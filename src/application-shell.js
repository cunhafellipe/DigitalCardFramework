export const applicationShellProfile='dc.application-shell@1';
export const applicationShellLimits=Object.freeze({bytes:32768,nodes:64,depth:8,text:500,sections:64,groups:16});
const regions=['account','balances','statistics','navigation','status','recovery','content','overlays'];
const tokens=Object.freeze(['bg','panel','text','muted','accent','border','button-text','card-text']);
const align=Object.freeze(['start','center','end','stretch']),justify=Object.freeze(['start','center','end','space-between']);
const layoutProperties={gap:{type:'integer',minimum:0,maximum:64},padding:{type:'integer',minimum:0,maximum:64},align:{enum:align},justify:{enum:justify},columns:{type:'integer',minimum:1,maximum:12},grow:{enum:[0,1]},color:{enum:tokens},background:{enum:tokens}};
const layoutSchema={type:'object',additionalProperties:false,properties:layoutProperties};
const responsiveSchema={...layoutSchema,properties:{...layoutProperties,flow:{enum:['row','column','grid']}}};
const textSchema={type:'string',maxLength:500};
const common={layout:{$ref:'#/$defs/layout'},narrow:{$ref:'#/$defs/responsive'},wide:{$ref:'#/$defs/responsive'}};
export const applicationShellSchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://digital-card.dev/schemas/application-shell.schema.json',
  title:'Portable application shell',description:'At most 32 KiB UTF-8 JSON, 64 tree nodes and depth 8. Exactly one content, status, recovery and overlays region. Overlays is the final direct child of the root container. Regions are unique. Static strings must be well-formed Unicode.',
  type:'object',additionalProperties:false,required:['profile','tree'],properties:{profile:{const:applicationShellProfile},tree:{$ref:'#/$defs/container'}},
  $defs:{layout:layoutSchema,responsive:responsiveSchema,
    entry:{type:'object',additionalProperties:false,required:['section'],properties:{section:{type:'string',minLength:1,maxLength:80,pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]*$'},label:textSchema}},
    group:{type:'object',additionalProperties:false,required:['entries'],properties:{label:textSchema,entries:{type:'array',minItems:1,maxItems:64,items:{$ref:'#/$defs/entry'}}}},
    container:{type:'object',additionalProperties:false,required:['type','children'],properties:{type:{enum:['row','column','grid']},children:{type:'array',minItems:1,maxItems:64,items:{$ref:'#/$defs/node'}},...common}},
    static:{oneOf:[{type:'object',additionalProperties:false,required:['type','text'],properties:{type:{const:'text'},text:textSchema,...common}},{type:'object',additionalProperties:false,required:['type','text'],properties:{type:{const:'heading'},text:textSchema,level:{type:'integer',minimum:2,maximum:6},...common}}]},
    region:{oneOf:[{type:'object',additionalProperties:false,required:['type','name'],properties:{type:{const:'region'},name:{enum:regions.filter(name=>!['navigation','overlays'].includes(name))},...common}},{type:'object',additionalProperties:false,required:['type','name'],properties:{type:{const:'region'},name:{const:'navigation'},...common,arrangement:{enum:['horizontal','vertical']},groups:{type:'array',maxItems:16,items:{$ref:'#/$defs/group'}}}},{type:'object',additionalProperties:false,required:['type','name'],properties:{type:{const:'region'},name:{const:'overlays'}}}]},
    node:{oneOf:[{$ref:'#/$defs/container'},{$ref:'#/$defs/static'},{$ref:'#/$defs/region'}]}}
};
function invalid(){throw new TypeError('Invalid portable application shell');}
function record(value,allowed,required=[]){
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!allowed.includes(key)||!Object.hasOwn(descriptors[key],'value')||!descriptors[key].enumerable)||required.some(key=>!Object.hasOwn(descriptors,key)))invalid();
  return value;
}
function array(value,max,min=0){
  if(!Array.isArray(value)||value.length<min||value.length>max)invalid();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).length!==value.length+1)invalid();
  for(let i=0;i<value.length;i++)if(!Object.hasOwn(descriptors[i]??{},'value')||!descriptors[i].enumerable)invalid();
  return value;
}
function literal(value){if(typeof value!=='string'||Array.from(value).length>500||!value.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))invalid();return value;}
function layout(value,responsive=false){
  record(value,[...Object.keys(layoutProperties),...(responsive?['flow']:[])]);
  for(const [key,item]of Object.entries(value)){
    if(['gap','padding','columns','grow'].includes(key)){const min=key==='columns'?1:0,max=key==='columns'?12:key==='grow'?1:64;if(!Number.isInteger(item)||item<min||item>max)invalid();}
    else if(!(key==='flow'?['row','column','grid']:key==='align'?align:key==='justify'?justify:tokens).includes(item))invalid();
  }
}
export function validateApplicationShell(value){
  record(value,['profile','tree'],['profile','tree']);if(value.profile!==applicationShellProfile)invalid();
  let count=0,entryCount=0;const seen=new Set(),mounted=new Set(),entries=new Set();
  function visit(node,depth){
    if(depth>8||++count>64||seen.has(node))invalid();seen.add(node);
    record(node,['type','children','text','level','name','layout','narrow','wide','arrangement','groups'],['type']);
    const container=['row','column','grid'].includes(node.type),staticNode=['heading','text'].includes(node.type);
    const permitted=container?['type','children','layout','narrow','wide']:staticNode?['type','text','layout','narrow','wide',...(node.type==='heading'?['level']:[])]:node.type==='region'?['type','name','layout','narrow','wide',...(node.name==='navigation'?['arrangement','groups']:[])]:[];
    if(!permitted.length||Object.keys(node).some(key=>!permitted.includes(key)))invalid();
    for(const key of ['layout','narrow','wide'])if(node[key]!==undefined)layout(node[key],key!=='layout');
    if(container){array(node.children,64,1);for(const child of node.children)visit(child,depth+1);}
    else if(staticNode){literal(node.text);if(node.level!==undefined&&(!Number.isInteger(node.level)||node.level<2||node.level>6))invalid();}
    else{
      if(!regions.includes(node.name)||mounted.has(node.name))invalid();mounted.add(node.name);
      if(node.name==='overlays'&&Object.keys(node).length!==2)invalid();
      if(node.arrangement!==undefined&&!['horizontal','vertical'].includes(node.arrangement))invalid();
      if(node.groups!==undefined)for(const group of array(node.groups,16)){
        record(group,['label','entries'],['entries']);if(group.label!==undefined)literal(group.label);
        for(const entry of array(group.entries,64,1)){
          if(++entryCount>64)invalid();record(entry,['section','label'],['section']);
          if(typeof entry.section!=='string'||entry.section.length>80||!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(entry.section)||entries.has(entry.section))invalid();entries.add(entry.section);
          if(entry.label!==undefined)literal(entry.label);
        }
      }
    }
  }
  visit(value.tree,1);
  if(!['row','column','grid'].includes(value.tree.type)||!['status','recovery','content','overlays'].every(name=>mounted.has(name))||value.tree.children.at(-1)?.name!=='overlays'||value.tree.children.at(-1)?.type!=='region')invalid();
  if(new TextEncoder().encode(JSON.stringify(value)).length>32768)invalid();
  return JSON.parse(JSON.stringify(value));
}
export async function loadApplicationShell(url,{fetch:request=globalThis.fetch,signal}={}){
  const parsed=new URL(url,globalThis.document?.baseURI);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)invalid();
  const response=await request(parsed.href,{signal,headers:{accept:'application/json'}});
  if(!response.ok||Number(response.headers.get('content-length'))>32768)invalid();
  if(!response.body?.getReader)invalid();const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{while(true){if(signal?.aborted)throw signal.reason??new Error('Shell load aborted');const result=await reader.read();if(result.done)break;bytes+=result.value.byteLength;if(bytes>32768)invalid();chunks.push(result.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  return validateApplicationShell(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)));
}
let shellSequence=0;
const node=(tag,className)=>{const item=document.createElement(tag);if(className)item.className=className;return item;};
function declarations(style,flow){
  const values=[];if(flow)values.push('display:'+(flow==='grid'?'grid':'flex'),...(flow==='grid'?[]:['flex-direction:'+flow]));
  for(const [key,value]of Object.entries(style??{})){
    if(key==='flow')continue;
    values.push(key==='columns'?'grid-template-columns:repeat('+value+',minmax(0,1fr))':key==='align'?'align-items:'+(value==='start'||value==='end'?'flex-'+value:value):key==='justify'?'justify-content:'+(value==='start'||value==='end'?'flex-'+value:value):key==='grow'?'flex:'+value+' 1 0%':key==='color'||key==='background'?key+':var(--dc-'+value+')':key+':'+value+'px');
  }return values.join(';');
}
export function createApplicationShell({root,navigation,navigate,localization}){
  const id='dc-shell-'+(++shellSequence),t=localization.text,number=localization.number;
  const native={account:node('div','dc-dashboard-heading'),balances:node('div','dc-wallet-strip'),statistics:node('div','dc-account-stats'),navigation:node('nav','dc-nav'),status:node('div','dc-status'),recovery:node('div','dc-recovery'),content:node('div','dc-content'),overlays:node('div','dc-overlays')};
  for(const [name,item]of Object.entries(native))item.dataset.dcRegion=name;
  native.status.setAttribute('role','status');native.status.setAttribute('aria-live','polite');native.navigation.setAttribute('aria-label',t('nav.features'));
  const style=node('style'),dashboard=node('div','dc-dashboard'),buttons=new Map(),groups=new Map();let wrapper,profile=null,navSpec=null,disposed=false,lastModel;
  root.append(style);
  function compose(manifest){
    if(disposed)return false;
    const focus=document.activeElement;
    for(const [name,item]of Object.entries(native))if(name!=='overlays')item.remove();wrapper?.remove();dashboard.remove();
    profile=manifest;navSpec=null;style.textContent='';root.classList.toggle(id,!!manifest);
    if(!native.overlays.isConnected)root.append(native.overlays);
    if(!manifest){dashboard.append(native.account,native.balances,native.statistics);dashboard.style.display=navigation==='tabs'?'':'none';for(const item of [dashboard,native.navigation,native.status,native.recovery,native.content])root.insertBefore(item,native.overlays);}
    else{
      const rules=[];let index=0;
      function build(spec){
        if(spec.name==='overlays')return null;
        const indexId=++index,item=spec.type==='region'?native[spec.name]:node(spec.type==='heading'?'h'+(spec.level??2):spec.type==='text'?'p':'div');
        item.dataset.dcShellNode=String(indexId);if(spec.type==='region'&&spec.name==='navigation')navSpec=spec;
        if(spec.text!==undefined)item.textContent=spec.text;
        const container=['row','column','grid'].includes(spec.type),selector='[data-dc-shell="'+id+'"] [data-dc-shell-node="'+indexId+'"]';
        rules.push(selector+'{min-width:0;max-width:100%;'+declarations(spec.layout,container?spec.type:undefined)+'}');
        for(const [key,query]of [['narrow','max-width:760px'],['wide','min-width:761px']])if(spec[key])rules.push('@media('+query+'){'+selector+'{'+declarations(spec[key],spec[key].flow)+'}}');
        for(const child of spec.children??[]){const result=build(child);if(result)item.append(result);}return item;
      }
      wrapper=node('div');wrapper.dataset.dcShell=id;wrapper.className='dc-application-shell';wrapper.append(build(manifest.tree));
      style.textContent=rules.join('\n')+'\n[data-dc-shell="'+id+'"] .dc-nav[data-arrangement="vertical"]{flex-direction:column;overflow:visible;align-items:stretch}[data-dc-shell="'+id+'"] .dc-shell-nav-group{display:flex;gap:4px;align-items:center;flex-wrap:wrap}[data-dc-shell="'+id+'"] .dc-nav[data-arrangement="vertical"] .dc-shell-nav-group{flex-direction:column;align-items:stretch}[data-dc-shell="'+id+'"] .dc-shell-nav-group:empty,[data-dc-shell="'+id+'"] [data-dc-region="recovery"]:empty{display:none}[data-dc-shell="'+id+'"] [data-dc-region="statistics"]{display:flex;flex-wrap:wrap}';
      root.insertBefore(wrapper,native.overlays);
    }
    for(const item of Object.values(native))if(!manifest)delete item.dataset.dcShellNode;
    style.textContent+='\n.dc-root [data-dc-region][hidden]{display:none!important}.dc-root .dc-overlays{display:contents}.dc-root .dc-recovery:empty{display:none}.dc-root.dc-with-nav>.dc-recovery:not(:empty){grid-column:2;grid-row:3}.dc-root.dc-with-nav:has(>.dc-recovery:not(:empty))>.dc-content{grid-row:4}';
    if(manifest)style.textContent+='\n.dc-root.dc-with-nav.'+id+'{display:block}.dc-root.'+id+' [data-dc-shell="'+id+'"]{width:100%;min-width:0}.dc-root.'+id+' [data-dc-shell="'+id+'"] [data-dc-region]{grid-area:auto}.dc-root.'+id+' [data-dc-shell="'+id+'"] .dc-nav{position:static;flex-direction:row;align-self:stretch;flex-wrap:wrap}.dc-root.'+id+' [data-dc-shell="'+id+'"] .dc-nav[data-arrangement="vertical"]{flex-direction:column}';
    if(lastModel)update(lastModel);
    if(focus?.isConnected&&root.contains(focus)&&document.activeElement!==focus)focus.focus();return profile===manifest;
  }
  function update({model,sections,views,labels,active,userName}){
    if(disposed)return;lastModel={model,sections,views,labels,active,userName};
    const permitted=sections.filter(name=>typeof name==='string'&&Object.hasOwn(views,name)&&typeof views[name]==='function');
    if(profile&&navigation==='tabs'&&permitted.length>=2&&!navSpec){compose(null);return;}
    const chrome=navigation==='tabs';
    native.account.hidden=!chrome;native.balances.hidden=!chrome||!sections.includes('wallet');native.statistics.hidden=!chrome;
    if(chrome){
      native.account.replaceChildren(Object.assign(node('span','dc-eyebrow'),{textContent:t('account.heading')}),Object.assign(node('strong'),{textContent:model.me.displayName??userName(model.me.userId)}));
      native.balances.replaceChildren(...model.catalog.currencies.map(currency=>{const item=node('div');item.append(Object.assign(node('strong'),{textContent:number(model.wallet[currency.id]??0)}),Object.assign(node('span','dc-muted'),{textContent:currency.name}));return item;}));
      native.statistics.replaceChildren(Object.assign(node('span'),{textContent:t('account.cards',{count:model.inventory.length})}));if(sections.includes('packs'))native.statistics.append(Object.assign(node('span'),{textContent:t('account.sealedPacks',{count:model.packs.filter(pack=>!pack.openedAt).length})}));
    }
    native.navigation.hidden=navigation!=='tabs'&&!navSpec;
    native.navigation.dataset.arrangement=navSpec?.arrangement??'horizontal';
    const plans=[],claimed=new Set();
    for(const [index,group]of (navSpec?.groups??[]).entries()){
      const items=group.entries.filter(entry=>permitted.includes(entry.section));for(const entry of items)claimed.add(entry.section);
      if(items.length)plans.push({key:String(index),label:group.label,items});
    }
    const rest=permitted.filter(name=>!claimed.has(name)).map(section=>({section}));if(rest.length)plans.push({key:'rest',items:rest});
    const desired=[];
    if(!native.navigation.hidden)for(const plan of plans){
      let parent=native.navigation;
      if(navSpec?.groups?.length){if(!groups.has(plan.key))groups.set(plan.key,node('div','dc-shell-nav-group'));parent=groups.get(plan.key);parent.setAttribute('role','group');if(plan.label!==undefined)parent.setAttribute('aria-label',plan.label);else parent.removeAttribute('aria-label');desired.push(parent);}
      const groupNodes=[];
      for(const entry of plan.items){
        const name=entry.section;if(!buttons.has(name)){const button=node('button','dc-nav-item');button.type='button';button.dataset.view=name;button.addEventListener('click',()=>navigate(name));buttons.set(name,button);}
        const button=buttons.get(name),text=entry.label??labels[name]??name,count=name==='packs'?model.packs.filter(pack=>!pack.openedAt).length:0;
        const signature=JSON.stringify([text,count]);if(button.dataset.labelState!==signature){button.textContent=text;if(count)button.append(Object.assign(node('span','dc-nav-count'),{textContent:number(count)}));button.dataset.labelState=signature;}
        button.setAttribute('aria-current',active===name?'page':'false');groupNodes.push(button);
      }
      if(parent!==native.navigation)reconcile(parent,groupNodes);else desired.push(...groupNodes);
    }
    reconcile(native.navigation,desired);
  }
  function reconcile(parent,desired){for(const child of [...parent.children])if(!desired.includes(child))child.remove();for(let index=0;index<desired.length;index++)if(parent.children[index]!==desired[index])parent.insertBefore(desired[index],parent.children[index]??null);}
  compose(null);
  return {regions:native,install(value){try{return compose(value===null?null:validateApplicationShell(value));}catch{compose(null);return false;}},update,dispose(){disposed=true;root.classList.remove(id);style.remove();wrapper?.remove();dashboard.remove();for(const item of Object.values(native))item.remove();buttons.clear();groups.clear();lastModel=null;}};
}
