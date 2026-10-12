import {createPresentationStore} from "../src/presentation/service.js";
import {createPresentationHandler} from "../src/presentation/node-http.js";
import {authorizePresentation} from "../src/access.js";
import {createCodeGateway} from '../src/code-gateway.js';
import {createCurrencyGateway} from "../src/currency-gateway.js";
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {FrameworkWorkerService} from '../src/framework-worker-service.js';
import {keyFromHex} from '../src/encryption.js';
import {parseContent} from '../src/importer.js';
import {SessionStore,createAuthHost,createOIDCProvider} from '../src/auth.js';
import {createApiHandler} from '../src/http.js';
import {createRateLimiter} from '../src/limits.js';
import {serveReference,securityHeaders} from '../src/static.js';

const secret=async name=>process.env[name+'_FILE']?(await readFile(process.env[name+'_FILE'],'utf8')).trim():process.env[name];
const origin=process.env.SITE_ORIGIN;
if(!origin||new URL(origin).origin!==origin||!origin.startsWith('https://'))throw new Error('SITE_ORIGIN must be an exact HTTPS origin');
const encryptionKey=keyFromHex(await secret('STATE_ENCRYPTION_KEY'));if(!encryptionKey)throw new Error('STATE_ENCRYPTION_KEY is required');
const issuer=process.env.OIDC_ISSUER,clientId=process.env.OIDC_CLIENT_ID;
const adminSubjects=JSON.parse(process.env.OPERATOR_SUBJECTS??'[]');if(!Array.isArray(adminSubjects)||adminSubjects.some(x=>typeof x!=='string'))throw new Error('OPERATOR_SUBJECTS must be a JSON string array');
const dbPath=resolve(process.env.DATABASE_PATH??'data/production.sqlite');await mkdir(dirname(dbPath),{recursive:true});
const extension=process.env.HOST_MODULE?await import(pathToFileURL(resolve(process.env.HOST_MODULE)).href):{};
const codeKeyConfig=await secret('CODE_VAULT_KEYS'),codeIndex=await secret('CODE_INDEX_KEY');
const codeVaultOptions=codeKeyConfig?({activeKeyId:process.env.CODE_ACTIVE_KEY_ID,keys:Object.fromEntries(Object.entries(JSON.parse(codeKeyConfig)).map(([id,hex])=>[id,keyFromHex(hex)])),indexKey:keyFromHex(codeIndex)}):undefined;
const workerOptions=extension.workerOptions??{};for(const name of Object.keys(workerOptions))if(!['maxPendingRequests','maxPendingBytes','startupTimeoutMs','closeTimeoutMs'].includes(name))throw new Error('Unsupported worker option '+name);
const framework=new FrameworkWorkerService({filename:dbPath,storeOptions:{encryptionKey,maxCompletionBytes:extension.limits?.completionBytes},extensionModule:process.env.HOST_MODULE,codeVaultOptions,
  frameworkOptions:{limits:{users:500,copies:5000,packs:2000,requests:20000,albums:2000,trades:2000,copiesPerUser:1000,packsPerUser:500}},...workerOptions});
