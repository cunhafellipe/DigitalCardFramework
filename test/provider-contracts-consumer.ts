import {codeProviderProtocol, codeProviderSchema, validateCodeProviderRequest, validateCodeProviderResponse, type CodeProviderRequest, type CodeProviderResponse} from '@digital-card/framework/code-provider-contracts';
import {currencyProviderProtocol, currencyProviderSchema, validateCurrencyProviderRequest, validateCurrencyProviderResponse, type CurrencyProviderRequest, type CurrencyProviderResponse} from '@digital-card/framework/currency-provider-contracts';
import {codeIssuanceProtocol, codeIssuanceSchema, validateCodeIssuanceRequest, validateCodeIssuanceResponse, matchCodeIssuanceResults, type CodeIssuanceRequest, type CodeIssuanceResponse, type CodeIssuanceEntry, type CodeIssuanceResult} from '@digital-card/framework/code-issuance-contracts';
import {bindingFactoryProtocol, bindingFactorySchema, bindingFactoryInputDigest, bindingFactoryIdentity, validateBindingFactoryRequest, validateBindingFactoryResponse, matchBindingFactoryResults, type BindingFactoryCopy, type BindingFactoryRequestEntry, type BindingFactoryRequest, type BindingFactoryResult, type BindingFactoryResponse} from '@digital-card/framework/binding-factory-contracts';

