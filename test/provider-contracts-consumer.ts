import {codeProviderProtocol, codeProviderSchema, validateCodeProviderRequest, validateCodeProviderResponse, type CodeProviderRequest, type CodeProviderResponse} from '@digital-card/framework/code-provider-contracts';
import {currencyProviderProtocol, currencyProviderSchema, validateCurrencyProviderRequest, validateCurrencyProviderResponse, type CurrencyProviderRequest, type CurrencyProviderResponse} from '@digital-card/framework/currency-provider-contracts';
import {codeIssuanceProtocol, codeIssuanceSchema, validateCodeIssuanceRequest, validateCodeIssuanceResponse, matchCodeIssuanceResults, type CodeIssuanceRequest, type CodeIssuanceResponse, type CodeIssuanceEntry, type CodeIssuanceResult} from '@digital-card/framework/code-issuance-contracts';

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
