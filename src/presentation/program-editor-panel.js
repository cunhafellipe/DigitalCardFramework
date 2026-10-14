import {mountProgram} from './program.js';
import {editorDisplayProfile,validateEditorFields,projectEditorSelection,validateEditorProposal,applyEditorPatch} from './editor-display.js';
import {ensure} from './data.js';
import {createLocalization} from '../localization.js';
/** Reviewed panel programs receive selection data and propose changes for native review. */
export function createProgramEditorPanels({registry,panels=[],maxActivePrograms=8,handshakeTimeout=5000,maxMessagesPerSecond=30}={}){
  ensure(registry?.get&&Array.isArray(panels)&&panels.length<=16&&Number.isInteger(maxActivePrograms)&&maxActivePrograms>=1&&maxActivePrograms<=16,'EDITOR_PANEL','Invalid editor panel registry');
  const installed=panels.map(panel=>{ensure(panel&&Object.keys(panel).every(key=>['id','programId','fields'].includes(key))&&typeof panel.id==='string'&&/^[a-z][a-z0-9.-]{1,99}$/.test(panel.id)&&typeof panel.programId==='string','EDITOR_PANEL','Invalid editor panel');return Object.freeze({...panel,fields:Object.freeze(validateEditorFields(panel.fields))});});
  ensure(new Set(installed.map(panel=>panel.id)).size===installed.length,'EDITOR_PANEL','Duplicate editor panel');
  const enabled=new Map(installed.map(panel=>[panel.id,true])),mounts=new Set();let disposed=false,active=0;
  function mount({root,getSelection,edit,run=fn=>Promise.resolve().then(fn),report=()=>{},localization=createLocalization()}){
    const selection=getSelection(),section=root.ownerDocument.createElement('section'),instances=[];let closed=false;root.append(section);section.className='dcs-program-editor-panels';
    const current=snapshot=>!disposed&&!closed&&getSelection()?.project===selection?.project&&getSelection()?.node===selection?.node&&getSelection()?.side===selection?.side&&selection.project.getRevision()===snapshot.revision;
    function render(){for(const instance of instances.splice(0))instance.dispose();section.replaceChildren();if(disposed||closed||!selection)return;
      for(const panel of installed){if(!enabled.get(panel.id))continue;
        const container=root.ownerDocument.createElement('fieldset'),legend=root.ownerDocument.createElement('legend'),frameRoot=root.ownerDocument.createElement('div'),review=root.ownerDocument.createElement('section'),fallback=root.ownerDocument.createElement('p');
        const entry=registry.get(panel.programId);legend.textContent=entry?.title??panel.id;container.dataset.programEditorPanel=panel.id;frameRoot.style.height='300px';frameRoot.inert=true;fallback.textContent=localization.text('editorPanel.fallback');container.append(legend,frameRoot,fallback,review);section.append(container);let bridge,terminal=false,pending,admitted=false;
        const stop=()=>{terminal=true;pending=undefined;bridge?.dispose();bridge=undefined;if(admitted){active--;admitted=false;}review.replaceChildren();frameRoot.inert=true;frameRoot.replaceChildren();fallback.hidden=false;};
        const instance={dispose(){stop();container.remove();}};instances.push(instance);
        try{
          ensure(active<maxActivePrograms,'EDITOR_PANEL','Editor panel capacity reached');
          const snapshot=projectEditorSelection(selection,panel.fields);ensure(entry?.editorDisplay?.profile===editorDisplayProfile,'EDITOR_PANEL','Editor panel is not granted');
          active++;admitted=true;bridge=mountProgram(frameRoot,{programId:panel.programId,registry,editorDisplay:snapshot,handshakeTimeout,maxMessagesPerSecond,onSessionEnd(){pending=undefined;review.replaceChildren();frameRoot.inert=true;},onReady(){if(!terminal){fallback.hidden=true;frameRoot.inert=false;}},onError(){stop();report(localization.text('editorPanel.failure'));},onEditorProposal(proposal){
            if(terminal||!enabled.get(panel.id)||!current(snapshot)||getSelection().locked)return;
            pending=validateEditorProposal(proposal,snapshot);const captured=pending;review.replaceChildren();const heading=root.ownerDocument.createElement('h4'),details=root.ownerDocument.createElement('pre'),apply=root.ownerDocument.createElement('button'),cancel=root.ownerDocument.createElement('button');heading.textContent=localization.text('editorPanel.review');details.textContent=JSON.stringify(pending.patch,null,2);apply.type=cancel.type='button';apply.textContent=localization.text('editorPanel.apply');cancel.textContent=localization.text('editorPanel.cancel');review.append(heading,details,apply,cancel);
            cancel.onclick=()=>{if(pending!==captured)return;pending=undefined;review.replaceChildren();};
            apply.onclick=()=>{if(!apply.isConnected||pending!==captured)return;pending=undefined;apply.disabled=true;Promise.resolve(run(async()=>{ensure(!terminal&&enabled.get(panel.id)&&current(snapshot)&&!getSelection().locked,'EDITOR_PANEL','Editor proposal is stale');validateEditorProposal(captured,snapshot);await edit(()=>{ensure(!terminal&&current(snapshot)&&!getSelection().locked,'EDITOR_PANEL','Editor proposal is stale');applyEditorPatch(selection.node,captured.patch);});})).catch(()=>{if(!closed)report(localization.text('editorPanel.rejected'));});};
          }});
        }catch{stop();report(localization.text('editorPanel.failure'));}
      }
    }
    const mounted={render,dispose(){if(closed)return;closed=true;for(const instance of instances.splice(0))instance.dispose();section.remove();mounts.delete(mounted);}};mounts.add(mounted);render();return mounted;
  }
  return Object.freeze({mount,setEnabled(id,value){ensure(!disposed&&enabled.has(id)&&typeof value==='boolean','EDITOR_PANEL','Invalid editor panel enablement');enabled.set(id,value);for(const mounted of mounts)mounted.render();},dispose(){if(disposed)return;disposed=true;for(const mounted of [...mounts])mounted.dispose();}});
}