const identity = {providerId: 'example.provider', requestId: '00000000-0000-4000-8000-000000000001'};
const lookup: CodeProviderRequest = {...identity, protocol: codeProviderProtocol, codeId: 'example.code', operation: 'lookup', externalId: null, code: 'EXAMPLE-CODE'};
validateCodeProviderRequest(lookup).externalId?.toUpperCase();
const codeReply: CodeProviderResponse = {...identity, protocol: codeProviderProtocol, codeId: 'example.code', status: 'redeemed', eventId: 'redemption-1', occurredAt: '2026-01-01T00:00:00Z'};
const input: unknown = JSON.parse('{}');
const parsedCode = validateCodeProviderResponse(input);
if (parsedCode.status === 'redeemed' || parsedCode.status === 'revoked') parsedCode.occurredAt.toUpperCase();
if (parsedCode.status === 'error') parsedCode.errorCode.toUpperCase();
const account: CurrencyProviderRequest = {...identity, protocol: currencyProviderProtocol, operation: 'resolve-account', userId: 'collector'};
const settlement: CurrencyProviderRequest = {...identity, protocol: currencyProviderProtocol, operation: 'lookup', transactionId: 'purchase-1', account: 'external-account'};
const resolved: CurrencyProviderResponse = {...account, status: 'resolved', account: 'external-account'};
const settled: CurrencyProviderResponse = {...settlement, status: 'settled', currency: 'credits', amountUnits: '1234567890123456789012345678901234567890'};
const parsedCurrency = validateCurrencyProviderResponse(input);
if (parsedCurrency.operation === 'resolve-account') {
  parsedCurrency.userId.toUpperCase();
  if (parsedCurrency.status === 'resolved') parsedCurrency.account.toUpperCase();
} else {
  parsedCurrency.transactionId.toUpperCase();
  if (parsedCurrency.status === 'settled') BigInt(parsedCurrency.amountUnits);
}
validateCurrencyProviderRequest(account);validateCurrencyProviderRequest(settlement);
const entry: CodeIssuanceEntry = {issuanceId: identity.requestId, inputDigest: 'a'.repeat(64), attemptId: identity.requestId, codeId: identity.requestId, copyId: identity.requestId, userId: 'collector', poolId: 'reward.codes', variantId: 'reward.standard', packIndex: 0, slotId: 'reward', slotOrdinal: 0, attachmentId: 'code', attachmentIndex: 0};
const issuance: CodeIssuanceRequest = {...identity, protocol: codeIssuanceProtocol, operation: 'issue', grantId: identity.requestId, generation: 1, batchId: identity.requestId, inputDigest: entry.inputDigest, deadline: 1, context: {entries: [entry]}};
const result: CodeIssuanceResult = {...entry, state: 'issued', result: {code: 'EXAMPLE-CODE', metadata: {category: 'reward', tags: ['sample'], attributes: {count: 1}, unused: null}}};
const response: CodeIssuanceResponse = {protocol: issuance.protocol, operation: issuance.operation, requestId: issuance.requestId, providerId: issuance.providerId, grantId: issuance.grantId, generation: issuance.generation, batchId: issuance.batchId, inputDigest: issuance.inputDigest, deadline: issuance.deadline, status: 'processed', results: [result]};
validateCodeIssuanceRequest(issuance);const parsedIssuance = validateCodeIssuanceResponse(input);
if (parsedIssuance.status === 'processed') parsedIssuance.results.map(row => row.issuanceId);
for (const row of matchCodeIssuanceResults(issuance, response)) {
  if (row.state === 'issued') row.result.code.toUpperCase();
  else if (row.state === 'error') row.errorCode.toUpperCase();
  else {const state: 'pending' | 'not-issued' | 'cancelled' = row.state;void state;}
}
// @ts-expect-error A status lookup always carries the code, including when externalId is null.
const missingCode: CodeProviderRequest = {...identity, protocol: codeProviderProtocol, codeId: 'code', operation: 'lookup', externalId: null};
// @ts-expect-error Unknown status provides no redemption event.
const unknownCode: CodeProviderResponse = {...identity, protocol: codeProviderProtocol, codeId: 'code', status: 'unknown', eventId: 'event'};
// @ts-expect-error A settlement amount is a decimal string, not an imprecise number.
const numericSettlement: CurrencyProviderResponse = {...settlement, status: 'settled', currency: 'credits', amountUnits: 10};
// @ts-expect-error Lookup responses cannot resolve account mappings.
const wrongOperation: CurrencyProviderResponse = {...settlement, status: 'resolved'};
// @ts-expect-error Settlement validators return typed string amounts.
if (parsedCurrency.status === 'settled') {const amount: number = parsedCurrency.amountUnits;void amount;}
// @ts-expect-error Issued entries require the generated result.
const missingResult: CodeIssuanceResult = {...entry, state: 'issued'};
// @ts-expect-error Code metadata is JSON, so executable values are excluded.
const executableResult: CodeIssuanceResult = {...entry, state: 'issued', result: {code: 'EXAMPLE', metadata: {run: () => true}}};
// @ts-expect-error Per-entry errors have a narrower enum than provider response errors.
const wrongEntryError: CodeIssuanceResult = {...entry, state: 'error', errorCode: 'unauthenticated'};
// @ts-expect-error Result matching requires a complete request context.
matchCodeIssuanceResults(identity, input);
void [codeReply, resolved, settled, codeProviderSchema, currencyProviderSchema, codeIssuanceSchema, missingCode, unknownCode, numericSettlement, wrongOperation, missingResult, executableResult, wrongEntryError];

