import {createTradingSession} from './trading-session.js';
import {localizeDiagnostic,createLocalization,localizationKeys} from './localization.js';
import {el,button,field,select,section} from './ui-kit.js';

/** Two real inventories, two offer trays, and immutable offer review. Entire view is replaceable. */
export function renderTrading(model,context,sharedSession){
  const session=sharedSession??createTradingSession(model,context);
  const {client,cardRenderer,inspect,action,mutate,locale='en',messages={},localization=createLocalization({locale,messages})}=context,t=localization.text,num=localization.number,date=localization.date,node=section(t('trades.title'),t('trades.description'));
  node.setAttribute('lang',localization.locale);node.setAttribute('dir',localization.dir);
  const renderedCards=new Set(),paneCards={give:[],receive:[]};let cardSide=null;const renderCopy=(copy,options)=>{const card=cardRenderer(copy,options);renderedCards.add(card);if(cardSide)paneCards[cardSide].push(card);return card.node??card;};
  const enabled=model.catalog.features.cardTrading||model.catalog.features.currencyTrading;
  const header=el('div','dc-trade-heading');header.append(el('span','dc-eyebrow',t('trades.heading')),el('span','dc-badge',t('trades.pending',{count:model.trades.filter(trade=>trade.status==='pending').length})));node.prepend(header);
  let draft=session.draft,unsubscribe,disposed=false,partnerOptions=session.directory,counter=session.counter,state=session.state,ownSearch='',partnerSearch='',ownLimit=24,partnerLimit=24;
  const composer=el('div','dc-trade-composer'),toolbar=el('div','dc-form-row'),choose=select(toolbar,t('trades.with'),[{id:'',name:t('trades.choose')}]),recipientSearch=field(toolbar,t('trades.find'),{placeholder:t('trades.findPlaceholder')}),loadButton=button(t('trades.search'),loadDirectory,'dc-quiet');toolbar.append(loadButton);
  const counterNotice=el('p','dc-accent'),error=el('p','dc-error');error.setAttribute('role','status');
  const board=el('div','dc-trade-board'),panes={};
  for(const side of ['give','receive']){
    const pane=el('section','dc-inventory-pane'),heading=el('h3','',t(side==='give'?'trades.yourInventory':'trades.theirInventory')),search=field(pane,t(side==='give'?'trades.searchOwn':'trades.searchPartner'),{placeholder:t('trades.cardPlaceholder')}),grid=el('div','dc-trade-inventory'),tray=el('div','dc-offer-tray'),money=el('div','dc-offer-money'),more=button(t('trades.more'),()=>{if(side==='give')ownLimit+=24;else partnerLimit+=24;renderState();},'dc-quiet');
    search.addEventListener('input',()=>{if(side==='give')ownSearch=search.value.toLowerCase();else partnerSearch=search.value.toLowerCase();renderState();});
    pane.prepend(heading);tray.setAttribute('aria-label',t(side==='give'?'trades.offerTray':'trades.requestTray'));tray.dataset.side=side;
    tray.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('application/x-dc-copy')){e.preventDefault();tray.classList.add('is-dragover');}});tray.addEventListener('dragleave',()=>tray.classList.remove('is-dragover'));
    tray.addEventListener('drop',e=>{e.preventDefault();tray.classList.remove('is-dragover');try{const item=JSON.parse(e.dataTransfer.getData('application/x-dc-copy'));if(item.side!==side)throw new Error(t('trades.wrongTray'));draft.add(side,item.id);}catch(err){error.textContent=localizeDiagnostic(localization,err);}});
    pane.append(grid,more,el('h4','',t(side==='give'?'trades.youOffer':'trades.youRequest')),tray,money);board.append(pane);panes[side]={heading,grid,tray,more,money};
    for(const currency of model.catalog.currencies.filter(c=>model.catalog.features.currencyTrading&&c.tradable)){const input=field(money,t(side==='give'?'trades.offerCurrency':'trades.requestCurrency',{currency:currency.name}),{type:'number',value:'0'});input.min='0';input.step='1';input.dataset.currency=currency.id;
      input.addEventListener('input',()=>{try{input.setCustomValidity('');draft.setCurrency(side,currency.id,Number(input.value));error.textContent='';}catch(err){input.setCustomValidity(localizeDiagnostic(localization,err));draft.review(false);error.textContent=localizeDiagnostic(localization,err);confirm.disabled=send.disabled=true;}});}
  }
  const message=field(composer,t('trades.message'),{type:'textarea',placeholder:t('trades.messagePlaceholder')});message.maxLength=500;message.rows=2;message.addEventListener('input',()=>draft?.setMessage(message.value));
  const review=button(t('trades.reviewAction'),()=>{if([...composer.querySelectorAll('.dc-offer-money input')].every(input=>input.reportValidity()))session.review(node);},'dc-quiet'),confirm={checked:false,disabled:false};
  const summary=el('p','dc-trade-summary'),send={disabled:false,textContent:''};
  const reset=button(t('trades.clear'),()=>draft.clear(),'dc-quiet');composer.prepend(toolbar,counterNotice,error,board);composer.append(summary,review,el('p','dc-muted',t('trades.expiry')),reset);
  if(enabled)node.append(composer);else node.append(el('p','dc-muted',t('trades.disabled')));
  const list=el('div','dc-offer-list');node.append(el('h3','dc-subheading',t('trades.offers')),list);
  const name=id=>model.catalog.currencies.find(c=>c.id===id)?.name??id;
  const snapshotCards=(trade,side)=>{const box=el('div','dc-snapshot-side');box.append(el('span','dc-eyebrow',t(side==='give'?'trades.senderOffers':'trades.senderRequests')));const grid=el('div','dc-trade-snapshots');for(const id of trade[side].copyIds){const copy=trade.snapshots?.[id];if(copy)grid.append(renderCopy(copy,{interactive:false,onSelect:inspect,localization}));else grid.append(el('span','dc-badge',t('trades.card',{id:id.slice(0,8)})));}box.append(grid);for(const amount of trade[side].currencies)box.append(el('p','',num(amount.amount)+' '+name(amount.currencyId)));if(!trade[side].copyIds.length&&!trade[side].currencies.length)box.append(el('small','dc-muted',t('trades.gift')));return box;};
  for(const trade of model.trades.slice().reverse()){
    const offer=el('article','dc-trade-offer'),head=el('div','dc-row');head.append(el('span','dc-badge is-'+trade.status,Object.hasOwn(localizationKeys,'trades.status.'+trade.status)?t('trades.status.'+trade.status):trade.status),el('h3','',(trade.fromName??t('trades.collector'))+' → '+(trade.toName??t('trades.collector'))));offer.append(head);
    if(trade.message)offer.append(el('p','dc-offer-message',trade.message));const sides=el('div','dc-trade-columns');sides.append(snapshotCards(trade,'give'),snapshotCards(trade,'receive'));offer.append(sides);
    offer.append(el('small','dc-muted',t('trades.dates',{created:date(trade.createdAt),expires:date(trade.expiresAt)})));
    if(trade.status==='pending'){
      const row=el('div','dc-row');if(enabled&&trade.toUserId===model.me.userId){
        row.append(button(t('trades.accept'),()=>session.review(node,trade,'accept')),button(t('trades.counter'),()=>startDraft(trade),'dc-quiet'));
      }
      row.append(button(t(trade.fromUserId===model.me.userId?'trades.cancel':'trades.decline'),()=>session.review(node,trade,trade.fromUserId===model.me.userId?'cancel':'decline'),'dc-quiet'));offer.append(row);
    }list.append(offer);
  }
  if(!model.trades.length)list.append(el('div','dc-empty',t('trades.empty')));

  async function loadDirectory(){await session.loadDirectory(recipientSearch.value);}
  function startDraft(trade=null){ownLimit=partnerLimit=24;session.start(choose.value||null,trade);composer.scrollIntoView({block:'nearest'});}
  function renderState(){if(disposed||!state)return;confirm.checked=state.reviewed;confirm.disabled=state.phase!=='ready'||!state.recipientId||state.reviewPhase==='pending';send.disabled=!state.reviewed||!state.recipientId;send.textContent=t(counter?'trades.sendCounter':'trades.send');error.textContent=(state.error?(state.diagnostic?localizeDiagnostic(localization,state.diagnostic):state.error):null)??(state.reviewPhase==='pending'?t('trades.checking'):'');
    if(document.activeElement!==message)message.value=state.message;
    summary.textContent=t('trades.offerCards',{count:state.give.length})+state.giveCurrencies.map(c=>' + '+num(c.amount)+' '+name(c.currencyId)).join('')+' · '+t('trades.requestCards',{count:state.receive.length})+state.receiveCurrencies.map(c=>' + '+num(c.amount)+' '+name(c.currencyId)).join('')+(state.phase==='loading'?t('trades.loadingInventories'):'');
    for(const side of ['give','receive']){const pane=panes[side],items=side==='give'?state.inventory:state.partnerInventory,search=side==='give'?ownSearch:partnerSearch,limit=side==='give'?ownLimit:partnerLimit;
      pane.heading.textContent=side==='give'?t('trades.yourInventory'):t('trades.partnerInventory',{name:state.partner?.name??t('trades.their')});for(const card of paneCards[side]){card.dispose?.();renderedCards.delete(card);}paneCards[side]=[];cardSide=side;pane.grid.replaceChildren();pane.tray.replaceChildren();
      const filtered=items.filter(copy=>JSON.stringify([copy.definition.name,copy.rarityId,copy.lineId,copy.definition.tags]).toLowerCase().includes(search));
      for(const copy of filtered.slice(0,limit)){
        const tile=el('div','dc-trade-card'+(state[side].includes(copy.id)?' is-selected':'')),eligible=model.catalog.features.cardTrading&&(copy.tradable||copy.remoteReviewRequired===true||counter&&copy.lockedBy===counter.id&&copy.untradableReason==='Reserved by another transaction');tile.draggable=!!eligible;tile.dataset.copyId=copy.id;
        tile.addEventListener('dragstart',e=>{e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('application/x-dc-copy',JSON.stringify({side,id:copy.id}));});tile.append(renderCopy(copy,{interactive:false,onSelect:inspect,localization}));
        const add=button(t(state[side].includes(copy.id)?'trades.inOffer':'trades.add'),()=>{try{draft.add(side,copy.id);}catch(err){error.textContent=localizeDiagnostic(localization,err);}},'dc-quiet');add.disabled=!eligible||state[side].includes(copy.id);tile.append(add);if(!eligible)tile.append(el('small','dc-muted',copy.untradableReason??t('trades.reserved')));else if(copy.remoteReviewRequired)tile.append(el('small','dc-muted',t('trades.availabilityReview')));pane.grid.append(tile);
      }
      if(!filtered.length)pane.grid.append(el('p','dc-muted',state.phase==='loading'?t('trades.loading'):side==='receive'&&session.partnerPrivate?t('trades.privateInventory'):t('trades.noCards')));
      pane.more.hidden=filtered.length<=limit;
      if(state[side==='give'?'ownNext':'partnerNext'])pane.grid.append(button(t('trades.nextInventory'),()=>draft.more(side),'dc-quiet'));
      const selected=state[side==='give'?'selectedGive':'selectedReceive'];for(const copy of selected){const item=el('div','dc-tray-card');item.append(renderCopy(copy,{interactive:false,onSelect:inspect,localization}),button(t('trades.remove'),()=>draft.remove(side,copy.id),'dc-quiet'));pane.tray.append(item);}if(!selected.length)pane.tray.append(el('p','dc-drop-hint',t('trades.dropHint')));
      for(const input of pane.money.querySelectorAll('input'))if(document.activeElement!==input)input.value=String(state[side+'Currencies'].find(c=>c.currencyId===input.dataset.currency)?.amount??0);
    }
    cardSide=null;const invalid=[...composer.querySelectorAll('.dc-offer-money input')].some(input=>!input.checkValidity());
    confirm.disabled=invalid||state.phase!=='ready'||!state.recipientId||state.reviewPhase==='pending';send.disabled=confirm.disabled||!state.reviewed;
  }
  choose.addEventListener('change',()=>{ownLimit=partnerLimit=24;startDraft();});recipientSearch.addEventListener('keydown',e=>{if(e.key==='Enter')loadDirectory();});
  unsubscribe=session.subscribe(()=>{if(disposed)return;draft=session.draft;counter=session.counter;state=session.state;partnerOptions=session.directory;counterNotice.textContent=counter?t('trades.counterNotice'):'';const selected=choose.value||state?.recipientId;choose.replaceChildren();for(const u of [{id:'',name:t('trades.choose')},...partnerOptions]){const option=el('option','',u.name+(u.inventoryVisible===false?t('trades.privateSuffix'):''));option.value=u.id;choose.append(option);}if(partnerOptions.some(u=>u.id===selected))choose.value=selected;renderState();review.disabled=session.busy||state?.phase!=='ready'||!state?.recipientId;});
  return {node,dispose(){disposed=true;unsubscribe?.();for(const card of renderedCards)card.dispose?.();renderedCards.clear();if(!sharedSession)session.dispose();}};
}
