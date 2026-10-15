import {mountProgram, connectProgram, programHeaders, type ProgramRegistry} from '@digital-card/framework/presentation/program';
import {createProgramCardRenderer} from '@digital-card/framework/presentation/program-card-view';
import {createProgramPackRenderer} from '@digital-card/framework/presentation/program-pack-view';
import {validateAlbumDisplay, type AlbumDisplayField} from '@digital-card/framework/presentation/album-display';
import {createProgramAlbumRenderer} from '@digital-card/framework/presentation/program-album-view';

const registry: ProgramRegistry = new Map([['celestial', {approved: true, url: 'https://programs.example/card/', version: '1', intents: ['select']}]]);
const root = document.createElement('div');
const program = mountProgram(root, {programId: 'celestial', registry, onError: event => console.log(event.code)});
program.setInputs({tilt: {x: 0.5}, flipProgress: 1});
program.setVisibility('hidden');
program.dispose();
programHeaders('https://assets.example');
void connectProgram({onInputs: inputs => console.log(inputs.tilt?.x)});
const renderer = createProgramCardRenderer({registry, cards: {dawn: 'celestial'}});
const card = renderer({cardId: 'dawn', definition: {name: 'Dawn'}, variant: {}, rarityId: 'common'}, {onSelect: copy => console.log(copy.cardId)});
card.setPresentationSide?.('back');
card.dispose?.();
renderer.setEnabled(false);
renderer.dispose();
// @ts-expect-error Only numeric presentation inputs cross the bridge.
program.setInputs({tilt: {x: 'secret'}});
// @ts-expect-error Owned-copy fields are not program inputs.
program.setInputs({bindings: {code: 'private'}});
// @ts-expect-error The renderer maps IDs to approved program IDs.
createProgramCardRenderer({registry, cards: {dawn: () => 'celestial'}});
const packs = createProgramPackRenderer({registry, products: {starter: 'celestial'}});
const pack = packs({id: 'starter', name: 'Starter', lineId: 'sky'}, {side: 'front', onSelect: product => console.log(product.id)});
if ('node' in pack) {
  pack.setSide?.('back');
  pack.setPresentationInputs?.({revealProgress: 0.5});
  pack.dispose?.();
  // @ts-expect-error Pack programs cannot receive private purchase data.
  pack.setPresentationInputs?.({price: 100});
}
packs.setEnabled(false);
packs.dispose();
const fields: AlbumDisplayField[] = ['albumName', 'cardName', 'rarity'];
const albums = createProgramAlbumRenderer({registry, programId: 'celestial', displayFields: fields});
const album = albums({name: 'Journal', cards: [{copy: {definition: {name: 'Dawn'}, variant: {}, rarityId: 'common'}}]});
album.dispose?.();
albums.setEnabled(false);
albums.dispose();
const snapshot = validateAlbumDisplay(JSON.parse('{}'));
program.setAlbumDisplay(snapshot);
void connectProgram({onAlbumDisplay: content => console.log(content.items.length)}).then(bridge => bridge.selectItem(snapshot.snapshotId, snapshot.items[0]!.handle));
// @ts-expect-error Private copy fields cannot be granted.
createProgramAlbumRenderer({registry, programId: 'celestial', displayFields: ['bindings']});

import {createProgramOpenerView} from '@digital-card/framework/presentation/program-opener-view';
import {createProgramEditorPanels} from '@digital-card/framework/presentation/program-editor-panel';
import {validateEditorDisplay,validateEditorProposal} from '@digital-card/framework/presentation/editor-display';

