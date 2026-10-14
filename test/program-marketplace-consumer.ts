import {createProgramMarketplaceView,type ProgramMarketplaceView} from '../src/presentation/program-marketplace-view.js';
import {createMarketplaceSession,type MarketplaceModel,type MarketplaceContext} from '../src/marketplace-session.js';
import {marketplaceDisplayFields,marketplaceDisplayProfile,marketplaceIntents,validateMarketplaceDisplay,validateMarketplaceIntent,type MarketplaceDisplaySnapshot,type MarketplaceIntentEvent} from '../src/presentation/marketplace-display.js';
import {mountProgram,connectProgram,type ProgramRegistry} from '../src/presentation/program.js';
import {disposeMarketplaceBootstrap} from '../src/presentation/program-marketplace-bootstrap.js';
declare const model:MarketplaceModel,context:MarketplaceContext,root:HTMLElement,input:unknown;
const registry:ProgramRegistry=new Map([['example.marketplace',{approved:true,url:'https://program.example/market/index.html',version:'1',intents:marketplaceIntents,marketplaceDisplay:{profile:marketplaceDisplayProfile,fields:marketplaceDisplayFields}}]]);
const view:ProgramMarketplaceView=createProgramMarketplaceView({registry,programId:'example.marketplace',displayFields:marketplaceDisplayFields});const instance=view(model,context);instance.dispose();view.setEnabled(false);view.dispose();
const session=createMarketplaceSession(model,context);session.review(root,'stock');session.edit('title','A literal title');session.closeReview();session.dispose();
const snapshot:MarketplaceDisplaySnapshot=validateMarketplaceDisplay(input),event:MarketplaceIntentEvent=validateMarketplaceIntent(input,snapshot);const mounted=mountProgram(root,{registry,programId:'example.marketplace',marketplaceDisplay:snapshot,onMarketplaceIntent(event){void event.intent;}});mounted.setMarketplaceDisplay(snapshot);mounted.dispose();
void connectProgram({onMarketplaceDisplay(value){void value.seller.stock;}}).then(bridge=>{bridge.marketplaceIntent(event);bridge.dispose();});disposeMarketplaceBootstrap();
// @ts-expect-error The program cannot submit command keys or allocation digests.
const forged:MarketplaceIntentEvent={intent:'marketplace-request',snapshotId:'opaque',action:'stock',key:'command-key'};void forged;
