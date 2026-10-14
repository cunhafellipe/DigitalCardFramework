import {connectProgram} from './program.js';

const root=document.documentElement,events=new AbortController(),records=new Map();let disposed=false,current,bridge;
const text=(node,selector,value)=>{for(const target of node.querySelectorAll(selector))target.textContent=value??'';};
const labels=(node,snapshot)=>{for(const target of node.querySelectorAll('[data-dc-opener-label]')){const key=target.dataset.dcOpenerLabel;if(Object.hasOwn(snapshot.labels,key))target.textContent=snapshot.labels[key];}};
const clearPreview=record=>{if(record.url)URL.revokeObjectURL(record.url);record.url=null;record.preview=null;for(const image of record.node.querySelectorAll('img[data-dc-item-preview]')){image.onerror=null;image.removeAttribute('src');image.hidden=true;}};
const equal=(left,right)=>left&&right&&left.mediaType===right.mediaType&&left.bytes.length===right.bytes.length&&left.bytes.every((byte,index)=>byte===right.bytes[index]);
connectProgram({onOpenerDisplay(snapshot){
  if(disposed)return;const items=document.querySelector('[data-dc-opener-items]'),template=document.querySelector('template[data-dc-opener-item-template]');if(!items||!template)return;
  current=snapshot;root.dataset.dcOpenerPhase=snapshot.phase;root.lang=snapshot.locale;root.dir=snapshot.dir;labels(document,snapshot);
  const hasReceipt=['ready','revealing','complete'].includes(snapshot.phase);
  for(const button of document.querySelectorAll('button[data-dc-opener-intent]')){const action=button.dataset.dcOpenerIntent;button.disabled=!hasReceipt||(action!=='replay'&&snapshot.revealed===snapshot.total);}
  const previews=new Map(snapshot.previews.map(preview=>[preview.handle,preview]));
  for(const [position,record]of records)if(position>=snapshot.total){clearPreview(record);record.node.remove();records.delete(position);}
  for(const item of snapshot.items){
    let record=records.get(item.position);if(!record){const fragment=template.content.cloneNode(true),node=fragment.firstElementChild;if(!node)continue;record={node,url:null,preview:null};node.dataset.dcItemPosition=String(item.position);records.set(item.position,record);items.append(fragment);}
    record.handle=item.handle;record.node.dataset.dcRevealed=item.handle?'true':'false';labels(record.node,snapshot);text(record.node,'[data-dc-item-label]',item.label);text(record.node,'[data-dc-item-name]',item.name);text(record.node,'[data-dc-item-rarity]',item.rarity);text(record.node,'[data-dc-item-new]',item.isNew===undefined?'':snapshot.labels[item.isNew?'new':'duplicate']);
    for(const [selector,shown]of [['[data-dc-item-name]',item.name!==undefined],['[data-dc-item-rarity]',item.rarity!==undefined],['[data-dc-item-new]',item.isNew!==undefined],['button[data-dc-opener-inspect]',!!item.handle]])for(const target of record.node.querySelectorAll(selector)){target.hidden=!shown;if(target.localName==='button')target.disabled=!shown;}
    const preview=previews.get(item.handle);if(!preview){clearPreview(record);continue;}
    if(!equal(record.preview,preview)){clearPreview(record);record.preview=preview;record.url=URL.createObjectURL(new Blob([preview.bytes],{type:preview.mediaType}));}
    const url=record.url;for(const image of record.node.querySelectorAll('img[data-dc-item-preview]')){image.hidden=false;image.src=url;image.alt=item.name??item.label;image.onerror=()=>{if(record.url===url)clearPreview(record);};}
  }
}}).then(value=>{if(disposed)value.dispose();else bridge=value;});
document.addEventListener('click',event=>{
  if(disposed||!current)return;const action=event.target.closest?.('button[data-dc-opener-intent]');if(action&&!action.disabled){const names={reveal:'opener-reveal',skip:'opener-skip',replay:'opener-replay'},intent=names[action.dataset.dcOpenerIntent];if(intent)bridge?.openerIntent(intent,current.snapshotId);return;}
  const inspect=event.target.closest?.('button[data-dc-opener-inspect]');if(inspect&&!inspect.disabled&&!inspect.hidden){const card=inspect.closest('[data-dc-item-position]'),record=records.get(Number(card?.dataset.dcItemPosition));if(record?.handle)bridge?.openerIntent('opener-inspect',current.snapshotId,record.handle);}
},{signal:events.signal});
window.addEventListener('pagehide',()=>{disposed=true;events.abort();bridge?.dispose();current=null;for(const record of records.values())clearPreview(record);records.clear();},{once:true});
