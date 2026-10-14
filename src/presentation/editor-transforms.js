import {ensure,canonical,parseJSON,text,utf8} from './data.js';
import {buildPackage,importPackage,readZip,writeZip,browserResolver} from './package.js';
import {createPlayerStage} from './player.js';

export const editorTransformProtocol='digital-card-editor-transform@1';
export const editorTransformLimits=Object.freeze({headerBytes:65536,parameterBytes:16384,sourceBytes:64*1024*1024,resultBytes:80*1024*1024,retainedBytes:128*1024*1024,newAssets:32,assetBytes:4*1024*1024,newAssetBytes:16*1024*1024,assetPixels:4*1024*1024,newAssetPixels:16*1024*1024});
const identity={requestId:{type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},toolId:{type:'string',minLength:2,maxLength:100,pattern:'^[a-z][a-z0-9.-]+$'},toolVersion:{type:'string',maxLength:32,pattern:'^[0-9]+\\.[0-9]+\\.[0-9]+$'},sourceDigest:{type:'string',pattern:'^sha256:[0-9a-f]{64}$'}};
const grantSchema={type:'object',additionalProperties:false,required:['faces','newRasterAssets','capabilities'],properties:{faces:{type:'array',minItems:1,maxItems:2,uniqueItems:true,items:{enum:['front','back']}},newRasterAssets:{type:'boolean'},capabilities:{type:'array',maxItems:16,uniqueItems:true,items:{type:'string',maxLength:100}}}};
export const editorTransformSchema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://digital-card.invalid/editor-transform/v1',oneOf:[{type:'object',additionalProperties:false,required:['protocol','kind',...Object.keys(identity),'parameters','grants'],properties:{protocol:{const:editorTransformProtocol},kind:{const:'request'},...identity,parameters:{type:'object',maxProperties:16,additionalProperties:{type:['string','number','boolean']}},grants:grantSchema}},{type:'object',additionalProperties:false,required:['protocol','kind',...Object.keys(identity)],properties:{protocol:{const:editorTransformProtocol},kind:{const:'result'},...identity}}]};
const fail=(condition,message='Invalid editor transform')=>ensure(condition,'EDITOR_TRANSFORM',message);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const name=value=>typeof value==='string'&&value.length>=2&&value.length<=100&&/^[a-z][a-z0-9.-]+(?![\s\S])/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const label=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.isWellFormed()&&!/[\u0000-\u001f\u007f]/u.test(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function data(value,maxBytes=editorTransformLimits.headerBytes){
  let count=0;const seen=new Set();
  function visit(item,depth){fail(++count<=10000&&depth<=16);if(item===null||typeof item==='boolean')return;if(typeof item==='number'){fail(Number.isFinite(item));return;}if(typeof item==='string'){fail(item.isWellFormed());return;}fail(Array.isArray(item)||plain(item));fail(!seen.has(item));seen.add(item);for(const key of Reflect.ownKeys(item)){if(Array.isArray(item)&&key==='length')continue;const descriptor=Object.getOwnPropertyDescriptor(item,key);fail(typeof key==='string'&&!['constructor','prototype','__proto__'].includes(key)&&descriptor.enumerable&&Object.hasOwn(descriptor,'value'));if(Array.isArray(item))fail(/^(0|[1-9][0-9]*)$/.test(key)&&Number(key)<item.length);visit(descriptor.value,depth+1);}seen.delete(item);}
  visit(value,0);fail(utf8(JSON.stringify(value)).length<=maxBytes);
}
function grants(value){
  fail(exact(value,['faces','newRasterAssets','capabilities'])&&Array.isArray(value.faces)&&value.faces.length>=1&&value.faces.length<=2&&new Set(value.faces).size===value.faces.length&&value.faces.every(face=>['front','back'].includes(face))&&typeof value.newRasterAssets==='boolean'&&Array.isArray(value.capabilities)&&value.capabilities.length<=16&&new Set(value.capabilities).size===value.capabilities.length&&value.capabilities.every(capability=>typeof capability==='string'&&capability.length<=100&&/^[a-zA-Z][a-zA-Z0-9.-]*@\d+\.\d+(?![\s\S])/.test(capability)));
}
export function validateEditorTransformHeader(value){
  data(value);fail(plain(value));const keys=['protocol','kind',...Object.keys(identity)];if(value.kind==='request')keys.push('parameters','grants');
  fail(exact(value,keys)&&value.protocol===editorTransformProtocol&&['request','result'].includes(value.kind)&&typeof value.requestId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.requestId)&&name(value.toolId)&&typeof value.toolVersion==='string'&&value.toolVersion.length<=32&&/^\d+\.\d+\.\d+(?![\s\S])/.test(value.toolVersion)&&typeof value.sourceDigest==='string'&&/^sha256:[0-9a-f]{64}$/.test(value.sourceDigest));
  if(value.kind==='request'){data(value.parameters,editorTransformLimits.parameterBytes);fail(plain(value.parameters)&&Object.keys(value.parameters).length<=16&&Object.entries(value.parameters).every(([key,item])=>name(key)&&['string','number','boolean'].includes(typeof item)));grants(value.grants);}
  return freeze(structuredClone(value));
}
function tool(value){
  data(value);fail(exact(value,['id','version','title','parameters','grants'])&&name(value.id)&&label(value.title,100)&&typeof value.version==='string'&&value.version.length<=32&&/^\d+\.\d+\.\d+(?![\s\S])/.test(value.version)&&plain(value.parameters)&&Object.keys(value.parameters).length<=16);
  const normalized=structuredClone(value);fail(plain(normalized.grants));normalized.grants.capabilities??=[];grants(normalized.grants);
  for(const [key,rule]of Object.entries(normalized.parameters)){
    fail(name(key)&&plain(rule)&&label(rule.label,160)&&['number','string','boolean'].includes(rule.type)&&Object.hasOwn(rule,'default'));
    const fields=rule.type==='number'?['minimum','maximum','step']:rule.type==='string'?['maxLength']:[];
    fail(Object.keys(rule).every(key=>['label','type','default',...fields].includes(key)));
    if(rule.type==='number'){rule.minimum??=-1000000;rule.maximum??=1000000;rule.step??=1;fail(Number.isFinite(rule.minimum)&&Number.isFinite(rule.maximum)&&rule.minimum<rule.maximum&&Math.abs(rule.minimum)<=1000000&&Math.abs(rule.maximum)<=1000000&&Number.isFinite(rule.step)&&rule.step>0&&rule.step<=1000000);}
    if(rule.type==='string'){rule.maxLength??=4096;fail(Number.isInteger(rule.maxLength)&&rule.maxLength>=1&&rule.maxLength<=4096);}
  }
  parameters(normalized,{});return freeze(normalized);
}
function parameters(tool,input){
  data(input,editorTransformLimits.parameterBytes);fail(plain(input)&&Object.keys(input).every(key=>Object.hasOwn(tool.parameters,key)),'Invalid transform parameters');const output={};
  for(const [key,rule]of Object.entries(tool.parameters)){const value=Object.hasOwn(input,key)?input[key]:rule.default;fail(typeof value===rule.type,'Invalid transform parameter');if(rule.type==='number'){const steps=(value-rule.minimum)/rule.step;fail(Number.isFinite(value)&&value>=rule.minimum&&value<=rule.maximum&&Math.abs(steps-Math.round(steps))<=1e-8,'Transform parameter is outside its range');}if(rule.type==='string')fail(value.isWellFormed()&&value.length<=rule.maxLength,'Transform text is too long');output[key]=value;}
  return output;
}
const same=(left,right)=>canonical(left)===canonical(right);
const sameBytes=(left,right)=>left.length===right.length&&left.every((byte,index)=>byte===right[index]);
function tree(nodes){const result=new Map();function walk(list,path=[]){for(const [index,node]of list.entries()){const location=[...path,node.id],own={...node};delete own.children;result.set(node.id,{node,own,path,index});if(node.children)walk(node.children,location);}}walk(nodes);return result;}
function protectedLocks(source,result){
  const before=tree(source.nodes),after=tree(result.nodes);
  for(const row of before.values())if(row.node.locked){
    const candidate=after.get(row.node.id);fail(candidate&&same(row.node,candidate.node)&&same(row.path,candidate.path)&&row.index===candidate.index,'Transform changed a locked layer');
    for(const id of row.path){const ancestor=before.get(id),next=after.get(id);fail(next&&same(ancestor.own,next.own)&&same(ancestor.path,next.path)&&ancestor.index===next.index,'Transform changed a locked ancestor');}
  }
}
function proposal(source,result,allowed,project){
  const oldManifest=structuredClone(source.manifest),newManifest=structuredClone(result.manifest);delete oldManifest.assets;delete newManifest.assets;delete oldManifest.capabilities;delete newManifest.capabilities;fail(same(oldManifest,newManifest),'Transform changed protected card metadata');
  fail(same(source.manifest.capabilities.optional,result.manifest.capabilities.optional),'Transform changed optional capabilities');
  const oldCapabilities=source.manifest.capabilities.required,newCapabilities=result.manifest.capabilities.required;fail(oldCapabilities.every(capability=>newCapabilities.includes(capability))&&newCapabilities.every(capability=>oldCapabilities.includes(capability)||allowed.capabilities.includes(capability)),'Transform capability is not granted');
  const changes=[];for(const [path,scene]of source.scenes){const next=result.scenes.get(path);fail(next,'Transform removed a scene');const faces=Object.entries(source.manifest.faces).filter(([,face])=>face.scene===path).map(([side])=>side);if(!faces.every(face=>allowed.faces.includes(face)))fail(same(scene,next),'Transform changed an ungranted face');protectedLocks(scene,next);if(!same(scene,next))changes.push(path);}
  fail(result.scenes.size===source.scenes.size,'Transform added a scene');
  const added=[];let bytes=0,pixels=0;for(const asset of source.manifest.assets){const next=result.manifest.assets.find(row=>row.id===asset.id);fail(next&&same(asset,next)&&sameBytes(source.files.get(asset.path),result.files.get(next.path)),'Transform changed an existing asset');}
  for(const asset of result.manifest.assets)if(!source.manifest.assets.some(row=>row.id===asset.id)){
    fail(allowed.newRasterAssets&&['image/png','image/jpeg','image/webp'].includes(asset.mediaType)&&!project.manifest.assets.some(row=>row.id===asset.id||row.path===asset.path),'New transform asset is not granted');const count=asset.width*asset.height;bytes+=asset.bytes;pixels+=count;added.push(asset);fail(asset.bytes<=editorTransformLimits.assetBytes&&count<=editorTransformLimits.assetPixels&&added.length<=editorTransformLimits.newAssets&&bytes<=editorTransformLimits.newAssetBytes&&pixels<=editorTransformLimits.newAssetPixels,'New transform assets exceed their budget');
  }
  return {changes,added,capabilities:newCapabilities.filter(capability=>!oldCapabilities.includes(capability))};
}
async function publicSource(project){
  const exported=await project.export();const manifest=structuredClone(exported.manifest);
  if(manifest.authoring){const authoring=manifest.authoring,fields=(authoring.fields??[]).filter(field=>(field.visibility??'public')==='public'&&(field.scope??'card')!=='copy'),values={};for(const scope of ['card','variant']){values[scope]={};for(const field of fields)if((field.scope??'card')===scope&&Object.hasOwn(authoring.values?.[scope]??{},field.key))values[scope][field.key]=authoring.values[scope][field.key];}manifest.authoring={fields,values};}
  return buildPackage(manifest,exported.scenes,new Map(manifest.assets.map(asset=>[asset.path,exported.files.get(asset.path)])));
}
/** Host-installed offline tools. Imported archives can propose data, never install execution or permissions. */
export function createEditorTransforms(options={}){
  data(options);fail(plain(options)&&Object.keys(options).every(key=>['tools','maxOutstandingJobs'].includes(key)));const {tools=[],maxOutstandingJobs=4}=options;fail(Array.isArray(tools)&&tools.length<=16&&Number.isInteger(maxOutstandingJobs)&&maxOutstandingJobs>=1&&maxOutstandingJobs<=8);
  const registered=Object.freeze(tools.map(tool));fail(new Set(registered.map(item=>item.id)).size===registered.length);const registry=new Map(registered.map(item=>[item.id,{tool:item,enabled:true,epoch:0}])),jobs=new Map(),reviews=new WeakMap();let disposed=false,reviewing=false;
  const bytes=()=>[...jobs.values()].reduce((sum,job)=>sum+(job.source?.archive.length??0)+(job.result?.archive.length??0),0);
  function current(project,job){const config=registry.get(job.tool.id);fail(!disposed&&jobs.get(job.requestId)===job&&job.project===project&&project.getRevision()===job.revision&&config.enabled&&config.epoch===job.epoch,'Transform request is stale or unavailable');}
  function discard(requestId){const job=jobs.get(requestId);job?.preview?.dispose();if(job?.review)reviews.delete(job.review);jobs.delete(requestId);}
  return Object.freeze({tools:registered,
    async prepare(project,input){
      data(input);fail(plain(input));fail(exact(input,Object.hasOwn(input,'parameters')?['toolId','parameters']:['toolId']));const config=registry.get(input.toolId);fail(!disposed&&config?.enabled&&jobs.size<maxOutstandingJobs,'Transform tool is unavailable or its job limit is reached');const job={project,revision:project.getRevision(),tool:config.tool,epoch:config.epoch,requestId:crypto.randomUUID(),reviewGeneration:0};jobs.set(job.requestId,job);
      try{const values=parameters(job.tool,input.parameters??{}),source=await publicSource(project);current(project,job);fail(source.archive.length<=editorTransformLimits.sourceBytes&&bytes()+source.archive.length<=editorTransformLimits.retainedBytes,'Transform source exceeds its budget');job.source=source;job.header=validateEditorTransformHeader({protocol:editorTransformProtocol,kind:'request',requestId:job.requestId,toolId:job.tool.id,toolVersion:job.tool.version,sourceDigest:source.digest,parameters:values,grants:job.tool.grants});return {requestId:job.requestId,archive:writeZip(new Map([['request.json',utf8(canonical(job.header))],['source.dcard',source.archive]]))};}catch(error){discard(job.requestId);throw error;}
    },
    async review(project,requestId,archive){
      const job=jobs.get(requestId);fail(job?.source,'Unknown transform request');current(project,job);fail(!reviewing,'A transform result is already being reviewed');const generation=++job.reviewGeneration;
      job.preview?.dispose();if(job.review)reviews.delete(job.review);delete job.review;delete job.result;delete job.proposal;
      fail(archive instanceof Uint8Array&&archive.byteLength<=editorTransformLimits.resultBytes+editorTransformLimits.headerBytes+4096,'Transform result exceeds its budget');reviewing=true;
      try{
      const files=await readZip(archive.slice(),{entries:2,compressed:editorTransformLimits.resultBytes+editorTransformLimits.headerBytes+4096,inflated:editorTransformLimits.resultBytes+editorTransformLimits.headerBytes,entry:editorTransformLimits.resultBytes,ratio:200});current(project,job);fail(files.size===2&&files.has('result.json')&&files.has('result.dcard'),'Invalid transform result archive');const header=validateEditorTransformHeader(parseJSON(text(files.get('result.json')),{maxBytes:editorTransformLimits.headerBytes}));fail(header.kind==='result'&&['requestId','toolId','toolVersion','sourceDigest'].every(key=>header[key]===job.header[key]),'Transform result identity does not match');
      const result=await importPackage(files.get('result.dcard'),{limits:{compressed:editorTransformLimits.resultBytes,inflated:editorTransformLimits.resultBytes,entry:editorTransformLimits.resultBytes}});result.archive=files.get('result.dcard');current(project,job);fail(generation===job.reviewGeneration,'Transform review was superseded');const checked=proposal(job.source,result,job.tool.grants,project);fail(bytes()-(job.result?.archive.length??0)+result.archive.length<=editorTransformLimits.retainedBytes,'Transform results exceed the retained budget');
      job.result=result;job.proposal=checked;job.review=freeze({requestId,toolId:job.tool.id,title:job.tool.title,changes:{scenes:[...checked.changes],addedAssets:checked.added.map(asset=>asset.id)}});reviews.set(job.review,job);return job.review;
      }finally{reviewing=false;}
    },
    apply(project,review){
      const job=reviews.get(review);fail(job&&job.review===review,'Unknown transform review');current(project,job);const checked=proposal(job.source,job.result,job.tool.grants,project);
      project.edit(currentProject=>{current(project,job);for(const path of checked.changes)currentProject.scenes.set(path,structuredClone(job.result.scenes.get(path)));for(const asset of checked.added){currentProject.manifest.assets.push(structuredClone(asset));currentProject.assets.set(asset.path,job.result.files.get(asset.path).slice());}for(const capability of checked.capabilities)if(!currentProject.manifest.capabilities.required.includes(capability))currentProject.manifest.capabilities.required.push(capability);});discard(job.requestId);
    },discard,
    mountReview(project,review,options){
      const job=reviews.get(review);fail(job&&job.review===review,'Unknown transform review');current(project,job);fail(plain(options)&&Object.keys(options).every(key=>['root','side','adapters'].includes(key))&&Object.keys(options).every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(options,key),'value')),'Invalid transform preview options');const {root,side='front',adapters=[]}=options;fail(root?.ownerDocument&&['front','back'].includes(side)&&Array.isArray(adapters)&&adapters.length<=16,'Invalid transform preview');
      job.preview?.dispose();const resolver=browserResolver(job.result);let stage,closed=false;
      try{stage=createPlayerStage({root,adapters});const view=stage.mount(root,{resolver},{side,inputMode:'drag'}),preview={ready:view.ready.then(result=>{if(closed)return {mode:'cancelled'};current(project,job);return result;}),dispose(){if(closed)return;closed=true;stage.dispose();resolver.dispose();if(job.preview===preview)delete job.preview;}};job.preview=preview;return preview;}catch(error){stage?.dispose();resolver.dispose();throw error;}
    },
    setEnabled(id,enabled){const config=registry.get(id);fail(!disposed&&config&&typeof enabled==='boolean');if(config.enabled===enabled)return;config.enabled=enabled;config.epoch++;for(const job of [...jobs.values()])if(job.tool.id===id)discard(job.requestId);},
    dispose(){if(disposed)return;disposed=true;for(const requestId of [...jobs.keys()])discard(requestId);},
  });
}
