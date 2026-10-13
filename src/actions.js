import {completionContext,withCompletion,reserveDelivery,deliveryBytes,completionCapacity,completionDefaults} from './completion.js';
import { randomUUID } from "node:crypto";
import { check, integer, text, jsonObject,FrameworkError } from "./catalog.js";
import { hasPermission } from "./access.js";
import { contentDigest } from "./importer.js";
import {validRecordAccounting,recordAccountingField} from './record-accounting.js';
import { page } from "./data.js";

export function enqueueAction(
  s,
  { handler, params = {}, userId = null, source },
  at,
) {
  text(handler, "action handler", 100);
  jsonObject(params);
  jsonObject(source);
  s.actionJobs ??= {};
  const job = {
    id: randomUUID(),
    ...(completionContext(s)?{completionId:completionContext(s).id}:{}),
    handler,
    params: structuredClone(params),
    userId,
    source: structuredClone(source),
    status: "pending",
    attempts: 0,
    totalAttempts: 0,
    history: [{ type: "queued", at }],
    createdAt: at,
    nextAt: at,
    leaseToken: null,
    leaseUntil: null,
    error: null,
    completedAt: null,
  };
  s.actionJobs[job.id] = job;
  reserveDelivery(s,job);
  return job;
}
export function openingActions(s, copy, userId, at) {
  copy.actionJobIds ??= [];
  for (const action of copy.variant.onOpen ?? [])
    copy.actionJobIds.push(
      enqueueAction(
        s,
        {
          handler: action.handler,
          params: action.params,
          userId,
          source: {
            type: "card.opened",
            copyId: copy.id,
            actionId: action.id,
            packId: copy.source?.packId ?? null,
          },
        },
        at,
      ).id,
    );
}
const operator = (actor, permission) =>
  check(
    hasPermission(actor, permission),
    "FORBIDDEN",
    "Action operator permission required",
    403,
  );
