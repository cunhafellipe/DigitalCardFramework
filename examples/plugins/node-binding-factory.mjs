// Synthetic durable binding factory. Run: node node-binding-factory.mjs DATABASE [loopback-port].
// Set BINDING_FACTORY_TOKEN and BINDING_FACTORY_KIND (pure, provision or activation).
// Defaults: provider example.binding, factory example.reward, revision 1, user fields ["id"].
// Override with BINDING_FACTORY_PROVIDER_ID, NAME, REVISION and USER_FIELDS (JSON array).
// The explicit database stores synthetic results, effect counts and cancellation fences.
// Optional BINDING_FACTORY_PENDING_EVERY and BINDING_FACTORY_DELAY_MS simulate failures.
import {timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {validateBindingFactoryRequest,validateBindingFactoryResponse,bindingFactoryIdentity} from '../../src/binding-factory-contracts.js';
import {contentDigest} from '../../src/importer.js';

const maxBody=1048576;
function setting(name,maximum){const value=process.env[name]??'0';if(!/^\d+(?![\s\S])/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>maximum)throw Error('Invalid setting');return Number(value);}
function decode(raw){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);let at=0,nodes=0;
  const invalid=()=>{throw Error('Invalid JSON');},whitespace=()=>{while(/[\x20\t\r\n]/.test(text[at]??'x'))at++;};
  function string(){const start=at++;while(at<text.length){const character=text[at++];if(character==='\\'){at++;continue;}if(character==='"'){const value=JSON.parse(text.slice(start,at));if(!value.isWellFormed())invalid();return value;}}invalid();}
  function number(){
    const match=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));if(!match||match.index!==0)invalid();at+=match[0].length;
    let value=match[0],negative=value.startsWith('-');if(negative)value=value.slice(1);const [mantissa,exponent='0']=value.split(/[eE]/);let digits=mantissa.replace('.','');if(!digits.replaceAll('0',''))return 0;
    let scale=Number(exponent);if(!Number.isInteger(scale)||Math.abs(scale)>maxBody)invalid();const dot=mantissa.indexOf('.');if(dot!==-1)scale-=mantissa.length-dot-1;
    digits=digits.replace(/^0+/,'');const trimmed=digits.replace(/0+$/,'');scale+=digits.length-trimmed.length;digits=trimmed;if(scale<0){const result=Number(match[0]);if(!Number.isFinite(result)||Number.isInteger(result))invalid();return result;}if(digits.length+scale>16)invalid();const result=Number(digits+'0'.repeat(scale))*(negative?-1:1);if(!Number.isSafeInteger(result))invalid();return result;
  }
  function parse(depth=0){
    if(depth>40||++nodes>1000000)invalid();whitespace();const character=text[at];if(character==='"')return string();
    if(character==='{'){at++;whitespace();const value=Object.create(null),keys=new Set();if(text[at]==='}'){at++;return value;}for(;;){if(text[at]!=='"')invalid();const key=string();if(keys.has(key))invalid();keys.add(key);whitespace();if(text[at++]!==':')invalid();value[key]=parse(depth+1);whitespace();const end=text[at++];if(end==='}')return value;if(end!==',')invalid();whitespace();}}
    if(character==='['){at++;whitespace();const value=[];if(text[at]===']'){at++;return value;}for(;;){value.push(parse(depth+1));whitespace();const end=text[at++];if(end===']')return value;if(end!==',')invalid();}}
    for(const [literal,value] of [['null',null],['true',true],['false',false]])if(text.startsWith(literal,at)){at+=literal.length;return value;}return number();
  }
  const result=parse();whitespace();if(at!==text.length)invalid();return result;
}
function reply(response,status,value){let body=Buffer.from(JSON.stringify(value));if(body.length>maxBody){status=500;body=Buffer.from('{}');}response.writeHead(status,{'content-type':'application/json','content-length':body.length,'cache-control':'no-store',connection:'close'});response.end(body);}
async function main(){
  const filename=process.argv[2],port=process.argv[3]??'0',token=process.env.BINDING_FACTORY_TOKEN,providerId=process.env.BINDING_FACTORY_PROVIDER_ID??'example.binding',factoryName=process.env.BINDING_FACTORY_NAME??'example.reward',kind=process.env.BINDING_FACTORY_KIND??'provision',revision=Number(process.env.BINDING_FACTORY_REVISION??1);
  const validId=value=>/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}(?![\s\S])/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
  if(!filename||process.argv.length>4||!/^\d+(?![\s\S])/.test(port)||Number(port)>65535)throw Error('Explicit database and loopback port required');
  if(typeof token!=='string'||token.length<16||token.length>4096||!/^[\x21-\x7e]+(?![\s\S])/.test(token)||!validId(providerId)||!validId(factoryName)||!['pure','provision','activation'].includes(kind)||!Number.isSafeInteger(revision)||revision<1)throw Error('Factory authority required');
  const fields=JSON.parse(process.env.BINDING_FACTORY_USER_FIELDS??'["id"]');
  if(!Array.isArray(fields)||fields.length<1||fields.length>32||!fields.includes('id')||new Set(fields).size!==fields.length||fields.some(path=>typeof path!=='string'||path.length>200||path.split('.').length>8||path.split('.').some(key=>!/^[A-Za-z0-9_][A-Za-z0-9_-]*(?![\s\S])/.test(key)||['constructor','prototype','__proto__'].includes(key))))throw Error('Invalid user grants');
  function granted(value,path=''){
    if(fields.includes(path))return true;
    if(path&&!fields.some(field=>field.startsWith(path+'.')))return false;
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    return Object.entries(value).every(([key,item])=>granted(item,path?path+'.'+key:key));
  }
  const hasGrants=user=>fields.every(path=>{let value=user;for(const key of path.split('.')){if(!value||typeof value!=='object'||!Object.hasOwn(value,key))return false;value=value[key];}return true;});
  const pendingEvery=setting('BINDING_FACTORY_PENDING_EVERY',128),delayMs=setting('BINDING_FACTORY_DELAY_MS',5000),capacity=Number(process.env.BINDING_FACTORY_MAX_ROWS??10000);
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>100000)throw Error('Invalid capacity');
  const credential=Buffer.from('Bearer '+token),db=new DatabaseSync(filename);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS factory_entries(invocation_id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,identity TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','ready','cancelled')),result TEXT,effect_count INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0) STRICT;");
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Invalid factory database');
  const lookup=id=>db.prepare('SELECT * FROM factory_entries WHERE invocation_id=?').get(id);
  const transaction=callback=>{db.exec('BEGIN IMMEDIATE');try{const value=callback();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  const resultRow=(entry,row)=>({...bindingFactoryIdentity(entry),state:row?.state??'not-created',...(row?.state==='ready'?{data:JSON.parse(row.result)}:{})});
  const produced=entry=>({value:'SYNTHETIC-BINDING-'+entry.invocationId,holder:entry.userId,mode:entry.kind});
  async function processEntry(request,entry,index){
    const identity=contentDigest({providerId,entry});
    const started=transaction(()=>{
      let row=lookup(entry.invocationId);
      if(row&&(row.batch_id!==request.batchId||row.identity!==identity||row.kind!==kind))return {response:{...bindingFactoryIdentity(entry),state:'error',errorCode:'conflict'}};
      if(request.operation==='lookup')return {response:resultRow(entry,row)};
      if(!row){if(db.prepare('SELECT COUNT(*) AS n FROM factory_entries').get().n>=capacity)return {response:{...bindingFactoryIdentity(entry),state:'error',errorCode:'unavailable'}};db.prepare('INSERT INTO factory_entries(invocation_id,batch_id,identity,kind,state) VALUES(?,?,?,?,?)').run(entry.invocationId,request.batchId,identity,kind,request.operation==='cancel'?'cancelled':'pending');row=lookup(entry.invocationId);}
      if(request.operation==='cancel'){db.prepare("UPDATE factory_entries SET state='cancelled',result=NULL WHERE invocation_id=?").run(entry.invocationId);return {response:resultRow(entry,lookup(entry.invocationId))};}
      if(row.state!=='pending')return {response:resultRow(entry,row)};
      db.prepare('UPDATE factory_entries SET attempts=attempts+1 WHERE invocation_id=?').run(entry.invocationId);
      if(pendingEvery&&(index+1)%pendingEvery===0&&row.attempts===0)return {response:{...bindingFactoryIdentity(entry),state:'pending'}};
      return {complete:true};
    });
    if(started.response)return started.response;
    if(delayMs)await delay(delayMs);
    return transaction(()=>{
      const row=lookup(entry.invocationId);if(row.state!=='pending')return resultRow(entry,row);
      // The synthetic irreversible effect and its deduplication record share one commit.
      db.prepare("UPDATE factory_entries SET state='ready',result=?,effect_count=effect_count+? WHERE invocation_id=? AND state='pending'").run(JSON.stringify(produced(entry)),kind==='pure'?0:1,entry.invocationId);return resultRow(entry,lookup(entry.invocationId));
    });
  }
  const server=createServer({maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000},async(request,response)=>{
    request.setTimeout(5000,()=>request.destroy());const count=name=>request.rawHeaders.filter((_,index)=>index%2===0&&request.rawHeaders[index].toLowerCase()===name).length,supplied=Buffer.from(request.headers.authorization??'');
    if(count('authorization')!==1||supplied.length!==credential.length||!timingSafeEqual(supplied,credential)){request.resume();reply(response,401,{});return;}
    const length=request.headers['content-length'];if(request.method!=='POST'||request.url!=='/binding-factory'||request.headers['transfer-encoding']||count('content-length')!==1||count('content-type')!==1||!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??'')||!/^\d+(?![\s\S])/.test(length??'')||Number(length)<1||Number(length)>maxBody){request.resume();reply(response,400,{});return;}
    let value;
    try{const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>maxBody)throw Error('Request limit');chunks.push(chunk);}if(size!==Number(length))throw Error('Request length');value=validateBindingFactoryRequest(decode(Buffer.concat(chunks)));if(value.providerId!==providerId||value.inputDigest!==contentDigest(value.context.entries.map(bindingFactoryIdentity))||value.context.entries.some(entry=>entry.kind!==kind||entry.factoryName!==factoryName||entry.factoryRevision!==revision||!granted(entry.input.user)||!hasGrants(entry.input.user)))throw Error('Factory identity');}catch{if(!response.destroyed)reply(response,400,{});return;}
    const identity=Object.fromEntries(Object.entries(value).filter(([key])=>key!=='context'));
    if(Date.now()>=value.deadline){reply(response,503,validateBindingFactoryResponse({...identity,status:'error',errorCode:'unavailable'}));return;}
    try{const results=await Promise.all(value.context.entries.map((entry,index)=>processEntry(value,entry,index)));reply(response,200,validateBindingFactoryResponse({...identity,status:'processed',results}));}
    catch{if(!response.destroyed)reply(response,503,validateBindingFactoryResponse({...identity,status:'error',errorCode:'unavailable'}));}
  });
  server.maxConnections=32;server.maxRequestsPerSocket=1;server.keepAliveTimeout=1;
  server.on('error',()=>{db.close();process.stderr.write('Binding factory unavailable\n');process.exitCode=1;});server.listen(Number(port),'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\n'));
}
main().catch(()=>{process.stderr.write('Binding factory unavailable\n');process.exitCode=1;});
