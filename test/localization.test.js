import test from 'node:test';
import assert from 'node:assert/strict';
import {localizeDiagnostic,diagnosticKeys,createLocalization,validateLocalizationBundle,localizationProtocol,localizationSchema,localizationKeys,englishMessages} from '../src/localization.js';

const bundle=(messages={},locale='fr')=>({protocol:localizationProtocol,locale,messages});
const invalid=input=>assert.throws(()=>validateLocalizationBundle(input),{name:'TypeError',message:'Invalid localization bundle'});

test('portable locale data is canonical, detached and deeply frozen',()=>{
  const input=bundle({'shop.purchased':{one:'{count} paquet acheté.',other:'{count} paquets achetés.'}},'fr-ca'),validated=validateLocalizationBundle(JSON.parse(JSON.stringify(input)));
  input.messages['shop.purchased'].one='Changed';
  assert.equal(validated.locale,'fr-CA');assert.equal(validated.messages['shop.purchased'].one,'{count} paquet acheté.');
  assert(Object.isFrozen(validated)&&Object.isFrozen(validated.messages)&&Object.isFrozen(validated.messages['shop.purchased']));
  assert(Object.isFrozen(englishMessages)&&Object.isFrozen(localizationKeys));
  assert.equal(Object.keys(localizationSchema.keys).length,Object.keys(englishMessages).length);
});

test('requested plurals and English fallback use their own language rules',()=>{
  const ar=createLocalization({locale:'ar',messages:{'shop.purchased':{zero:'لا حزم ({count})',one:'حزمة واحدة ({count})',two:'حزمتان ({count})',few:'حزم قليلة ({count})',many:'حزم كثيرة ({count})',other:'حزم ({count})'}}});
  assert.equal(ar.text('shop.purchased',{count:2}),'حزمتان ('+ar.number(2)+')');
  assert.equal(ar.text('shop.cardsPerPack',{count:2}),ar.number(2)+' cards per pack');
  const fr=createLocalization({locale:'fr'});assert.equal(fr.text('shop.cardsPerPack',{count:0}),'0 cards per pack');
  assert.equal(fr.text('shop.cardsPerPack',{count:1}),'1 card per pack');
  assert.equal(fr.text('shop.cardsPerPack',{count:1.0001}),'1,0001 cards per pack');
  const en=createLocalization();assert.equal(en.text('shop.cardsPerPack',{count:1.0001}),'1.0001 cards per pack');
});

test('named interpolation supports reordered fields and safe literal text',()=>{
  const locale=createLocalization({locale:'de',messages:{'shop.buy':'{currency}: {amount} kaufen < 10 > 1','recovery.action':'{change} wiederherstellen'}});
  assert.equal(locale.text('shop.buy',{currency:'<img src=x>',amount:1234.56789}),'<img src=x>: 1.234,56789 kaufen < 10 > 1');
  assert.equal(locale.text('recovery.action',{change:'Original'}),'Original wiederherstellen');
  assert.throws(()=>locale.text('shop.buy',{amount:1}));assert.throws(()=>locale.text('not-a-key'));
  assert.throws(()=>locale.text('shop.purchased',{count:'2'}));assert.throws(()=>locale.number(Infinity));
});

test('financial formatting keeps small fractions and dates use explicit UTC options',()=>{
  const locale=createLocalization({locale:'de-DE'});
  assert.equal(locale.number(0.000123456789),'0,000123456789');assert.equal(locale.number(1234567.125),'1.234.567,125');
  assert.equal(locale.date('2026-10-12T01:02:03-07:00'),new Intl.DateTimeFormat('de-DE',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date('2026-10-12T08:02:03Z')));
  assert.throws(()=>locale.date('not-a-date'));
  assert.equal(locale.date(new Date('2026-10-12T08:02:03Z')),locale.date('2026-10-12T08:02:03Z'));
  let coerced=0;assert.throws(()=>locale.date({[Symbol.toPrimitive](){coerced++;return 0;}}));assert.equal(coerced,0);
});

test('validation rejects unknown keys, malformed templates and invalid plural data',()=>{
  for(const messages of [{'unknown':'Text'},{'shop.buy':'Buy {amount}'},{'shop.buy':'Buy {amount} {currency} {secret}'},{'shop.buy':'Buy {amount} {currency} {'},{'shop.buy':'\ud800 {amount} {currency}'},{'shop.buy':{other:'{amount} {currency}'}},{'shop.purchased':'{count} packs'},{'shop.purchased':{one:'{count} pack'}},{'shop.purchased':{other:'{count}',invalid:'{count}'}},{'shop.purchased':{other:'Missing count'}}])invalid(bundle(messages));
  invalid({...bundle(),protocol:'other'});invalid({...bundle(),extra:true});invalid(bundle({},'bad_locale'));
});

test('validation rejects accessors, custom prototypes and executable values without calling them',()=>{
  let calls=0;const messages={};Object.defineProperty(messages,'shop.title',{enumerable:true,get(){calls++;return 'Unsafe';}});invalid(bundle(messages));assert.equal(calls,0);
  const options={};Object.defineProperty(options,'locale',{enumerable:true,get(){calls++;return 'fr';}});assert.throws(()=>createLocalization(options));assert.equal(calls,0);
  invalid(bundle(Object.assign(Object.create({}),{'shop.title':'Text'})));
  invalid(bundle({'shop.title':()=> 'Text'}));invalid(bundle({'shop.title':['Text']}));
  invalid(bundle(JSON.parse('{"__proto__":"unsafe"}')));
});