const factoryCopy:BindingFactoryCopy={id:identity.requestId,ownerId:'collector',cardId:'reward',variantId:'reward.standard',lineId:'basic',rarityId:'common',state:'sealed',serialNumber:null,editionTotal:null,createdAt:'2026-01-01T00:00:00Z',openedAt:null,openedBy:null,acquiredAt:'2026-01-01T00:00:00Z',version:1,source:{},definition:{},variant:{},bindings:{},metadata:{}};
const factoryEntry:BindingFactoryRequestEntry={invocationId:identity.requestId,inputDigest:entry.inputDigest,attemptId:identity.requestId,copyId:factoryCopy.id,userId:factoryCopy.ownerId,namespace:'example.reward',factoryName:'reward',factoryRevision:1,kind:'pure',packIndex:0,slotId:'reward',slotOrdinal:0,input:{copy:factoryCopy,user:{id:'collector'},spec:{factory:'reward',visibility:'owner',transfer:'retain'}}};
factoryEntry.inputDigest=bindingFactoryInputDigest(factoryEntry);
const factoryRequest:BindingFactoryRequest={...issuance,protocol:bindingFactoryProtocol,operation:'produce',context:{entries:[{...factoryEntry,kind:'pure'}]}};
const factoryDigest:string=bindingFactoryInputDigest(factoryEntry);
const factoryId:string=bindingFactoryIdentity(factoryEntry).invocationId;
const factoryResult:BindingFactoryResult={...bindingFactoryIdentity(factoryEntry),state:'ready',data:{reward:'example',attributes:{count:1},tags:['reward'],unused:null}};
const {context:factoryContext,...factoryResponseIdentity}=factoryRequest;
const factoryResponse:BindingFactoryResponse={...factoryResponseIdentity,status:'processed',results:[factoryResult]};
const parsedFactory=validateBindingFactoryRequest(input);
if(parsedFactory.operation==='activate'){for(const row of parsedFactory.context.entries){const kind:'activation'=row.kind;void kind;}}
const parsedFactoryResponse=validateBindingFactoryResponse(input);
if(parsedFactoryResponse.status==='error')parsedFactoryResponse.errorCode.toUpperCase();
for(const row of matchBindingFactoryResults(factoryRequest,factoryResponse)){
  if(row.state==='ready')Object.keys(row.data);
  else if(row.state==='error')row.errorCode.toUpperCase();
  else if(row.state==='not-activated'){const kind:'activation'=row.kind;void kind;}
}
// @ts-expect-error Factory snapshots represent sealed copies.
const openedFactoryCopy:BindingFactoryCopy={...factoryCopy,state:'opened'};
// @ts-expect-error Factory variant snapshots omit binding definitions.
const factoryVariantBindings:BindingFactoryCopy={...factoryCopy,variant:{bindings:{}}};
// @ts-expect-error Production operations require pure entries.
const activationProduction:BindingFactoryRequest={...factoryRequest,operation:'produce',context:{entries:[{...factoryEntry,kind:'activation'}]}};
// @ts-expect-error Activation entries cannot be cancelled.
const cancelledActivation:BindingFactoryResult={...factoryEntry,kind:'activation',state:'cancelled'};
// @ts-expect-error A ready result requires JSON data.
const missingFactoryData:BindingFactoryResult={...factoryEntry,state:'ready'};
// @ts-expect-error Factory data cannot contain executable values.
const executableFactoryData:BindingFactoryResult={...factoryEntry,state:'ready',data:{run:()=>true}};
// @ts-expect-error Per-entry errors exclude authentication failures.
const authenticationFactoryError:BindingFactoryResult={...factoryEntry,state:'error',errorCode:'unauthenticated'};
void [bindingFactorySchema,factoryDigest,factoryId,openedFactoryCopy,factoryVariantBindings,activationProduction,cancelledActivation,missingFactoryData,executableFactoryData,authenticationFactoryError];

import {createRemoteCodeProvider, createCodeProviderRegistry, codeProviderProtocol as remoteCodeProtocol} from '@digital-card/framework/remote-code-provider';
import {createRemoteCurrencyProvider, createCurrencyProviderRegistry, currencyProviderProtocol as remoteCurrencyProtocol} from '@digital-card/framework/remote-currency-provider';
import {createRemoteCodeIssuer, createCodeIssuerRegistry, codeIssuanceProtocol as remoteIssuanceProtocol} from '@digital-card/framework/remote-code-issuer';

