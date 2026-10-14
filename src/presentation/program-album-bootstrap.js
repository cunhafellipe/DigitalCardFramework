import {connectProgram} from './program.js';

const root=document.documentElement,events=new AbortController(),urls=new Set();
let disposed=false,current,bridge;
const revoke=()=>{for(const url of urls)URL.revokeObjectURL(url);urls.clear();};
const text=(node,selector,value)=>{for(const target of node.querySelectorAll(selector))target.textContent=value??'';};
connectProgram({onAlbumDisplay(snapshot){
  if(disposed)return;
  const pages=document.querySelector('[data-dc-album-pages]'),pageTemplate=document.querySelector('template[data-dc-album-page]'),itemTemplate=document.querySelector('template[data-dc-album-item]');
  if(!pages||!pageTemplate||!itemTemplate)return;
  revoke();current=snapshot;text(document,'[data-dc-album-name]',snapshot.name);
  const previews=new Map(snapshot.previews.map(preview=>[preview.handle,preview]));
  const content=document.createDocumentFragment();
  for(const page of snapshot.pages){
    const pageNode=pageTemplate.content.cloneNode(true);text(pageNode,'[data-dc-page-name]',page.name??'Page '+(page.index+1));
    const items=pageNode.querySelector('[data-dc-album-items]');if(!items)continue;
    for(const item of snapshot.items.filter(item=>item.page===page.index).sort((a,b)=>a.position-b.position)){
      const itemNode=itemTemplate.content.cloneNode(true);text(itemNode,'[data-dc-item-name]',item.name??'Card '+(item.position+1));text(itemNode,'[data-dc-item-rarity]',item.rarity);
      for(const button of itemNode.querySelectorAll('button[data-dc-item-select]'))button.dataset.dcItemSelect=item.handle;
      for(const image of itemNode.querySelectorAll('img[data-dc-item-preview]')){const preview=previews.get(item.handle);if(preview){const url=URL.createObjectURL(new Blob([preview.bytes],{type:preview.mediaType}));urls.add(url);image.src=url;image.alt=item.name??'';image.addEventListener('error',()=>{image.removeAttribute('src');image.hidden=true;URL.revokeObjectURL(url);urls.delete(url);},{once:true,signal:events.signal});}else image.removeAttribute('src');}
      items.append(itemNode);
    }content.append(pageNode);
  }pages.replaceChildren(content);root.dataset.dcAlbumState='ready';
}}).then(value=>{if(disposed)value.dispose();else bridge=value;});
document.addEventListener('click',event=>{const button=event.target.closest?.('button[data-dc-item-select]');if(!disposed&&button&&!button.disabled&&current)bridge?.selectItem(current.snapshotId,button.dataset.dcItemSelect);},{signal:events.signal});
window.addEventListener('pagehide',()=>{disposed=true;events.abort();bridge?.dispose();current=null;revoke();},{once:true});
