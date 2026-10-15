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