const remoteConfig = {providerId: 'example.provider', url: 'https://provider.example.test/status', token: 'configured-service-credential', timeoutMs: 5000, maxRequestBytes: 8192, maxResponseBytes: 8192, maxConcurrent: 2, allowLoopbackHttp: false};
const signal = new AbortController().signal;
const codeAdapter = createRemoteCodeProvider(remoteConfig);
void codeAdapter.lookup({providerId: remoteConfig.providerId, codeId: 'example.code', code: 'EXAMPLE-CODE', signal}).then(result => {
  if (result.status !== 'unknown') result.occurredAt.toUpperCase();
  // @ts-expect-error Remote code lookups return a reduced result, not a wire envelope.
  result.requestId;
});
codeAdapter.assertActive();codeAdapter.disable();
const codes = createCodeProviderRegistry({codeProviders: {'direct.codes': {lookup: ({codeId}) => ({codeId, status: 'unknown'})}}, codeProviderEndpoints: {'remote.codes': {url: remoteConfig.url, token: remoteConfig.token}}});
codes.providers['direct.codes']?.lookup({providerId: 'direct.codes', codeId: 'example.code', code: 'EXAMPLE-CODE'});
codes.disable('remote.codes');codes.close();
const currencies = {points: {currencyId: 'credits', numerator: 1, denominator: 100}};
const currencyAdapter = createRemoteCurrencyProvider({...remoteConfig, currencies});
void currencyAdapter.resolveAccount({userId: 'collector', signal}).then(accountId => accountId.toUpperCase());
void currencyAdapter.lookup({transactionId: 'purchase-1', account: 'external-account', signal}).then(result => {
  if (result.status === 'settled') {const units: string = result.amountUnits;BigInt(units);}
  // @ts-expect-error Remote error frames reject and are not lookup results.
  result.errorCode;
});
currencyAdapter.currencies.points?.currencyId.toUpperCase();currencyAdapter.assertActive();currencyAdapter.disable();
const currencyRegistry = createCurrencyProviderRegistry({currencyProviders: {'direct.currency': {currencies, resolveAccount: async ({userId}) => 'account-'+userId, lookup: ({transactionId,account}) => ({transactionId,account,status:'pending'})}}, currencyProviderEndpoints: {'remote.currency': {url: remoteConfig.url, token: remoteConfig.token, currencies}}});
currencyRegistry.disable('remote.currency');currencyRegistry.close();
const externalIssuer = createRemoteCodeIssuer({...remoteConfig, kind: 'external'});
externalIssuer.assertGrant(externalIssuer.grant());
void externalIssuer.evaluate({...issuance, ...externalIssuer.grant()}, {signal}).then(reply => {
  const processed: 'processed' = reply.status;
  for (const row of reply.results) if (row.state === 'issued') row.result.code.toUpperCase();
  return processed;
});
externalIssuer.setEnabled(false);externalIssuer.close();
const issuers = createCodeIssuerRegistry({allocationCodeIssuers: {
  'local.codes': {kind:'pure',providerId:'local.codes',generate: entry => ({code:'SAMPLE-'+entry.issuanceId,metadata:{attachment:entry.attachmentId}})},
  'external.codes': {...remoteConfig,kind:'external'},
}});
const localIssuer = issuers.issuers['local.codes'];
if (localIssuer?.kind === 'pure') {
  void localIssuer.evaluate({...issuance, ...localIssuer.grant()}, {signal}).then(reply => {
    for (const row of reply.results) {
      const state: 'issued' | 'not-issued' | 'cancelled' = row.state;void state;
    }
  });
  // @ts-expect-error Pure issuers expose close, not remote grant enablement.
  localIssuer.setEnabled(false);
}
issuers.close();createCodeIssuerRegistry().close();createCodeProviderRegistry().close();createCurrencyProviderRegistry().close();
// @ts-expect-error Remote currencies require explicit mappings.
createRemoteCurrencyProvider(remoteConfig);
// @ts-expect-error Currency ratios are numeric, not decimal-string settlement amounts.
createRemoteCurrencyProvider({...remoteConfig,currencies:{points:{currencyId:'credits',numerator:'1'}}});
// @ts-expect-error Remote provider URL configuration is a string.
createRemoteCodeProvider({...remoteConfig,url:new URL(remoteConfig.url)});
// @ts-expect-error Remote code providers disable; they do not expose a close method.
codeAdapter.close();
// @ts-expect-error Currency mappings exposed by remote adapters are immutable.
currencyAdapter.currencies.points = {currencyId:'changed'};
// @ts-expect-error Issuer generation must be synchronous.
createCodeIssuerRegistry({allocationCodeIssuers:{'local.codes':{kind:'pure',providerId:'local.codes',generate:async entry=>({code:entry.issuanceId})}}});
// @ts-expect-error The remote issuer constructor does not construct pure generators.
createRemoteCodeIssuer({...remoteConfig,kind:'pure'});
// @ts-expect-error A registry currency adapter requires both lookup callbacks.
createCurrencyProviderRegistry({currencyProviders:{broken:{resolveAccount:()=> 'account'}}});
void [remoteCodeProtocol,remoteCurrencyProtocol,remoteIssuanceProtocol];

