import {el,button} from './ui-kit.js';
import {createLocalization} from './localization.js';
/** Camera is presentation state; it never changes copy ownership or card definitions. */
function camera(stage,target,localization){let yaw=0,pitch=0,zoom=1,drag=null;const t=localization.text;
  stage.tabIndex=0;stage.setAttribute('aria-label',t('inspector.stage'));
  const apply=()=>{target.style.transform=`scale(${zoom}) rotateX(${pitch}deg) rotateY(${yaw}deg)`;stage.dataset.yaw=String(Math.round(yaw));for(const card of stage.querySelectorAll('.dc-card')){card.style.setProperty('--dc-x',String(Math.sin(yaw*Math.PI/180)*.8));card.style.setProperty('--dc-y',String(pitch/85));card.setPresentationInputs?.({tilt:{x:Math.sin(yaw*Math.PI/180),y:pitch/85}});const angle=((yaw%360)+360)%360;card.setPresentationSide?.(angle>90&&angle<270?'back':'front');}};
  stage.addEventListener('pointerdown',e=>{if(e.target.closest('.dc-camera-controls'))return;drag={x:e.clientX,y:e.clientY,yaw,pitch};stage.setPointerCapture(e.pointerId);});
  stage.addEventListener('pointermove',e=>{if(!drag)return;yaw=drag.yaw+(e.clientX-drag.x)*.65;pitch=Math.max(-85,Math.min(85,drag.pitch-(e.clientY-drag.y)*.5));apply();});
  stage.addEventListener('pointerup',()=>drag=null);stage.addEventListener('pointercancel',()=>drag=null);
  stage.addEventListener('keydown',e=>{if(e.target!==stage)return;const actions={ArrowLeft:()=>yaw-=15,ArrowRight:()=>yaw+=15,ArrowUp:()=>pitch=Math.min(85,pitch+10),ArrowDown:()=>pitch=Math.max(-85,pitch-10),'+':()=>zoom=Math.min(1.7,zoom+.1),'=':()=>zoom=Math.min(1.7,zoom+.1),'-':()=>zoom=Math.max(.5,zoom-.1),r:()=>{yaw=pitch=0;zoom=1;}};if(actions[e.key]){e.preventDefault();actions[e.key]();apply();}});
  const controls=el('div','dc-camera-controls');controls.append(button('↶',()=>{yaw-=45;apply();},'dc-quiet'),button(t('inspector.flip'),()=>{yaw+=180;apply();},'dc-quiet'),button('↷',()=>{yaw+=45;apply();},'dc-quiet'),button('−',()=>{zoom=Math.max(.5,zoom-.1);apply();},'dc-quiet'),button('+',()=>{zoom=Math.min(1.7,zoom+.1);apply();},'dc-quiet'),button(t('inspector.reset'),()=>{yaw=pitch=0;zoom=1;apply();},'dc-quiet'));
  controls.querySelectorAll('button')[0].setAttribute('aria-label',t('inspector.rotateLeft'));controls.querySelectorAll('button')[2].setAttribute('aria-label',t('inspector.rotateRight'));controls.querySelectorAll('button')[3].setAttribute('aria-label',t('inspector.zoomOut'));controls.querySelectorAll('button')[4].setAttribute('aria-label',t('inspector.zoomIn'));stage.append(controls);apply();return {apply};
}
export function render3DInspector(copy,{cardRenderer,metadataRenderer,backRenderer,onClose,labels={},catalog,locale='en',messages={},localization=createLocalization({locale,messages})}={}){
  const t=localization.text,valueText=value=>typeof value==='number'&&Number.isFinite(value)?localization.number(value):typeof value==='object'?JSON.stringify(value):value;
  const node=el('section','dc-inspector'),grid=el('div','dc-inspector-grid'),stage=el('div','dc-3d-stage'),card=cardRenderer(copy,{interactive:false,backRenderer,presentationMode:'interactive',localization}),details=el('div');node.setAttribute('lang',localization.locale);node.setAttribute('dir',localization.dir);node.setAttribute('aria-label',t('inspector.label'));
  card.tabIndex=-1;card.classList.add('dc-orbit-card');const inner=card.querySelector('.dc-card-inner')??card;inner.append(el('span','dc-card-edge'));stage.append(card);camera(stage,inner,localization);
  details.append(el('span','dc-eyebrow',t('inspector.object')),el('h2','',copy.definition.name),el('p','dc-muted',copy.definition.description??t('inspector.description')));
  if(copy.definition.tags?.length){const tags=el('div','dc-tags');copy.definition.tags.forEach(t=>tags.append(el('span','dc-badge',t)));details.append(tags);}
  const stats=el('div','dc-stat-grid');for(const [key,value]of Object.entries(copy.definition.stats??{})){const stat=el('div'),label=catalog?.displayFields?.find(f=>f.path==='stats.'+key)?.label??key;stat.append(el('small','dc-muted',label),el('strong','',valueText(value)));stats.append(stat);}details.append(stats);
  if(metadataRenderer)details.append(metadataRenderer(copy,{localization}));else{
    const finish=copy.variant.finish??'standard',list=el('dl'),fieldLabels={Line:'line',Rarity:'rarity',Finish:'finish',Edition:'edition','Opened by':'openedBy','Opened at':'openedAt','Copy ID':'copyId'},fields={Line:labels.line??copy.lineId,Rarity:labels.rarity??copy.rarityId,Finish:['standard','gloss','holo','foil'].includes(finish)?t('finish.'+finish):finish,Edition:copy.serialNumber?t('inspector.serial',{serial:copy.serialNumber,total:copy.editionTotal}):t('inspector.openEdition'),'Opened by':copy.openedByName??copy.openedBy??t('inspector.catalogPreview'),'Opened at':copy.openedAt?localization.date(copy.openedAt):t('inspector.notOpened'),'Copy ID':copy.id};
    const metadata={...copy.definition.metadata,...copy.variant.metadata,...copy.metadata};for(const [key,value]of Object.entries({...fields,...metadata})){const label=Object.hasOwn(metadata,key)?catalog?.displayFields?.find(f=>f.path==='metadata.'+key)?.label??key:t('inspector.'+fieldLabels[key]);list.append(el('dt','',label),el('dd','',valueText(value)));}
    if(copy.provenance){const origin=el('details'),body=el('pre','',JSON.stringify(copy.provenance,null,2));body.style.whiteSpace='pre-wrap';origin.append(el('summary','',t('inspector.provenance')),body);details.append(origin);}
    if(copy.codes?.length)details.append(el('p','dc-muted',t('inspector.codes',{count:copy.codes.length})));
    const bindingStates={active:'bindingActive',used:'bindingUsed','activation-pending':'bindingPending','activation-failed':'bindingFailed'};
    for(const [key,b]of Object.entries(copy.bindings??{}))list.append(el('dt','',key+' · '+(Object.hasOwn(bindingStates,b.state)?t('inspector.'+bindingStates[b.state]):b.state)),el('dd','',b.state==='activation-pending'?t('inspector.activationPending'):b.state==='activation-failed'?t('inspector.activationFailed'):JSON.stringify(b.data)));details.append(list);
  }
  if(onClose)details.prepend(button(t('inspector.close'),onClose,'dc-quiet dc-close'));grid.append(stage,details);node.append(grid);return node;
}
export function renderComparison(copies,{cardRenderer,catalog,onClose,locale='en',messages={},localization=createLocalization({locale,messages})}={}){
  const t=localization.text,render=copy=>cardRenderer(copy,{interactive:false,localization});
  const node=el('section','dc-inspector dc-comparison'),head=el('div','dc-row');node.setAttribute('lang',localization.locale);node.setAttribute('dir',localization.dir);head.append(el('h2','',t('inspector.shared',{count:copies.length})),button(t('inspector.close'),onClose,'dc-quiet'));node.append(head);
  const combinations=(catalog.combinations??[]).filter(c=>c.pieces.some(p=>copies.some(copy=>copy.cardId===p.cardId)));
  const toolbar=el('div','dc-row'),stage=el('div','dc-3d-stage dc-comparison-stage'),scene=el('div','dc-comparison-scene');stage.append(scene);
  const notice=el('p','dc-muted');let choice=null;
  function draw(){scene.replaceChildren();scene.classList.toggle('is-assembled',!!choice);scene.style.gridTemplateColumns=`repeat(${choice?.columns??Math.min(4,copies.length)},minmax(0,1fr))`;scene.style.gap=(choice?.gap??20)+'px';scene.style.setProperty('--dc-rows',String(choice?.rows??1));
    if(choice){for(let row=0;row<choice.rows;row++)for(let column=0;column<choice.columns;column++){const piece=choice.pieces.find(p=>p.row===row&&p.column===column),copy=copies.find(c=>c.cardId===piece?.cardId);scene.append(copy?render(copy):el('div','dc-missing-piece',t(piece?'inspector.missingPiece':'inspector.empty')));}const missing=choice.pieces.filter(p=>!copies.some(c=>c.cardId===p.cardId));notice.textContent=choice.name+' · '+t(missing.length?'inspector.piecesMissing':'inspector.completeScene',{count:missing.length});}
    else{copies.forEach(c=>scene.append(render(c)));notice.textContent=t('inspector.compareHint');}}
  toolbar.append(button(t('inspector.sideBySide'),()=>{choice=null;draw();},'dc-quiet'));for(const combo of combinations)toolbar.append(button(t('inspector.assemble',{name:combo.name}),()=>{choice=combo;draw();},'dc-quiet'));
  draw();camera(stage,scene,localization);node.append(toolbar,notice,stage);return node;
}