const editorPanels = createProgramEditorPanels({registry, panels: [{id:'typography',programId:'typography',fields:['text','typography.size','color']}]});
editorPanels.setEnabled('typography', false);
editorPanels.dispose();
const editorSnapshot = validateEditorDisplay(JSON.parse('{}'));
program.setEditorDisplay(editorSnapshot);
const editorProposal = validateEditorProposal(JSON.parse('{}'), editorSnapshot);
void connectProgram({onEditorDisplay: snapshot => console.log(snapshot.values.text)}).then(bridge => bridge.editorProposal(editorProposal.snapshotId, editorProposal.revision, editorProposal.patch));
// @ts-expect-error Private metadata is not a permitted editor field.
createProgramEditorPanels({registry, panels:[{id:'invalid',programId:'invalid',fields:['metadata']}]});
import type {RevealState, RevealController} from '@digital-card/framework/client';
declare const revealState: RevealState;
declare const revealController: RevealController;
const opener = createProgramOpenerView({registry, programId: 'celestial', displayFields: ['cardName', 'isNew']});
const opening = opener(revealState, revealController, {onSelect: copy => console.log(copy.id)});
opening.update(revealState);
opening.dispose();
opener.setEnabled(false);
opener.dispose();
// @ts-expect-error Private card fields are not display grants.
createProgramOpenerView({registry, programId: 'celestial', displayFields: ['bindings']});
void connectProgram({onOpenerDisplay: snapshot => console.log(snapshot.revealed)}).then(bridge => {
  bridge.openerIntent('opener-reveal', 'snapshot');
  // @ts-expect-error Browser programs cannot request authoritative pack opening.
  bridge.openerIntent('openPack', 'snapshot');
});

import {encodePNG} from '@digital-card/framework/presentation/png-encode';
const png:Promise<Uint8Array>=encodePNG({width:1,height:1,data:new Uint8Array(4)});
const canvasPNG:Promise<Uint8Array>=encodePNG({width:1,height:1,data:new Uint8ClampedArray(4)});
// @ts-expect-error RGBA input must provide byte data
void encodePNG({width:1,height:1,data:'RGBA'});
// @ts-expect-error dimensions must be numeric
void encodePNG({width:'1',height:1,data:new Uint8Array(4)});
void [png,canvasPNG];

import {exportStatsCSV, parseStatsCSV, importStatsCSV} from '@digital-card/framework/presentation/stats-csv';
import type {StatsCSVDocument, StatsCSVRow, StatsCSVValue} from '@digital-card/framework/presentation/stats-csv';
interface CSVPresentationDraft extends StatsCSVDocument {
  manifest: StatsCSVDocument['manifest'] & {title: string; faces: {front: {scene: string}}};
  scenes: Map<string, {nodes: unknown[]}>;
  assets: Map<string, Uint8Array>;
}
declare const csvProject: CSVPresentationDraft & {edit(callback: (draft: CSVPresentationDraft) => void): void; getRevision(): number};
const csvText: string = exportStatsCSV(csvProject);
const changedRows: number = importStatsCSV(csvProject, csvText);
const csvRows: StatsCSVRow[] = parseStatsCSV(csvText);
for (const row of csvRows) {
  const scope: 'card' | 'variant' = row.scope;
  const value: StatsCSVValue | undefined = row.value;
  if (value === undefined) console.log('absent', scope);
  else if (value === null) console.log('explicit null', scope);
  // @ts-expect-error Parsed JSON values are not necessarily numbers.
  const numeric: number = row.value;
  void numeric;
}
exportStatsCSV({manifest:{authoring:{values:{card:{zero:0,nullable:null},variant:{tags:['rare'],metadata:{active:false}}}}}});
exportStatsCSV({manifest:{}});
// @ts-expect-error CSV input is text.
parseStatsCSV(new Uint8Array());
// @ts-expect-error CSV import requires the project's edit transaction.
importStatsCSV({manifest:{}}, csvText);
// @ts-expect-error Stored stat values must be JSON, not functions.
exportStatsCSV({manifest:{authoring:{values:{card:{bad:()=>0}}}}});
// @ts-expect-error CSV scopes exclude per-copy stats.
const copyCSVRow: StatsCSVRow = {scope:'copy',key:'count',value:1};
void [changedRows,csvRows,copyCSVRow];

