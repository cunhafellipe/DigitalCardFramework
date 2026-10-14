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
