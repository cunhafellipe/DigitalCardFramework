import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tradingIntents,tradingDisplayLabelKeys} from '../src/presentation/trading-display.js';
test('portable trading bootstrap exposes every bounded workflow operation without a command confirmation',async()=>{const bootstrap=await readFile(new URL('../src/presentation/program-trading-bootstrap.js',import.meta.url),'utf8');for(const intent of tradingIntents)assert(bootstrap.includes(intent)||['draft-clear','draft-review'].includes(intent),intent);for(const source of ['../examples/plugins/python-trading-view.py','../examples/plugins/go-trading-view/main.go']){const document=await readFile(new URL(source,import.meta.url),'utf8');for(const control of ['data-dc-trading-recipient','data-dc-trading-tray','data-dc-trading-currencies','data-dc-trading-message','data-dc-trading-offers','data-dc-trading-details','data-dc-trading-detail-currencies'])assert(document.includes(control),control);}assert(!tradingIntents.includes('draft-confirm'));assert(tradingDisplayLabelKeys.includes('review'));});


test('directory diagnostics replace prior failures and clear after a successful load',async()=>{
  const {createTradingSession}=await import('../src/trading-session.js');
  let failure=Object.assign(new Error('Access detail'),{code:'FORBIDDEN'});
  const session=createTradingSession({me:{userId:'owner'},catalog:{features:{}}},{client:{directory:async()=>{if(failure)throw failure;return {items:[]};}}});
  try{
    session.error='Previous failure';session.diagnostic={code:'NETWORK_ERROR'};
    await session.loadDirectory();assert.equal(session.diagnostic.code,'FORBIDDEN');assert.equal(session.error,session.localization.text('diagnostic.access'));
    failure=new Error('Uncoded local detail');await session.loadDirectory();assert.equal(session.diagnostic.code,undefined);assert.equal(session.error,'Uncoded local detail');
    failure=null;await session.loadDirectory();assert.equal(session.error,null);assert.equal(session.diagnostic,null);
  }finally{session.dispose();}
});
