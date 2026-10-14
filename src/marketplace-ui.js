import { el, button as baseButton, field, select, section } from "./ui-kit.js";
import {createCommandRunner} from "./client.js";
import {createLocalization,localizationKeys} from "./localization.js";

export function renderMarketplace(
  model,
  { client, cardRenderer, listingRenderer, refresh, mutate, storage, locale='en',messages={},localization=createLocalization({locale,messages}) } = {},
) {
  const t=localization.text,num=localization.number,date=localization.date,enumLabel=(group,value)=>Object.hasOwn(localizationKeys,'marketplace.'+group+'.'+value)?t('marketplace.'+group+'.'+value):value;
  const enabled=name=>!model.capabilities||model.capabilities.available[name];
  const workflow=kind=>kind==='mint-pack'?'packs':['mint-card','action'].includes(kind)?'directSales':'resale';
  const button=(label,callback,...options)=>baseButton(label,(...args)=>{if(disposed)return;return callback(...args)},...options);
  const node = section(
      t('marketplace.title'),
      t('marketplace.description'),
    ),
    status = el("p", "dc-muted"),
    list = el("div", "dc-market-list"),
    review = el("div", "dc-form-panel");
  node.setAttribute('lang',localization.locale);node.setAttribute('dir',localization.dir);
  status.setAttribute("role", "status");
  node.append(status, review, list);
  review.style.display = "none";
  let disposed = false,
    busy = false,
    cursor = null,
    generation = 0;
  let invalidateStockForm=()=>{};
  let persistence=storage;
  if(persistence===undefined)try{persistence=node.ownerDocument.defaultView?.sessionStorage;}catch{}
  const cleanups = [],
    reviewCleanups = [],
    run = mutate ?? createCommandRunner({client,storage:persistence,namespace:model.me.userId});
  function clearReview() {
    reviewCleanups.splice(0).forEach((fn) => fn());
    review.replaceChildren();
    review.style.display = "none";
  }
  async function action(fn) {
    if (busy || disposed) return;
    busy = true;
    try {
      await fn();
    } catch (error) {
      if (!disposed) status.textContent = error.message;
    } finally {
      busy = false;
    }
  }
  async function purchase(listing,{newPurchase=false}={}) {
    await action(async () => {
      const original=run.pending?.('buyListing');
      if(original&&!original._confirmed&&original.listingId!==listing.id)throw new Error(t('marketplace.resolvePurchase'));
      if(newPurchase&&original&&!original._confirmed)throw new Error(t('marketplace.recoverPurchase'));
      const quote = !newPurchase&&original ? original : await client.quoteListing({ listingId: listing.id });
      if (disposed) return;
      clearReview();
      review.style.display = "";
      review.replaceChildren(
        el("h3", "", !newPurchase&&original ? t('marketplace.retryPurchase') : t('marketplace.reviewPurchase')),
        el("p", "", num(quote.price.amount) + " " + quote.price.currencyId),
      );
      for (const item of quote.items ?? []) {
        if (item.copy && cardRenderer) {
          const rendered = cardRenderer(item.copy, { interactive: false,localization });
          review.append(rendered.node ?? rendered);
          if (rendered.dispose) reviewCleanups.push(() => rendered.dispose());
        } else
          review.append(el("p", "", item.pack?.product.name ?? t('marketplace.customItem')));
      }
      review.append(
        button(t('marketplace.confirmPurchase'), () =>
          action(async () => {
            const order = await (newPurchase&&run.beginNew ? run.beginNew("buyListing",quote) : original&&run.recover ? run.recover("buyListing",quote) : run("buyListing", quote));
            if (disposed) return;
            clearReview();
            review.style.display = "";
            review.replaceChildren(
              el("p", "", t('marketplace.purchased',{id:order.id})),
              button(t('marketplace.newPurchase'),()=>purchase(listing,{newPurchase:true})),
            );
            if (refresh) await refresh();
            else await load(true);
          }),
        ),
        button(t('marketplace.closeReview'), clearReview, "dc-quiet"),
      );
    });
  }
  function defaultListing(l) {
    const card = el("article", "dc-form-panel");
    card.append(
      el("h3", "", l.title),
      el("p", "", l.description),
      el(
        "p",
        "dc-muted",
        t('marketplace.listingInfo',{shop:l.shopName,phase:enumLabel('phase',l.phase),count:l.remaining}),
      ),
      el("p", "", num(l.price.amount) + " " + l.price.currencyId),
      el("p", "dc-muted", t('marketplace.release',{date:date(l.startsAt)})),
    );
    if (l.preview?.preallocated)
      card.append(
        el(
          "p",
          "dc-muted",
          t('marketplace.preallocated'),
        ),
      );
    if (l.mine && l.status === "active")
      card.append(
        button(
          t('marketplace.cancelStock'),
          () =>
            action(async () => {
              await run("cancelListing", { listingId: l.id });
              if (refresh) await refresh();
              else await load(true);
            }),
          "dc-quiet",
        ),
      );
    else if (l.raffle) {
      const own = el("p", "dc-muted");
      card.append(
        el(
          "p",
          "",
          t('marketplace.raffleTerms'),
        ),
        own,
        button(
          t('marketplace.checkRaffle'),
          () =>
            action(async () => {
              const r = await client.raffleStatus({ listingId: l.id });
              if (disposed) return;
              own.textContent = r.orderId
                ? t('marketplace.claimed')
                : r.winner
                  ? t('marketplace.won',{date:date(r.claimUntil)})
                  : r.drawnAt
                    ? t('marketplace.notSelected')
                    : r.entered
                      ? t('marketplace.awaitingDraw')
                      : t('marketplace.notEntered');
              if (r.winner && !r.orderId)
                own.append(button(t('marketplace.reviewWinner'), () => purchase(l)));
            }),
          "dc-quiet",
        ),
      );
      if (l.phase === "entries-open" && enabled(workflow(l.kind)))
        card.append(
          button(t('marketplace.enterRaffle'), () =>
            action(async () => {
              await run("enterRaffle", { listingId: l.id });
              if (!disposed) own.textContent = t('marketplace.entered');
            }),
          ),
        );
    } else if (l.phase === "live" && enabled(workflow(l.kind)))
      card.append(button(t('marketplace.reviewPurchase'), () => purchase(l)));
    return card;
  }
  const more = button(t('marketplace.more'), () => load(false), "dc-quiet");
  async function load(reset) {
    if(disposed)return;
    const current = ++generation;
    if (reset) {
      invalidateStockForm();
      cursor = null;
      cleanups.splice(0).forEach((fn) => fn());
      list.replaceChildren();
      clearReview();
    }
    more.disabled = true;
    try {
      const result = await client.listings({ limit: 24, after: cursor });
      if (disposed || current !== generation) return;
      for (const l of result.items) {
        const rendered = listingRenderer
          ? listingRenderer(l, {
              purchase,
              defaultRenderer: defaultListing,
              client, localization,
            })
          : defaultListing(l);
        list.append(rendered.node ?? rendered);
        if (rendered.dispose) cleanups.push(() => rendered.dispose());
      }
      cursor = result.next;
      more.hidden = !cursor;
      status.textContent = t('marketplace.listings',{count:result.total});
    } catch (error) {
      if (!disposed) status.textContent = error.message;
    } finally {
      if(!disposed)more.disabled = false;
    }
  }
  node.prepend(button(t('marketplace.refresh'), () => load(true), "dc-quiet"));
  node.append(more);
  async function compose() {
    if(disposed)return;
    if(!['packs','directSales','resale'].some(enabled))return;
    try {
      const [shops, settings] = await Promise.all([
        client.shops({ limit: 200 }),
        client.commerceSettings(),
      ]);
      if (disposed||typeof client.principal==='function'&&client.principal()!==model.me.userId) return;
      const admin =
          model.me.role === "admin" ||
          model.me.permissions?.includes("commerce.manage"),
        own = shops.items.filter((s) => s.mine);
      if ((enabled('resale') && (settings.effectiveSettings?.playerShops ?? settings.settings.playerShops) && !model.me.adminStatus?.restrictions?.sellingBlocked) || admin) {
        const box = el("details", "dc-form-panel");
        box.append(el("summary", "", t('marketplace.createShop')));
        const name = field(box, t('marketplace.shopName')),
          kind = select(
            box,
            t('marketplace.shopType'),
            admin
              ? [
                  { id: "admin", name: t('marketplace.adminShop') },
                  ...(enabled('resale')?[{ id: "player", name: t('marketplace.playerShop') }]:[]),
                ]
              : [{ id: "player", name: t('marketplace.playerShop') }],
          );
        box.append(
          button(t('marketplace.createShopButton'), () =>
            action(async () => {
              await run("createShop", { name: name.value, kind: kind.value });
              if (refresh) await refresh();
              else if (!disposed)
                status.textContent =
                  t('marketplace.shopCreated');
            }),
          ),
        );
        node.append(box);
      }
      if (own.length && (admin||enabled('resale'))) {
        const box = el("details", "dc-form-panel");
        box.append(el("summary", "", t('marketplace.listStock')));
        const shop = select(
            box,
            t('marketplace.shop'),
            own.map((s) => ({ id: s.id, name: s.name })),
          ),
          title = field(box, t('marketplace.listingTitle')),
          currency = select(box, t('marketplace.currency'), model.catalog.currencies),
          amount = field(box, t('marketplace.unitPrice'), { type: "number", value: "1" }),
          kind = select(box, t('marketplace.stockSource'), [
            ...(enabled('resale')?[{ id: "copies", name: t('marketplace.ownedCard') }]:[]),
            ...(enabled('resale')&&settings.settings.packResale
              ? [{ id: "packs", name: t('marketplace.ownedPack') }]
              : []),
            ...(admin
              ? [
                  { id: "mint-card", name: t('marketplace.issueCard') },
                  { id: "mint-pack", name: t('marketplace.issuePack') },
                  { id: "action", name: t('marketplace.actionItem') },
                ]
              : []),
          ].filter(item=>enabled(workflow(item.id)))),
          target = select(box, t('marketplace.stockItem'), []),
          quantity = field(box, t('marketplace.stockQuantity'), {
            type: "number",
            value: "1",
          }),
          handler = field(box, t('marketplace.handler')),
          params = field(box, t('marketplace.params'), {
            type: "textarea",
            value: "{}",
          }),
          preview = field(box, t('marketplace.previewTime')),
          starts = field(box, t('marketplace.releaseTime')),
          ends = field(box, t('marketplace.endTime')),
          raffle = field(box, t('marketplace.raffleJson'), {
            type: "textarea",
            value: "",
          });
        function choices() {
          target.replaceChildren();
          const rows =
            kind.value === "copies"
              ? model.inventory
                  .filter((c) => !c.lockedBy)
                  .map((c) => ({
                    id: c.id,
                    name: c.definition.name + " · " + c.id.slice(0, 8),
                  }))
              : kind.value === "packs"
                ? model.packs
                    .filter((p) => !p.openedAt && !p.lockedBy)
                    .map((p) => ({ id: p.id, name: p.product.name }))
                : kind.value === "mint-card"
                  ? model.catalog.variants.map((v) => ({
                      id: v.id,
                      name:
                        model.catalog.cards.find((c) => c.id === v.cardId)
                          .name +
                        " · " +
                        v.id,
                    }))
                  : model.catalog.products;
          for (const item of rows) {
            const option = el("option", "", item.name);
            option.value = item.id;
            target.append(option);
          }
        }
        kind.addEventListener("change", choices);
        choices();
        let formVersion=0,stockQuote=null,reviewedListing=null,stockAttempt=null,stockBlocked=false;
        const stockNote=el('p','dc-muted'),attemptNote=el('p','dc-muted');stockNote.setAttribute('role','status');attemptNote.setAttribute('role','status');
        const principal=model.me.userId;
        function stockDeckVersion(){const strategy=model.catalog.products.find(product=>product.id===target.value)?.allocationStrategy;return strategy&&Object.keys(strategy).length===3&&strategy.deckScope==='purchase-slot'&&((strategy.algorithm==='weighted-deck@1'&&strategy.version===1)||(strategy.algorithm==='weighted-deck@2'&&strategy.version===2)||(strategy.algorithm==='weighted-deck@3'&&strategy.version===3)||(strategy.algorithm==='weighted-deck@4'&&strategy.version===4))?strategy.version:0;}
        const ticketStock=()=>kind.value==='mint-pack'&&stockDeckVersion()>0;
        function fence(version=formVersion){if(disposed||!node.contains(box)||typeof client.principal==='function'&&client.principal()!==principal)throw new Error(t('marketplace.changedView'));if(version!==formVersion)throw new Error(t('marketplace.changedListing'));}
        function listingInput(){
              const items =
                kind.value === "copies" || kind.value === "packs"
                  ? { kind: kind.value, ids: [target.value] }
                  : kind.value === "action"
                    ? {
                        kind: "action",
                        handler: handler.value,
                        params: JSON.parse(params.value),
                        quantity: Number(quantity.value),
                      }
                    : {
                        kind: kind.value,
                        [kind.value === "mint-card"
                          ? "variantId"
                          : "productId"]: target.value,
                        quantity: Number(quantity.value),
                      };
              return {
                shopId: shop.value,
                title: title.value,
                price: {
                  currencyId: currency.value,
                  amount: Number(amount.value),
                },
                items,
                ...(preview.value ? { previewAt: preview.value } : {}),
                ...(starts.value ? { startsAt: starts.value } : {}),
                ...(ends.value ? { endsAt: ends.value } : {}),
                ...(raffle.value ? { raffle: JSON.parse(raffle.value) } : {}),
              };
        }
        const create=button(t('marketplace.createListing'),async()=>{
          await action(async()=>{const version=formVersion;fence(version);updateStock();try{
            let input=listingInput();if(ticketStock()){if(!stockQuote||!reviewedListing||JSON.stringify(input)!==JSON.stringify(reviewedListing))throw new Error(t('marketplace.reviewStockFirst'));input={...reviewedListing,allocationDigest:stockQuote.allocationDigest};}
            const original=run.pending?.('createListing');if(original&&!original._confirmed)throw new Error(t('marketplace.resolveListing'));
            await (original?._confirmed&&run.beginNew?run.beginNew('createListing',input):run('createListing',input));fence(version);stockQuote=reviewedListing=null;formVersion++;if(refresh)await refresh();else await load(true);
          }catch(error){if(!disposed){stockQuote=reviewedListing=null;if(ticketStock()&&['ALLOCATION_STALE','ALLOCATION_PENDING'].includes(error.code)){stockBlocked=true;stockNote.textContent=t('marketplace.stockNeedsReview');}}throw error;}});if(!disposed)updateStock();
        });
        const quoteStock=button(t('marketplace.reviewStock'),async()=>{
          await action(async()=>{const version=formVersion;fence(version);updateStock();if(!ticketStock())throw new Error(t('marketplace.selectTicketProduct'));const pending=run.pending?.('createListing');if(pending&&!pending._confirmed)throw new Error(t('marketplace.resolveBeforeQuote'));
            stockQuote=reviewedListing=null;stockNote.textContent=t('marketplace.checkingStock');const input=listingInput(),quoted=await client.quoteMintPackStock({shopId:input.shopId,productId:input.items.productId,quantity:input.items.quantity});fence(version);
            if(quoted.shopId!==input.shopId||quoted.productId!==input.items.productId||quoted.quantity!==input.items.quantity||typeof quoted.allocationDigest!=='string'||!/^[a-f0-9]{64}$/.test(quoted.allocationDigest))throw new Error(t('marketplace.invalidQuote'));
            stockQuote=structuredClone(quoted);reviewedListing=structuredClone(input);stockNote.textContent=[t('marketplace.reviewStockCount',{count:quoted.quantity,shop:own.find(item=>item.id===quoted.shopId)?.name??t('marketplace.thisShop')}),t('marketplace.listingPrice',{title:input.title,amount:input.price.amount,currency:input.price.currencyId}),...(stockDeckVersion()>=2?[t('marketplace.stockPersonal')]:[]),...(stockDeckVersion()>=3?[t('marketplace.stockCodeSupply')]:[]),...(stockDeckVersion()>=4?[t('shop.feasibleTickets')]:[]),...(stockQuote.bindingActivation?[t('marketplace.stockActivation',{count:stockQuote.bindingActivation.maximum})]:[]),t('marketplace.confirmStock')].join(' ');
          });if(!disposed)updateStock();
        });
        const inspectStock=button(t('marketplace.checkStock'),async()=>{
          await action(async()=>{const version=formVersion;fence(version);updateStock();const result=await client.stockAllocationStatus({shopId:shop.value,productId:target.value});fence(version);
            if(result.shopId!==shop.value||result.productId!==target.value||!['idle','prepared','stale','completed','acknowledged'].includes(result.state)||![null,'purchase','createListing','commitExternalPurchase'].includes(result.command)||result.attemptShopId!==null&&typeof result.attemptShopId!=='string'||['prepared','stale','completed'].includes(result.state)&&typeof result.attemptId!=='string')throw new Error(t('marketplace.invalidStatus'));
            stockAttempt=result;stockBlocked=['prepared','stale'].includes(result.state);if(stockBlocked)stockQuote=reviewedListing=null;if(result.state==='acknowledged'&&result.command==='createListing'&&result.attemptShopId===shop.value)await confirmOriginalListing(version);showStockAttempt();
          });if(!disposed)updateStock();
        });
        const acknowledgeStock=button(t('marketplace.ackStock'),async()=>{
          await action(async()=>{const version=formVersion;fence(version);updateStock();if(!stockAttempt||stockAttempt.command!=='createListing'||stockAttempt.attemptShopId!==shop.value||!['prepared','stale'].includes(stockAttempt.state))throw new Error(t('marketplace.recoverOriginalAllocation'));
            const result=await client.acknowledgeAllocation({attemptId:stockAttempt.attemptId});fence(version);if(result.attemptId!==stockAttempt.attemptId||result.state!=='acknowledged')throw new Error(t('marketplace.invalidAcknowledgement'));
            stockAttempt={...stockAttempt,state:'acknowledged',errorCode:null};stockBlocked=false;stockQuote=reviewedListing=null;await confirmOriginalListing(version);showStockAttempt();
          });if(!disposed)updateStock();
        });
        const retryListing=button(t('marketplace.retryListing'),async()=>{
          await action(async()=>{fence();updateStock();if(stockAttempt?.command==='commitExternalPurchase')throw new Error(t('marketplace.recoverPayment'));const original=run.pending?.('createListing');if(!original||original._confirmed)throw new Error(t('marketplace.noListingRetry'));await (run.recover?run.recover('createListing',original):run('createListing',original));fence();stockQuote=reviewedListing=null;formVersion++;if(refresh)await refresh();else await load(true);});if(!disposed)updateStock();
        });
        async function confirmOriginalListing(version){const original=run.pending?.('createListing');if(original&&!original._confirmed&&original.shopId===shop.value&&original.items?.kind==='mint-pack'&&original.items.productId===target.value&&typeof run.confirmFailed==='function'){await run.confirmFailed('createListing',original);fence(version);}}
        function showStockAttempt(){
          const attempt=stockAttempt;if(!attempt){attemptNote.textContent='';return;}
          if(attempt.command==='commitExternalPurchase'){attemptNote.textContent=t('marketplace.externalAttempt');return;}
          if(attempt.command==='purchase'){attemptNote.textContent=t('marketplace.walletAttempt');return;}
          if(attempt.command==='createListing'&&attempt.attemptShopId!==shop.value){attemptNote.textContent=t('marketplace.otherShopAttempt',{shop:own.find(item=>item.id===attempt.attemptShopId)?.name??t('marketplace.otherShop')});return;}
          if(attempt.state==='completed'){attemptNote.textContent=t('marketplace.completedAttempt');return;}
          if(['prepared','stale'].includes(attempt.state)){attemptNote.textContent=(attempt.state==='stale'?t('marketplace.staleAttempt'):t('marketplace.pendingAttempt'))+' '+t('marketplace.abandonAttempt');return;}
          const pending=run.pending?.('createListing');attemptNote.textContent=pending&&!pending._confirmed?t('marketplace.retryOriginal'):t('marketplace.freshStock');
        }
        function updateStock(){
          const tickets=ticketStock(),pending=run.pending?.('createListing'),unresolved=!!pending&&!pending._confirmed;
          quoteStock.hidden=inspectStock.hidden=!tickets;quoteStock.disabled=busy||unresolved||stockBlocked||!Number.isSafeInteger(Number(quantity.value))||Number(quantity.value)<1||Number(quantity.value)>100;
          inspectStock.disabled=busy;acknowledgeStock.hidden=!tickets||stockAttempt?.command!=='createListing'||stockAttempt.attemptShopId!==shop.value||!['prepared','stale'].includes(stockAttempt.state);acknowledgeStock.disabled=busy;
          retryListing.hidden=!unresolved||stockAttempt?.command==='commitExternalPurchase';retryListing.disabled=busy;
          create.disabled=busy||unresolved||tickets&&(!stockQuote||stockBlocked);stockNote.hidden=attemptNote.hidden=!tickets;
          if(tickets&&!stockQuote&&!stockNote.textContent){const product=model.catalog.products.find(product=>product.id===target.value),protectedStock=stockDeckVersion()>=2&&product.duplicatePolicy.scope!=='none';stockNote.textContent=[t('marketplace.stockDeck'),...(stockDeckVersion()>=2?[t('marketplace.stockPersonal')]:[]),...(protectedStock?[t('marketplace.stockDuplicates'),t(product.duplicatePolicy.fallback==='allow'?'marketplace.stockRepeat':'marketplace.stockReject')]:[]),...(stockDeckVersion()>=3?[t('marketplace.stockImported')]:[]),...(stockDeckVersion()>=4?[t('shop.feasibleTickets')]:[]),t('marketplace.quoteBeforeStock')].join(' ');}
        }
        function invalidateStock(){formVersion++;stockQuote=reviewedListing=stockAttempt=null;stockBlocked=false;stockNote.textContent=attemptNote.textContent='';updateStock();}
        invalidateStockForm=invalidateStock;
        box.addEventListener('input',event=>{if(event.target.matches('input,textarea,select'))invalidateStock();});box.addEventListener('change',event=>{if(event.target.matches('input,textarea,select'))invalidateStock();});
        box.append(stockNote,quoteStock,create,attemptNote,inspectStock,acknowledgeStock,retryListing);updateStock();
        node.append(box);
      }
      if (admin) {
        const box = el("details", "dc-form-panel");
        box.append(el("summary", "", "Commerce settings"));
        const json = field(box, "Settings JSON", {
          type: "textarea",
          value: JSON.stringify(settings.settings, null, 2),
        });
        json.rows = 10;
        box.append(
          button("Apply commerce settings", () =>
            action(async () => {
              await client.configureCommerce({
                key: client.requestKey(),
                expectedRevision: settings.revision,
                settings: JSON.parse(json.value),
              });
              if (refresh) await refresh();
              else if (!disposed)
                status.textContent =
                  "Settings saved. Reload this view to load the current controls.";
            }),
          ),
        );
        node.append(box);
      }
    } catch (error) {
      if (!disposed) status.textContent = error.message;
    }
  }
  const history = el("details", "dc-form-panel");
  history.append(el("summary", "", t('marketplace.history')));
  const orders = el("div");
  let orderCursor = null;
  const orderMore = button(
    t('marketplace.loadOrders'),
    () =>
      action(async () => {
        const result = await client.orders({ limit: 24, after: orderCursor });
        if (disposed) return;
        for (const o of result.items)
          orders.append(
            el(
              "p",
              "",
              t('marketplace.order',{id:o.id,count:o.quantity,amount:o.paid.amount,currency:o.paid.currencyId,fulfillment:enumLabel('fulfillment',o.fulfillment)}),
            ),
          );
        orderCursor = result.next;
        orderMore.hidden = !orderCursor;
      }),
    "dc-quiet",
  );
  history.append(orderMore, orders);
  node.append(history);
  const ready = Promise.all([load(true), compose()]).then(()=>{
    if(disposed)return;const original=run.pending?.('buyListing');
    if(original){status.textContent=t('marketplace.previousPurchase');const retry=button(t('marketplace.retryPurchase'),()=>purchase({id:original.listingId}));node.insertBefore(retry,review);}
  });
  return {
    node,
    ready,
    dispose() {
      disposed = true;
      generation++;
      cleanups.splice(0).forEach((fn) => fn());
      clearReview();
      if(!mutate)run.dispose();
      node.replaceChildren();
    },
  };
}
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
                if (!disposed) status.textContent = error.message;
              }
            }),
          );
        list.append(item);
      }
      cursor = result.next;
      more.hidden = !cursor;
      status.textContent = t('rewards.total',{count:result.total});
    } catch (error) {
      if (!disposed) status.textContent = error.message;
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
            if(!disposed)status.textContent = error.message;
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
              if(!disposed)status.textContent = error.message;
            }
          }),
        );
    } catch (error) {
      if (!disposed) status.textContent = error.message;
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