test('per-form and total UTF-8 limits apply to portable bundles',()=>{
  invalid(bundle({'shop.title':'x'.repeat(2049)}));
  const messages={};for(const [key,metadata]of Object.entries(localizationKeys)){const text='é'.repeat(900)+metadata.placeholders.map(name=>'{'+name+'}').join(' ');messages[key]=metadata.plural?{other:text}:text;}
  invalid(bundle(messages));
});

test('expanded collector catalog accepts bounded large bundles and retains old bundle compatibility',()=>{
  assert.equal(localizationSchema.maximumBytes,131072);assert.equal(localizationSchema.maximumMessages,2048);assert(Object.keys(localizationKeys).length>1024);
  const makeMessages=padding=>Object.fromEntries(Object.entries(localizationKeys).map(([key,metadata])=>{const text='x'.repeat(padding)+metadata.placeholders.map(name=>'{'+name+'}').join(' ');return [key,metadata.plural?{other:text}:text];})),large=bundle(makeMessages(40));
  const bytes=new TextEncoder().encode(JSON.stringify(large)).length;assert(bytes>32768&&bytes<=131072);assert.equal(Object.keys(validateLocalizationBundle(large).messages).length,Object.keys(localizationKeys).length);
  const oversized=bundle(makeMessages(150));assert(new TextEncoder().encode(JSON.stringify(oversized)).length>131072);invalid(oversized);
  const oldMessages=Object.fromEntries(Object.entries(englishMessages).slice(0,220));assert.equal(Object.keys(validateLocalizationBundle(bundle(oldMessages,'en')).messages).length,220);
  const previousMessages=Object.fromEntries(Object.entries(englishMessages).slice(0,490));assert.equal(Object.keys(validateLocalizationBundle(bundle(previousMessages,'en')).messages).length,490);
  invalid(bundle(Object.fromEntries(Array.from({length:2049},(_,index)=>['extra.'+index,'text']))));
});

test('independent instances retain their locale and validated message snapshot',()=>{
  const messages={'packs.open':'Ouvrir le paquet'},fr=createLocalization({locale:'fr',messages}),en=createLocalization();messages['packs.open']='Changed';
  assert.equal(fr.text('packs.open'),'Ouvrir le paquet');assert.equal(en.text('packs.open'),'Open pack');assert.equal(fr.number(1234.5),'1 234,5');assert.equal(en.number(1234.5),'1,234.5');
  assert.equal(createLocalization({locale:'ar'}).dir,'rtl');assert.equal(en.dir,'ltr');
});


test('structured diagnostics use catalog keys without changing machine data or authored literals',()=>{
  const messages=Object.fromEntries(Object.values(diagnosticKeys).map(key=>[key,'Local '+key]));
  messages['diagnostic.unknown']='Local unknown';
  const local=createLocalization({locale:'es',messages}),english=createLocalization();
  for(const [code,key] of Object.entries(diagnosticKeys)){
    const error=Object.freeze({code,message:'Authored <name> 0007',status:503,retryAfter:17});
    assert.equal(localizeDiagnostic(local,error),'Local '+key);
    assert.equal(localizeDiagnostic(english,error),englishMessages[key]);
    assert.deepEqual(error,{code,message:'Authored <name> 0007',status:503,retryAfter:17});
  }
  for(const code of ['FUTURE_SERVER_CODE','__proto__','toString'])assert.equal(localizeDiagnostic(local,{code,message:'Untrusted detail'}),'Local unknown');
  assert.equal(localizeDiagnostic(local,null),'Local unknown');
  assert.equal(localizeDiagnostic(local,new SyntaxError('Raw parser detail')),'Local diagnostic.input');
  assert.equal(localizeDiagnostic(local,{message:'Authored <name> 0007'}),'Authored <name> 0007');
});

test('wire parser diagnostics preserve phase, operation and validation details',async()=>{
  const {WireContractError}=await import('../src/wire-contracts.js');
  const error=new WireContractError('inventory','response',[{instancePath:'/0',message:'invalid authored value'}]);
  const before=structuredClone({...error}),local=createLocalization({locale:'es',messages:{'diagnostic.contract':'No se pudo leer la respuesta.'}});
  assert.equal(localizeDiagnostic(local,error),'No se pudo leer la respuesta.');
  assert.deepEqual({...error},before);assert.equal(error.message,'Invalid response contract for inventory');
});


test('malformed response JSON is a response diagnostic and network failures retain identity',async()=>{
  const {createWireTransport}=await import('../src/wire-client.js');
  const local=createLocalization({locale:'es',messages:{'diagnostic.contract':'No se pudo leer la respuesta.'}});
  const call=createWireTransport({principal:()=>null,fetch:async()=>new Response('{',{status:200})});
  await assert.rejects(()=>call('catalog'),error=>error.code==='INVALID_WIRE_CONTRACT'&&error.phase==='response'&&localizeDiagnostic(local,error)==='No se pudo leer la respuesta.');
  const aborted=new DOMException('Stopped','AbortError');
  const interrupted=createWireTransport({principal:()=>null,fetch:async()=>({json:async()=>{throw aborted;}})});
  await assert.rejects(()=>interrupted('catalog'),error=>error===aborted);
});