import {mobilePerformanceDefaults,performancePolicy,analyzePerformance,enforcePerformance} from '@digital-card/framework/presentation/performance';
import type {PerformanceInput,PerformanceReport} from '@digital-card/framework/presentation/performance';
const performanceConfig=performancePolicy({mode:'reject',quality:'lite',drawLayers:20,layerTextureBytes:1024});
const performanceScene={version:1,nodes:[{id:'group',type:'group',isolate:true,width:100,height:100,children:[{id:'image',type:'image',asset:'art',width:100,height:100,opacity:1},{id:'video',type:'video',video:{poster:'art'}},{id:'text',type:'text',typography:{size:12},runs:[{text:'Card'}],mask:{polygon:[[0,0],[1,0],[0,1]]},material:{kind:'foil'}}]}]};
const performanceProject={manifest:{version:1,title:'Card',canvas:{width:240,height:360},assets:[{id:'art',path:'art.png',width:100,height:100,bytes:256}],quality:{standard:{maxEdge:768},lite:{maxEdge:256}},faces:{front:{scene:'front.json'}}},scenes:new Map([['front.json',performanceScene]]),assets:new Map<string,Uint8Array>()};
const performanceInput:PerformanceInput=performanceProject;
const performanceReport:PerformanceReport=analyzePerformance(performanceInput,performanceConfig);
const sameReport:PerformanceReport=enforcePerformance(performanceReport);
for(const issue of performanceReport.issues){
  const measured:number|null=issue.measured,threshold:number|null=issue.threshold;
  if(issue.code==='ADAPTER_COST_UNKNOWN'){const unknownCost:null=issue.measured;void unknownCost;}
  else {const numericCost:number=issue.measured;void numericCost;}
  // @ts-expect-error Unknown adapter costs are null, not measured numbers.
  const cost:number=issue.measured;
  void [measured,threshold,cost];
}
// @ts-expect-error Published defaults are immutable.
mobilePerformanceDefaults.drawLayers=10;
// @ts-expect-error Returned policies are immutable.
performanceConfig.mode='off';
// @ts-expect-error Unsupported policy mode.
performancePolicy({mode:'strict'});
// @ts-expect-error Unsupported quality.
performancePolicy({quality:'high'});
// @ts-expect-error Thresholds must be numeric.
analyzePerformance(performanceInput,{decoders:'1'});
// @ts-expect-error Scenes must provide a map lookup, not a plain dictionary.
analyzePerformance({...performanceProject,scenes:{'front.json':performanceScene}});
void sameReport;

import * as documentBootstrap from '@digital-card/framework/presentation/program-bootstrap';
import * as albumBootstrap from '@digital-card/framework/presentation/program-album-bootstrap';
import * as openerBootstrap from '@digital-card/framework/presentation/program-opener-bootstrap';
const documentBootstrapHasNoExports:keyof typeof documentBootstrap extends never?true:false=true;
const albumBootstrapHasNoExports:keyof typeof albumBootstrap extends never?true:false=true;
const openerBootstrapHasNoExports:keyof typeof openerBootstrap extends never?true:false=true;
// @ts-expect-error The document bootstrap initializes on import and exports no callable API.
documentBootstrap.connectProgram();
// @ts-expect-error Album bootstrap cleanup is handled by pagehide, not an exported method.
albumBootstrap.dispose();
// @ts-expect-error Opener bootstrap cleanup is handled by pagehide, not an exported method.
openerBootstrap.dispose();
void [documentBootstrapHasNoExports,albumBootstrapHasNoExports,openerBootstrapHasNoExports];

import {composeExtensions, resolveConfiguration, type ExtensionModule} from '@digital-card/framework/presentation/extensions';
const effectModule = {
  id: 'host.effect', version: '1.0.0', apiVersion: '0.1.0', trust: 'host-installed' as const,
  provides: ['effect'], fallback: 'poster', create: (root: HTMLElement) => root,
  estimate: (width: number) => width * 4,
  validate(configuration: Record<string, unknown>) { console.log(configuration); },
};
const composition = composeExtensions([effectModule], {select: {effect: 'host.effect'}});
const selectedEffect = composition.get('effect');
if (selectedEffect) {
  const node: HTMLElement = selectedEffect.create(root);
  const bytes: number = selectedEffect.estimate(64);
  void [node, bytes];
}
const absentEffect: typeof effectModule | undefined = composition.get('absent');
const extensionOrder: string[] = composition.explainComposition().order;
const configured = resolveConfiguration({
  density: {type: 'number', default: 0.5, min: 0, max: 1, scopes: ['host']},
  enabled: {type: 'boolean', default: true, scopes: ['host']},
}, [{scope: 'host', values: {density: 0.7}}], {ceilings: {density: 0.8}});
const density: number = configured.density;
const enabled: boolean = configured.enabled;
// @ts-expect-error Module code must be explicitly host-installed.
const untrustedExtension: ExtensionModule = {...effectModule, trust: 'package'};
// @ts-expect-error Missing slots can return undefined.
const definiteEffect: typeof effectModule = composition.get('absent');
// @ts-expect-error Configuration overrides follow the field's declared type.
resolveConfiguration({enabled: {type:'boolean', default:true, scopes:['host']}}, [{scope:'host', values:{enabled:1}}]);
// @ts-expect-error Configuration ceilings are numeric.
resolveConfiguration({enabled: {type:'boolean', default:true, scopes:['host']}}, [], {ceilings:{enabled:'yes'}});
void [absentEffect, extensionOrder, density, enabled, untrustedExtension, definiteEffect];

