import {createLocalization,validateLocalizationBundle,type LocalizationMessages} from '@digital-card/framework/localization';
const messages: LocalizationMessages = {'nav.wallet':'Cartera','account.cards':{one:'{count} tarjeta',other:'{count} tarjetas'}};
const locale=createLocalization({locale:'es',messages});
const label:string=locale.text('account.cards',{count:2});
const collectionTitle:string=locale.text('collection.title');
const inspectorLabel:string=locale.text('inspector.label');
const albumTitle:string=locale.text('albums.title');
const tradeTitle:string=locale.text('trades.title');
const feasibleTickets:string=locale.text('shop.feasibleTickets');
locale.number(12.5);locale.date('2026-10-12T00:00:00Z');
validateLocalizationBundle({protocol:'digital-card-localization@1',locale:'es',messages});
// @ts-expect-error Message keys are a closed public contract.
locale.text('unknown.key');
// @ts-expect-error Messages contain data, not callbacks.
createLocalization({messages:{'nav.wallet':()=>label}});
