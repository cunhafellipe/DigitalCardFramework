import {localizeDiagnostic} from './localization.js';
import { el, button as baseButton, field, select, section } from "./ui-kit.js";
import {createLocalization,localizationKeys} from "./localization.js";
export {renderMarketplace} from "./marketplace-native.js";

export function renderFulfillments(model, { client,locale='en',messages={},localization=createLocalization({locale,messages}) } = {}) {
  const t=localization.text,enumLabel=value=>Object.hasOwn(localizationKeys,'rewards.status.'+value)?t('rewards.status.'+value):value;
  const button=(label,callback,...options)=>baseButton(label,(...args)=>{if(disposed)return;return callback(...args)},...options);
  const node = section(
      t('rewards.title'),
      t('rewards.description'),
    ),
    list = el("div"),
    status = el("p", "dc-muted");
  node.setAttribute('lang',localization.locale);node.setAttribute('dir',localization.dir);status.setAttribute('role','status');
  let disposed = false,
    cursor = null,
    generation = 0;
  const operator =
      model.me.role === "admin" ||
      model.me.permissions?.includes("actions.manage"),
    scope = select(
      node,
      t('rewards.history'),
      operator
        ? [
            { id: "own", name:t('rewards.own') },
            { id: "all", name:t('rewards.queue') },
          ]
        : [{ id: "own", name:t('rewards.own') }],
    ),
    more = button(t('rewards.more'), () => load(false), "dc-quiet");
  node.append(
    button(t('rewards.refresh'), () => load(true), "dc-quiet"),
    status,
    list,
    more,
  );
  async function load(reset) {
    if(disposed)return;
    const current = ++generation;
    if (reset) {
      cursor = null;
      list.replaceChildren();
    }
    more.disabled = true;
    try {
      const result = await client[
        scope.value === "all" ? "actionJobs" : "fulfillments"
      ]({ limit: 24, after: cursor });
      if (disposed || current !== generation) return;
      for (const job of result.items) {
        const item = el("article", "dc-form-panel");
        item.append(
          el("h3", "", job.handler),
          el("p", "", enumLabel(job.status)),
          el("p", "dc-muted", job.error ?? ""),
          el("p", "dc-muted",t('rewards.reference',{id:job.id})),
        );
        if (operator && scope.value === "all" && job.status === "dead")
          item.append(
            button(t('rewards.retry'), async () => {
              try {
                await client.retryAction({
                  key: client.requestKey(),
                  jobId: job.id,
                });
                await load(true);
              } catch (error) {
                if (!disposed) status.textContent = localizeDiagnostic(localization,error);
              }
            }),
          );
        list.append(item);
      }
      cursor = result.next;
      more.hidden = !cursor;
      status.textContent = t('rewards.total',{count:result.total});
    } catch (error) {
      if (!disposed) status.textContent = localizeDiagnostic(localization,error);
    } finally {
      if(!disposed)more.disabled = false;
    }
  }
  scope.addEventListener("change", () => load(true));
  const ready = load(true);
  return {
    node,
    ready,
    dispose() {
      disposed = true;
      generation++;
      node.replaceChildren();
    },
  };
}

export function renderTradingControls(model, { client,locale='en',messages={},localization=createLocalization({locale,messages}) } = {}) {
  const t=localization.text;
  const button=(label,callback,...options)=>baseButton(label,(...args)=>{if(disposed)return;return callback(...args)},...options);
  const node = section(
      t('tradingControls.title'),
      t('tradingControls.description'),
    ),
    status = el("p", "dc-muted");
  node.setAttribute('lang',localization.locale);node.setAttribute('dir',localization.dir);status.setAttribute('role','status');
  node.append(status);
  let disposed = false;
  async function load() {
    if(disposed)return;
    try {
      const current = await client.tradingPolicy();
      if (disposed) return;
      const json = field(node,t('tradingControls.policyJSON'), {
        type: "textarea",
        value: JSON.stringify(current.policy, null, 2),
      });
      json.rows = 18;
      node.append(
        button(t('tradingControls.apply'), async () => {
          try {
            const result = await client.configureTrading({
              key: client.requestKey(),
              expectedRevision: current.revision,
              policy: JSON.parse(json.value),
            });
            if(disposed)return;
            current.revision = result.revision;
            status.textContent = t('tradingControls.saved');
          } catch (error) {
            if(!disposed)status.textContent = localizeDiagnostic(localization,error);
          }
        }),
      );
      const copyId = field(node,t('tradingControls.copyId')),
        reason = field(node,t('tradingControls.reason'), {
          value:t('tradingControls.defaultReason'),
        }),
        until = field(node,t('tradingControls.expiry'));
      for (const locked of [true, false])
        node.append(
          button(t(locked?'tradingControls.lock':'tradingControls.unlock'), async () => {
            try {
              await client.setCardTransferLock({
                key: client.requestKey(),
                copyId: copyId.value,
                locked,
                reason: reason.value,
                until: until.value || null,
              });
              if(!disposed)status.textContent = t(locked?'tradingControls.locked':'tradingControls.unlocked');
            } catch (error) {
              if(!disposed)status.textContent = localizeDiagnostic(localization,error);
            }
          }),
        );
    } catch (error) {
      if (!disposed) status.textContent = localizeDiagnostic(localization,error);
    }
  }
  const ready = load();
  return {
    node,
    ready,
    dispose() {
      disposed = true;
      node.replaceChildren();
    },
  };
}