import {walletSessions, tokenIdentity, resolveExternalOwnership, externalOwnershipState, ethersOwnershipProvider, marketplaceMetadata, type OwnershipProvider} from '@digital-card/framework/presentation/identity';
const sessions = walletSessions({domain:'cards.example', uri:'https://cards.example', chainIds:[1], nonces:new Map()});
const challengeVersion: '1' = sessions.challenge('session').version;
void sessions.verify('session', {message:'signed message', signature:'signature'}).then(proof => {
  const chain: number = proof.chainId;
  void chain;
});
const binding = {chainId:1, standard:'erc721' as const, contract:'0x0000000000000000000000000000000000000001', tokenId:'1'};
const tokenId: string = tokenIdentity(binding).id;
const ownershipProvider: OwnershipProvider = {
  getNetwork: async () => ({chainId:1n}), getBlockNumber: async () => 100,
  getBlock: async () => ({hash:'block'}), readToken: async () => ({owner:'account'}),
};
void resolveExternalOwnership(binding, {provider:ownershipProvider, account:'account'}).then(ownership => {
  const authority: 'external' = ownership.authority;
  if (ownership.state === 'confirmed') {
    const confirmations: number = ownership.confirmations;
    const account: string = ownership.account;
    void [confirmations, account];
  } else {
    const zero: '0' = ownership.quantity;
    // @ts-expect-error Reorg snapshots have no confirmed account.
    ownership.account;
    void zero;
  }
  const stale = externalOwnershipState(ownership, {clock:() => Date.now()});
  const state: 'confirmed' | 'reorg' | 'stale' = stale.state;
  const transferAllowed: false = stale.localTransferAllowed;
  void [authority, state, transferAllowed];
});
const preservedOwnership = externalOwnershipState({checkedAt:0, state:'confirmed' as const, custom:42, localTransferAllowed:true});
const preservedCustom: number = preservedOwnership.custom;
const forcedTransferPolicy: false = preservedOwnership.localTransferAllowed;
const ethersBridge: OwnershipProvider = ethersOwnershipProvider({
  provider:null, getNetwork:async () => {throw new Error('network');},
  getBlockNumber:async () => 100, getBlock:async () => null,
  call:async () => '0x',
});
const metadata = marketplaceMetadata({title:'Card',description:'A card',posterURL:'https://cards.example/poster.png',viewerURL:'https://cards.example/view',attributes:[{trait_type:'Rarity',value:'Rare'}]});
const rarity: string | undefined = metadata.attributes[0]?.value;
// @ts-expect-error Token IDs preserve decimal precision as strings.
tokenIdentity({...binding, tokenId:1});
// @ts-expect-error Only the implemented token standards are supported.
tokenIdentity({...binding, standard:'erc20'});
// @ts-expect-error Wallet proofs require a string signature.
sessions.verify('session', {message:'message',signature:123});
// @ts-expect-error The ethers adapter requires block access.
ethersOwnershipProvider({provider:null,getNetwork:async () => ({chainId:1n})});
void [challengeVersion,tokenId,preservedCustom,forcedTransferPolicy,ethersBridge,rarity];

