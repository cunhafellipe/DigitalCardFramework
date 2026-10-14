import {connectProgram} from './program.js';
/** Declarative reviewed HTML controls; all proposals require native host review. */
export async function bootstrapEditorPanel(root=document){
  let snapshot,connection,disposed=false;
  const controls=[...root.querySelectorAll('[data-editor-field]')];
  const baselines=new Map();
  const buttons=[...root.querySelectorAll('[data-editor-propose]')];
  for(const control of [...controls,...buttons])control.disabled=true;
  const events=new AbortController();
  function setAvailability(){for(const control of controls)control.disabled=!connection||!snapshot||snapshot.locked||!snapshot.fields.includes(control.dataset.editorField);for(const button of buttons)button.disabled=!connection||!snapshot||snapshot.locked;}
  function update(value){snapshot=value;for(const control of controls){const field=control.dataset.editorField;control.value=String(value.values[field]??'');baselines.set(control,control.value);}setAvailability();}
  for(const button of buttons)button.addEventListener('click',()=>{if(disposed||!connection||!snapshot||snapshot.locked)return;const patch={};for(const control of controls){const field=control.dataset.editorField;if(control.disabled||control.value===baselines.get(control))continue;if(!control.checkValidity())return;patch[field]=control.type==='number'||control.type==='range'?control.valueAsNumber:control.value;}if(Object.keys(patch).length)connection.editorProposal(snapshot.snapshotId,snapshot.revision,patch);},{signal:events.signal});
  connection=await connectProgram({onEditorDisplay:update});setAvailability();
  return {dispose(){disposed=true;events.abort();connection.dispose();}};
}
if(typeof document!=='undefined'&&[...document.querySelectorAll('script[type="module"][src]')].some(script=>script.src===import.meta.url))bootstrapEditorPanel(document);
