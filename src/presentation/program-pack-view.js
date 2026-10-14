import {createProgramViewRenderer,programSelections} from './program-view.js';
import {renderPack} from '../ui.js';
import {createLocalization} from '../localization.js';

/** Approved pack appearance only. Selection requests host focus, never purchase/open. */
export function createProgramPackRenderer({registry,products={},fallbackRenderer=renderPack,...limits}={}){
  products=programSelections(products);
  const surfaces=createProgramViewRenderer({registry,fallbackRenderer,...limits,tagName:'dc-program-pack',classNameFor:options=>'dc-pack-art'+(options.small?' dc-pack-art-small':''),selectNestedButtons:false,nameFor:product=>product.name,programFor:product=>products[product.id]});
  const render=(product,options={})=>{
    const surface=surfaces(product,options);
    if(surface?.localName!=='dc-program-pack')return surface;
    const localization=options.localization??createLocalization({locale:options.locale??'en',messages:options.messages??{}}),toggle=document.createElement('button');
    let side=options.side==='back'?'back':'front',disposed=false;
    surface.setAttribute('lang',localization.locale);surface.setAttribute('dir',localization.dir);surface.dataset.line=product.lineId;
    Object.assign(surface.style,{aspectRatio:'auto',height:options.small?'82px':'218px',...(options.small?{width:'62px'}:{})});
    toggle.type='button';toggle.className='dc-button';Object.assign(toggle.style,{position:'absolute',bottom:'8px',right:'8px',zIndex:'2'});toggle.hidden=!!options.small;
    const setSide=value=>{if(disposed||surface._programTerminal())return;side=value==='back'?'back':'front';surface.setPresentationSide(side);toggle.textContent=localization.text(side==='front'?'artwork.back':'artwork.front');};
    toggle.addEventListener('click',event=>{event.stopPropagation();setSide(side==='front'?'back':'front');});surface.append(toggle);setSide(side);
    surface._programCleanup=()=>{disposed=true;toggle.remove();};
    return {node:surface,setSide,setPresentationInputs:inputs=>surface.setPresentationInputs(inputs),dispose:()=>surface.dispose()};
  };
  render.setEnabled=surfaces.setEnabled;render.dispose=surfaces.dispose;return render;
}
