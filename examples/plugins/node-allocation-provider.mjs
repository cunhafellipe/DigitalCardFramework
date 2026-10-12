// Trusted loopback allocation fixture. Run: node node-allocation-provider.mjs [port].
// Set ALLOCATION_PROVIDER_TOKEN; ALLOCATION_PROVIDER_ID defaults to example.allocation.
// Plans are deterministic and read-only. The framework owns inventory and settlement.
import {timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {validateAllocationStrategyRequest,validateAllocationStrategyResponse} from '../../src/allocation-strategy-contracts.js';
import {validateStockAllocationStrategyRequest,validateStockAllocationStrategyResponse} from '../../src/stock-allocation-strategy-contracts.js';
import {validateExternalAllocationStrategyRequest,validateExternalAllocationStrategyResponse} from '../../src/external-allocation-strategy-contracts.js';
import {planAllocation} from '../../src/allocation-planner.js';

const token=process.env.ALLOCATION_PROVIDER_TOKEN,providerId=process.env.ALLOCATION_PROVIDER_ID??'example.allocation';
if(typeof token!=='string'||token.length<16||token.length>4096||!/^[\x21-\x7e]+(?![\s\S])/.test(token))throw Error('Provider credential required');
if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}(?![\s\S])/.test(providerId)||['constructor','prototype','__proto__'].includes(providerId))throw Error('Invalid provider identity');
const port=process.argv[2]??'0';
if(process.argv.length>3||!/^\d+(?![\s\S])/.test(port)||!Number.isInteger(Number(port))||Number(port)>65535)throw Error('Invalid loopback port');
const credential=Buffer.from('Bearer '+token),maxBody=1048576,maxResponse=262144;
const routes=new Map([
  ['/allocate-packs',[validateAllocationStrategyRequest,validateAllocationStrategyResponse]],
  ['/allocate-stock',[validateStockAllocationStrategyRequest,validateStockAllocationStrategyResponse]],
  ['/allocate-external',[validateExternalAllocationStrategyRequest,validateExternalAllocationStrategyResponse]],
]);
function decode(raw){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);let at=0,nodes=0;
  const invalid=()=>{throw Error('Invalid JSON');};
  const whitespace=()=>{while(/[\x20\t\r\n]/.test(text[at]??'x'))at++;};
  function string(){
    const start=at++;while(at<text.length){const character=text[at++];if(character==='\\'){at++;continue;}if(character==='"'){const value=JSON.parse(text.slice(start,at));if(!value.isWellFormed())invalid();return value;}}invalid();
  }
  function number(){
    const match=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));if(!match||match.index!==0)invalid();at+=match[0].length;
    let value=match[0],negative=value.startsWith('-');if(negative)value=value.slice(1);
    let [mantissa,exponent='0']=value.split(/[eE]/),digits=mantissa.replace('.','');
    if(!digits.replaceAll('0',''))return 0;
    let scale=Number(exponent);if(!Number.isInteger(scale)||Math.abs(scale)>maxBody)invalid();
    const dot=mantissa.indexOf('.');if(dot!==-1)scale-=mantissa.length-dot-1;
    digits=digits.replace(/^0+/,'');const trimmed=digits.replace(/0+$/,'');scale+=digits.length-trimmed.length;digits=trimmed;
    if(scale<0||digits.length+scale>16)invalid();const result=Number(digits+'0'.repeat(scale))*(negative?-1:1);if(!Number.isSafeInteger(result))invalid();return result;
  }
  function parse(depth=0){
    if(depth>16||++nodes>200000)invalid();whitespace();const character=text[at];
    if(character==='"')return string();
    if(character==='{'){
      at++;whitespace();const value=Object.create(null),keys=new Set();if(text[at]==='}'){at++;return value;}
      for(;;){if(text[at]!=='"')invalid();const key=string();if(keys.has(key))invalid();keys.add(key);whitespace();if(text[at++]!==':')invalid();value[key]=parse(depth+1);whitespace();const end=text[at++];if(end==='}')return value;if(end!==',')invalid();whitespace();}
    }
    if(character==='['){
      at++;whitespace();const value=[];if(text[at]===']'){at++;return value;}
      for(;;){value.push(parse(depth+1));whitespace();const end=text[at++];if(end===']')return value;if(end!==',')invalid();}
    }
    for(const [literal,value] of [['null',null],['true',true],['false',false]])if(text.startsWith(literal,at)){at+=literal.length;return value;}
    return number();
  }
  const result=parse();whitespace();if(at!==text.length)invalid();return result;
}
function reply(response,status,value){
  let body=Buffer.from(JSON.stringify(value));if(body.length>maxResponse){status=500;body=Buffer.from('{}');}
  response.writeHead(status,{'content-type':'application/json','content-length':body.length,'cache-control':'no-store',connection:'close'});response.end(body);
}
const server=createServer({maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000},async(request,response)=>{
  request.setTimeout(5000,()=>request.destroy());
  const values=name=>request.rawHeaders.filter((_,index)=>index%2===0&&request.rawHeaders[index].toLowerCase()===name).length;
  const supplied=Buffer.from(request.headers.authorization??'');
  if(values('authorization')!==1||supplied.length!==credential.length||!timingSafeEqual(supplied,credential)){request.resume();reply(response,401,{});return;}
  const length=request.headers['content-length'];
  const validators=routes.get(request.url);
  if(request.method!=='POST'||!validators||request.headers['transfer-encoding']||values('content-length')!==1||values('content-type')!==1||!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??'')||!/^\d+$/.test(length??'')||Number(length)<1||Number(length)>maxBody){request.resume();reply(response,400,{});return;}
  const [validateRequest,validateResponse]=validators;
  let value;
  try{
    const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>maxBody)throw Error('Request limit');chunks.push(chunk);}if(size!==Number(length))throw Error('Request length');
    value=validateRequest(decode(Buffer.concat(chunks)));
    if(value.providerId!==providerId)throw Error('Provider identity');
  }catch{if(!response.destroyed)reply(response,400,{});return;}
  const identity=Object.fromEntries(Object.entries(value).filter(([key])=>key!=='context'));
  try{reply(response,200,validateResponse({...identity,status:'planned',allocations:planAllocation(value.context)}));}
  catch{reply(response,503,validateResponse({...identity,status:'error',errorCode:'unavailable'}));}
});
server.maxConnections=32;server.maxRequestsPerSocket=1;server.keepAliveTimeout=1;
server.on('error',()=>{process.stderr.write('Allocation provider unavailable\n');process.exitCode=1;});
server.listen(Number(port),'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\n'));
