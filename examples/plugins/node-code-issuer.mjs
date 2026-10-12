// Synthetic durable issuer. Run: node node-code-issuer.mjs DATABASE [loopback-port].
// Set CODE_ISSUER_TOKEN; CODE_ISSUER_PROVIDER_ID defaults to example.issuer.
// The explicitly supplied database stores synthetic results and terminal tombstones.
// CODE_ISSUER_PENDING_EVERY and CODE_ISSUER_DELAY_MS simulate partial/delayed replies.
import {timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {validateCodeIssuanceRequest,validateCodeIssuanceResponse} from '../../src/code-issuance-contracts.js';

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
    digits=digits.replace(/^0+/,'');const trimmed=digits.replace(/0+$/,'');scale+=digits.length-trimmed.length;digits=trimmed;if(scale<0||digits.length+scale>16)invalid();const result=Number(digits+'0'.repeat(scale))*(negative?-1:1);if(!Number.isSafeInteger(result))invalid();return result;
  }
  function parse(depth=0){
    if(depth>16||++nodes>50000)invalid();whitespace();const character=text[at];if(character==='"')return string();
    if(character==='{'){at++;whitespace();const value=Object.create(null),keys=new Set();if(text[at]==='}'){at++;return value;}for(;;){if(text[at]!=='"')invalid();const key=string();if(keys.has(key))invalid();keys.add(key);whitespace();if(text[at++]!==':')invalid();value[key]=parse(depth+1);whitespace();const end=text[at++];if(end==='}')return value;if(end!==',')invalid();whitespace();}}
    if(character==='['){at++;whitespace();const value=[];if(text[at]===']'){at++;return value;}for(;;){value.push(parse(depth+1));whitespace();const end=text[at++];if(end===']')return value;if(end!==',')invalid();}}
    for(const [literal,value] of [['null',null],['true',true],['false',false]])if(text.startsWith(literal,at)){at+=literal.length;return value;}return number();
  }
  const result=parse();whitespace();if(at!==text.length)invalid();return result;
}
function reply(response,status,value){let body=Buffer.from(JSON.stringify(value));if(body.length>maxBody){status=500;body=Buffer.from('{}');}response.writeHead(status,{'content-type':'application/json','content-length':body.length,'cache-control':'no-store',connection:'close'});response.end(body);}
async function main(){
  const filename=process.argv[2],port=process.argv[3]??'0',token=process.env.CODE_ISSUER_TOKEN,providerId=process.env.CODE_ISSUER_PROVIDER_ID??'example.issuer';
  if(!filename||process.argv.length>4||!/^\d+(?![\s\S])/.test(port)||Number(port)>65535)throw Error('Explicit database and loopback port required');
  if(typeof token!=='string'||token.length<16||token.length>4096||!/^[\x21-\x7e]+(?![\s\S])/.test(token)||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}(?![\s\S])/.test(providerId)||['constructor','prototype','__proto__'].includes(providerId))throw Error('Issuer authority required');
  const pendingEvery=setting('CODE_ISSUER_PENDING_EVERY',128),delayMs=setting('CODE_ISSUER_DELAY_MS',5000),capacity=Number(process.env.CODE_ISSUER_MAX_ROWS??10000);
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>100000)throw Error('Invalid capacity');
  const credential=Buffer.from('Bearer '+token),db=new DatabaseSync(filename);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS issuer_entries(issuance_id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,identity TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','issued','cancelled')),result TEXT,effect_count INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0) STRICT;");
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Invalid issuer database');
  const canonical=entry=>JSON.stringify(Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a.localeCompare(b))));
  const lookup=id=>db.prepare('SELECT * FROM issuer_entries WHERE issuance_id=?').get(id);
  const transaction=callback=>{db.exec('BEGIN IMMEDIATE');try{const value=callback();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  const issued=entry=>({code:'SYNTHETIC-CODE-'+entry.issuanceId,externalId:'synthetic-'+entry.issuanceId,metadata:{fixture:'synthetic'}});
  const resultRow=(entry,row)=>({...entry,state:row?.state??'not-issued',...(row?.state==='issued'?{result:JSON.parse(row.result)}:{})});
  async function processEntry(request,entry,index){
    const identity=canonical(entry);
    const started=transaction(()=>{
      let row=lookup(entry.issuanceId);
      if(row&&(row.batch_id!==request.batchId||row.identity!==identity))return {response:{...entry,state:'error',errorCode:'conflict'}};
      if(request.operation==='lookup')return {response:resultRow(entry,row)};
      if(!row){if(db.prepare('SELECT COUNT(*) AS n FROM issuer_entries').get().n>=capacity)return {response:{...entry,state:'error',errorCode:'unavailable'}};db.prepare('INSERT INTO issuer_entries(issuance_id,batch_id,identity,state) VALUES(?,?,?,?)').run(entry.issuanceId,request.batchId,identity,request.operation==='cancel'?'cancelled':'pending');row=lookup(entry.issuanceId);}
      if(request.operation==='cancel'){db.prepare("UPDATE issuer_entries SET state='cancelled',result=NULL WHERE issuance_id=?").run(entry.issuanceId);return {response:resultRow(entry,lookup(entry.issuanceId))};}
      if(row.state!=='pending')return {response:resultRow(entry,row)};
      db.prepare('UPDATE issuer_entries SET attempts=attempts+1 WHERE issuance_id=?').run(entry.issuanceId);
      if(pendingEvery&&(index+1)%pendingEvery===0&&row.attempts===0)return {response:{...entry,state:'pending'}};
      return {complete:true};
    });
    if(started.response)return started.response;
    if(delayMs)await delay(delayMs);
    return transaction(()=>{
      const row=lookup(entry.issuanceId);if(row.state!=='pending')return resultRow(entry,row);
      db.prepare("UPDATE issuer_entries SET state='issued',result=?,effect_count=effect_count+1 WHERE issuance_id=? AND state='pending'").run(JSON.stringify(issued(entry)),entry.issuanceId);return resultRow(entry,lookup(entry.issuanceId));
    });
  }
  const server=createServer({maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000},async(request,response)=>{
    request.setTimeout(5000,()=>request.destroy());const count=name=>request.rawHeaders.filter((_,index)=>index%2===0&&request.rawHeaders[index].toLowerCase()===name).length,supplied=Buffer.from(request.headers.authorization??'');
    if(count('authorization')!==1||supplied.length!==credential.length||!timingSafeEqual(supplied,credential)){request.resume();reply(response,401,{});return;}
    const length=request.headers['content-length'];if(request.method!=='POST'||request.url!=='/code-issuance'||request.headers['transfer-encoding']||count('content-length')!==1||count('content-type')!==1||!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??'')||!/^\d+(?![\s\S])/.test(length??'')||Number(length)<1||Number(length)>maxBody){request.resume();reply(response,400,{});return;}
    let value;
    try{const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>maxBody)throw Error('Request limit');chunks.push(chunk);}if(size!==Number(length))throw Error('Request length');value=validateCodeIssuanceRequest(decode(Buffer.concat(chunks)));if(value.providerId!==providerId)throw Error('Issuer identity');}catch{if(!response.destroyed)reply(response,400,{});return;}
    const identity=Object.fromEntries(Object.entries(value).filter(([key])=>key!=='context'));
    if(Date.now()>=value.deadline){reply(response,503,validateCodeIssuanceResponse({...identity,status:'error',errorCode:'unavailable'}));return;}
    try{const results=await Promise.all(value.context.entries.map((entry,index)=>processEntry(value,entry,index)));reply(response,200,validateCodeIssuanceResponse({...identity,status:'processed',results}));}
    catch{if(!response.destroyed)reply(response,503,validateCodeIssuanceResponse({...identity,status:'error',errorCode:'unavailable'}));}
  });
  server.maxConnections=32;server.maxRequestsPerSocket=1;server.keepAliveTimeout=1;
  server.on('error',()=>{db.close();process.stderr.write('Code issuer unavailable\n');process.exitCode=1;});server.listen(Number(port),'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\n'));
}
main().catch(()=>{process.stderr.write('Code issuer unavailable\n');process.exitCode=1;});
