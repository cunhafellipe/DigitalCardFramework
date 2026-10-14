import {createProgramCollectionView} from '@digital-card/framework/presentation/program-collection-view';
import {collectionDisplaySchema,validateCollectionDisplay,validateCollectionQuery} from '@digital-card/framework/presentation/collection-display';
import type {ProgramRegistry} from '@digital-card/framework/presentation/program';
declare const registry: ProgramRegistry;
const view=createProgramCollectionView({registry,programId:'collection.example',displayFields:['cardName','line','rarity','preview']});
view.setEnabled(false);
view.dispose();
const display=validateCollectionDisplay(JSON.parse('{}'));
const query=validateCollectionQuery(JSON.parse('{}'));
const mode:'owned'|'catalog'=query.mode;
const snapshot:string=display.snapshotId;
void [collectionDisplaySchema,mode,snapshot];
// @ts-expect-error Private bindings are not collection display grants.
createProgramCollectionView({registry,programId:'collection.example',displayFields:['bindings']});
// @ts-expect-error Display grants cannot expose account credentials.
createProgramCollectionView({registry,programId:'collection.example',displayFields:['sessionToken']});
import {connectProgram} from '@digital-card/framework/presentation/program';
void connectProgram({onCollectionDisplay:snapshot=>console.log(snapshot.optionWindows.lines.page)}).then(bridge=>{
  bridge.collectionIntent({intent:'collection-options',snapshotId:'snapshot',kind:'lines',search:'season',page:0});
  bridge.collectionIntent({intent:'collection-more',snapshotId:'snapshot',direction:-1});
  // @ts-expect-error Collection programs cannot submit arbitrary host commands.
  bridge.collectionIntent({intent:'tradeUp',snapshotId:'snapshot',copyIds:['copy']});
  // @ts-expect-error Option queries are limited to declared filter families.
  bridge.collectionIntent({intent:'collection-options',snapshotId:'snapshot',kind:'accounts',search:'',page:0});
});
