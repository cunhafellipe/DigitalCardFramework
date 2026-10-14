import { ensure, canonical, clamp } from "./data.js";
import {albumDisplayProfile,validateAlbumDisplay} from './album-display.js';
import {openerDisplayProfile,validateOpenerDisplay} from './opener-display.js';
import {editorDisplayProfile,validateEditorDisplay,validateEditorProposal} from './editor-display.js';
import {collectionDisplayProfile,validateCollectionDisplay,validateCollectionIntent,collectionIntents} from './collection-display.js';
/** Serve reviewed programs from this origin with these HTTP response headers. */
export function programHeaders(assetOrigin) {
  const origin = new URL(assetOrigin).origin;
  return {
    "Content-Security-Policy": `default-src 'none'; script-src 'self'; style-src 'self'; img-src ${origin} blob: data:; media-src ${origin} blob:; connect-src 'none'; font-src ${origin}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors https: http:; sandbox allow-scripts`,
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

/** Reviewed host registry only; arbitrary uploaded HTML is never executed by .dcard. */
export function mountProgram(
  root,
  {
    programId,
    registry,
    inputs = {},
    onIntent = () => {},
    maxMessagesPerSecond = 30,
    handshakeTimeout = 5000,
    onReady = () => {},
    onError = () => {},
    albumDisplay,
    onAlbumSelect = () => {},
    openerDisplay,
    onOpenerIntent = () => {},
    editorDisplay,
    onEditorProposal = () => {},
    onSessionEnd = () => {},
    collectionDisplay,
    onCollectionIntent = () => {},
  },
) {
  const entry = registry.get(programId);
  ensure(
    entry?.approved === true && entry.url && entry.version,
    "PROGRAM",
    "Program not approved",
  );
  const url = new URL(entry.url);
  ensure(
    url.origin !== location.origin &&
      ["http:", "https:"].includes(url.protocol),
    "PROGRAM_ORIGIN",
    "Program must use a separate HTTP origin",
  );
  ensure(Number.isInteger(maxMessagesPerSecond) && maxMessagesPerSecond >= 1 && maxMessagesPerSecond <= 1000 && Number.isInteger(handshakeTimeout) && handshakeTimeout >= 1 && handshakeTimeout <= 60000, "PROGRAM", "Invalid program limits");
  let session,
    disposed = false,
    hostVisible = true,
    lastInputs = filterInputs(inputs),lastAlbum,lastOpener;
  const prepareAlbum=value=>{const snapshot=validateAlbumDisplay(value);ensure(entry.albumDisplay?.profile===albumDisplayProfile&&Array.isArray(entry.albumDisplay.fields)&&snapshot.fields.every(field=>entry.albumDisplay.fields.includes(field)),'PROGRAM_CONTENT','Album display is not granted');return snapshot;};
  if(albumDisplay!==undefined)lastAlbum=prepareAlbum(albumDisplay);
  const prepareOpener=value=>{const snapshot=validateOpenerDisplay(value);ensure(entry.openerDisplay?.profile===openerDisplayProfile&&Array.isArray(entry.openerDisplay.fields)&&snapshot.fields.every(field=>entry.openerDisplay.fields.includes(field)),'PROGRAM_CONTENT','Opener display is not granted');return snapshot;};
  if(openerDisplay!==undefined)lastOpener=prepareOpener(openerDisplay);
  let lastEditor;
  const prepareEditor=value=>{const snapshot=validateEditorDisplay(value);ensure(entry.editorDisplay?.profile===editorDisplayProfile&&Array.isArray(entry.editorDisplay.fields)&&snapshot.fields.every(field=>entry.editorDisplay.fields.includes(field)),'PROGRAM_CONTENT','Editor display is not granted');return snapshot;};
  if(editorDisplay!==undefined)lastEditor=prepareEditor(editorDisplay);
  let lastCollection;
  const prepareCollection=value=>{const snapshot=validateCollectionDisplay(value);ensure(entry.collectionDisplay?.profile===collectionDisplayProfile&&Array.isArray(entry.collectionDisplay.fields)&&snapshot.fields.every(field=>entry.collectionDisplay.fields.includes(field)),'PROGRAM_CONTENT','Collection display is not granted');return snapshot;};
  if(collectionDisplay!==undefined)lastCollection=prepareCollection(collectionDisplay);
  const current = state => session === state && !disposed && hostVisible && !document.hidden;
  const send = message => { if (session?.ready && current(session)) session.port.postMessage(message); };
  const clean = () => {
    const state=session;session=null;
    if(!state)return;
    clearTimeout(state.timer);
    state.port.onmessage=null;state.port.close();
    if(!state.transferred)state.transfer.close();
    state.frame.onload=state.frame.onerror=null;state.frame.remove();
    onSessionEnd();
  };
  const fail=(state,code)=>{if(!current(state))return;clean();onError({code});};
  function start() {
    if (disposed || session || !hostVisible || document.hidden) return;
    const nonce = crypto.randomUUID(),
      channel = new MessageChannel();
    const frame = document.createElement("iframe"),state={frame,port:channel.port1,transfer:channel.port2,nonce,ready:false,transferred:false,windowStart:performance.now(),count:0};
    session=state;
    frame.title = entry.title ?? "Interactive card";
    frame.sandbox = "allow-scripts";
    frame.referrerPolicy = "no-referrer";
    frame.allow =
      "camera 'none'; microphone 'none'; geolocation 'none'; autoplay 'none'; payment 'none'";
    frame.src = url.href;
    Object.assign(frame.style, { border: "0", width: "100%", height: "100%" });
    state.port.onmessage = (event) => {
      if(!current(state))return;
      try {
        const message = event.data;
        ensure(
          canonical(message).length <= (message?.intent==='editor-propose'?32768:4096),
          "PROGRAM_MESSAGE",
          "Message too large",
        );
        const now = performance.now();
        if (now - state.windowStart > 1000) {
          state.windowStart = now;
          state.count = 0;
        }
        ensure(
          ++state.count <= maxMessagesPerSecond,
          "PROGRAM_RATE",
          "Program message rate exceeded",
        );
        ensure(
          message.nonce === nonce && message.version === 1,
          "PROGRAM_MESSAGE",
          "Invalid handshake",
        );
        if (message.type === "ready") {
          ensure(!state.ready, "PROGRAM_MESSAGE", "Duplicate handshake");
          state.ready = true;
          clearTimeout(state.timer);
          send({
            version: 1,
            type: "inputs",
            inputs: lastInputs,
          });
          if(lastAlbum)send({version:1,type:'content',content:lastAlbum});
          if(lastOpener)send({version:1,type:'content',content:lastOpener});
          if(lastEditor)send({version:1,type:'content',content:lastEditor});
          if(lastCollection)send({version:1,type:'content',content:lastCollection});
          onReady();
        } else {
          ensure(
            state.ready &&
              message.type === "intent" &&
              entry.intents?.includes(message.intent),
            "PROGRAM_INTENT",
            "Intent not allowed",
          );
          if(collectionIntents.includes(message.intent)){
            ensure(lastCollection,'PROGRAM_CONTENT','Collection display is required');
            const {version,type,nonce,...event}=message;
            const intent=validateCollectionIntent(event,lastCollection);
            if(intent.snapshotId!==lastCollection.snapshotId)return;
            onCollectionIntent(intent);
          }else if(message.intent==='editor-propose'){
            ensure(lastEditor&&Object.keys(message).sort().join(',')==='intent,nonce,patch,revision,snapshotId,type,version','PROGRAM_CONTENT','Invalid editor proposal');
            if(message.snapshotId!==lastEditor.snapshotId||message.revision!==lastEditor.revision)return;
            onEditorProposal(validateEditorProposal({snapshotId:message.snapshotId,revision:message.revision,patch:message.patch},lastEditor));
          }else if(message.intent==='select-item'){
            ensure(lastAlbum&&Object.keys(message).sort().join(',')==='handle,intent,nonce,snapshotId,type,version'&&message.snapshotId===lastAlbum.snapshotId&&lastAlbum.items.some(item=>item.handle===message.handle),'PROGRAM_CONTENT','Invalid album selection');
            onAlbumSelect({snapshotId:message.snapshotId,handle:message.handle});
          }else if(['opener-reveal','opener-skip','opener-replay','opener-inspect'].includes(message.intent)){
            const keys=message.intent==='opener-inspect'?'handle,intent,nonce,snapshotId,type,version':'intent,nonce,snapshotId,type,version';ensure(lastOpener&&Object.keys(message).sort().join(',')===keys&&typeof message.snapshotId==='string','PROGRAM_CONTENT','Invalid opener intent');
            if(message.snapshotId!==lastOpener.snapshotId)return;
            if(message.intent==='opener-inspect')ensure(lastOpener.items.slice(0,lastOpener.revealed).some(item=>item.handle===message.handle),'PROGRAM_CONTENT','Invalid opener selection');
            onOpenerIntent({intent:message.intent,snapshotId:message.snapshotId,...(message.intent==='opener-inspect'?{handle:message.handle}:{})});
          }else onIntent({ intent: message.intent });
        }
      } catch (error) {
        fail(state,["PROGRAM_MESSAGE","PROGRAM_RATE","PROGRAM_INTENT","PROGRAM_CONTENT"].includes(error.code)?error.code:"PROGRAM_MESSAGE");
      }
    };
    frame.onload = () => {
      if(!current(state)||state.transferred)return;
      try{frame.contentWindow.postMessage(
        { type: "dc.program.init", version: 1, nonce },
        "*",
        [state.transfer],
      );state.transferred=true;}catch{fail(state,"PROGRAM_LOAD");}
    };
    frame.onerror=()=>fail(state,"PROGRAM_LOAD");
    state.timer=setTimeout(()=>fail(state,"PROGRAM_TIMEOUT"),handshakeTimeout);
    root.append(frame);
  }
  const visibility = () => {
    if (document.hidden) clean();
    else start();
  };
  document.addEventListener("visibilitychange", visibility);
  start();
  return {
    setCollectionDisplay(value){if(disposed)return;lastCollection=prepareCollection(value);send({version:1,type:'content',content:lastCollection});},
    setEditorDisplay(value){if(disposed)return;lastEditor=prepareEditor(value);send({version:1,type:'content',content:lastEditor});},
    setAlbumDisplay(value){if(disposed)return;lastAlbum=prepareAlbum(value);send({version:1,type:'content',content:lastAlbum});},
    setOpenerDisplay(value){if(disposed)return;lastOpener=prepareOpener(value);send({version:1,type:'content',content:lastOpener});},
    setInputs(value) {
      if(disposed)return;
      lastInputs = filterInputs(value);
      send({ version: 1, type: "inputs", inputs: lastInputs });
    },
    setVisibility(value) {
      if(disposed)return;
      hostVisible = value === "visible";
      hostVisible ? start() : clean();
    },
    dispose() {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      clean();
    },
  };
}
function filterInputs(input) {
  return {
    tilt: {
      x: clamp(Number(input.tilt?.x) || 0, -1, 1),
      y: clamp(Number(input.tilt?.y) || 0, -1, 1),
    },
    revealProgress: clamp(Number(input.revealProgress) || 0),
    flipProgress: clamp(Number(input.flipProgress) || 0),
  };
}

/** Called by the reviewed program entrypoint; source + transferred port authenticate the parent. */
export function connectProgram({ onInputs = () => {},onAlbumDisplay=()=>{},onOpenerDisplay=()=>{},onEditorDisplay=()=>{},onCollectionDisplay=()=>{} } = {}) {
  return new Promise((resolve) => {
    const listener = (event) => {
      if (
        event.source !== parent ||
        event.data?.type !== "dc.program.init" ||
        event.data.version !== 1 ||
        typeof event.data.nonce !== "string" ||
        event.data.nonce.length > 100 ||
        event.ports.length !== 1
      )
        return;
      window.removeEventListener("message", listener);
      const port = event.ports[0],
        nonce = event.data.nonce;
      let disposed=false;
      port.onmessage = (e) => {
        if(disposed)return;
        if (e.data?.version === 1 && e.data.type === "inputs")
          onInputs(filterInputs(e.data.inputs ?? {}));
        else if(e.data?.version===1&&e.data.type==='content'){if(e.data.content?.profile===collectionDisplayProfile)onCollectionDisplay(validateCollectionDisplay(e.data.content));else if(e.data.content?.profile===editorDisplayProfile)onEditorDisplay(validateEditorDisplay(e.data.content));else if(e.data.content?.profile===openerDisplayProfile)onOpenerDisplay(validateOpenerDisplay(e.data.content));else onAlbumDisplay(validateAlbumDisplay(e.data.content));}
      };
      port.postMessage({ version: 1, type: "ready", nonce });
      resolve({
        collectionIntent(event){if(!disposed)port.postMessage({version:1,type:'intent',nonce,...validateCollectionIntent(event)});},
        editorProposal(snapshotId,revision,patch){if(!disposed)port.postMessage({version:1,type:'intent',nonce,intent:'editor-propose',snapshotId,revision,patch});},
        intent(name) {
          if(disposed)return;
          port.postMessage({ version: 1, type: "intent", nonce, intent: name });
        },
        selectItem(snapshotId,handle){if(!disposed)port.postMessage({version:1,type:'intent',nonce,intent:'select-item',snapshotId,handle});},
        openerIntent(intent,snapshotId,handle){if(!disposed)port.postMessage({version:1,type:'intent',nonce,intent,snapshotId,...(handle===undefined?{}:{handle})});},
        dispose() {
          disposed=true;port.onmessage=null;
          port.close();
        },
      });
    };
    window.addEventListener("message", listener);
  });
}
