import {createLocalization} from './localization.js';
import {el,button,field,select,section,previewCopy,download} from './ui-kit.js';
import {mountVisualStudio} from './visual-studio-ui.js';
export function renderStudio(model,{client,cardRenderer,inspect,action,mutate,locale,messages,localization}){
  const l=localization??createLocalization({locale,messages}),t=l.text;
  const node=section(t("studioShell.creatorStudio"),t("studioShell.importCardsStatsLayeredArtworkReferencesPackDefinitions"));
  node.lang=l.locale;node.dir=l.dir;
  const allowed=permission=>model.me.role==='admin'||model.me.permissions?.includes(permission);
  if(!allowed('catalog.read')){node.append(el('p','dc-muted',t("studioShell.thisWorkspaceIsAvailableToAuthorizedCatalogOperators")));return node;}
  const options=el('div','dc-form-row'),format=select(options,t("studioShell.format"),[{id:'json',name:'JSON'},{id:'yaml',name:'YAML'}]),mode=select(options,t("studioShell.importMode"),[{id:'merge',name:t("studioShell.mergeRowsByID")},{id:'replace',name:t("studioShell.replaceCompleteCatalog")}]),upload=field(options,t("studioShell.chooseFile"),{type:'file'});upload.accept='.json,.yaml,.yml,application/json';
  const source=field(node,t("studioShell.importContent"),{type:'textarea',placeholder:t("studioShell.pasteJSONOrYAMLHereRowsWithExisting")});source.rows=14;source.spellcheck=false;source.classList.add('dc-code-input');
  const status=el('p','dc-muted'),preview=el('div','dc-import-preview'),review=el('label','dc-review-check'),confirm=el('input');confirm.type='checkbox';review.append(confirm,el('span','',t("studioShell.iReviewedThisCatalogRevisionAndItsAsset")));
  const visualRoot=el('div','dc-visual-studio');node.append(visualRoot);let visual=mountVisualStudio(visualRoot,{client,model,localization:l});
  let prepared=null,generation=0,disposed=false,publishing=false,newCardId,newLineId,newPackId;
  function invalidate(){generation++;prepared=null;confirm.checked=false;publish.disabled=true;preview.replaceChildren();status.textContent=t("studioShell.contentChangedRunANewPreview");}
  const publish=button(t("studioShell.publishReviewedRevision"),()=>{
    if(publishing||!prepared||!confirm.checked||!allowed('catalog.publish'))return;
    const revision=prepared;publishing=true;publish.disabled=true;node.inert=true;
    return action(async()=>{try{
      await mutate('commitImport',{manifest:revision.manifest,digest:revision.digest,expectedVersion:model.catalog.version,policyRevision:revision.policyRevision});
      if(disposed)return;
      model={...model,catalog:revision.manifest};visual.dispose();visualRoot.replaceChildren();visual=mountVisualStudio(visualRoot,{client,model,localization:l});
      if(newCardId){const destination=[...visualRoot.querySelectorAll('select')].find(input=>input.getAttribute('aria-label')===t('studioShell.destinationCard'));if(destination){destination.value=newCardId;destination.dispatchEvent(new document.defaultView.Event('change'));}}
      if(newPackId){
        const kind=[...visualRoot.querySelectorAll('select')].find(input=>input.getAttribute('aria-label')===t('studioShell.designDestination'));
        if(kind){kind.value='pack';kind.dispatchEvent(new document.defaultView.Event('change'));const destination=[...visualRoot.querySelectorAll('select')].find(input=>input.getAttribute('aria-label')===t('studioShell.destinationPack'));if(destination){destination.value=newPackId;destination.dispatchEvent(new document.defaultView.Event('change'));}}
      }
      createPack.reset();packDraftId=undefined;refreshPackOptions(newLineId);newPackId=undefined;
      create.reset();refreshCardOptions(newLineId);newCardId=undefined;newLineId=undefined;draftId=undefined;lineDraftId=undefined;createLine.reset();invalidate();
    }finally{node.inert=false;publishing=false;if(!disposed)publish.disabled=!allowed('catalog.publish')||!confirm.checked||!prepared;}},{message:t("studioShell.catalogRevisionPublishedAtomically")});
  });publish.disabled=true;confirm.addEventListener('change',()=>publish.disabled=publishing||!allowed('catalog.publish')||!confirm.checked||!prepared);
  async function validate(input){const current=++generation;prepared=null;publish.disabled=true;confirm.checked=false;status.textContent=t("studioShell.validating");try{const result=await client.previewImport({...input,expectedVersion:model.catalog.version});if(disposed||generation!==current)return;prepared=result;preview.replaceChildren();status.textContent=t('studioShell.validRevision',{version:result.manifest.version,digest:result.digest.slice(0,16)});
    const changes=el('div','dc-change-grid'),groups=new Map();for(const change of result.changes){if(!groups.has(change.section))groups.set(change.section,{add:[],update:[],remove:[]});groups.get(change.section)[change.action].push(change.id);}for(const [kind,change]of groups){const box=el('article','dc-change-box');box.append(el('h3','',t('studioShell.section.'+kind)),el('p','',t('studioShell.changeCounts',{added:change.add.length,updated:change.update.length,removed:change.remove.length})));for(const [type,ids]of Object.entries(change))if(ids.length)box.append(el('small','dc-muted',t('studioShell.change.'+type)+': '+ids.slice(0,30).join(', ')));changes.append(box);}preview.append(changes);
    if(newPackId){const product=result.manifest.products.find(row=>row.id===newPackId);if(product){
      preview.append(el('h3','',product.name),el('p','',t('studioShell.packReviewSummary',{count:product.slots[0].count,amount:product.price.amount,currency:result.manifest.currencies.find(row=>row.id===product.price.currencyId)?.name??product.price.currencyId})),el('p','',t('studioShell.basicPackRules')));
      const contents=el('ul');for(const entry of product.slots[0].pool){const variant=result.manifest.variants.find(row=>row.id===entry.variantId);contents.append(el('li','',variantLabel(variant,result.manifest)));}preview.append(contents);
    }}
    for(const warning of result.warnings)preview.append(el('p','dc-muted',typeof warning==='string'?warning:warning.path+' · '+warning.message));const cards=el('div','dc-collection-grid');for(const card of (newLineId||newPackId?[]:newCardId?result.manifest.cards.filter(card=>card.id===newCardId):result.manifest.cards.slice(0,24)))cards.append(cardRenderer(previewCopy(card,result.manifest.variants.find(v=>v.cardId===card.id)),{onSelect:inspect,localization:l}));preview.append(el('h3','',t('studioShell.cardPreviews',{count:cards.children.length})),cards);
  }catch(err){if(!disposed&&generation===current)status.textContent=err.message;}}
  const previewButton=button(t("studioShell.validatePreview"),()=>{newCardId=undefined;newLineId=undefined;newPackId=undefined;return validate({source:source.value,format:format.value,mode:mode.value});});
  previewButton.disabled=!allowed('catalog.preview');if(!allowed('catalog.publish'))publish.title=t("studioShell.publishingRequiresCatalogPublishPermission");
  const controls=el('div','dc-row');controls.append(previewButton,publish,button(t("studioShell.exportFullJSONCatalog"),()=>action(async()=>download('catalog.json',await client.operatorCatalog()),{refreshAfter:false,message:t("studioShell.catalogDownloadedOperatorExportsCanContainBindingDefinitions")}),'dc-quiet'),button(t("studioShell.loadStarterRow"),()=>{format.value='json';mode.value='merge';source.value=JSON.stringify({cards:[{id:'your-card',lineId:model.catalog.lines[0]?.id,name:'Your first card',description:'Describe this collectible.',stats:{attack:7,defense:4},metadata:{'creator.credit':'Your name'},tags:['starter'],layers:[{id:'background',src:'https://your-content.example/card-background.webp',depth:0},{id:'foreground',src:'https://your-content.example/card-foreground.webp',depth:22}]}],variants:[{id:'your-card.standard',cardId:'your-card',rarityId:model.catalog.rarities[0]?.id,finish:'gloss'}]},null,2);invalidate();},'dc-quiet'));
  node.prepend(options);node.append(controls,status,review,preview,el('p','dc-muted',t("studioShell.assetFilesStayInYourStorageOrCDN")));
  for(const input of [source,format,mode])input.addEventListener('input',invalidate);upload.addEventListener('change',async()=>{const file=upload.files[0];if(!file)return;invalidate();const current=generation;if(file.size>8*1024*1024){status.textContent=t('studioShell.importSize',{size:8});return;}const text=await file.text();if(disposed||current!==generation)return;source.value=text;format.value=/\.ya?ml$/i.test(file.name)?'yaml':'json';status.textContent=t("studioShell.fileLoadedValidateItToPreviewTheRevision");});
  const create=el('form','dc-new-card'),name=field(create,t('studioShell.newCardName')),description=field(create,t('studioShell.newCardDescription'),{type:'textarea'}),line=select(create,t('studioShell.newCardLine'),model.catalog.lines),rarity=select(create,t('studioShell.newCardRarity'),model.catalog.rarities);
  name.required=true;line.required=true;rarity.required=true;
  const createPreview=button(t('studioShell.previewNewCard'),()=>{});createPreview.type='submit';create.append(createPreview,button(t('studioShell.cancelNewCard'),()=>{draftId=undefined;newCardId=undefined;create.reset();name.setCustomValidity('');invalidate();}));
  let missing;
  const prerequisites=el('p','dc-muted',t('studioShell.newCardPrerequisites'));create.append(prerequisites);
  function refreshCardOptions(preferredLine){
    for(const [input,rows,value] of [[line,model.catalog.lines,preferredLine??line.value],[rarity,model.catalog.rarities,rarity.value]]){
      input.replaceChildren();for(const row of rows){const option=el('option','',row.name);option.value=row.id;input.append(option);}if(rows.some(row=>row.id===value))input.value=value;
    }
    missing=!model.catalog.lines.length||!model.catalog.rarities.length;
    createPreview.disabled=missing||!allowed('catalog.preview');prerequisites.hidden=!missing;
  }
  refreshCardOptions();
  let draftId;
  create.addEventListener('input',()=>{invalidate();});create.addEventListener('change',()=>{invalidate();});
  create.addEventListener('submit',event=>{
    event.preventDefault();if(publishing||missing||!allowed('catalog.preview'))return;
    name.setCustomValidity(name.value.trim()?'':t('studioShell.newCardNameRequired'));
    if(!create.reportValidity())return;
    if(!model.catalog.lines.some(row=>row.id===line.value)||!model.catalog.rarities.some(row=>row.id===rarity.value))return;
    draftId??='card-'+crypto.randomUUID();newCardId=draftId;newLineId=undefined;newPackId=undefined;
    return validate({mode:'merge',source:{cards:[{id:draftId,name:name.value.trim(),...(description.value.trim()?{description:description.value.trim()}:{}),lineId:line.value}],variants:[{id:draftId+'.standard',cardId:draftId,rarityId:rarity.value,finish:'standard'}]}});
  });
  name.addEventListener('input',()=>name.setCustomValidity(''));
  create.prepend(el('h3','',t('studioShell.newCard')));node.prepend(create);
  const createLine=el('form','dc-new-line'),lineName=field(createLine,t('studioShell.newLineName')),lineDescription=field(createLine,t('studioShell.newLineDescription'),{type:'textarea'});
  lineName.required=true;lineName.maxLength=200;lineDescription.maxLength=2000;
  let lineDraftId;
  const linePreview=button(t('studioShell.previewNewLine'),()=>{});linePreview.type='submit';linePreview.disabled=!allowed('catalog.preview');
  createLine.append(linePreview,button(t('studioShell.cancelNewLine'),()=>{lineDraftId=undefined;newLineId=undefined;createLine.reset();lineName.setCustomValidity('');invalidate();}));
  for(const event of ['input','change'])createLine.addEventListener(event,invalidate);
  lineName.addEventListener('input',()=>lineName.setCustomValidity(''));
  createLine.addEventListener('submit',event=>{
    event.preventDefault();if(publishing||!allowed('catalog.preview'))return;
    lineName.setCustomValidity(lineName.value.trim()?'':t('studioShell.newLineNameRequired'));
    if(!createLine.reportValidity())return;
    lineDraftId??='line-'+crypto.randomUUID();newLineId=lineDraftId;newCardId=undefined;newPackId=undefined;
    return validate({mode:'merge',source:{lines:[{id:lineDraftId,name:lineName.value.trim(),...(lineDescription.value.trim()?{description:lineDescription.value.trim()}:{})}]}});
  });
  createLine.prepend(el('h3','',t('studioShell.newLine')));node.prepend(createLine);
  const createPack=el('form','dc-new-pack'),packName=field(createPack,t('studioShell.newPackName')),packLine=select(createPack,t('studioShell.newPackLine'),model.catalog.lines),packCurrency=select(createPack,t('studioShell.newPackCurrency'),model.catalog.currencies),packPrice=field(createPack,t('studioShell.newPackPrice'),{type:'number',value:'1'}),packCount=field(createPack,t('studioShell.newPackCount'),{type:'number',value:'1'}),pool=el('fieldset'),packGuidance=el('p','dc-muted'),poolError=el('p','dc-muted');
  packName.required=true;packName.maxLength=200;packLine.required=packCurrency.required=true;
  for(const [input,max]of [[packPrice,Number.MAX_SAFE_INTEGER],[packCount,100]]){input.required=true;input.min='1';input.max=String(max);input.step='1';input.defaultValue='1';}
  poolError.setAttribute('role','status');createPack.append(pool,poolError,el('p','dc-muted',t('studioShell.basicPackRules')),packGuidance);
  let packDraftId,packMissing;
  function variantLabel(variant,catalog=model.catalog){return t('studioShell.packVariantLabel',{card:catalog.cards.find(row=>row.id===variant.cardId)?.name??variant.cardId,variant:variant.name??variant.id,rarity:catalog.rarities.find(row=>row.id===variant.rarityId)?.name??variant.rarityId});}
  function eligibleVariants(){const cardIds=new Set(model.catalog.cards.filter(card=>card.lineId===packLine.value).map(card=>card.id));return model.catalog.variants.filter(variant=>variant.enabled!==false&&cardIds.has(variant.cardId));}
  function refreshPackPool(){
    pool.replaceChildren(el('legend','',t('studioShell.newPackVariants')));poolError.textContent='';
    const variants=eligibleVariants();for(const variant of variants){const label=el('label','dc-field'),input=el('input');input.type='checkbox';input.value=variant.id;label.append(input,el('span','',variantLabel(variant)));pool.append(label);}
    packMissing=!model.catalog.lines.length||!model.catalog.currencies.length||!variants.length;
    packGuidance.textContent=!model.catalog.lines.length?t('studioShell.packNeedsLine'):!model.catalog.currencies.length?t('studioShell.packNeedsCurrency'):!variants.length?t('studioShell.packNeedsVariants'):'';
    packGuidance.hidden=!packMissing;packPreview.disabled=packMissing||!allowed('catalog.preview');
  }
  function refreshPackOptions(preferredLine){
    for(const [input,rows,value]of [[packLine,model.catalog.lines,preferredLine??packLine.value],[packCurrency,model.catalog.currencies,packCurrency.value]]){
      input.replaceChildren();for(const row of rows){const option=el('option','',row.name);option.value=row.id;input.append(option);}if(rows.some(row=>row.id===value))input.value=value;
    }
    refreshPackPool();
  }
  const packPreview=button(t('studioShell.previewNewPack'),()=>{});packPreview.type='submit';
  createPack.append(packPreview,button(t('studioShell.cancelNewPack'),()=>{packDraftId=undefined;newPackId=undefined;createPack.reset();packName.setCustomValidity('');packPrice.setCustomValidity('');packCount.setCustomValidity('');refreshPackOptions();invalidate();}));
  for(const event of ['input','change'])createPack.addEventListener(event,invalidate);
  packName.addEventListener('input',()=>packName.setCustomValidity(''));
  for(const input of [packPrice,packCount])input.addEventListener('input',()=>input.setCustomValidity(''));
  pool.addEventListener('change',()=>{poolError.textContent='';});packLine.addEventListener('change',refreshPackPool);
  createPack.addEventListener('submit',event=>{
    event.preventDefault();if(publishing||packMissing||!allowed('catalog.preview'))return;
    packName.setCustomValidity(packName.value.trim()?'':t('studioShell.newPackNameRequired'));
    const amount=Number(packPrice.value),count=Number(packCount.value);
    packPrice.setCustomValidity(Number.isSafeInteger(amount)&&amount>=1?'':t('studioShell.packPriceRequired'));
    packCount.setCustomValidity(Number.isSafeInteger(count)&&count>=1&&count<=100?'':t('studioShell.packCountRequired'));
    if(!createPack.reportValidity())return;
    if(!model.catalog.lines.some(row=>row.id===packLine.value)||!model.catalog.currencies.some(row=>row.id===packCurrency.value))return;
    const eligible=new Set(eligibleVariants().map(variant=>variant.id)),selected=[...pool.querySelectorAll('input:checked')].map(input=>input.value);
    if(!selected.length||selected.some(id=>!eligible.has(id))){poolError.textContent=t('studioShell.packSelectionRequired');return;}
    packDraftId??='pack-'+crypto.randomUUID();newPackId=packDraftId;newCardId=undefined;newLineId=undefined;
    return validate({mode:'merge',source:{products:[{id:packDraftId,lineId:packLine.value,name:packName.value.trim(),revision:1,price:{currencyId:packCurrency.value,amount},slots:[{count,pool:selected.map(variantId=>({variantId,weight:1}))}]}]}});
  });
  refreshPackOptions();createPack.prepend(el('h3','',t('studioShell.newPack')));create.after(createPack);
  return {node,dispose(){disposed=true;generation++;visual.dispose();}};
}
