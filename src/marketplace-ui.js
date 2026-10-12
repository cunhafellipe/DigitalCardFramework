import { el, button as baseButton, field, select, section } from "./ui-kit.js";
import {createCommandRunner} from "./client.js";

export function renderMarketplace(
  model,
  { client, cardRenderer, listingRenderer, refresh, mutate, storage } = {},
) {
  const enabled=name=>!model.capabilities||model.capabilities.available[name];
  const workflow=kind=>kind==='mint-pack'?'packs':['mint-card','action'].includes(kind)?'directSales':'resale';
  const button=(label,callback,...options)=>baseButton(label,(...args)=>{if(disposed)return;return callback(...args)},...options);
  const node = section(
      "Marketplace",
      "Browse upcoming releases, buy reserved stock, or visit player shops.",
    ),
    status = el("p", "dc-muted"),
    list = el("div", "dc-market-list"),
    review = el("div", "dc-form-panel");
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
      if(original&&!original._confirmed&&original.listingId!==listing.id)throw new Error('Resolve the original pending purchase before selecting another listing.');
      if(newPurchase&&original&&!original._confirmed)throw new Error('Recover the original result before starting another purchase.');
      const quote = !newPurchase&&original ? original : await client.quoteListing({ listingId: listing.id });
      if (disposed) return;
      clearReview();
      review.style.display = "";
      review.replaceChildren(
        el("h3", "", !newPurchase&&original ? "Retry original purchase" : "Review purchase"),
        el("p", "", quote.price.amount + " " + quote.price.currencyId),
      );
      for (const item of quote.items ?? []) {
        if (item.copy && cardRenderer) {
          const rendered = cardRenderer(item.copy, { interactive: false });
          review.append(rendered.node ?? rendered);
          if (rendered.dispose) reviewCleanups.push(() => rendered.dispose());
        } else
          review.append(el("p", "", item.pack?.product.name ?? "Custom item"));
      }
      review.append(
        button("Confirm purchase", () =>
          action(async () => {
            const order = await (newPurchase&&run.beginNew ? run.beginNew("buyListing",quote) : original&&run.recover ? run.recover("buyListing",quote) : run("buyListing", quote));
            if (disposed) return;
            clearReview();
            review.style.display = "";
            review.replaceChildren(
              el("p", "", "Purchase complete · " + order.id),
              button("New purchase",()=>purchase(listing,{newPurchase:true})),
            );
            if (refresh) await refresh();
            else await load(true);
          }),
        ),
        button("Close review", clearReview, "dc-quiet"),
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
        l.shopName + " · " + l.phase + " · " + l.remaining + " available",
      ),
      el("p", "", l.price.amount + " " + l.price.currencyId),
      el("p", "dc-muted", "Release: " + new Date(l.startsAt).toLocaleString()),
    );
    if (l.preview?.preallocated)
      card.append(
        el(
          "p",
          "dc-muted",
          "Sealed, preallocated pack. Personal pity does not apply.",
        ),
      );
    if (l.mine && l.status === "active")
      card.append(
        button(
          "Cancel remaining stock",
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
          "Free entry for a chance to purchase. Payment is due only when a winner claims.",
        ),
        own,
        button(
          "Check entry / claim",
          () =>
            action(async () => {
              const r = await client.raffleStatus({ listingId: l.id });
              if (disposed) return;
              own.textContent = r.orderId
                ? "Claimed"
                : r.winner
                  ? "You won. Claim before " +
                    new Date(r.claimUntil).toLocaleString()
                  : r.drawnAt
                    ? "Not selected"
                    : r.entered
                      ? "Entered; awaiting draw"
                      : "Not entered";
              if (r.winner && !r.orderId)
                own.append(button("Review winner purchase", () => purchase(l)));
            }),
          "dc-quiet",
        ),
      );
      if (l.phase === "entries-open" && enabled(workflow(l.kind)))
        card.append(
          button("Enter raffle", () =>
            action(async () => {
              await run("enterRaffle", { listingId: l.id });
              if (!disposed) own.textContent = "Entered. No charge.";
            }),
          ),
        );
    } else if (l.phase === "live" && enabled(workflow(l.kind)))
      card.append(button("Review purchase", () => purchase(l)));
    return card;
  }
  const more = button("Load more listings", () => load(false), "dc-quiet");
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
              client,
            })
          : defaultListing(l);
        list.append(rendered.node ?? rendered);
        if (rendered.dispose) cleanups.push(() => rendered.dispose());
      }
      cursor = result.next;
      more.hidden = !cursor;
      status.textContent = result.total + " listings";
    } catch (error) {
      if (!disposed) status.textContent = error.message;
    } finally {
      if(!disposed)more.disabled = false;
    }
  }
  node.prepend(button("Refresh marketplace", () => load(true), "dc-quiet"));
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
        box.append(el("summary", "", "Create a shop"));
        const name = field(box, "Shop name"),
          kind = select(
            box,
            "Shop type",
            admin
              ? [
                  { id: "admin", name: "Admin shop" },
                  ...(enabled('resale')?[{ id: "player", name: "Player shop" }]:[]),
                ]
              : [{ id: "player", name: "Player shop" }],
          );
        box.append(
          button("Create shop", () =>
            action(async () => {
              await run("createShop", { name: name.value, kind: kind.value });
              if (refresh) await refresh();
              else if (!disposed)
                status.textContent =
                  "Shop created. Reload this view to add its stock.";
            }),
          ),
        );
        node.append(box);
      }
      if (own.length && (admin||enabled('resale'))) {
        const box = el("details", "dc-form-panel");
        box.append(el("summary", "", "List stock for sale"));
        const shop = select(
            box,
            "Shop",
            own.map((s) => ({ id: s.id, name: s.name })),
          ),
          title = field(box, "Listing title"),
          currency = select(box, "Currency", model.catalog.currencies),
          amount = field(box, "Unit price", { type: "number", value: "1" }),
          kind = select(box, "Stock source", [
            ...(enabled('resale')?[{ id: "copies", name: "Owned card" }]:[]),
            ...(enabled('resale')&&settings.settings.packResale
              ? [{ id: "packs", name: "Owned sealed pack" }]
              : []),
            ...(admin
              ? [
                  { id: "mint-card", name: "Issue card stock" },
                  { id: "mint-pack", name: "Issue sealed packs" },
                  { id: "action", name: "Custom action item" },
                ]
              : []),
          ].filter(item=>enabled(workflow(item.id)))),
          target = select(box, "Stock item", []),
          quantity = field(box, "Stock quantity (new stock)", {
            type: "number",
            value: "1",
          }),
          handler = field(box, "Custom handler (server installed)"),
          params = field(box, "Custom item parameters", {
            type: "textarea",
            value: "{}",
          }),
          preview = field(box, "Preview time (ISO, optional)"),
          starts = field(box, "Release time (ISO, optional)"),
          ends = field(box, "End time (ISO, optional)"),
          raffle = field(box, "Raffle terms JSON (optional)", {
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
        const ticketStock=()=>kind.value==='mint-pack'&&model.catalog.products.find(product=>product.id===target.value)?.allocationStrategy?.algorithm==='weighted-deck@1';
        function fence(version=formVersion){if(disposed||!node.contains(box)||typeof client.principal==='function'&&client.principal()!==principal)throw new Error('The listing view or signed-in account changed. Review the listing again.');if(version!==formVersion)throw new Error('The listing changed. Review the stock allocation again.');}
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
        const create=button('Reserve stock and publish listing',async()=>{
          await action(async()=>{const version=formVersion;fence(version);updateStock();try{
            let input=listingInput();if(ticketStock()){if(!stockQuote||!reviewedListing||JSON.stringify(input)!==JSON.stringify(reviewedListing))throw new Error('Review the stock allocation before creating the listing');input={...reviewedListing,allocationDigest:stockQuote.allocationDigest};}
            const original=run.pending?.('createListing');if(original&&!original._confirmed)throw new Error('Resolve the original listing before creating another');
            await (original?._confirmed&&run.beginNew?run.beginNew('createListing',input):run('createListing',input));fence(version);stockQuote=reviewedListing=null;formVersion++;if(refresh)await refresh();else await load(true);
          }catch(error){if(!disposed){stockQuote=reviewedListing=null;if(ticketStock()&&['ALLOCATION_STALE','ALLOCATION_PENDING'].includes(error.code)){stockBlocked=true;stockNote.textContent='The stock allocation needs review. Check its attempt before acknowledging it and reviewing new stock.';}}throw error;}});if(!disposed)updateStock();
        });
        const quoteStock=button('Review stock allocation',async()=>{
          await action(async()=>{const version=formVersion;fence(version);updateStock();if(!ticketStock())throw new Error('Select a product with ticket allocation');const pending=run.pending?.('createListing');if(pending&&!pending._confirmed)throw new Error('Resolve the original listing before requesting a new allocation');
            stockQuote=reviewedListing=null;stockNote.textContent='Checking current stock allocation…';const input=listingInput(),quoted=await client.quoteMintPackStock({shopId:input.shopId,productId:input.items.productId,quantity:input.items.quantity});fence(version);
            if(quoted.shopId!==input.shopId||quoted.productId!==input.items.productId||quoted.quantity!==input.items.quantity||typeof quoted.allocationDigest!=='string'||!/^[a-f0-9]{64}$/.test(quoted.allocationDigest))throw new Error('Invalid stock allocation quote');
            stockQuote=structuredClone(quoted);reviewedListing=structuredClone(input);stockNote.textContent='Review '+quoted.quantity+' sealed pack'+(quoted.quantity===1?'':'s')+' for '+(own.find(item=>item.id===quoted.shopId)?.name??'this shop')+'. Listing “'+input.title+'” sells each pack for '+input.price.amount+' '+input.price.currencyId+'. Reserve stock and publish listing to confirm.';
          });if(!disposed)updateStock();
        });
        const inspectStock=button('Check stock allocation attempt',async()=>{
          await action(async()=>{const version=formVersion;fence(version);updateStock();const result=await client.stockAllocationStatus({shopId:shop.value,productId:target.value});fence(version);
            if(result.shopId!==shop.value||result.productId!==target.value||!['idle','prepared','stale','completed','acknowledged'].includes(result.state)||![null,'purchase','createListing','commitExternalPurchase'].includes(result.command)||result.attemptShopId!==null&&typeof result.attemptShopId!=='string'||['prepared','stale','completed'].includes(result.state)&&typeof result.attemptId!=='string')throw new Error('Invalid stock allocation status');
            stockAttempt=result;stockBlocked=['prepared','stale'].includes(result.state);if(stockBlocked)stockQuote=reviewedListing=null;if(result.state==='acknowledged'&&result.command==='createListing'&&result.attemptShopId===shop.value)await confirmOriginalListing(version);showStockAttempt();
          });if(!disposed)updateStock();
        });
        const acknowledgeStock=button('Acknowledge stock allocation attempt',async()=>{
          await action(async()=>{const version=formVersion;fence(version);updateStock();if(!stockAttempt||stockAttempt.command!=='createListing'||stockAttempt.attemptShopId!==shop.value||!['prepared','stale'].includes(stockAttempt.state))throw new Error('Recover the allocation in its original purchase or shop');
            const result=await client.acknowledgeAllocation({attemptId:stockAttempt.attemptId});fence(version);if(result.attemptId!==stockAttempt.attemptId||result.state!=='acknowledged')throw new Error('Invalid stock allocation acknowledgement');
            stockAttempt={...stockAttempt,state:'acknowledged',errorCode:null};stockBlocked=false;stockQuote=reviewedListing=null;await confirmOriginalListing(version);showStockAttempt();
          });if(!disposed)updateStock();
        });
        const retryListing=button('Retry original listing',async()=>{
          await action(async()=>{fence();updateStock();if(stockAttempt?.command==='commitExternalPurchase')throw new Error('Recover the original payment through its payment provider');const original=run.pending?.('createListing');if(!original||original._confirmed)throw new Error('No unresolved listing to retry');await (run.recover?run.recover('createListing',original):run('createListing',original));fence();stockQuote=reviewedListing=null;formVersion++;if(refresh)await refresh();else await load(true);});if(!disposed)updateStock();
        });
        async function confirmOriginalListing(version){const original=run.pending?.('createListing');if(original&&!original._confirmed&&original.shopId===shop.value&&original.items?.kind==='mint-pack'&&original.items.productId===target.value&&typeof run.confirmFailed==='function'){await run.confirmFailed('createListing',original);fence(version);}}
        function showStockAttempt(){
          const attempt=stockAttempt;if(!attempt){attemptNote.textContent='';return;}
          if(attempt.command==='commitExternalPurchase'){attemptNote.textContent='This product’s allocation belongs to a payment-provider purchase. Use the original payment provider’s recovery flow. This stock form cannot retry or acknowledge that payment.';return;}
          if(attempt.command==='purchase'){attemptNote.textContent='This product’s allocation belongs to a wallet purchase. Return to Discover to recover or acknowledge that original purchase. This stock form cannot acknowledge it.';return;}
          if(attempt.command==='createListing'&&attempt.attemptShopId!==shop.value){attemptNote.textContent='This product’s allocation belongs to '+(own.find(item=>item.id===attempt.attemptShopId)?.name??'another shop')+'. Recover or acknowledge the original listing in that shop.';return;}
          if(attempt.state==='completed'){attemptNote.textContent='This stock allocation completed. Recover the original listing result before creating another listing.';return;}
          if(['prepared','stale'].includes(attempt.state)){attemptNote.textContent=(attempt.state==='stale'?'The stock allocation is stale.':'A stock allocation is pending.')+' Acknowledge this inactive attempt to abandon it. This does not create a listing.';return;}
          const pending=run.pending?.('createListing');attemptNote.textContent=pending&&!pending._confirmed?'Retry the original listing to resolve its saved result before reviewing new stock.':'No active stock allocation. Select Review stock allocation for a fresh quote.';
        }
        function updateStock(){
          const tickets=ticketStock(),pending=run.pending?.('createListing'),unresolved=!!pending&&!pending._confirmed;
          quoteStock.hidden=inspectStock.hidden=!tickets;quoteStock.disabled=busy||unresolved||stockBlocked||!Number.isSafeInteger(Number(quantity.value))||Number(quantity.value)<1||Number(quantity.value)>100;
          inspectStock.disabled=busy;acknowledgeStock.hidden=!tickets||stockAttempt?.command!=='createListing'||stockAttempt.attemptShopId!==shop.value||!['prepared','stale'].includes(stockAttempt.state);acknowledgeStock.disabled=busy;
          retryListing.hidden=!unresolved||stockAttempt?.command==='commitExternalPurchase';retryListing.disabled=busy;
          create.disabled=busy||unresolved||tickets&&(!stockQuote||stockBlocked);stockNote.hidden=attemptNote.hidden=!tickets;
          if(tickets&&!stockQuote&&!stockNote.textContent)stockNote.textContent='Ticket allocation draws this stock batch without replacement. Finite supply can reduce available tickets. Review an allocation quote before reserving the packs.';
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
  history.append(el("summary", "", "Purchase and sale history"));
  const orders = el("div");
  let orderCursor = null;
  const orderMore = button(
    "Load orders",
    () =>
      action(async () => {
        const result = await client.orders({ limit: 24, after: orderCursor });
        if (disposed) return;
        for (const o of result.items)
          orders.append(
            el(
              "p",
              "",
              o.id +
                " · " +
                o.quantity +
                " items · " +
                o.paid.amount +
                " " +
                o.paid.currencyId +
                " · " +
                o.fulfillment,
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
    if(original){status.textContent='A previous purchase needs confirmation. Retry its original terms before buying again.';const retry=button('Retry original purchase',()=>purchase({id:original.listingId}));node.insertBefore(retry,review);}
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
export function renderFulfillments(model, { client } = {}) {
  const button=(label,callback,...options)=>baseButton(label,(...args)=>{if(disposed)return;return callback(...args)},...options);
  const node = section(
      "Account rewards",
      "Opening actions are delivered to your account. Pending deliveries retry without opening another pack.",
    ),
    list = el("div"),
    status = el("p", "dc-muted");
  let disposed = false,
    cursor = null,
    generation = 0;
  const operator =
      model.me.role === "admin" ||
      model.me.permissions?.includes("actions.manage"),
    scope = select(
      node,
      "Reward history",
      operator
        ? [
            { id: "own", name: "My rewards" },
            { id: "all", name: "Operator delivery queue" },
          ]
        : [{ id: "own", name: "My rewards" }],
    ),
    more = button("Load more rewards", () => load(false), "dc-quiet");
  node.append(
    button("Refresh rewards", () => load(true), "dc-quiet"),
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
          el("p", "", job.status),
          el("p", "dc-muted", job.error ?? ""),
          el("p", "dc-muted", "Reference: " + job.id),
        );
        if (operator && scope.value === "all" && job.status === "dead")
          item.append(
            button("Retry delivery", async () => {
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
      status.textContent = result.total + " rewards";
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

export function renderTradingControls(model, { client } = {}) {
  const button=(label,callback,...options)=>baseButton(label,(...args)=>{if(disposed)return;return callback(...args)},...options);
  const node = section(
      "Trading controls",
      "Deployment policy applies again at completion. Ownership and code restrictions always remain in force.",
    ),
    status = el("p", "dc-muted");
  node.append(status);
  let disposed = false;
  async function load() {
    if(disposed)return;
    try {
      const current = await client.tradingPolicy();
      if (disposed) return;
      const json = field(node, "Trading policy JSON", {
        type: "textarea",
        value: JSON.stringify(current.policy, null, 2),
      });
      json.rows = 18;
      node.append(
        button("Apply trading policy", async () => {
          try {
            const result = await client.configureTrading({
              key: client.requestKey(),
              expectedRevision: current.revision,
              policy: JSON.parse(json.value),
            });
            if(disposed)return;
            current.revision = result.revision;
            status.textContent = "Trading policy saved.";
          } catch (error) {
            status.textContent = error.message;
          }
        }),
      );
      const copyId = field(node, "Individual copy ID"),
        reason = field(node, "Lock reason", {
          value: "This card cannot be transferred",
        }),
        until = field(node, "Lock expiry (ISO, optional)");
      for (const locked of [true, false])
        node.append(
          button(locked ? "Lock this card" : "Remove lock", async () => {
            try {
              await client.setCardTransferLock({
                key: client.requestKey(),
                copyId: copyId.value,
                locked,
                reason: reason.value,
                until: until.value || null,
              });
              status.textContent = locked
                ? "Card locked."
                : "Card lock removed.";
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