import {bindingFactoryConfiguration, snapshotBindingFactoryUser, createRemoteBindingFactory, createBindingFactoryRegistry, bindingFactoryProtocol as remoteFactoryProtocol, type PureBindingFactoryRequest} from '@digital-card/framework/remote-binding-factory';
const factoryDescriptor=bindingFactoryConfiguration({kind:'provision',providerId:'example.factory',revision:1,userFields:['id','profile.region']});
const userSnapshot=snapshotBindingFactoryUser({id:'collector',profile:{region:'example'}},factoryDescriptor.userFields);
const remoteFactory=createRemoteBindingFactory({...remoteConfig,kind:'provision',revision:1,userFields:['id']});
remoteFactory.assertGrant(remoteFactory.grant());
const factoryScope:'binding-factory'=remoteFactory.setEnabled(true).scope;
const provisionRequest:BindingFactoryRequest={...factoryRequest,operation:'provision',context:{entries:[{...factoryEntry,kind:'provision'}]}};
remoteFactory.evaluate(provisionRequest,{signal}).then(reply=>{
  const protocol:typeof remoteFactoryProtocol=reply.protocol;
  const status:'processed'=reply.status;
  reply.results.forEach(row=>{if(row.state==='ready')Object.keys(row.data);});
  // @ts-expect-error Provider error frames reject instead of resolving.
  reply.errorCode;
  void [protocol,status];
});
remoteFactory.close();
const pureFactoryRequest:PureBindingFactoryRequest={...factoryRequest,operation:'produce',context:{entries:[{...factoryEntry,kind:'pure'}]}};
const factoryRegistry=createBindingFactoryRegistry({allocationBindingFactories:{
  local:{kind:'pure',providerId:'example.local',revision:1,produce:row=>({copyId:row.copyId,ownerId:row.input.user.id})},
  external:{...remoteConfig,kind:'activation',revision:1},
}});
const registeredFactory=factoryRegistry.factories.local;
if(registeredFactory){registeredFactory.assertGrant(registeredFactory.grant());registeredFactory.setEnabled(false);void registeredFactory.evaluate(pureFactoryRequest);}
factoryRegistry.close();createBindingFactoryRegistry().close();
// @ts-expect-error Factory user grants are immutable.
factoryDescriptor.userFields.push('private');
// @ts-expect-error Remote factories reject production callbacks.
createRemoteBindingFactory({...remoteConfig,kind:'pure',revision:1,produce:()=>({})});
// @ts-expect-error Only pure factory configurations accept production callbacks.
createBindingFactoryRegistry({allocationBindingFactories:{invalid:{kind:'provision',providerId:'example.factory',revision:1,produce:()=>({})}}});
// @ts-expect-error Pure callbacks must return synchronously.
createBindingFactoryRegistry({allocationBindingFactories:{invalid:{kind:'pure',providerId:'example.factory',revision:1,produce:async()=>({})}}});
// @ts-expect-error Factory output data must be JSON.
createBindingFactoryRegistry({allocationBindingFactories:{invalid:{kind:'pure',providerId:'example.factory',revision:1,produce:()=>({run:()=>true})}}});
// @ts-expect-error Pure evaluation cannot activate bindings.
const pureActivation:PureBindingFactoryRequest={...pureFactoryRequest,operation:'activate'};
void [userSnapshot,factoryScope,pureActivation];

