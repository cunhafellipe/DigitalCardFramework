import {createProgramViewRenderer,programSelections} from './program-view.js';
import {renderCard} from '../ui.js';

/** Explicit host selection of approved structural programs; catalog data cannot install code. */
export function createProgramCardRenderer({registry,cards={},variants={},fallbackRenderer=renderCard,...limits}={}){
  cards=programSelections(cards);variants=programSelections(variants);
  return createProgramViewRenderer({registry,fallbackRenderer,...limits,tagName:'dc-program-card',classNameFor:()=> 'dc-card',captionClassName:'dc-card-title',nameFor:copy=>copy.definition.name,
    programFor:copy=>{const variantId=copy.variantId??copy.variant?.id,cardId=copy.cardId??copy.definition?.id;return Object.hasOwn(variants,variantId)?variants[variantId]:cards[cardId];}});
}