import {FONT_TYPES, fontHeader, inspectFont, validateTypography, textValue, fontForNode, layoutText, fontMeasure, textMeasure, fontDiagnostics, accessibleText, drawText, type TextNode, type TextLayout, type FontType} from '@digital-card/framework/presentation/text';
const fontType: FontType | undefined = FONT_TYPES[0];
fontHeader(new Uint8Array(12), 'font/ttf');
const inspectedFont = inspectFont(new Uint8Array(12), 'font/ttf');
const familyName: string = inspectedFont.info.family;
const optionalWeight: number | undefined = inspectedFont.info.weight;
const defaultAxis: number | undefined = inspectedFont.info.axes.wght?.default;
const textNode: TextNode = {
  id:'caption', width:200, height:40,
  typography:{size:16, weight:600, overflow:'ellipsis', direction:'auto'},
  runs:[{text:'Caption',style:'italic',icon:'star'}],
};
validateTypography(textNode, new Map([['star',{mediaType:'image/png'}]]));
validateTypography({height:40}, new Map());
const caption: string = textValue(textNode, {});
const statCaption: string = textValue({stat:{key:'power',scope:'variant',view:'bar'}}, {authoring:{values:{variant:{power:42}}}});
const variedFont = fontForNode(inspectedFont.font, textNode);
const measureFont = fontMeasure(variedFont, textNode);
const measuredText: number = measureFont('Caption',16,0);
const textLayout: TextLayout = layoutText(textNode, caption, (value,size,start) => value.length * size + (start ?? 0));
const lineWidth: number | undefined = textLayout.lines[0]?.width;
const canvasContext = document.createElement('canvas').getContext('2d')!;
const measureCanvas = textMeasure(canvasContext, textNode);
const measureEmbeddedFont = textMeasure(canvasContext, textNode, inspectedFont.font);
const diagnostic = fontDiagnostics({hasGlyphForCodePoint:codepoint => codepoint < 128}, {id:'caption'}, caption)[0];
const glyphCode: 'FONT_GLYPH' | undefined = diagnostic?.code;
const readingText: string = accessibleText({}, {nodes:[{type:'group',children:[{type:'text',text:'Caption',readingOrder:1}]}]});
const emptyReadingText: string = accessibleText({}, null);
const drawnText: TextLayout = drawText(canvasContext, textNode, {}, variedFont, new Map([['star',document.createElement('canvas')]]));
const offscreenContext = new OffscreenCanvas(200,40).getContext('2d')!;
drawText(offscreenContext, textNode, {}, null);
// @ts-expect-error Font data must be bytes.
inspectFont('font data', 'font/ttf');
// @ts-expect-error Font media types are restricted to supported formats.
fontHeader(new Uint8Array(12), 'image/png');
// @ts-expect-error Typography uses the public numeric size contract.
layoutText({...textNode, typography:{size:'large'}}, caption, measureCanvas);
// @ts-expect-error Text measurement callbacks return numbers.
layoutText(textNode, caption, () => 'wide');
// @ts-expect-error Presentation stat bindings exclude private per-copy values.
textValue({stat:{key:'secret',scope:'copy'}}, {});
// @ts-expect-error Inline icons must be drawable canvas sources.
drawText(canvasContext,textNode,{},null,new Map([['star','star.png']]));
void [fontType,familyName,optionalWeight,defaultAxis,statCaption,measuredText,lineWidth,measureEmbeddedFont,glyphCode,readingText,emptyReadingText,drawnText];

import {validateExpression, evaluate, selectFrame, normalizedInputs, type MotionExpression, type MotionBudget} from '@digital-card/framework/presentation/motion';
const motionExpression: MotionExpression = ['mix',['input','tilt.x'],['curve',['input','time.active'],[[0,0],[1,1]]],0.5];
const expressionNodes: number = validateExpression(motionExpression, {maxNodes:64,hostInputs:['host.level']});
validateExpression(JSON.parse('null'));
const motionBudget: MotionBudget = {remaining:100};
const normalized = normalizedInputs({tilt:{x:'0.5',y:0},pressed:true,host:{'host.level':3,'host.enabled':true,'host.invalid':'filtered'}});
const numericTilt: number = normalized['tilt.x'];
const hostValue: number | boolean | undefined = normalized['host.enabled'];
const evaluatedMotion: number = evaluate(motionExpression, normalized, motionBudget);
evaluate(['max',1,2,3,4,5,6,7,8]);
const motionFrame = selectFrame({frames:[{asset:'frame.png',duration:100}],progress:motionExpression,loop:true},normalized,motionBudget);
const optionalFrameAsset: string | undefined = motionFrame?.asset;
const emptyFrame: {duration:number} | undefined = selectFrame({frames:[],progress:0});
// @ts-expect-error Frame selection can return undefined for an empty animation.
const requiredFrame: {duration:number} = selectFrame({frames:[],progress:0});
// @ts-expect-error Binary operations require exactly two operands.
evaluate(['sub',1]);
// @ts-expect-error Variadic operations allow at most eight operands.
evaluate(['add',1,2,3,4,5,6,7,8,9]);
// @ts-expect-error Input expressions take an input name.
evaluate(['input',1]);
// @ts-expect-error Curve points are pairs of numeric values.
evaluate(['curve',0,[[0,'zero'],[1,1]]]);
// @ts-expect-error Evaluation budgets are mutable numeric counters.
evaluate(1,{}, {remaining:'100'});
// @ts-expect-error Evaluation inputs are numeric or boolean.
evaluate(['input','host.level'], {'host.level':'high'});
// @ts-expect-error Frame durations are numeric.
selectFrame({frames:[{duration:'100'}],progress:0});
void [expressionNodes,numericTilt,hostValue,evaluatedMotion,optionalFrameAsset,emptyFrame,requiredFrame];