try {
await framework.ready;
try{await framework.catalog();}catch(error){if(error.code!=='NO_CATALOG')throw error;if(!process.env.CATALOG_FILE)throw new Error('CATALOG_FILE is required for first initialization');await framework.publishCatalog({role:'admin'},parseContent(await readFile(process.env.CATALOG_FILE,'utf8'),{format:/\.ya?ml$/i.test(process.env.CATALOG_FILE)?'yaml':'json'}));}
const raw=await framework.operatorCatalog({role:'admin'}),runtime=await framework.runtimeCapabilities();
for(const variant of raw.variants)for(const binding of Object.values(variant.bindings))if(binding.factory&&!runtime.bindingFactories.includes(binding.factory))throw new Error('Configure binding factory '+binding.factory+' in HOST_MODULE');
if(raw.variants.some(v=>v.codes?.length)&&!runtime.codeVault)throw new Error('Configure CODE_VAULT_KEYS, CODE_ACTIVE_KEY_ID and CODE_INDEX_KEY before serving code cards');
await framework.verifyCodeVault({role:'admin'});
await framework.backfillCompletionReservations({role:'admin'});
await framework.backfillProvenance({role:'admin'});
const codeGateway=extension.codeProviders?createCodeGateway({framework,providers:extension.codeProviders}):undefined;
const audit=await framework.audit({role:'admin'});if(!audit.ok||!await framework.storeIntegrity())throw new Error('Database verification failed; restore a verified backup');
try{await framework.prepareRecordTransactions();}catch(error){if(!['STORAGE_CAPACITY','COMPLETION_CAPACITY'].includes(error.code))throw error;process.stderr.write('Record accounting migration deferred; worker planning uses compatibility summaries\n');}
const sessions=new SessionStore(dbPath,{encryptionKey,maxSessions:extension.sessionOptions?.maxSessions}),rateLimit=extension.rateLimiter??createRateLimiter(extension.rateLimits);
if(!extension.identityProvider&&(!issuer?.startsWith('https://')||!clientId))throw new Error('Configure OIDC or a host identityProvider');
const provider=extension.identityProvider??await createOIDCProvider({issuer,clientId,clientSecret:await secret('OIDC_CLIENT_SECRET'),origin});
const auth=createAuthHost({framework,sessions,provider,origin,adminSubjects,resolveAccess:extension.resolveAccess,rateLimit});
const currencyGateway=extension.currencyProviders?createCurrencyGateway({framework,providers:extension.currencyProviders}):undefined;
const api=createApiHandler({framework,currencyGateway,codeGateway,resolveIdentity:auth.resolveIdentity,allowedOrigin:origin,exposeOperators:true,requireTradeReview:true,requirePrincipal:true,rateLimit,
  onRequest:event=>{process.stdout.write(JSON.stringify({kind:'request',...event})+'\n');if(event.method==='POST')syncWorkers();}});
const presentations=process.env.PRESENTATION_ROOT?await createPresentationStore({root:resolve(process.env.PRESENTATION_ROOT),...extension.presentationOptions,authorize:authorizePresentation,validatePublication:async(actor,input)=>{await framework.registerCardPresentation(actor,input.archive);await extension.presentationOptions?.validatePublication?.(actor,input);}}):null;
const presentationHTTP=presentations?createPresentationHandler({store:presentations,resolveIdentity:auth.resolveIdentity,allowedOrigin:origin,rateLimit}):null;
const assetOrigins=(process.env.ASSET_ORIGINS??'').split(',').filter(Boolean);for(const value of assetOrigins)if(new URL(value).origin!==value||!value.startsWith('https://'))throw new Error('ASSET_ORIGINS requires exact HTTPS origins');
const server=createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:16384},async(req,res)=>{
  securityHeaders(res,{production:true});
  try{
    const path=new URL(req.url,origin).pathname;
    if(path==='/healthz'&&req.method==='GET'){res.setHeader('Content-Type','application/json');const status=framework.status(),ok=status.ready&&!status.saturated;res.statusCode=ok?200:503;res.end(JSON.stringify({ok}));return;}
    if(path==='/host/config'&&req.method==='GET'){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({mode:'production',brand:process.env.SITE_NAME??'Card Atelier',loginUrl:'/auth/login'}));return;}
    if(await auth.handle(req,res)||await presentationHTTP?.(req,res)||await api(req,res)||await extension.handleStatic?.(req,res,{framework})||await serveReference(req,res,{production:true,assetOrigins}))return;
    res.statusCode=404;res.end('Not found');
  }catch{res.statusCode=500;res.end('Request could not be completed');}
});
server.maxRequestsPerSocket=1000;server.keepAliveTimeout=5000;
let dispatching=null,actionWorker=null,maintenance=null,maintaining=null,planning=null;const workerAbort=new AbortController();
function syncWorkers(){
  if(workerAbort.signal.aborted)return Promise.resolve();
  if(planning)return planning;
  planning=(async()=>{
    const plan=await framework.workerPlan({role:'admin'});if(workerAbort.signal.aborted)return;
    const actions=plan.actions&&extension.actionWorker!==false&&runtime.actionHandlers;
    if(actions&&!actionWorker){actionWorker=setInterval(()=>{if(!dispatching){dispatching=framework.dispatchActions({permissions:['actions.dispatch']},{limit:10,signal:workerAbort.signal}).catch(()=>process.stderr.write('Action delivery cycle failed\n')).finally(()=>{dispatching=null;void syncWorkers();});}},1000);actionWorker.unref();}
    if(!actions&&actionWorker){clearInterval(actionWorker);actionWorker=null;}
    if(plan.maintenance&&!maintenance){maintenance=setInterval(()=>{if(!maintaining){maintaining=(async()=>{let failure;for(const method of ['sweepExpiredTrades','expireListings','drawDueRaffles'])try{await framework[method]({role:'admin'});}catch(error){failure??=error;}if(failure)throw failure;})().catch(()=>process.stderr.write('Scheduled maintenance failed\n')).finally(()=>{maintaining=null;void syncWorkers();});}},60000);maintenance.unref();}
    if(!plan.maintenance&&maintenance){clearInterval(maintenance);maintenance=null;}
  })().catch(()=>process.stderr.write('Worker planning failed\n')).finally(()=>{planning=null;});return planning;
}
await syncWorkers();
server.listen(Number(process.env.PORT??8080),process.env.BIND_ADDRESS??'127.0.0.1',()=>console.log('Framework production host ready on '+origin));
let closing=false;function shutdown(){if(closing)return;closing=true;clearInterval(maintenance);clearInterval(actionWorker);workerAbort.abort();server.close(async()=>{try{await Promise.all([dispatching,maintaining,planning]);await presentations?.close();sessions.close();await framework.close();process.exit(0);}catch{process.exit(1);}});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
} catch(error) { await framework.terminate(); throw error; }
