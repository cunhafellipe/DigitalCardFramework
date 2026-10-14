import {createProgramShopView,type ProgramShopOptions} from '@digital-card/framework/presentation/program-shop-view';
import {shopIntents,shopDisplayProfile,validateShopIntent,type ShopDisplaySnapshot} from '@digital-card/framework/presentation/shop-display';
import {mountProgram,connectProgram,type ProgramRegistry} from '@digital-card/framework/presentation/program';
const registry:ProgramRegistry=new Map([['example.shop',{approved:true,url:'https://shop.example.test/',version:'1',intents:shopIntents,shopDisplay:{profile:shopDisplayProfile,fields:['productName','price','availability','rates']}}]]);
const options:ProgramShopOptions={registry,programId:'example.shop',displayFields:['productName','price','availability','rates']};
const view=createProgramShopView(options);view.setEnabled(false);view.dispose();
declare const snapshot:ShopDisplaySnapshot;declare const root:HTMLElement;
const mounted=mountProgram(root,{registry,programId:'example.shop',shopDisplay:snapshot,onShopIntent(event){if(event.intent==='shop-review')console.log(event.quantity);}});mounted.setShopDisplay(snapshot);mounted.dispose();
void connectProgram({onShopDisplay(value){const item=value.items[0];if(!item)return;const event=validateShopIntent({intent:'shop-review',snapshotId:value.snapshotId,handle:item.handle,quantity:1});void event;}}).then(bridge=>{bridge.shopIntent({intent:'shop-query',snapshotId:snapshot.snapshotId,search:''});bridge.dispose();});
// @ts-expect-error Programs do not receive a payment/commit intent.
validateShopIntent({intent:'shop-commit'}).intent='shop-commit';
