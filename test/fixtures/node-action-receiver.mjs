import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createHash,timingSafeEqual} from 'node:crypto';
import {validateActionDelivery} from '../../src/action-contracts.js';

// Test receipt recorder: one exclusive SQLite owner, no external provider effect.
const token=process.env.PLUGIN_TOKEN,capacity=Number(process.env.PLUGIN_MAX_RECEIPTS??1000),byteCapacity=Number(process.env.RECEIPT_MAX_BYTES??4194304);
const check=condition=>{if(!condition)throw Error('Invalid receipt request');};
const digest=value=>createHash('sha256').update(value).digest('hex');
function number(raw){
  check(raw.length<=500);const [mantissa,exponent='0']=raw.toLowerCase().split('e'),power=Number(exponent);check(Number.isInteger(power)&&Math.abs(power)<=400);let scale=(mantissa.split('.')[1]?.length??0)-power,coefficient=BigInt(mantissa.replace('.',''));if(coefficient===0n)return '0';const sign=coefficient<0n?'-':'';let digits=(coefficient<0n?-coefficient:coefficient).toString();while(digits.endsWith('0')){digits=digits.slice(0,-1);scale--;}return sign+(scale<=0?digits+'0'.repeat(-scale):scale>=digits.length?'0.'+'0'.repeat(scale-digits.length)+digits:digits.slice(0,-scale)+'.'+digits.slice(-scale));
}
function parse(raw){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw),frames=[];
  for(const match of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)){const item=match[0];if(item==='{'){frames.push(new Set());check(frames.length<=18);continue;}if(item==='['){frames.push(null);check(frames.length<=18);continue;}if(item==='}'||item===']'){frames.pop();continue;}if(!/^\s*:/.test(text.slice(match.index+item.length)))continue;const key=JSON.parse(item),keys=frames.at(-1);check(keys instanceof Set&&!keys.has(key));keys.add(key);}
  const numbers=new WeakMap(),value=JSON.parse(text,function(key,value,context){if(typeof value==='number'){check(Number.isFinite(value)&&typeof context?.source==='string');let terms=numbers.get(this);if(!terms)numbers.set(this,terms=new Map());terms.set(key,number(context.source));}return value;});
  const render=(value,parent,key)=>typeof value==='number'?numbers.get(parent).get(key):Array.isArray(value)?'['+value.map((item,n)=>render(item,value,String(n))).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(name=>JSON.stringify(name)+':'+render(value[name],value,name)).join(',')+'}':JSON.stringify(value);
  validateActionDelivery(value);check(value.pluginId==='example.receiver'&&value.handlerId==='example.record');return {value,canonical:render(value),text};
}
let db,server;
try{
  check(typeof token==='string'&&/^[!-~]{16,4096}$/.test(token)&&!/[\r\n]/.test(token));check(Number.isInteger(capacity)&&capacity>=1&&capacity<=10000);check(Number.isInteger(byteCapacity)&&byteCapacity>=1024&&byteCapacity<=4194304);check(process.argv.length===3);
  db=new DatabaseSync(process.argv[2]);db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS deliveries(job_id TEXT PRIMARY KEY, digest TEXT NOT NULL, payload TEXT NOT NULL); COMMIT');
  const rows=db.prepare('SELECT job_id,digest,payload FROM deliveries').all();check(rows.length<=10000);let bytes=0;for(const row of rows){const retained=parse(Buffer.from(row.payload));check(retained.value.jobId===row.job_id&&digest(retained.canonical)===row.digest);bytes+=Buffer.byteLength(row.payload)+Buffer.byteLength(row.job_id)+64;}check(bytes<=4194304);
  const lookup=db.prepare('SELECT digest FROM deliveries WHERE job_id=?'),insert=db.prepare('INSERT INTO deliveries(job_id,digest,payload) VALUES(?,?,?)');let count=rows.length,poisoned=false,active=0;
  const header=(req,name)=>{check(req.rawHeaders.filter((value,n)=>n%2===0&&value.toLowerCase()===name).length===1);check(typeof req.headers[name]==='string');return req.headers[name];};
  const reply=(res,status,value={})=>{const body=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','content-length':Buffer.byteLength(body)});res.end(body);};
  server=createServer({maxHeaderSize:8192},async(req,res)=>{
    if(++active>4){active--;req.resume();reply(res,429);return;}
    try{
      if(req.method!=='POST'||req.url!=='/actions'){reply(res,404);return;}const auth=header(req,'authorization'),expected='Bearer '+token;if(Buffer.byteLength(auth)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected))){reply(res,403);return;}check(header(req,'content-type').split(';')[0]==='application/json'&&!req.headers['content-encoding']);let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>65536){req.resume();reply(res,413);return;}parts.push(part);}const parsed=parse(Buffer.concat(parts)),key=header(req,'idempotency-key');check(parsed.value.jobId===key);if(poisoned){reply(res,503);return;}const hash=digest(parsed.canonical),known=lookup.get(key);
      if(known){if(known.digest!==hash){reply(res,409);return;}}
      else{
        const growth=Buffer.byteLength(parsed.text)+Buffer.byteLength(key)+64;if(count>=capacity||bytes+growth>byteCapacity){reply(res,507);return;}
        try{db.exec('BEGIN IMMEDIATE');insert.run(key,hash,parsed.text);db.exec('COMMIT');}catch{try{db.exec('ROLLBACK');}catch{}poisoned=true;reply(res,503);return;}count++;bytes+=growth;
      }
      reply(res,200,{protocol:'digital-card-action@1',pluginId:'example.receiver',jobId:key,status:'completed'});
    }catch{if(!res.headersSent)reply(res,400);}finally{active--;req.resume();}
  });
  server.maxConnections=8;server.headersTimeout=10000;server.requestTimeout=10000;server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});});
}catch{db?.close();console.error('RECEIPT_FIXTURE_FAILED');process.exitCode=1;}
