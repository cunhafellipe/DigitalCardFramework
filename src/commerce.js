import {recordContexts} from "./record-context.js";
import { randomUUID, randomInt } from "node:crypto";
import { check, integer, text, jsonObject } from "./catalog.js";
import { hasPermission } from "./access.js";
import { safeData, page } from "./data.js";
import { contentDigest } from "./importer.js";
import { enqueueAction } from "./actions.js";
import {adminSite,adminRevision,assertAdminShop,effectiveProduct} from './admin.js';
import {codeStockAvailable} from './codes.js';

export const commerceDefaults = Object.freeze({
  enabled: true,
  playerShops: false,
  packResale: false,
  allowedCurrencyIds: null,
  maxListingsPerShop: 200,
  maxStockPerListing: 100,
  maxRaffleEntries: 10000,
});
const find = (rows, id) => rows.find((x) => x.id === id),
  clone = structuredClone;
const record = (rows, id) =>
  rows && typeof id === "string" && Object.hasOwn(rows, id)
    ? rows[id]
    : undefined;
const active = (l) => l.status === "active";
const permission = (actor, p) =>
  check(
    hasPermission(actor, p),
    "FORBIDDEN",
    "Operator authority required: " + p,
    403,
  );
const initialize = (s) => {
  s.shops ??= {};
  s.listings ??= {};
  s.orders ??= {};
};
function date(value, name) {
  check(
    value === null ||
      (typeof value === "string" && Number.isFinite(Date.parse(value))),
    "INVALID_INPUT",
    "Invalid " + name,
  );
  return value;
}
function object(value, keys) {
  const clean = jsonObject(value);
  check(
    Object.keys(clean).every((k) => keys.includes(k)),
    "INVALID_INPUT",
    "Unknown configuration field",
  );
  return clean;
}
function config(s) {
  const base=s.commerceSettings?.settings??commerceDefaults;
  return {...base,playerShops:adminSite(s).playerShopsEnabled??base.playerShops};
}
function stock(l) {
  return l.units.filter((u) => u.status === "available");
}
function terms(l) {
  return {
    id: l.id,
    shopId: l.shopId,
    sellerId: l.sellerId,
    title: l.title,
    price: l.price,
    kind: l.kind,
    previewAt: l.previewAt,
    startsAt: l.startsAt,
    endsAt: l.endsAt,
    perBuyerLimit: l.perBuyerLimit,
    metadata: l.metadata,
    raffle: l.raffle,
    createdAt: l.createdAt,
  };
}
function digest(l, units) {
  return contentDigest({ terms: terms(l), unitIds: units.map((u) => u.id) });
}
function publicListing(s, l, at, userId) {
  const now = Date.parse(at),
    phase = !active(l)
      ? l.status
      : now < Date.parse(l.startsAt)
        ? "upcoming"
        : l.endsAt && now >= Date.parse(l.endsAt)
          ? "expired"
          : l.raffle
            ? l.draw
              ? "claiming"
              : now >= Date.parse(l.raffle.entryClosesAt)
                ? "awaiting-draw"
                : "entries-open"
            : "live";
  return {
    ...terms(l),
    description: l.description,
    shopName: s.shops[l.shopId]?.name,
    sellerName: s.users[l.sellerId]?.displayName,
    status: l.status,
    phase,
    remaining: stock(l).length,
    preview: clone(l.preview),
    mine: l.sellerId === userId,
    entryCount: Object.keys(l.entries ?? {}).length,
    drawnAt: l.draw?.at ?? null,
    claimUntil: l.draw?.claimUntil ?? null,
  };
}
export class CommerceService {
  #b;
  #random;
  #remotePolicy;
  #proposals;
  #remoteListingPolicy;
  #listingProposals;
  constructor(bridge, { random = randomInt, remotePolicy, policyCoordinator, remoteListingPolicy, listingPolicyCoordinator } = {}) {
    this.#b = bridge;
    this.#random = random;
    this.#remotePolicy = remotePolicy;
    this.#proposals = policyCoordinator;
    this.#remoteListingPolicy = remoteListingPolicy;
    this.#listingProposals = listingPolicyCoordinator;
  }
  settings() {
    return this.#b.read(s=>({...s.commerceSettings??{revision:0,settings:clone(commerceDefaults)},effectiveSettings:{...config(s),playerShops:config(s).playerShops&&!adminSite(s).playerShopsPaused}}));
  }
  configure(actor, { key, expectedRevision, settings }) {
    object(settings, Object.keys(commerceDefaults));
    const clean = { ...commerceDefaults, ...safeData(settings) };
    for (const k of ["enabled", "playerShops", "packResale"])
      check(
        typeof clean[k] === "boolean",
        "INVALID_INPUT",
        "Invalid commerce switch",
      );
    for (const [k, max] of Object.entries({
      maxListingsPerShop: 10000,
      maxStockPerListing: 1000,
      maxRaffleEntries: 100000,
    }))
      integer(clean[k], k, 1, max);
    check(
      clean.allowedCurrencyIds === null ||
        (Array.isArray(clean.allowedCurrencyIds) &&
          clean.allowedCurrencyIds.length <= 100 &&
          clean.allowedCurrencyIds.every((x) => typeof x === "string")),
      "INVALID_INPUT",
      "Invalid currency allowlist",
    );
    return this.#b.operator(
      actor,
      key,
      "commerce.manage",
      "commerce.configured",
      { expectedRevision, settings: clean },
      (s) => {
        check(
          (s.commerceSettings?.revision ?? 0) === expectedRevision,
          "POLICY_CHANGED",
          "Commerce settings changed",
          409,
        );
        for (const id of clean.allowedCurrencyIds ?? [])
          this.#b.currency(s, id);
        s.commerceSettings = {
          revision: expectedRevision + 1,
          settings: clean,
        };
        return s.commerceSettings;
      },
    );
  }
  createShop(actor, { key, name, kind = "player", ownerId, metadata = {} }) {
    text(name, "shop name", 100);
    check(
      ["admin", "player"].includes(kind),
      "INVALID_INPUT",
      "Invalid shop kind",
    );
    jsonObject(metadata);
    return this.#b.command(
      actor,
      key,
      "shop.created",
      { name, kind, ownerId, metadata },
      (s, u) => {
        check(config(s).enabled,'SHOP_DISABLED','Shop creation is disabled',409);
        this.#b.workflow(s,kind==='player'?'resale':['directSales','packs','resale']);
        initialize(s);
        const manage = hasPermission(actor, "commerce.manage");
        check(
          (kind === "player" && config(s).playerShops) || manage,
          "FORBIDDEN",
          "Player shops are disabled",
          403,
        );
        const owner = ownerId ?? u.id;
        check(
          owner === u.id || manage,
          "FORBIDDEN",
          "Cannot create another account shop",
          403,
        );
        check(record(s.users, owner), "NOT_FOUND", "Shop owner not found", 404);
        if(kind==='player')assertAdminShop(s,{kind,ownerId:owner});
        check(
          kind !== "admin" || manage,
          "FORBIDDEN",
          "Admin shop authority required",
          403,
        );
        const shop = {
          id: randomUUID(),
          name,
          kind,
          ownerId: owner,
          enabled: true,
          metadata: clone(metadata),
          createdAt: this.#b.now(),
        };
        s.shops[shop.id] = shop;
        return shop;
      },
    );
  }
  setShop(actor, { key, shopId, enabled }) {
    check(
      typeof enabled === "boolean",
      "INVALID_INPUT",
      "enabled must be boolean",
    );
    return this.#b.operator(
      actor,
      key,
      "commerce.manage",
      "shop.status",
      { shopId, enabled },
      (s) => {
        const shop = record(s.shops, shopId);
        check(shop, "NOT_FOUND", "Shop not found", 404);
        shop.enabled = enabled;
        return shop;
      },
    );
  }
  shops(actor, options = {}) {
    return this.#b.read((s) => {
      const user = this.#b.user(s, actor);
      return page(
        Object.values(s.shops ?? {})
          .filter(
            (shop) =>
              shop.enabled ||
              shop.ownerId === user.id ||
              hasPermission(actor, "commerce.manage"),
          )
          .map((shop) => ({ ...shop, mine: shop.ownerId === user.id })),
        options,
      );
    });
  }
  #own(s, actor, shopId) {
    const u = this.#b.user(s, actor),
      shop = record(s.shops, shopId);
    check(
      shop &&
        (shop.ownerId === u.id || hasPermission(actor, "commerce.manage")),
      "NOT_FOUND",
      "Shop not found",
      404,
    );
    if (shop.kind === "admin") permission(actor, "commerce.manage");
    else
      check(
        config(s).playerShops || hasPermission(actor, "commerce.manage"),
        "FORBIDDEN",
        "Player shops are disabled",
        403,
      );
    return shop;
  }
  #currency(s, shop, price) {
    object(price, ["currencyId", "amount"]);
    text(price.currencyId, "currency ID", 100);
    integer(price.amount, "unit price", 0);
    const currency = this.#b.currency(s, price.currencyId);
    check(
      !config(s).allowedCurrencyIds ||
        config(s).allowedCurrencyIds.includes(price.currencyId),
      "TRANSFER_BLOCKED",
      "Currency is not accepted by shops",
      403,
    );
    if (shop.kind === "player")
      check(
        currency.tradable === true,
        "TRANSFER_BLOCKED",
        "Currency cannot be transferred to player shops",
        403,
      );
  }
  createListing(actor, input) {
    const reviewed=this.#reviewListing(input);
    if(this.#remoteListingPolicy){
      const previous=this.#b.creationReceipt(actor,reviewed.key,this.#creationCommandInput(reviewed));if(previous.found)return previous.result;
      check(false,'POLICY_ASYNC_REQUIRED','Use asynchronous listing policy evaluation',503);
    }
    return this.#createListing(actor,reviewed);
  }
  #reviewListing(input){
    const {
      key,
      shopId,
      title,
      description = "",
      price,
      items,
      previewAt = null,
      startsAt = this.#b.now(),
      endsAt = null,
      perBuyerLimit = 10,
      metadata = {},
      raffle = null,
    } = input;
    text(title, "listing title", 200);
    check(
      typeof description === "string" && description.length <= 2000,
      "INVALID_INPUT",
      "Description too long",
    );
    integer(perBuyerLimit, "buyer limit", 1, 1000);
    jsonObject(metadata);
    date(previewAt, "preview time");
    date(startsAt, "start time");
    check(startsAt, "INVALID_INPUT", "Start time required");
    date(endsAt, "end time");
    check(
      !endsAt || Date.parse(endsAt) > Date.parse(startsAt),
      "INVALID_INPUT",
      "End must follow start",
    );
    check(
      !previewAt || Date.parse(previewAt) <= Date.parse(startsAt),
      "INVALID_INPUT",
      "Preview must precede start",
    );
    if (raffle) {
      object(raffle, ["entryClosesAt", "claimSeconds", "winners"]);
      date(raffle.entryClosesAt, "entry deadline");
      check(
        raffle.entryClosesAt &&
          Date.parse(raffle.entryClosesAt) > Date.parse(startsAt),
        "INVALID_INPUT",
        "Entry deadline must follow start",
      );
      integer(raffle.claimSeconds, "claim seconds", 60, 604800);
      integer(raffle.winners, "winners", 1, 1000);
      check(
        !endsAt ||
          Date.parse(endsAt) >
            Date.parse(raffle.entryClosesAt) + raffle.claimSeconds * 1000,
        "INVALID_INPUT",
        "Listing end must allow the full claim window",
      );
    }
    object(items, [
      "kind",
      "ids",
      "variantId",
      "productId",
      "quantity",
      "handler",
      "params",
    ]);
    check(
      ["copies", "packs", "mint-card", "mint-pack", "action"].includes(
        items.kind,
      ),
      "INVALID_INPUT",
      "Invalid stock kind",
    );
    return {key,shopId,title,description,price:clone(price),items:clone(items),previewAt,startsAt,inputStartsAt:input.startsAt??null,endsAt,perBuyerLimit,metadata:clone(metadata),raffle:clone(raffle)};
  }
  #creationCommandInput(reviewed){
    const {key,inputStartsAt,...input}=reviewed;return {...input,startsAt:inputStartsAt};
  }
  #creationPreflight(s,actor,reviewed){
    initialize(s);const {shopId,items,price,raffle}=reviewed,shop=this.#own(s,actor,shopId);
    check(config(s).enabled&&shop.enabled,'SHOP_DISABLED','Listing creation is disabled',409);
    this.#b.workflow(s,items.kind==='mint-pack'?'packs':['mint-card','action'].includes(items.kind)?'directSales':'resale',price.amount>0);
    assertAdminShop(s,shop);this.#currency(s,shop,price);
    const count=recordContexts.get(s)?.activeShopListings??Object.values(s.listings).filter(l=>l.shopId===shopId&&active(l)).length;
    check(count<config(s).maxListingsPerShop,'INSTALLATION_CAPACITY','Shop listing limit reached',507);
    const primary=['mint-card','mint-pack','action'].includes(items.kind);
    if(primary){check(shop.kind==='admin','FORBIDDEN','Only admin shops can issue stock or custom items',403);permission(actor,'commerce.manage');integer(items.quantity,'stock quantity',1,config(s).maxStockPerListing);}
    else check(Array.isArray(items.ids)&&items.ids.length>0&&items.ids.length<=config(s).maxStockPerListing&&new Set(items.ids).size===items.ids.length&&items.ids.every(id=>typeof id==='string'),'INVALID_INPUT','Select unique owned stock');
    if(items.kind==='copies'){
      const copies=items.ids.map(id=>s.copies[id]);
      check(copies.every(c=>c?.ownerId===shop.ownerId&&c.state==='owned'),'NOT_OWNED','Stock must be owned cards',403);
      check(copies.every(c=>!c.lockedBy),'CARD_LOCKED','Card already reserved',409);
      check(new Set(copies.map(c=>c.variantId)).size<=1,'INVALID_INPUT','One listing must contain the same variant');
    }
    if(items.kind==='packs'){
      check(config(s).packResale,'FORBIDDEN','Pack resale is disabled',403);
      const packs=items.ids.map(id=>s.packs[id]);check(packs.every(p=>p?.ownerId===shop.ownerId&&!p.openedAt&&!p.lockedBy),'NOT_OWNED','Stock must be unreserved sealed packs',403);
      check(packs.every(p=>p.copyIds.every(id=>s.copies[id]?.ownerId===shop.ownerId&&!s.copies[id].lockedBy)),'NOT_OWNED','Pack stock ownership changed',403);
      check(new Set(packs.map(p=>p.productId+':'+p.productRevision)).size<=1,'INVALID_INPUT','One listing must contain the same pack revision');
    }
    if(items.kind==='mint-card'){
      const variant=find(s.catalog.variants,items.variantId);check(variant&&variant.enabled!==false,'NOT_FOUND','Variant not available',404);
      check(variant.supplyLimit===undefined||(s.supply[variant.id]??0)+items.quantity<=variant.supplyLimit,'SOLD_OUT','Edition exhausted',409);
      check(codeStockAvailable(s,variant.codes,this.#b.now()),'CODE_STOCK','Code stock is unavailable',409);
    }
    if(items.kind==='mint-pack'){
      const product=effectiveProduct(s,find(s.catalog.products,items.productId));check(product&&product.enabled!==false,'NOT_FOUND','Pack product unavailable',404);
      for(const slot of product.slots)if(slot.probability?.numerator!==0)check(slot.pool.some(entry=>{const v=find(s.catalog.variants,entry.variantId);return v&&v.enabled!==false&&(v.supplyLimit===undefined||(s.supply[v.id]??0)<v.supplyLimit)&&codeStockAvailable(s,v.codes,this.#b.now());}),'SOLD_OUT','Pack stock is unavailable',409);
    }
    if(items.kind==='action'){text(items.handler,'action handler',100);jsonObject(items.params??{});}
    check(!raffle||raffle.winners<=(primary?items.quantity:items.ids.length),'INVALID_INPUT','Winners exceed reserved stock');
    return shop;
  }
  #creationDependencies(s,actor,reviewed,shop){
    const {items}=reviewed,product=items.kind==='mint-pack'?effectiveProduct(s,find(s.catalog.products,items.productId)):null;
    const variantIds=items.kind==='mint-card'?[items.variantId]:product?[...new Set(product.slots.flatMap(slot=>slot.pool.map(entry=>entry.variantId)))]:[];
    const demand=new Map(),add=(ids,count)=>{for(const poolId of new Set(ids.flatMap(id=>find(s.catalog.variants,id)?.codes?.map(spec=>spec.poolId)??[]))){const maximum=Math.max(0,...ids.map(id=>find(s.catalog.variants,id)?.codes?.filter(spec=>spec.poolId===poolId).length??0));demand.set(poolId,(demand.get(poolId)??0)+maximum*count);}};
    if(items.kind==='mint-card')add(variantIds,items.quantity);else if(product)for(const slot of product.slots)add(slot.pool.map(entry=>entry.variantId),items.quantity*slot.count);
    const codeReadiness=[...demand].map(([poolId,count])=>({pool:s.codePools?.[poolId]??null,stock:Object.values(s.codes??{}).filter(c=>c.poolId===poolId&&c.status==='available'&&(!c.expiresAt||Date.parse(c.expiresAt)>Date.parse(this.#b.now()))).slice(0,count).map(c=>({id:c.id,status:c.status,expiresAt:c.expiresAt})).sort((a,b)=>a.id.localeCompare(b.id))}));
    const packIds=items.kind==='packs'?items.ids:[],copyIds=items.kind==='copies'?items.ids:packIds.flatMap(id=>s.packs[id]?.copyIds??[]);
    const copies=copyIds.map(id=>{const c=s.copies[id];return c?{id:c.id,version:c.version,ownerId:c.ownerId,state:c.state,lockedBy:c.lockedBy??null,transferLock:c.transferLock??null,codeIds:c.codeIds??[]}:null;});
    const codes=copyIds.flatMap(id=>s.copies[id]?.codeIds??[]).map(id=>{const c=s.codes[id];return c?{id:c.id,holderId:c.holderId,status:c.status,transfer:c.transfer,revealedAt:c.revealedAt,reportedUsed:c.reportedUsed}:null;});
    const packs=packIds.map(id=>{const p=s.packs[id];return p?{id:p.id,ownerId:p.ownerId,lockedBy:p.lockedBy??null,openedAt:p.openedAt,copyIds:p.copyIds}:null;});
    const baseline=recordContexts.get(s)?.ownerCountsById?.[shop.ownerId]??{ownedCopies:0,sealedCopies:0,packs:0,unopenedPacks:0};
    const ownCopies=Object.values(s.copies).filter(c=>c.ownerId===shop.ownerId),ownPacks=Object.values(s.packs).filter(p=>p.ownerId===shop.ownerId);
    const counts={ownedCopies:baseline.ownedCopies+ownCopies.filter(c=>c.state==='owned').length,sealedCopies:baseline.sealedCopies+ownCopies.filter(c=>c.state==='sealed').length,packs:baseline.packs+ownPacks.length,unopenedPacks:baseline.unopenedPacks+ownPacks.filter(p=>!p.openedAt).length};
    return contentDigest({input:this.#creationCommandInput(reviewed),effectiveStartsAt:reviewed.startsAt,actorId:actor.userId,shop,copies,packs,codes,counts,codeReadiness,supply:variantIds.map(id=>[id,s.supply[id]??0]),
      activeListings:recordContexts.get(s)?.activeShopListings??Object.values(s.listings).filter(l=>l.shopId===shop.id&&active(l)).length,catalogVersion:s.catalog?.version??0,adminRevision:adminRevision(s),commerceRevision:s.commerceSettings?.revision??0,tradingRevision:s.tradingPolicy?.revision??0,cardPolicyRevision:s.cardAuthoring?.revision??0});
  }
  async createListingAsync(actor,input,{signal}={}){
    if(!this.#remoteListingPolicy)return this.createListing(actor,input);
    const principal=clone(actor),reviewed=this.#reviewListing(clone(input)),commandInput=this.#creationCommandInput(reviewed);
    const previous=this.#b.creationReceipt(principal,reviewed.key,commandInput);if(previous.found)return previous.result;
    const prepared=this.#b.createListingRead(principal,commandInput,s=>{
      const shop=this.#creationPreflight(s,principal,reviewed),{items}=reviewed;
      const stock=['copies','packs'].includes(items.kind)?{kind:items.kind,ids:clone(items.ids)}:items.kind==='mint-card'?{kind:items.kind,variantId:items.variantId,quantity:items.quantity}:items.kind==='mint-pack'?{kind:items.kind,productId:items.productId,quantity:items.quantity}:{kind:items.kind,handler:items.handler,quantity:items.quantity};
      return {phase:'create',userId:principal.userId,key:reviewed.key,input:commandInput,snapshotDigest:this.#creationDependencies(s,principal,reviewed,shop),context:{actor:{id:principal.userId},shop:{id:shop.id,ownerId:shop.ownerId,kind:shop.kind},price:clone(reviewed.price),stock}};
    });
    const proposal=this.#listingProposals.prepare(prepared);await this.#listingProposals.evaluate(proposal,{signal});return this.#createListing(principal,reviewed,proposal,signal);
  }
  #createListing(actor,reviewed,proposal,signal){
    const {key,shopId,title,description,price,items,previewAt,startsAt,endsAt,perBuyerLimit,metadata,raffle}=reviewed,receipt={};
    return this.#b.createListingCommand(
      actor,
      key,
      "listing.created",
      {
        shopId,
        title,
        description,
        price,
        items,
        previewAt,
        startsAt: reviewed.inputStartsAt,
        endsAt,
        perBuyerLimit,
        metadata,
        raffle,
      },
      (s, u) => {
        initialize(s);
        if(proposal){const currentShop=this.#creationPreflight(s,actor,reviewed);receipt.policyAdmission=this.#listingProposals.admit(proposal,this.#creationDependencies(s,actor,reviewed,currentShop),{signal});}
        const shop = this.#own(s, actor, shopId);
        check(config(s).enabled,'SHOP_DISABLED','Listing creation is disabled',409);
        this.#b.workflow(s,items.kind==='mint-pack'?'packs':['mint-card','action'].includes(items.kind)?'directSales':'resale',price.amount>0);
        check(shop.enabled, "SHOP_DISABLED", "Shop is disabled", 409);
        assertAdminShop(s,shop);
        this.#currency(s, shop, price);
        check(
          (recordContexts.get(s)?.activeShopListings??Object.values(s.listings).filter(
            (l) => l.shopId === shopId && active(l),
          ).length) < config(s).maxListingsPerShop,
          "INSTALLATION_CAPACITY",
          "Shop listing limit reached",
          507,
        );
        const listing = {
          id: randomUUID(),
          shopId,
          sellerId: shop.ownerId,
          title,
          description,
          price: clone(price),
          kind: items.kind,
          previewAt: previewAt ?? startsAt,
          startsAt,
          endsAt,
          perBuyerLimit,
          metadata: clone(metadata),
          raffle: clone(raffle),
          entries: {},
          draw: null,
          units: [],
          preview: null,
          status: "active",
          createdAt: this.#b.now(),
        };
        const primary = ["mint-card", "mint-pack", "action"].includes(
          items.kind,
        );
        if (primary) {
          check(
            shop.kind === "admin",
            "FORBIDDEN",
            "Only admin shops can issue stock or custom items",
            403,
          );
          permission(actor, "commerce.manage");
          integer(
            items.quantity,
            "stock quantity",
            1,
            config(s).maxStockPerListing,
          );
        } else {
          check(
            Array.isArray(items.ids) &&
              items.ids.length > 0 &&
              items.ids.length <= config(s).maxStockPerListing &&
              new Set(items.ids).size === items.ids.length &&
              items.ids.every((x) => typeof x === "string"),
            "INVALID_INPUT",
            "Select unique owned stock",
          );
        }
        let copies = [],
          packs = [];
        if (items.kind === "mint-card") {
          const variant = find(s.catalog.variants, items.variantId);
          check(
            variant && variant.enabled !== false,
            "NOT_FOUND",
            "Variant not available",
            404,
          );
          for (let i = 0; i < items.quantity; i++)
            copies.push(
              this.#b.mint(s, shop.ownerId, items.variantId, {
                type: "shop-stock",
                listingId: listing.id,
                stockIndex: i,
              }),
            );
        }
        if (items.kind === "mint-pack") {
          const product = effectiveProduct(s,find(s.catalog.products, items.productId));
          check(
            product && product.enabled !== false,
            "NOT_FOUND",
            "Pack product unavailable",
            404,
          );
          packs = this.#b
            .allocatePacks(
              s,
              s.users[shop.ownerId],
              product,
              items.quantity,
              { listingId: listing.id },
              false,
            )
            .map((p) => s.packs[p.id]);
        }
        if (items.kind === "copies")
          copies = items.ids.map((id) => {
            const c = s.copies[id];
            check(
              c?.ownerId === shop.ownerId && c.state === "owned",
              "NOT_OWNED",
              "Stock must be owned cards",
              403,
            );
            this.#b.transferAllowed(s, c, shop.ownerId, null, "sale", false);
            return c;
          });
        if (items.kind === "packs") {
          check(
            config(s).packResale,
            "FORBIDDEN",
            "Pack resale is disabled",
            403,
          );
          packs = items.ids.map((id) => {
            const p = s.packs[id];
            check(
              p?.ownerId === shop.ownerId && !p.openedAt && !p.lockedBy,
              "NOT_OWNED",
              "Stock must be unreserved sealed packs",
              403,
            );
            for (const id of p.copyIds)
              this.#b.transferAllowed(
                s,
                s.copies[id],
                shop.ownerId,
                null,
                "sale",
                false,
              );
            return p;
          });
        }
        check(
          new Set(copies.map((c) => c.variantId)).size <= 1 &&
            new Set(packs.map((p) => p.productId + ":" + p.productRevision))
              .size <= 1,
          "INVALID_INPUT",
          "One listing must contain the same variant or pack revision",
        );
        const lock = "market:" + listing.id;
        for (const c of copies) {
          check(!c.lockedBy, "CARD_LOCKED", "Card already reserved", 409);
          c.lockedBy = lock;
          listing.units.push({
            id: randomUUID(),
            kind: "copy",
            copyId: c.id,
            primary,
            status: "available",
          });
        }
        for (const p of packs) {
          p.lockedBy = lock;
          for (const id of p.copyIds) s.copies[id].lockedBy = lock;
          listing.units.push({
            id: randomUUID(),
            kind: "pack",
            packId: p.id,
            primary,
            status: "available",
          });
        }
        if (items.kind === "action") {
          text(items.handler, "action handler", 100);
          jsonObject(items.params ?? {});
          for (let i = 0; i < items.quantity; i++)
            listing.units.push({
              id: randomUUID(),
              kind: "action",
              handler: items.handler,
              params: clone(items.params ?? {}),
              primary: true,
              status: "available",
            });
        }
        if (copies.length)
          listing.preview = {
            kind: "card",
            name: copies[0].definition.name,
            cardId: copies[0].cardId,
            variantId: copies[0].variantId,
          };
        else if (packs.length)
          listing.preview = {
            kind: "pack",
            name: packs[0].product.name,
            productId: packs[0].productId,
            preallocated: true,
          };
        else listing.preview = { kind: "custom", name: title };
        check(
          !raffle || raffle.winners <= listing.units.length,
          "INVALID_INPUT",
          "Winners exceed reserved stock",
        );
        if (this.#b.canList)
          check(
            this.#b.canList({
              actor: clone(actor),
              shop: clone(shop),
              listing: publicListing(s, listing, this.#b.now(), u.id),
            }) === true,
            "FORBIDDEN",
            "Host listing policy rejected stock",
            403,
          );
        assertAdminShop(s,shop,null,listing);
        s.listings[listing.id] = listing;
        return publicListing(s, listing, this.#b.now(), u.id);
      },receipt,
    );
  }
  listings(actor, { shopId, ...options } = {}) {
    return this.#b.read((s) => {
      const u = this.#b.user(s, actor),
        at = this.#b.now();
      return page(
        Object.values(s.listings ?? {})
          .filter(
            (l) =>
              (!shopId || l.shopId === shopId) &&
              (l.sellerId === u.id ||
                hasPermission(actor, "commerce.manage") ||
                (s.shops[l.shopId]?.enabled &&
                  Date.parse(l.previewAt) <= Date.parse(at))),
          )
          .map((l) => publicListing(s, l, at, u.id)),
        options,
      );
    });
  }
  #eligible(s, l, u, evaluateDirectPolicy = true) {
    const shop = s.shops[l.shopId],
      at = this.#b.now();
    const claim=l.draw?.winners.some(w=>w.userId===u.id&&!w.orderId);
    if(!claim)this.#b.workflow(s,l.kind==='mint-pack'?'packs':['mint-card','action'].includes(l.kind)?'directSales':'resale',l.price.amount>0);
    if(shop)assertAdminShop(s,shop,u.id,l);
    check(
      (config(s).enabled || claim) &&
        shop?.enabled &&
        (shop.kind === "admin" || config(s).playerShops),
      "SHOP_DISABLED",
      "Shop purchasing is disabled",
      409,
    );
    check(
      active(l) &&
        Date.parse(at) >= Date.parse(l.startsAt) &&
        (!l.endsAt || Date.parse(at) < Date.parse(l.endsAt)),
      "LISTING_CLOSED",
      "Listing is not open",
      409,
    );
    check(u.id !== l.sellerId, "FORBIDDEN", "Cannot buy your own stock", 403);
    check(
      !this.#b.blocked(s, u.id, l.sellerId),
      "TRANSFER_BLOCKED",
      "Transactions between these accounts are blocked",
      403,
    );
    this.#currency(s, shop, l.price);
    if (evaluateDirectPolicy && this.#b.canPurchase) {
      const decision = this.#b.canPurchase({
        user: clone(u),
        shop: clone(shop),
        listing: publicListing(s, l, at, u.id),
      });
      check(
        decision === true,
        "FORBIDDEN",
        typeof decision === "string"
          ? decision
          : "Host purchase policy rejected account",
        403,
      );
    }
  }
  #selection(s, l, u, quantity, evaluateDirectPolicy = true) {
    this.#eligible(s, l, u, evaluateDirectPolicy);
    integer(quantity, "quantity", 1, 1000);
    const bought = (recordContexts.get(s)?.listingPurchases ?? 0) + Object.values(s.orders ?? {})
      .filter((o) => o.listingId === l.id && o.buyerId === u.id)
      .reduce((n, o) => n + o.quantity, 0);
    check(
      bought + quantity <= l.perBuyerLimit,
      "PURCHASE_LIMIT",
      "Buyer limit reached",
      409,
    );
    if (l.raffle) {
      const win = l.draw?.winners.find((w) => w.userId === u.id);
      check(
        win &&
          !win.orderId &&
          quantity === 1 &&
          Date.parse(this.#b.now()) < Date.parse(l.draw.claimUntil),
        "RAFFLE_CLAIM",
        "No active purchase right",
        403,
      );
      return l.units.filter(
        (unit) => unit.id === win.unitId && unit.status === "available",
      );
    }
    const units = stock(l).slice(0, quantity);
    check(
      units.length === quantity,
      "OUT_OF_STOCK",
      "Not enough listing stock",
      409,
    );
    return units;
  }
  #unitView(s, unit) {
    if (unit.kind === "copy")
      return {
        unitId: unit.id,
        kind: "copy",
        copy: this.#b.copyView(s, s.copies[unit.copyId], null),
      };
    if (unit.kind === "pack")
      return {
        unitId: unit.id,
        kind: "pack",
        pack: this.#b.packView(s.packs[unit.packId]),
      };
    return { unitId: unit.id, kind: "custom" };
  }
  quote(actor, { listingId, quantity = 1 }) {
    check(!this.#remotePolicy,'POLICY_ASYNC_REQUIRED','Use asynchronous listing policy evaluation',503);
    return this.#quote(actor,{listingId,quantity});
  }
  #quote(actor, {listingId,quantity=1}, proposal, signal) {
    return this.#b.listingRead(actor, {listingId,quantity}, (s) => {
      const u = this.#b.user(s, actor),
        l = record(s.listings, listingId);
      check(l, "NOT_FOUND", "Listing not found", 404);
      const units = this.#selection(s, l, u, quantity);
      if(proposal)this.#proposals.admit(proposal,this.#dependencies(s,l,u,units,{listingId,quantity}),{signal});
      integer(l.price.amount * quantity, "total", 0);
      return {
        listingId,
        quantity,
        unitIds: units.map((x) => x.id),
        digest: digest(l, units),
        price: {
          currencyId: l.price.currencyId,
          amount: l.price.amount * quantity,
        },
        items: units.map((unit) => this.#unitView(s, unit)),
      };
    });
  }
  #dependencies(s,l,u,units,input){
    const copyIds=[...new Set(units.flatMap(unit=>unit.kind==='copy'?[unit.copyId]:unit.kind==='pack'?s.packs[unit.packId]?.copyIds??[]:[]))];
    const copies=copyIds.map(id=>{const c=s.copies[id];return c?{id:c.id,version:c.version,ownerId:c.ownerId,state:c.state,lockedBy:c.lockedBy??null,transferLock:c.transferLock??null,codeIds:c.codeIds??[]}:null;});
    const codes=copyIds.flatMap(id=>s.copies[id]?.codeIds??[]).map(id=>{const c=s.codes[id];return c?{id:c.id,holderId:c.holderId,status:c.status,transfer:c.transfer,revealedAt:c.revealedAt,reportedUsed:c.reportedUsed}:null;});
    const packs=units.filter(unit=>unit.kind==='pack').map(unit=>{const p=s.packs[unit.packId];return p?{id:p.id,ownerId:p.ownerId,lockedBy:p.lockedBy??null,openedAt:p.openedAt,copyIds:p.copyIds}:null;});
    const purchased=(recordContexts.get(s)?.listingPurchases??0)+Object.values(s.orders??{}).filter(o=>o.listingId===l.id&&o.buyerId===u.id).reduce((n,o)=>n+o.quantity,0);
    const parties=[u.id,l.sellerId].map(id=>({id,blockedUserIds:s.users[id]?.preferences?.blockedUserIds??[],balance:s.balances[id]?.[l.price.currencyId]??0}));
    return contentDigest({input,parties,listing:l,shop:s.shops[l.shopId],copies,packs,codes,purchased,
      catalogVersion:s.catalog?.version??0,adminRevision:adminRevision(s),commerceRevision:s.commerceSettings?.revision??0,tradingRevision:s.tradingPolicy?.revision??0,cardPolicyRevision:s.cardAuthoring?.revision??0});
  }
  #preparePolicy(actor,input,phase,key){
    const prepared=this.#b.listingRead(actor,input,s=>{
      const u=this.#b.user(s,actor),l=record(s.listings,input.listingId);check(l,'NOT_FOUND','Listing not found',404);
      const units=this.#selection(s,l,u,input.quantity,false);
      if(phase==='purchase')check(JSON.stringify(units.map(unit=>unit.id))===JSON.stringify(input.unitIds)&&digest(l,units)===input.digest,'STALE_QUOTE','Stock or terms changed; review a new quote',409);
      const shop=s.shops[l.shopId];
      return {phase,userId:u.id,key,input,snapshotDigest:this.#dependencies(s,l,u,units,input),context:{
        user:{id:u.id},shop:{id:shop.id,ownerId:shop.ownerId,kind:shop.kind},listing:{id:l.id,kind:l.kind,price:clone(l.price)},quantity:input.quantity,unitIds:units.map(unit=>unit.id),
      }};
    });
    return this.#proposals.prepare(prepared);
  }
  async quoteAsync(actor,{listingId,quantity=1},{signal}={}){
    if(!this.#remotePolicy)return this.quote(actor,{listingId,quantity});
    const principal=clone(actor),input={listingId,quantity};
    const proposal=this.#preparePolicy(principal,input,'quote');
    await this.#proposals.evaluate(proposal,{signal});return this.#quote(principal,input,proposal,signal);
  }
  async buyAsync(actor,{key,listingId,quantity=1,unitIds,digest:expectedDigest},{signal}={}){
    if(!this.#remotePolicy)return this.buy(actor,{key,listingId,quantity,unitIds,digest:expectedDigest});
    const principal=clone(actor),input=clone({listingId,quantity,unitIds,digest:expectedDigest});
    text(key,'idempotency key',128);
    const previous=this.#b.purchaseReceipt(principal,key,input);if(previous.found)return previous.result;
    check(Array.isArray(unitIds)&&unitIds.length===quantity,'INVALID_INPUT','Quoted unit IDs required');
    const proposal=this.#preparePolicy(principal,input,'purchase',key);
    await this.#proposals.evaluate(proposal,{signal});return this.#buy(principal,{key,...input},proposal,signal);
  }
  buy(
    actor,
    { key, listingId, quantity = 1, unitIds, digest: expectedDigest },
  ) {
    if(this.#remotePolicy){
      const previous=this.#b.purchaseReceipt(actor,key,{listingId,quantity,unitIds,digest:expectedDigest});
      if(previous.found)return previous.result;
      check(false,'POLICY_ASYNC_REQUIRED','Use asynchronous listing policy evaluation',503);
    }
    return this.#buy(actor,{key,listingId,quantity,unitIds,digest:expectedDigest});
  }
  #buy(actor,{key,listingId,quantity=1,unitIds,digest:expectedDigest},proposal,signal){
    check(
      Array.isArray(unitIds) && unitIds.length === quantity,
      "INVALID_INPUT",
      "Quoted unit IDs required",
    );
    const receipt={};
    return this.#b.listingCommand(
      actor,
      key,
      "shop.purchased",
      { listingId, quantity, unitIds, digest: expectedDigest },
      (s, u) => {
        initialize(s);
        const l = record(s.listings, listingId);
        check(l, "NOT_FOUND", "Listing not found", 404);
        const units = this.#selection(s, l, u, quantity);
        if(proposal)receipt.policyAdmission=this.#proposals.admit(proposal,this.#dependencies(s,l,u,units,{listingId,quantity,unitIds,digest:expectedDigest}),{signal});
        check(
          units.length === quantity &&
            JSON.stringify(units.map((x) => x.id)) ===
              JSON.stringify(unitIds) &&
            digest(l, units) === expectedDigest,
          "STALE_QUOTE",
          "Stock or terms changed; review a new quote",
          409,
        );
        const order = {
          id: randomUUID(),
          listingId,
          shopId: l.shopId,
          buyerId: u.id,
          sellerId: l.sellerId,
          quantity,
          unitIds: [...unitIds],
          paid: {
            currencyId: l.price.currencyId,
            amount: l.price.amount * quantity,
          },
          createdAt: this.#b.now(),
          items: [],
          actionJobIds: [],
        };
        integer(order.paid.amount, "total", 0);
        if (units.some((unit) => !unit.primary))
          this.#b.checkResale(s, l.sellerId, u.id, units, order.paid);
        this.#b.adjust(
          s,
          u.id,
          order.paid.currencyId,
          -order.paid.amount,
          "shop.purchase",
          order.id,
        );
        this.#b.adjust(
          s,
          l.sellerId,
          order.paid.currencyId,
          order.paid.amount,
          "shop.proceeds",
          order.id,
        );
        for (const unit of units) {
          const lock = "market:" + l.id;
          if (unit.kind === "copy") {
            const c = s.copies[unit.copyId];
            check(
              c?.ownerId === l.sellerId && c.lockedBy === lock,
              "STOCK_CHANGED",
              "Card reservation changed",
              409,
            );
            if (!unit.primary)
              this.#b.transferAllowed(s, c, l.sellerId, u.id, "sale", true);
            this.#b.deliverCopy(s, c, l.sellerId, u.id, order.id, unit.primary);
            order.items.push({ kind: "copy", copyId: c.id });
          } else if (unit.kind === "pack") {
            const p = s.packs[unit.packId];
            check(
              p?.ownerId === l.sellerId && p.lockedBy === lock && !p.openedAt,
              "STOCK_CHANGED",
              "Pack reservation changed",
              409,
            );
            for (const id of p.copyIds) {
              const c = s.copies[id];
              check(
                c.ownerId === l.sellerId && c.lockedBy === lock,
                "STOCK_CHANGED",
                "Pack contents changed",
                409,
              );
              if (!unit.primary)
                this.#b.transferAllowed(s, c, l.sellerId, u.id, "sale", true);
            }
            this.#b.deliverPack(s, p, l.sellerId, u.id, order.id);
            order.items.push({ kind: "pack", packId: p.id });
          } else {
            const job = enqueueAction(
              s,
              {
                handler: unit.handler,
                params: unit.params,
                userId: u.id,
                source: {
                  type: "shop.purchased",
                  orderId: order.id,
                  listingId: l.id,
                  unitId: unit.id,
                },
              },
              this.#b.now(),
            );
            order.actionJobIds.push(job.id);
            order.items.push({ kind: "custom", jobId: job.id });
          }
          unit.status = "sold";
          unit.orderId = order.id;
        }
        if (l.raffle)
          l.draw.winners.find((w) => w.userId === u.id).orderId = order.id;
        s.orders[order.id] = order;
        this.#b.event(s, "shop.order-created", {
          orderId: order.id,
          userId: u.id,
          shopId: l.shopId,
          listingId: l.id,
        });
        return this.#orderView(s, order);
      },receipt,
    );
  }
  #orderView(s, o) {
    const jobs = o.actionJobIds.map((id) => s.actionJobs[id]);
    return {
      ...o,
      fulfillment: jobs.some((j) => j.status === "dead")
        ? "attention-required"
        : jobs.some((j) => j.status !== "succeeded")
          ? "pending"
          : "complete",
    };
  }
  orders(actor, options = {}) {
    return this.#b.read((s) => {
      const u = this.#b.user(s, actor);
      return page(
        Object.values(s.orders ?? {})
          .filter((o) => o.buyerId === u.id || o.sellerId === u.id)
          .map((o) => this.#orderView(s, o)),
        options,
      );
    });
  }
  #release(s, l, status) {
    for (const unit of stock(l)) {
      const lock = "market:" + l.id;
      if (unit.kind === "copy") {
        const copy = s.copies[unit.copyId];
        if (copy?.lockedBy === lock) delete copy.lockedBy;
      } else if (unit.kind === "pack") {
        const p = s.packs[unit.packId];
        if (p?.lockedBy === lock) delete p.lockedBy;
        for (const id of p?.copyIds ?? [])
          if (s.copies[id]?.lockedBy === lock) delete s.copies[id].lockedBy;
      }
      unit.status = "released";
    }
    l.status = status;
    l.closedAt = this.#b.now();
    this.#b.event(s, "listing." + status, {
      listingId: l.id,
      userId: l.sellerId,
    });
  }
  cancel(actor, { key, listingId }) {
    return this.#b.cancelListingCommand(
      actor,
      key,
      "listing.canceled",
      { listingId },
      (s, u) => {
        const l = record(s.listings, listingId);
        check(
          l && (l.sellerId === u.id || hasPermission(actor, "commerce.manage")),
          "NOT_FOUND",
          "Listing not found",
          404,
        );
        if (active(l)) this.#release(s, l, "canceled");
        return publicListing(s, l, this.#b.now(), u.id);
      },
    );
  }
  expire(actor) {
    permission(actor, "maintenance.run");
    const ids=this.#b.selectDueExpirations('listings',this.#b.now(),32),failed=[];let count=0;
    for(const listingId of ids)try{
      if(this.#b.expireListing(listingId,(s,l,status)=>this.#release(s,l,status)))count++;
    }catch(error){failed.push({listingId,code:/^[A-Z][A-Z0-9_]{0,80}$/.test(error?.code)?error.code:'INTERNAL_ERROR'});}
    return failed.length?{count,failed}:{count};
  }

  enter(actor, { key, listingId }) {
    return this.#b.raffleCommand(
      actor,
      key,
      "raffle.entered",
      { listingId },
      (s, u) => {
        const l = record(s.listings, listingId);
        check(l?.raffle, "NOT_FOUND", "Raffle not found", 404);
        this.#eligible(s, l, u);
        check(
          !l.draw &&
            Date.parse(this.#b.now()) < Date.parse(l.raffle.entryClosesAt),
          "RAFFLE_CLOSED",
          "Entries are closed",
          409,
        );
        if (!l.entries[u.id]) {
          check(
            Object.keys(l.entries).length < config(s).maxRaffleEntries,
            "INSTALLATION_CAPACITY",
            "Raffle entry limit reached",
            507,
          );
          l.entries[u.id] = { userId: u.id, at: this.#b.now() };
        }
        return this.#raffleView(l, u.id);
      },
    );
  }
  #raffleView(l, userId) {
    const win = l.draw?.winners.find((w) => w.userId === userId);
    return {
      listingId: l.id,
      entryCount: Object.keys(l.entries).length,
      entered: !!l.entries[userId],
      drawnAt: l.draw?.at ?? null,
      winner: !!win,
      orderId: win?.orderId ?? null,
      claimUntil: win ? l.draw.claimUntil : null,
      status: l.status,
    };
  }
  raffleStatus(actor, { listingId }) {
    return this.#b.raffleRead(actor,{listingId},(s) => {
      const u = this.#b.user(s, actor),
        l = record(s.listings, listingId);
      check(
        l?.raffle &&
          (Date.parse(l.previewAt) <= Date.parse(this.#b.now()) ||
            l.sellerId === u.id ||
            hasPermission(actor, "commerce.manage")),
        "NOT_FOUND",
        "Raffle not found",
        404,
      );
      return this.#raffleView(l, u.id);
    });
  }
  draw(actor, { key, listingId }) {
    return this.#b.raffleOperator(
      actor,
      key,
      "raffles.draw",
      "raffle.drawn",
      { listingId },
      (s) => {
        const l = record(s.listings, listingId);
        check(l?.raffle, "NOT_FOUND", "Raffle not found", 404);
        if (l.draw) return clone(l.draw);
        check(
          active(l) &&
            (!l.endsAt || Date.parse(l.endsAt) > Date.parse(this.#b.now())) &&
            Date.parse(this.#b.now()) >= Date.parse(l.raffle.entryClosesAt),
          "RAFFLE_CLOSED",
          "Raffle is not ready to draw",
          409,
        );
        const entries = Object.keys(l.entries),
          units = stock(l),
          winners = [];
        const count = Math.min(entries.length, l.raffle.winners, units.length);
        for (let i = 0; i < count; i++) {
          const n = this.#random(entries.length);
          check(
            Number.isInteger(n) && n >= 0 && n < entries.length,
            "INVALID_PROVIDER",
            "Invalid raffle random draw",
            500,
          );
          const [userId] = entries.splice(n, 1);
          winners.push({ userId, unitId: units[i].id, orderId: null });
        }
        const at=this.#b.now();
        l.draw = {
          id: randomUUID(),
          at,
          claimUntil: new Date(
            Math.min(
              Date.parse(at) + l.raffle.claimSeconds * 1000,
              l.endsAt ? Date.parse(l.endsAt) : Infinity,
            ),
          ).toISOString(),
          winners,
        };
        for (const win of winners)
          this.#b.notify(s, win.userId, "raffle.won", {
            listingId: l.id,
            claimUntil: l.draw.claimUntil,
          });
        return clone(l.draw);
      },
    );
  }
}