import {Buffer} from 'node:buffer';
import {createStateCodec, keyFromHex, type StateCodec} from '@digital-card/framework/encryption';
const stateKey:Buffer=keyFromHex('ab'.repeat(32));
const absentStateKey:undefined=keyFromHex(undefined);
const omittedStateKey:undefined=keyFromHex();
declare const optionalHexKey:string|undefined;
const optionalStateKey:Buffer|undefined=keyFromHex(optionalHexKey);
const encryptedCodec:StateCodec=createStateCodec(stateKey);
const encodedState:string=encryptedCodec.encode({version:1,entries:[{id:'example',active:true}],extra:null});
const decodedState:unknown=encryptedCodec.decode(encodedState);
if(decodedState!==null&&typeof decodedState==='object'&&'version' in decodedState){const version:unknown=decodedState.version;void version;}
const plainCodec=createStateCodec();
plainCodec.encode(['example',1,true,null]);
createStateCodec(optionalStateKey);createStateCodec(Buffer.alloc(32));
// @ts-expect-error Encryption requires a Node.js Buffer, not a plain byte array.
createStateCodec(new Uint8Array(32));
// @ts-expect-error Hex text must first be converted to a binary key.
createStateCodec('ab'.repeat(32));
// @ts-expect-error Key text must be a string.
keyFromHex(123);
// @ts-expect-error State values must be JSON-compatible.
encryptedCodec.encode({run:()=>true});
// @ts-expect-error JSON encoding excludes bigint values.
plainCodec.encode({amount:1n});
// @ts-expect-error State decoding does not validate an application-specific shape.
const uncheckedState:{version:number}=encryptedCodec.decode(encodedState);
// @ts-expect-error Encoded state is text, not bytes.
plainCodec.decode(new Uint8Array());
void [absentStateKey,omittedStateKey,uncheckedState];

import {externalPurchaseDefinitions, externalPurchaseSchema, type ExternalPurchaseDefinitionName} from '@digital-card/framework/external-purchase-contracts';
import {createCodeVault, type CodeEnvelope} from '@digital-card/framework/code-vault';
const externalDefinitions=externalPurchaseDefinitions('#/components/schemas/');
const definitionName:ExternalPurchaseDefinitionName='ExternalRefundProof';
const externalObjectType:'object'=externalDefinitions[definitionName].type;
const externalAdditionalProperties:false=externalPurchaseSchema.$defs.ExternalPurchaseQuote.additionalProperties;
externalDefinitions.ExternalPurchaseProjection.allOf?.map(constraint=>Object.keys(constraint));
externalDefinitions.ExternalPurchaseIntent.required.map(name=>name.toUpperCase());
const defaultDefinitions=externalPurchaseDefinitions();
// @ts-expect-error Schema reference prefixes must be strings.
externalPurchaseDefinitions(42);
// @ts-expect-error Only declared host purchase definitions are returned.
externalDefinitions.ExternalPurchaseUnknown;
const vault=createCodeVault({activeKeyId:'current',keys:{current:Buffer.alloc(32)},indexKey:Buffer.alloc(32)});
const fingerprint:string=vault.fingerprint({providerId:'example',metadata:{b:2,a:1},entries:[true,null]});
const envelope:CodeEnvelope=vault.seal('EXAMPLE-CODE','code:example');
const envelopeVersion:1=envelope.version;
const decryptedCode:string=vault.open(envelope,'code:example');
// @ts-expect-error Vault key rings require actual Node.js Buffers.
createCodeVault({activeKeyId:'current',keys:{current:new Uint8Array(32)},indexKey:Buffer.alloc(32)});
// @ts-expect-error Fingerprint index keys must be Buffers.
createCodeVault({activeKeyId:'current',keys:{current:Buffer.alloc(32)},indexKey:'ab'.repeat(32)});
// @ts-expect-error Vault plaintext codes are strings.
vault.seal(123,'context');
// @ts-expect-error Vault operations require an associated context.
vault.open(envelope);
// @ts-expect-error Envelopes use the supported version literal.
vault.open({...envelope,version:2},'context');
// @ts-expect-error Envelopes require authentication tags.
vault.open({version:1,keyId:'current',iv:'example',data:'example'},'context');
// @ts-expect-error Fingerprint inputs must be JSON-compatible.
vault.fingerprint({run:()=>true});
void [externalObjectType,externalAdditionalProperties,defaultDefinitions,fingerprint,envelopeVersion,decryptedCode];

