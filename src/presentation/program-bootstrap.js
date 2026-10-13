import {connectProgram} from './program.js';

// Opt-in entrypoint for reviewed HTML/CSS programs. No catalog or copy data is read.
const root=document.documentElement,events=new AbortController();
let disposed=false,bridge;
connectProgram({onInputs(inputs){
  if(disposed)return;
  for(const [key,value] of Object.entries({'--dc-tilt-x':inputs.tilt.x,'--dc-tilt-y':inputs.tilt.y,'--dc-reveal-progress':inputs.revealProgress,'--dc-flip-progress':inputs.flipProgress}))root.style.setProperty(key,String(value));
  root.dataset.dcSide=inputs.flipProgress>=.5?'back':'front';
}}).then(value=>{if(disposed)value.dispose();else bridge=value;});
document.addEventListener('click',event=>{
  const button=event.target.closest?.('button[data-dc-intent="select"]');
  if(!disposed&&button&&!button.disabled)bridge?.intent('select');
},{signal:events.signal});
window.addEventListener('pagehide',()=>{disposed=true;events.abort();bridge?.dispose();},{once:true});