import {gltfAdapter, riveAdapter, dotLottieAdapter, type MediaAdapterContext} from '@digital-card/framework/presentation/adapters';
const gltf = gltfAdapter();
const rive = riveAdapter({wasmURL:'/runtime/rive.wasm',approvedDigests:['sha256:approved']});
const lottie = dotLottieAdapter({wasmURL:'/runtime/lottie.wasm'});
const gltfId: 'dc.gltf' = gltf.id;
const adapterCost: number = gltf.estimate();
gltf.estimate({width:200});
const mediaContext: MediaAdapterContext = {width:200,height:300,signal:new AbortController().signal,asset:async id => ({url:'/assets/'+id})};
const mediaFrame = {inputs:normalized,activeTimeSeconds:1,staticMotion:false};
void gltf.create(mediaContext,{asset:'model',turnRadians:0.5}).then(instance => {
  const canvas: HTMLCanvasElement = instance.canvas;
  const needsTime: boolean = instance.update(mediaFrame).needsTime;
  instance.render();
  instance.dispose();
  void [canvas,needsTime];
});
void rive.create({...mediaContext,digest:'sha256:approved'},{asset:'animation',artboard:'Card',animation:'Idle',clock:true});
void lottie.create(mediaContext,{asset:'animation',animation:'Idle',duration:2});
composeExtensions([gltf,rive,lottie]);
// @ts-expect-error Rive requires a self-hosted WASM URL.
riveAdapter({approvedDigests:[]});
// @ts-expect-error Rive checks the current package digest against host approvals.
rive.create(mediaContext,{asset:'animation'});
// @ts-expect-error GLTF adapter turn controls are numeric.
gltf.create(mediaContext,{asset:'model',turnRadians:'half'});
// @ts-expect-error Adapter creation requires an asset identifier.
lottie.create(mediaContext,{clock:true});
void [gltfId,adapterCost];

