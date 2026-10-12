import {writeFileSync} from 'node:fs';
import {isMainThread} from 'node:worker_threads';
import {CardFramework} from '../../src/core.js';
import {SessionStore} from '../../src/auth.js';

// Trusted test module: failures occur inside real framework commands and encrypted transactions.
export function createFrameworkOptions(options) {
  if (isMainThread) throw new Error('Framework callbacks must run in the owning worker');
  if (options.crashAfterSession === 'consume') {
    const get = SessionStore.prototype.get;
    SessionStore.prototype.get = function (...args) { const result = get.apply(this,args);if (args[2]?.consume) process.exit(17);return result; };
  } else if (options.crashAfterSession === 'revoke') {
    const revoke = SessionStore.prototype.revoke;
    SessionStore.prototype.revoke = function (...args) { revoke.apply(this,args);process.exit(17); };
  }
  if (options.crashAfterPurchase) {
    const purchase = CardFramework.prototype.purchase;
    CardFramework.prototype.purchase = function (...args) {
      purchase.apply(this,args);
      process.exit(17);
    };
  }
  return {
    clock:() => '2026-09-30T12:00:00.000Z',
    random:() => {
      if (options.marker) writeFileSync(options.marker,'entered');
      if (options.delayMs) {
        const until = performance.now() + options.delayMs;
        while (performance.now() < until) {}
      }
      if (options.throwRandom) throw new Error('Private provider failure detail');
      return 0;
    },
    bindings:{'demo.code':() => ({code:'worker-binding'})},
    policies:{canTrade:() => options.blockTrades ? 'Configured transfer rule' : true},
    eventSubscriptions:options.actions ? [{id:'purchase',handler:'purchase',events:['packs.purchased']}] : [],
    actionOptions:{timeoutMs:5000},
    actionHandlers:{purchase:async ({signal}) => {
      if (options.actionMarker) writeFileSync(options.actionMarker,'entered');
      if (options.waitForAbort) await new Promise((_,reject) => {
        const abort = () => { writeFileSync(options.actionMarker,'aborted'); reject(new Error('Canceled')); };
        if (signal.aborted) abort(); else signal.addEventListener('abort',abort,{once:true});
      });
    }},
  };
}
