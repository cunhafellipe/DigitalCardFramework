export const localizationProtocol='digital-card-localization@1';
const freeze=value=>{for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);};
export const englishMessages=freeze({
  'nav.wallet':'Wallet','nav.shop':'Discover','nav.packs':'My packs','nav.features':'Framework features',
  'account.heading':'YOUR ACCOUNT','account.you':'You','account.cards':{one:'{count} card',other:'{count} cards'},'account.sealedPacks':{one:'{count} sealed pack',other:'{count} sealed packs'},
  'status.working':'Working…','status.saved':'Changes saved.',
  'wallet.title':'Your wallet','wallet.description':'Each account has its own balances. Pack purchases and conversions update these balances immediately.',
  'wallet.tradable':'Tradable','wallet.notTradable':'Not tradable','wallet.value':'{tradability} · Value: {amount} base units',
  'wallet.convert':'Convert currencies','wallet.amount':'Amount to spend','wallet.from':'From','wallet.to':'To',
  'wallet.converted':'Converted {amount} {from} into {received} {to}.','wallet.wholeUnits':'Choose an amount that converts to a whole unit. Fractional results are rejected.',
  'artwork.back':'Show pack back','artwork.front':'Show pack front','artwork.subtitle':'COLLECTIBLE CARDS','artwork.reveal':'Pack reveal artwork',
  'shop.title':'Find your next discovery','shop.description':'Choose a pack, check its contents and price, then open it in My packs.',
  'shop.stepBuy':'Buy a pack','shop.stepBuyDescription':'Spend your account’s currency','shop.stepReveal':'Reveal your cards','shop.stepRevealDescription':'Open the pack in My packs','shop.stepCollect':'Make it yours','shop.stepCollectDescription':'Inspect cards and build an album',
  'shop.cardsPerPack':{one:'{count} card per pack',other:'{count} cards per pack'},'shop.duplicateProtection':' · Duplicate protection',
  'shop.pityPersonal':'Personal pity targets {rarity} or better by pack {after} since your last qualifying ordinary card · {progress}/{after} packs. A qualifying ordinary card resets pity; special inserts do not. When due, pity applies to the first draw in the first ordinary-card slot. Sealed packs count.',
  'shop.pityLegacy':'{rarity} or better by purchase {after} since your last qualifying pack · {progress}/{after} misses. Sealed packs count.',
  'shop.duplicatesInventory':'Ordinary card draws avoid card identities you already own and those in earlier packs of this purchase, including inserts in those earlier packs. They also avoid repeating ordinary card identities within the current pack.',
  'shop.duplicatesPack':'Ordinary card draws avoid repeating card identities within each pack; this check resets for the next pack.',
  'shop.inserts':'Special inserts bypass duplicate filtering.','shop.fallbackAllow':'If no unseen eligible card remains for a protected draw, the fallback allows a repeat.','shop.fallbackReject':'If no unseen eligible card can fill a protected draw, the purchase fails.',
  'shop.availableFrom':'From {date}','shop.availableUntil':' · Until {date}','shop.ticketsSummary':'See cards & ticket counts','shop.ratesSummary':'See cards & drop rates',
  'shop.draws':{one:'{count} draw per pack from this pool',other:'{count} draws per pack from this pool'},'shop.poolTickets':' · {count} configured tickets',
  'shop.remaining':' · {count} remaining','shop.tickets':{one:'{count} configured ticket',other:'{count} configured tickets'},
  'shop.deckExplanation':'All packs in one purchase draw tickets from each pool without replacement. A drawn ticket cannot be drawn again in that batch, so chances change between draws. Configured ticket counts are not fixed independent drop rates. Finite remaining supply can reduce the tickets available.',
  'shop.conditionalTickets':'Duplicate eligibility and personal pity can further change which tickets are eligible.','shop.codeSupply':'Imported-code supply also limits eligible tickets. Shared code pools may change before purchase.','shop.quoteSupply':'Your quote checks the current eligible supply.','shop.baseRates':'Base rates. Remaining editions and duplicate protection affect eligible cards.',
  'shop.quantity':'Packs','shop.activation':{one:'Up to {count} attached reward may require activation after purchase. Pack delivery does not confirm reward activation. These rewards cannot be used until activation is confirmed. If activation remains pending, contact the operator to recover the original activation.',other:'Up to {count} attached rewards may require activation after purchase. Pack delivery does not confirm reward activation. These rewards cannot be used until activation is confirmed. If activation remains pending, contact the operator to recover the original activation.'},
  'shop.review':{one:'Review {count} pack for {amount} {currency}.',other:'Review {count} packs for {amount} {currency}.'},'shop.reviewCodeSupply':'Availability depends on current imported-code supply.','shop.reviewAllocation':'Buying uses this reviewed allocation quote.',
  'shop.reviewReady':'Purchase quote ready. Review the pack quantity and price before buying.','shop.reviewActivationReady':'Purchase quote ready. Review the pack quantity and price and reward activation notice before buying.',
  'shop.purchased':{one:'Purchased {count} pack. Choose Open pack to reveal your cards.',other:'Purchased {count} packs. Choose Open pack to reveal your cards.'},
  'shop.activationDelivered':{one:'{count} attached reward was pending activation at delivery. Check current card details for activation status.',other:'{count} attached rewards were pending activation at delivery. Check current card details for activation status.'},
  'shop.retry':'Retry original purchase · {amount} {currency}','shop.buyReviewed':'Buy reviewed packs · {amount} {currency}','shop.reviewButton':'Review purchase · {amount} {currency}','shop.buy':'Buy · {amount} {currency}','shop.unavailable':'Currently unavailable',
  'shop.changedView':'The purchase view or signed-in account changed. Review the purchase again.','shop.changedQuantity':'The pack quantity changed. Review the purchase again.','shop.changedPrice':'The pack price changed. Review the updated price before buying.',
  'allocation.needsReview':'The allocation attempt needs review. Check its status before acknowledging it and requesting a fresh quote.',
  'allocation.check':'Check allocation attempt','allocation.acknowledge':'Acknowledge allocation attempt','allocation.invalidStatus':'Invalid allocation status response','allocation.checkFirst':'Check the allocation attempt before acknowledging it','allocation.invalidAcknowledgement':'Invalid allocation acknowledgement response','allocation.checked':'Allocation status checked.',
  'allocation.acknowledgedUnresolved':'Allocation attempt acknowledged. Resolve the original purchase before requesting a fresh quote.','allocation.acknowledged':'Allocation attempt acknowledged. Review a fresh quote before buying.',
  'allocation.completed':'This allocation completed. Recover the original purchase result or check My packs.','allocation.stale':'The allocation is stale.','allocation.pending':'An allocation attempt is pending.','allocation.abandon':'Acknowledge this inactive attempt to abandon it. This does not buy packs.',
  'allocation.retryOriginal':'Retry the original purchase to resolve its saved result before requesting a new quote.','allocation.freshReview':'No active allocation attempt. Select Review purchase to request a fresh quote.',
  'packs.title':'Your packs','packs.description':'Sealed packs are ready to open. Opened packs can be replayed without spending currency or receiving extra cards.','packs.opened':'Opened','packs.sealed':'Sealed','packs.replay':'Replay pack','packs.open':'Open pack','packs.replaying':'Replaying saved cards. No additional charge.','packs.openSuccess':'Pack opened. Reveal the cards below.','packs.empty':'No packs yet','packs.emptyDescription':'Buy your first pack to start collecting.','packs.browse':'Browse packs',
  'opener.complete':'Your cards are revealed','opener.title':'Reveal your cards','opener.idle':'Choose a sealed pack above. After opening, its cards belong to your collection.','opener.loading':'Loading committed cards…','opener.progress':'{revealed} of {total} revealed · Cards are already saved to your collection.','opener.next':'Reveal next','opener.all':'Reveal all','opener.replay':'Replay reveal','opener.new':'New to your collection','opener.duplicate':'Duplicate at opening','opener.card':'Card {number}',
  'card.label':'{name}, {rarity}','card.serialLabel':'{name}, {rarity} {serial} of {total}',
  'recovery.title':'Unconfirmed changes','recovery.description':'Recover these previously reviewed changes before starting another. Recovery uses the original request.','recovery.purchase':'pack purchase','recovery.openPack':'pack opening','recovery.convert':'currency conversion','recovery.action':'Recover {change}','recovery.product':'{count} × {product}','recovery.success':'Original result recovered.'
});
const placeholders=text=>[...new Set([...text.matchAll(/\{([a-z][a-zA-Z0-9]*)\}/g)].map(match=>match[1]))].sort();
export const localizationKeys=freeze(Object.fromEntries(Object.entries(englishMessages).map(([key,message])=>[key,{placeholders:placeholders(typeof message==='string'?message:message.other),plural:typeof message!=='string'}])));
export const localizationSchema=freeze({protocol:localizationProtocol,maximumBytes:32768,maximumMessages:256,maximumTextLength:2048,pluralCategories:['zero','one','two','few','many','other'],keys:localizationKeys});
const invalid=()=>{throw new TypeError('Invalid localization bundle');};
function dataObject(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!('value' in descriptors[key])||!descriptors[key].enumerable))invalid();
  return value;
}
function canonicalLocale(value){if(typeof value!=='string'||value.length>100)invalid();try{const [locale]=Intl.getCanonicalLocales(value);if(!locale)invalid();return locale;}catch{invalid();}}
function validText(text,key){
  if(typeof text!=='string'||text.length>localizationSchema.maximumTextLength||!text.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))invalid();
  if(text.replace(/\{[a-z][a-zA-Z0-9]*\}/g,'').match(/[{}]/)||JSON.stringify(placeholders(text))!==JSON.stringify(localizationKeys[key].placeholders))invalid();
  return text;
}
export function validateLocalizationBundle(input){
  dataObject(input);if(Object.keys(input).length!==3||!Object.hasOwn(input,'protocol')||input.protocol!==localizationProtocol||!Object.hasOwn(input,'locale')||!Object.hasOwn(input,'messages'))invalid();
  const locale=canonicalLocale(input.locale),source=dataObject(input.messages),messages={};
  if(Object.keys(source).length>localizationSchema.maximumMessages)invalid();
  for(const [key,message]of Object.entries(source)){
    if(!Object.hasOwn(localizationKeys,key))invalid();
    if(!localizationKeys[key].plural){messages[key]=validText(message,key);continue;}
    dataObject(message);if(!Object.hasOwn(message,'other'))invalid();const forms={};
    for(const [category,text]of Object.entries(message)){if(!localizationSchema.pluralCategories.includes(category))invalid();forms[category]=validText(text,key);}messages[key]=forms;
  }
  const bundle={protocol:localizationProtocol,locale,messages};if(new TextEncoder().encode(JSON.stringify(bundle)).length>localizationSchema.maximumBytes)invalid();
  return freeze(bundle);
}
export function createLocalization(options={}){
  dataObject(options);if(Object.keys(options).some(key=>!['locale','messages'].includes(key)))invalid();const {locale='en',messages={}}=options;
  const bundle=validateLocalizationBundle({protocol:localizationProtocol,locale,messages}),numberFormat=new Intl.NumberFormat(bundle.locale,{maximumFractionDigits:20}),
    dates=new Intl.DateTimeFormat(bundle.locale,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'UTC'}),
    plurals=new Intl.PluralRules(bundle.locale,{maximumFractionDigits:20}),englishPlurals=new Intl.PluralRules('en',{maximumFractionDigits:20}),intlLocale=new Intl.Locale(bundle.locale);
  const number=value=>{if(typeof value!=='number'||!Number.isFinite(value))invalid();return numberFormat.format(value);};
  return Object.freeze({locale:bundle.locale,dir:intlLocale.textInfo?.direction??(/^(ar|fa|he|ur|ps|sd|ug|yi|dv)(-|$)/.test(bundle.locale)?'rtl':'ltr'),
    number,date(value){let time;if(typeof value==='string'||typeof value==='number')time=new Date(value).getTime();else{try{time=Date.prototype.getTime.call(value);}catch{invalid();}}if(!Number.isFinite(time))invalid();return dates.format(time);},
    text(key,values={}){
      if(!Object.hasOwn(localizationKeys,key))invalid();dataObject(values);const metadata=localizationKeys[key],translated=Object.hasOwn(bundle.messages,key),message=translated?bundle.messages[key]:englishMessages[key];
      let template=message;if(metadata.plural){if(typeof values.count!=='number'||!Number.isFinite(values.count))invalid();const category=(translated?plurals:englishPlurals).select(values.count);template=message[category]??message.other;}
      return template.replace(/\{([a-z][a-zA-Z0-9]*)\}/g,(_,name)=>{if(!Object.hasOwn(values,name)||!['string','number'].includes(typeof values[name]))invalid();return typeof values[name]==='number'?number(values[name]):values[name];});
    }
  });
}
