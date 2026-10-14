import {loadApplicationShell,validateApplicationShell,applicationShellProfile,type ApplicationShell,type ApplicationShellMountOptions,type ApplicationShellMounted} from '@digital-card/framework/application-shell';
const shell:ApplicationShell={profile:applicationShellProfile,tree:{type:'column',narrow:{flow:'row',gap:12},children:[{type:'region',name:'status'},{type:'region',name:'recovery'},{type:'region',name:'content'},{type:'region',name:'navigation',groups:[{label:'Explore',entries:[{section:'custom.workspace',label:'Workspace'}]}]},{type:'region',name:'overlays'}]}};
const options:ApplicationShellMountOptions={shell:loadApplicationShell('https://example.test/shell.json',{signal:new AbortController().signal})};
async function update(app:ApplicationShellMounted){const ready:boolean=await app.shellReady;const installed:boolean=await app.setShell(validateApplicationShell(shell));await app.setShell(null);return ready&&installed;}
void options;void update;
// @ts-expect-error Shell nodes do not accept authored HTML.
const html:ApplicationShell['tree']={type:'column',children:[],html:'<b>unsafe</b>'};
// @ts-expect-error Protected overlays cannot acquire layout fields.
const overlay:ApplicationShell['tree']={type:'column',children:[{type:'region',name:'overlays',layout:{padding:4}}]};
void html;void overlay;