import {validatePresentationReference, publicInputs, connectedInputs, mountPresentation, mountAssembly, type PresentationStage, type PresentationResolver} from '@digital-card/framework/presentation/integration';
const presentationRef = validatePresentationReference(JSON.parse('{}'));
const presentationContract: 'digital-card@0.1' = presentationRef.contract;
const inputManifest = {inputs:{'host.level':{type:'number' as const,default:1,min:1,max:99},'host.enabled':{type:'boolean' as const,default:true}}};
const filteredInputs: Record<string,number|boolean> = publicInputs(inputManifest, {'host.level':123,secret:'filtered'});
const connected = connectedInputs(inputManifest,{clock:()=>100,maxAgeMs:60});
connected.update({'host.level':20},{at:100});
const inputRead = connected.read();
if(inputRead.state === 'offline') {const offlineTime:null=inputRead.at;void offlineTime;}
else {const recordedTime:number=inputRead.at;void recordedTime;}
const inputSnapshotTime:number|null = connected.snapshot().at;
const integrationResolver: PresentationResolver = {manifest:inputManifest,dispose(){}};
const integrationStage: PresentationStage<PresentationResolver,{setInputs(value:Record<string,unknown>):void;dispose():void;custom():number}> = {
  mount(target,model,options) {
    const modelResolver:PresentationResolver=model.resolver;
    options.onEvent?.({type:'ready',result:{mode:'interactive'}});
    void [target,modelResolver];
    return {setInputs(value){console.log(value);},dispose(){},custom(){return 1;}};
  },
};
void mountPresentation({stage:integrationStage,target:root,definition:{name:'Card',presentation:presentationRef},resolve:async (baseURL,options)=>{
  const digest:string=options.digest;
  const signal:AbortSignal|undefined=options.signal;
  void [baseURL,digest,signal];
  return integrationResolver;
},hostInputs:{'host.level':3},onEvent:event=>console.log(event.type)}).then(view=>{
  const custom:number=view.custom();
  view.setInputs({tilt:{x:0.5}});
  view.dispose();
  void custom;
});
void mountAssembly({stage:integrationStage,root,descriptor:{version:1,members:[{id:'card',bounds:[0,0,50,100],presentation:presentationRef,title:'Card',label:'Card label'}]},
  resolve:async()=>integrationResolver,missing:member=>member.label,
  interaction:{rotate:true,defaults:{scale:[1,1]},onChange:(id,state)=>{const rotation:number=state.rotation.x;void [id,rotation];}},
}).then(assembly=>{
  const memberCustom:number|undefined=assembly.views[0]?.custom();
  assembly.setInputs({tilt:{x:0.5}});
  assembly.setMemberInputs('card',{tilt:{y:0.5}});
  const memberRotation:number|undefined=assembly.snapshot().card?.rotation.x;
  assembly.dispose();
  void [memberCustom,memberRotation];
});
// @ts-expect-error Public input rules exclude string bindings.
publicInputs({inputs:{'host.secret':{type:'string',default:'secret'}}});
// @ts-expect-error Connected input event timestamps are numeric.
connected.update({},{at:'now'});
// @ts-expect-error Only supported presentation quality levels can be mounted.
mountPresentation({stage:integrationStage,target:root,definition:{presentation:presentationRef},quality:'high'});
// @ts-expect-error Assembly bounds require four coordinates.
mountAssembly({stage:integrationStage,root,descriptor:{version:1,members:[{id:'card',bounds:[0,0,100]}]}});
void [presentationContract,filteredInputs,inputSnapshotTime];

import {parseLayeredSource, type LayeredSourceNode, type LayeredSourceFormat} from '@digital-card/framework/presentation/layered-source';
import {layeredPackage, type LayeredPackage} from '@digital-card/framework/presentation/layered-package';
declare const layeredBytes:Uint8Array;
const layeredDocument=parseLayeredSource(layeredBytes,{format:'ora',encodeRGBA:encodePNG,limits:{bytes:1024,pixels:4096,edge:64,layers:8,depth:2}});
layeredDocument.then(async doc=>{
  const merged:Uint8Array|null|undefined=doc.merged;
  const sourceNode:LayeredSourceNode|undefined=doc.layers[0];
  if(sourceNode?.type==='group')sourceNode.children.map(child=>child.id);
  else if(sourceNode)sourceNode.bytes.byteLength.toFixed();
  const poster=merged??layeredBytes;
  const packaged:LayeredPackage=await layeredPackage(doc,{poster,flatten:false});
  const archive:Uint8Array=packaged.archive;
  const packageFormat:'digital-card'=packaged.manifest.format;
  const scene=packaged.scenes.get('scenes/front.json');
  scene?.nodes.forEach(node=>{
    if(node.type==='image'){
      node.asset.toUpperCase();
      node.animation?.frames.forEach(frame=>frame.asset.toUpperCase());
      // @ts-expect-error Package images refer to assets instead of embedded source bytes.
      node.bytes;
    }else node.children.forEach(child=>child.id.toUpperCase());
  });
  packaged.files.get('card.json')?.byteLength.toFixed();
  // @ts-expect-error Package output does not contain an authoring import report.
  packaged.report;
  void [archive,packageFormat];
});
parseLayeredSource(layeredBytes,{format:'gif',encodeRGBA:image=>new Uint8Array(image.data),limits:{frames:10}}).then(doc=>{
  const poster:Uint8Array=doc.poster;
  doc.report.notes.map(note=>note.toUpperCase());
  doc.layers.forEach(layer=>layer.animation?.frames.forEach(frame=>frame.duration.toFixed()));
  // @ts-expect-error GIF imports expose a poster rather than a merged image.
  doc.merged;
  void poster;
});
declare const layeredFormat:LayeredSourceFormat;
parseLayeredSource(layeredBytes,{format:layeredFormat,encodeRGBA:encodePNG});
// @ts-expect-error Layered sources are byte arrays.
parseLayeredSource('source',{format:'psd',encodeRGBA:encodePNG});
// @ts-expect-error Source formats are explicitly supported archive/image formats.
parseLayeredSource(layeredBytes,{format:'psb',encodeRGBA:encodePNG});
// @ts-expect-error The encoder must return PNG bytes.
parseLayeredSource(layeredBytes,{format:'psd',encodeRGBA:()=> 'png'});
// @ts-expect-error Package creation requires a rendered poster.
layeredPackage({width:1,height:1,title:'Example',layers:[]},{});
// @ts-expect-error Package creation is asynchronous.
const immediateLayeredPackage:LayeredPackage=layeredPackage({width:1,height:1,title:'Example',layers:[]},{poster:layeredBytes});
void immediateLayeredPackage;