const view = (job) => ({
  id: job.id,
  handler: job.handler,
  userId: job.userId,
  source: job.source,
  status: job.status,
  attempts: job.attempts,
  createdAt: job.createdAt,
  nextAt: job.nextAt,
  completedAt: job.completedAt,
  error: job.error,
  totalAttempts: job.totalAttempts ?? job.attempts,
  history: job.history ?? [],
});
export class ActionService {
  #bindingActivation;
  #store;
  #clock;
  #handlers;
  #options;
  #compactBindingHistory(job){
    const history=job.history??[];if(history.length<=128)return;
    const summary={type:'history-summary',at:history[0].at,entries:0,attempts:0,unconfirmed:0,retries:0};
    for(const row of history.slice(0,-127)){if(row.type==='history-summary'){for(const key of ['entries','attempts','unconfirmed','retries'])summary[key]+=row[key]??0;}else{summary.entries++;summary.attempts+=Number(row.type==='attempt-started');summary.unconfirmed+=Number(row.type==='unconfirmed');summary.retries+=Number(row.type==='retry-requested');}}
    for(const key of ['entries','attempts','unconfirmed','retries'])check(Number.isSafeInteger(summary[key]),'INSTALLATION_CAPACITY','Binding recovery counter capacity reached',507);
    job.history=[summary,...history.slice(-127)];
  }
  setBindingActivation(handler){this.#bindingActivation=handler;}
  claimBindingActivation(jobId,{retry=false}={}){
    return this.#store.transactRecords(tx=>{
      const job=tx.get('actionJobs',jobId);check(job?.source.type==='binding.activation','ACTION_STATE','Binding activation job required',409);
      this.#compactBindingHistory(job);
      if(retry&&job.status==='dead'){job.status='pending';job.attempts=0;job.nextAt=this.#clock();job.error=null;job.history.push({type:'retry-requested',at:this.#clock(),actorId:null});}
      else if(retry&&job.status==='pending')job.nextAt=this.#clock();
      const now=Date.parse(this.#clock());if(!((job.status==='pending'&&Date.parse(job.nextAt)<=now)||(job.status==='running'&&Date.parse(job.leaseUntil)<=now)))return null;
      const result=this.#startJob(job,this.#clock(),now);tx.put('actionJobs',jobId,job);const obligation=tx.get('completionObligations',job.completionId);tx.put('completionObligations',obligation.id,obligation);tx.reserveActionCompletion(obligation.id);return result;
    },{bindingFactories:true,maxRecords:16,maxBytes:1048576});
  }
  finishBindingActivation(tx,job,succeeded){const live=tx.get('actionJobs',job.id);check(live?.source.type==='binding.activation'&&live.status==='running'&&live.leaseToken===job.leaseToken&&Date.parse(live.leaseUntil)>Date.parse(this.#clock()),'ACTION_LEASE','Binding activation lease is no longer current',409);this.#finishJob(live,succeeded);this.#compactBindingHistory(live);tx.put('actionJobs',live.id,live);return view(live);}
  #limits;
  #completeJob(s,job,fn){
    const measure=state=>this.#store.measure?.(state)??{usedBytes:Buffer.byteLength(JSON.stringify(state))},before=measure(s).usedBytes;
    reserveDelivery(s,job);
    const obligation=s.completionObligations?.[job.completionId??job.deliveryCompletionId];
    check(obligation,'INVALID_STATE','Action completion obligation is missing',500);
    const result=withCompletion(s,obligation,fn,measure,before);completionCapacity(s,this.#limits);return result;
  }
  constructor({ store, clock, handlers = {}, options = {}, limits=completionDefaults }) {
    this.#store = store;
    this.#clock = clock;
    this.#handlers = handlers;
    this.#limits=limits;
    this.#options = {
      maxAttempts: 8,
      leaseMs: 60000,
      timeoutMs: 15000,
      retryMs: 1000,
      ...options,
    };
    for (const [k, max] of Object.entries({
      maxAttempts: 100,
      leaseMs: 3600000,
      timeoutMs: 300000,
      retryMs: 3600000,
    }))
      integer(this.#options[k], k, 1, max);
    check(
      this.#options.leaseMs > this.#options.timeoutMs,
      "INVALID_INPUT",
      "Action lease must exceed execution timeout",
    );
  }
  history(actor, options = {}, all = false) {
    if (all) operator(actor, "actions.manage");
    return this.#store.read((s) => {
      if (!all)
        check(
          actor?.disabled !== true &&
            actor?.userId &&
            Object.hasOwn(s.users, actor.userId),
          "UNAUTHENTICATED",
          "Verified account required",
          401,
        );
      return page(
        Object.values(s.actionJobs ?? {})
          .filter((j) => all || j.userId === actor.userId)
          .map(view),
        options,
      );
    });
  }
  #retryLegacy(actor, { key, jobId }) {
    operator(actor, "actions.manage");
    text(jobId, "job ID", 100);
    text(key, "retry key", 128);
    return this.#store.transact((s) => {
      s.actionRetryRequests ??= {};
      const token = contentDigest({ actorId: actor.userId ?? "operator", key }),
        old = s.actionRetryRequests[token];
      if (old) {
        check(
          old.jobId === jobId,
          "IDEMPOTENCY_CONFLICT",
          "Retry key already used",
          409,
        );
        return old.result;
      }
      check(
        Object.keys(s.actionRetryRequests).length < 20000,
        "INSTALLATION_CAPACITY",
        "Action retry capacity reached",
        507,
      );
      const j = s.actionJobs?.[jobId];
      check(j, "NOT_FOUND", "Action not found", 404);
      check(j.source.type!=='binding.activation','BINDING_ACTIVATION_REQUIRED','Use binding factory recovery for activation jobs',409);
      check(
        j.status === "dead",
        "ACTION_STATE",
        "Only dead actions can be retried",
        409,
      );
      check(
        (j.history?.length ?? 0) <= 1997,
        "INSTALLATION_CAPACITY",
        "Action history capacity reached; operator review required",
        507,
      );
      reserveDelivery(s,j);const reservation=s.completionObligations[j.completionId??j.deliveryCompletionId];reservation.bytes+=deliveryBytes;
      j.status = "pending";
      j.attempts = 0;
      j.nextAt = this.#clock();
      j.error = null;
      j.retryCount = (j.retryCount ?? 0) + 1;
      (j.history ??= []).push({
        type: "retry-requested",
        at: this.#clock(),
        actorId: actor.userId ?? null,
      });
      const result = view(j);
      s.actionRetryRequests[token] = { jobId, result };
      completionCapacity(s,this.#limits);
      return result;
    });
  }
  #claimLegacy(actor) {
    operator(actor, "actions.dispatch");
    const due = (j, now) =>
      (j.status === "pending" && Date.parse(j.nextAt) <= now) ||
      (j.status === "running" && Date.parse(j.leaseUntil) <= now);
    if (
      !this.#store.read((s) =>
        Object.values(s.actionJobs ?? {}).some((j) =>
          due(j, Date.parse(this.#clock())),
        ),
      )
    )
      return null;
    return this.#store.transact((s) => {
      const at = this.#clock(),
        now = Date.parse(at);
      for (const j of Object.values(s.actionJobs ?? {})) {
        if (!due(j, now)) continue;
        const claimed=this.#completeJob(s,j,()=>this.#startJob(j,at,now));
        if(claimed)return claimed;
      }
      return null;
    });
  }
  #settleLegacy(actor, { jobId, leaseToken, succeeded }) {
    operator(actor, "actions.dispatch");
    check(
      typeof succeeded === "boolean",
      "INVALID_INPUT",
      "Delivery result must be boolean",
    );
    return this.#store.transact((s) => {
      const j = s.actionJobs?.[jobId];
      check(j?.source.type!=='binding.activation','BINDING_ACTIVATION_REQUIRED','Binding activation requires authenticated typed settlement',409);
      check(
        j?.status === "running" &&
          j.leaseToken === leaseToken &&
          Date.parse(j.leaseUntil) > Date.parse(this.#clock()),
        "ACTION_LEASE",
        "Delivery lease is no longer current",
        409,
      );
      return this.#completeJob(s,j,()=>this.#finishJob(j,succeeded));
    });
  }
  #startJob(j,at,now){
        if (j.attempts >= this.#options.maxAttempts) {
          j.status = "dead";
          j.error =
            "Delivery attempts exhausted; provider reconciliation required";
          j.leaseToken = null;
          j.leaseUntil = null;
          return null;
        }
        if ((j.history?.length ?? 0) > 1998) {
          j.status = "dead";
          j.error = "Action history capacity reached; operator review required";
          j.leaseToken = null;
          j.leaseUntil = null;
          return null;
        }
        j.status = "running";
        j.attempts++;
        j.totalAttempts = (j.totalAttempts ?? 0) + 1;
        (j.history ??= []).push({
          type: "attempt-started",
          at,
          attempt: j.totalAttempts,
        });
        j.leaseToken = randomUUID();
        j.leaseUntil = new Date(now + this.#options.leaseMs).toISOString();
        return structuredClone(j);
  }
  #finishJob(j,succeeded){
      j.leaseToken = null;
      j.leaseUntil = null;
      (j.history ??= []).push({
        type: succeeded ? "succeeded" : "unconfirmed",
        at: this.#clock(),
        attempt: j.totalAttempts ?? j.attempts,
      });
      if (succeeded) {
        j.status = "succeeded";
        j.completedAt = this.#clock();
        j.error = null;
      } else {
        j.status = j.attempts >= this.#options.maxAttempts ? "dead" : "pending";
        j.error =
          "Delivery not confirmed; provider reconciliation may be required";
        j.nextAt = new Date(
          Date.parse(this.#clock()) +
            Math.min(
              3600000,
              this.#options.retryMs * 2 ** Math.min(j.attempts - 1, 20),
            ),
        ).toISOString();
      }
      return view(j);
  }
  #recordJob(tx,jobId,fn,{retry=false}={}){
    const raw=tx.value(recordAccountingField);let summary;try{summary=JSON.parse(raw);}catch{}
    check(validRecordAccounting(summary,tx.value('revision')),raw!==undefined&&(!summary||summary.version===3)?'INVALID_STATE':'RECORD_PATH_UNAVAILABLE','Action records require valid prepared accounting',503);
    const j=tx.get('actionJobs',jobId);check(j,'NOT_FOUND','Action not found',404);
    const id=j.completionId??j.deliveryCompletionId,row=id&&tx.get('completionObligations',id);
    check(row?.status==='completed','RECORD_PATH_UNAVAILABLE','Action requires compatibility reservation recovery',503);
    check(Number.isSafeInteger(row.bytes)&&Number.isSafeInteger(row.usedBytes)&&row.usedBytes>=0&&row.usedBytes<=row.bytes,'INVALID_STATE','Invalid completion byte accounting',500);
    const result=fn(j,row);tx.put('actionJobs',jobId,j);tx.put('completionObligations',id,row);
    if(!retry)tx.reserveActionCompletion(id);return result;
  }
  #actionOptions(retry=false){return {actionDelivery:true,actionRetry:retry,actionLimits:this.#limits,maxRecords:16,maxBytes:16*1024*1024};}
  retry(actor,input){
    if(!this.#store.selectDueActions)return this.#retryLegacy(actor,input);
    operator(actor,'actions.manage');text(input.jobId,'job ID',100);text(input.key,'retry key',128);
    const token=contentDigest({actorId:actor.userId??'operator',key:input.key});
    try{return this.#store.transactRecords(tx=>{
      const old=tx.get('actionRetryRequests',token);if(old){check(old.jobId===input.jobId,'IDEMPOTENCY_CONFLICT','Retry key already used',409);return old.result;}
      check(tx.count('actionRetryRequests')<20000,'INSTALLATION_CAPACITY','Action retry capacity reached',507);
      const result=this.#recordJob(tx,input.jobId,(j,row)=>{
        check(j.source.type!=='binding.activation','BINDING_ACTIVATION_REQUIRED','Use binding factory recovery for activation jobs',409);
        check(j.status==='dead','ACTION_STATE','Only dead actions can be retried',409);
        check((j.history?.length??0)<=1997,'INSTALLATION_CAPACITY','Action history capacity reached; operator review required',507);
        row.bytes+=deliveryBytes;j.status='pending';j.attempts=0;j.nextAt=this.#clock();j.error=null;j.retryCount=(j.retryCount??0)+1;
        (j.history??=[]).push({type:'retry-requested',at:this.#clock(),actorId:actor.userId??null});return view(j);
      },{retry:true});
      tx.put('actionRetryRequests',token,{jobId:input.jobId,result});return result;
    },this.#actionOptions(true));}catch(error){if(error.code==='RECORD_PATH_UNAVAILABLE')return this.#retryLegacy(actor,input);throw error;}
  }
  claim(actor){
    if(!this.#store.selectDueActions)return this.#claimLegacy(actor);
    operator(actor,'actions.dispatch');
    const selected=this.#store.selectDueActions(this.#clock(),32);
    for(const jobId of selected){
      try{const result=this.#store.transactRecords(tx=>{
        const at=this.#clock(),now=Date.parse(at),job=tx.get('actionJobs',jobId);
        if(job?.source.type==='binding.activation')throw new FrameworkError('BINDING_JOB','Use typed binding activation delivery',409);
        if(!job||!((job.status==='pending'&&Date.parse(job.nextAt)<=now)||(job.status==='running'&&Date.parse(job.leaseUntil)<=now)))return null;
        return this.#recordJob(tx,jobId,j=>this.#startJob(j,at,now));
      },this.#actionOptions());if(result)return result;}catch(error){if(error.code==='BINDING_JOB'){const result=this.claimBindingActivation(jobId);if(result)return result;continue;}if(error.code==='RECORD_PATH_UNAVAILABLE')return this.#claimLegacy(actor);throw error;}
    }
    return null;
  }
  settle(actor,input){
    if(!this.#store.selectDueActions)return this.#settleLegacy(actor,input);
    operator(actor,'actions.dispatch');check(typeof input.succeeded==='boolean','INVALID_INPUT','Delivery result must be boolean');
    try{return this.#store.transactRecords(tx=>{
      const job=tx.get('actionJobs',input.jobId);
      check(job?.source.type!=='binding.activation','BINDING_ACTIVATION_REQUIRED','Binding activation requires authenticated typed settlement',409);
      check(job?.status==='running'&&job.leaseToken===input.leaseToken&&Date.parse(job.leaseUntil)>Date.parse(this.#clock()),'ACTION_LEASE','Delivery lease is no longer current',409);
      return this.#recordJob(tx,input.jobId,j=>this.#finishJob(j,input.succeeded));
    },this.#actionOptions());}catch(error){if(error.code==='RECORD_PATH_UNAVAILABLE')return this.#settleLegacy(actor,input);throw error;}
  }
  async dispatch(actor, { limit = 10, signal } = {}) {
    operator(actor, "actions.dispatch");
    integer(limit, "dispatch limit", 1, 100);
    const results = [];
    for (let i = 0; i < limit && !signal?.aborted; i++) {
      const job = this.claim(actor);
      if (!job) break;
      if(job.source.type==='binding.activation'){
        check(this.#bindingActivation,'BINDING_FACTORY_PENDING','Binding activation provider is unavailable',503);
        try{results.push(await this.#bindingActivation(job,signal));}catch(error){if(error.code!=='ACTION_LEASE')throw error;results.push({id:job.id,status:'lease-lost'});}continue;
      }
      const controller = new AbortController();
      let timer, abort;
      let succeeded = false;
      try {
        const handler =
          Object.hasOwn(this.#handlers, job.handler) &&
          this.#handlers[job.handler];
        check(
          typeof handler === "function",
          "ACTION_HANDLER",
          "Action handler unavailable",
          503,
        );
        await Promise.race([
          Promise.resolve().then(() =>
            handler({
              idempotencyKey: job.id,
              userId: job.userId,
              source: structuredClone(job.source),
              params: structuredClone(job.params),
              signal: controller.signal,
            }),
          ),
          new Promise((_, reject) => {
            abort = () => {
              controller.abort();
              reject(new Error("Canceled"));
            };
            signal?.addEventListener("abort", abort, { once: true });
            timer = setTimeout(abort, this.#options.timeoutMs);
            if (signal?.aborted) abort();
          }),
        ]);
        succeeded = !controller.signal.aborted;
      } catch {
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        controller.abort();
      }
      try {
        results.push(
          this.settle(actor, {
            jobId: job.id,
            leaseToken: job.leaseToken,
            succeeded,
          }),
        );
      } catch (error) {
        if (error.code !== "ACTION_LEASE") throw error;
        results.push({ id: job.id, status: "lease-lost" });
      }
    }
    return results;
  }
}
