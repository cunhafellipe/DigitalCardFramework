import {createProgramTradingView,type ProgramTradingOptions} from '@digital-card/framework/presentation/program-trading-view';
import {tradingIntents,tradingDisplayProfile,validateTradingIntent,type TradingDisplaySnapshot} from '@digital-card/framework/presentation/trading-display';
import {mountProgram,connectProgram,type ProgramRegistry} from '@digital-card/framework/presentation/program';
const registry:ProgramRegistry=new Map([['example.trading',{approved:true,url:'https://trading.example.test/',version:'1',intents:tradingIntents,tradingDisplay:{profile:tradingDisplayProfile,fields:['participantName','cardName','currency','message']}}]]);
const options:ProgramTradingOptions={registry,programId:'example.trading',displayFields:['participantName','cardName','currency','message']};
const view=createProgramTradingView(options);view.setEnabled(false);view.dispose();
declare const snapshot:TradingDisplaySnapshot;declare const root:HTMLElement;
const mounted=mountProgram(root,{registry,programId:'example.trading',tradingDisplay:snapshot,onTradingIntent(event){if(event.intent==='currency-set')console.log(event.amount);}});mounted.setTradingDisplay(snapshot);mounted.dispose();
void connectProgram({onTradingDisplay(value){const item=value.inventories.give.items[0];if(item)void validateTradingIntent({intent:'card-add',snapshotId:value.snapshotId,side:'give',handle:item.handle});}}).then(bridge=>{bridge.tradingIntent({intent:'directory-query',snapshotId:snapshot.snapshotId,search:''});bridge.dispose();});
// @ts-expect-error Financial confirmation is unavailable to the program.
validateTradingIntent({intent:'draft-confirm'}).intent='draft-confirm';