import {inspectGIF, parseGIFSource, type GIFInspection} from '@digital-card/framework/presentation/gif-source';
import {importLayeredFile, type LayeredFileImport} from '@digital-card/framework/presentation/layered-import';
const gifInspection:GIFInspection=inspectGIF(layeredBytes,{frames:10,pixels:4096,edge:64});
const gifFrameCount:number=gifInspection.frames;
const artworkAbort=new AbortController();
parseGIFSource(layeredBytes,{encodeRGBA:encodePNG,signal:artworkAbort.signal,limits:{frames:10}}).then(doc=>{
  const format:'gif'=doc.report.format;
  const note:string|undefined=doc.report.notes[0];
  const animation=doc.layers[0]?.animation;
  const angleProgress:['input','angle']|undefined=animation?.progress;
  const frameDuration:number|undefined=animation?.frames[0]?.duration;
  void [format,note,angleProgress,frameDuration];
});
parseGIFSource(layeredBytes,{encodeRGBA:image=>new Uint8Array(image.data)});
const artworkFile=new File([new Uint8Array(4)],'artwork.ora');
const artworkImport:Promise<LayeredFileImport>=importLayeredFile(artworkFile,{workerURL:new URL('/workers/artwork.js',location.href),signal:artworkAbort.signal,timeoutMs:10000});
importLayeredFile(artworkFile,{workerURL:'/workers/artwork.js'});
artworkImport.then(async imported=>{
  const sourceWidth:number=imported.sourceSize.width;
  const canFlatten:boolean=imported.canFlatten;
  const issue=imported.report.issues[0];
  const issueLayer:string|undefined=issue?.layer;
  const issueCode:string|undefined=issue?.code;
  if(imported.report.format==='gif')imported.report.notes.map(note=>note.toUpperCase());
  else imported.report.notes.map(note=>note.message.toUpperCase());
  const built:LayeredPackage=await imported.build();
  const flattened:LayeredPackage=await imported.build({flatten:true});
  // @ts-expect-error Building an import produces its package asynchronously.
  const immediate:LayeredPackage=imported.build();
  // @ts-expect-error Flatten controls use a boolean.
  imported.build({flatten:'yes'});
  void [sourceWidth,canFlatten,issueLayer,issueCode,built,flattened,immediate];
});
// @ts-expect-error GIF inspection requires bytes.
inspectGIF('gif');
// @ts-expect-error GIF frame limits are numeric.
inspectGIF(layeredBytes,{frames:'10'});
// @ts-expect-error GIF decoding needs an RGBA encoder returning PNG bytes.
parseGIFSource(layeredBytes,{encodeRGBA:()=> 'png'});
// @ts-expect-error Cancellation accepts a DOM AbortSignal.
parseGIFSource(layeredBytes,{encodeRGBA:encodePNG,signal:true});
// @ts-expect-error Layered file imports require the browser File input.
importLayeredFile(layeredBytes);
// @ts-expect-error Import timeouts are numeric milliseconds.
importLayeredFile(artworkFile,{timeoutMs:'10000'});
void gifFrameCount;