import {signPackage, verifySignatures, type SignaturePackage} from '@digital-card/framework/presentation/signatures';
import {createPresentationHandler, type PresentationHttpStore, type PresentationRouteActor} from '@digital-card/framework/presentation/node-http';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {webcrypto} from 'node:crypto';
declare const signingKeys:CryptoKeyPair;
declare const nodeSigningKey:webcrypto.CryptoKey;
declare const archiveBytes:Uint8Array;
const signaturePackage:SignaturePackage={digest:'sha256:'+'ab'.repeat(32),files:new Map([['card.json',archiveBytes]])};
const signedArchive:Promise<Uint8Array>=signPackage(archiveBytes,{keyId:'example.signer',privateKey:signingKeys.privateKey});
signPackage(archiveBytes,{keyId:'example.node',privateKey:nodeSigningKey});
verifySignatures(signaturePackage,{keys:new Map([['example.signer',signingKeys.publicKey]]),requireTrusted:true}).then(results=>{
  for(const result of results){const trusted:boolean=result.trusted;result.keyId.toUpperCase();void trusted;}
});
verifySignatures(signaturePackage);verifySignatures(signaturePackage,{keys:new Map([['example.node',nodeSigningKey]])});
// @ts-expect-error Signing requires a Web Crypto key, not encoded private-key text.
signPackage(archiveBytes,{keyId:'example.signer',privateKey:'private-key'});
// @ts-expect-error Archive inputs are bytes.
signPackage('archive',{keyId:'example.signer',privateKey:signingKeys.privateKey});
// @ts-expect-error Trust keys are keyed CryptoKey values.
verifySignatures(signaturePackage,{keys:new Map([['example.signer','public-key']])});
// @ts-expect-error Verification requires the validated package digest.
verifySignatures({files:new Map()});
interface HttpIdentity {userId:string;disabled?:boolean;role:'editor'|'admin'}
type HttpRouteActor=PresentationRouteActor<HttpIdentity>;
const httpStore:PresentationHttpStore<HttpRouteActor>={
  async checkAccess(actor,action){actor.id.toUpperCase();actor.role.toUpperCase();const requested:'import'=action;void requested;},
  async import(actor,bytes,options){bytes.byteLength.toFixed();options.idempotencyKey?.toUpperCase();return {actor:actor.id};},
  async get(actor,id){return {actor:actor.id,id};},
  async publish(actor,id){return {actor:actor.id,id};},
  async cancel(actor,id){return {actor:actor.id,id};},
  async file(digest,relative){return {bytes:new Uint8Array(),mediaType:relative.endsWith('.json')?'application/json':'application/zip'};},
  async descriptor(digest){return {digest};},
};
const presentationHandler=createPresentationHandler<HttpIdentity>({store:httpStore,allowedOrigin:'https://cards.example',prefix:'/presentations',maxUploadBytes:1024,resolveIdentity:async request=>({userId:request.headers['x-user']?.toString()??'editor',role:'editor'}),rateLimit:({actor,request,mutation})=>actor.role==='admin'||(!mutation&&request.method==='GET')});
declare const httpRequest:IncomingMessage;
declare const httpResponse:ServerResponse;
presentationHandler(httpRequest,httpResponse).then(handled=>{const routed:boolean=handled;void routed;});
// @ts-expect-error Authentication must return an identity with userId.
createPresentationHandler({store:httpStore,allowedOrigin:'https://cards.example',resolveIdentity:()=>({id:'editor'})});
// @ts-expect-error Rate limits must resolve synchronously.
createPresentationHandler<HttpIdentity>({store:httpStore,allowedOrigin:'https://cards.example',resolveIdentity:()=>({userId:'editor',role:'editor'}),rateLimit:async()=>true});
// @ts-expect-error The Node adapter requires a Node request and response.
presentationHandler(new Request('https://cards.example/presentations/imports'),new Response());
// @ts-expect-error The handler does not own or close the store.
presentationHandler.close();
void signedArchive;
