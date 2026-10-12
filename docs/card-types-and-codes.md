# Add code cards and hybrid rewards

Applies to framework 0.2. Use the headless APIs, HTTP API, or replaceable private Code history view. Run the complete example with `node examples/code-cards.mjs`.

## Choose a type

| Type | Default collection / album picker | Tradable | Trade-up input |
| --- | --- | --- | --- |
| `collectible` (default), `playable`, `art` | Included | Yes | Yes |
| `token` | Included | Yes | No |
| `checklist` | Hidden | Yes | No |
| `code`, `voucher`, `reward` | Hidden | No | No |

These types classify cards and supply behavior defaults. They do not implement game rules, stored-value balances or ticket scanning. All default types are album-eligible; the picker can explicitly include hidden inserts. Override `behavior.collectionDefault`, `albumDefault`, `albumEligible`, `tradable` and `tradeUp` on a card definition. Issued copies retain their behavior snapshot after catalog changes.

Declare your own type in catalog `cardTypes`, for example:

```js
cardTypes: [{id:'example.ticket', name:'Admission ticket', defaults:{
  collectionDefault:false, albumDefault:false, albumEligible:false,
  tradable:false, tradeUp:false
}}]
```

Custom type IDs need a namespace. Validation rejects undeclared types. A **hybrid** is an ordinary card variant with code attachments; it keeps its ordinary collection behavior. Code-bearing copies cannot be consumed as trade-up inputs, even if their card type normally permits it.

For account unlocks without displaying a code, declare `onOpen` actions instead. Code, voucher and reward variants accept code attachments, opening actions, or both. See [account rewards](card-actions.md).

## Attach a code and add an insert slot

A code or voucher variant requires at least one attachment. Any variant can have up to eight. Attachments hold references, never raw secrets:

```js
// Catalog variant
{id:'bonus.standard', cardId:'bonus', rarityId:'common', codes:[{
  id:'reward', poolId:'external.rewards', title:'Your game reward',
  reveal:'scratch', transfer:'retain'
}]}

// Add this slot to a product alongside its ordinary card slots.
{id:'bonus', role:'insert', count:1,
 pool:[{variantId:'bonus.standard', weight:1}],
 metadata:{campaign:'summer'}}
```

A guaranteed slot with `count:1` produces one insert per pack. Add `probability:{numerator:1,denominator:5}` for a one-in-five chance. The decision happens once per slot per pack. An insert does not satisfy normal-card pity or duplicate protection. Every product needs at least one guaranteed slot.

Codes are reserved at purchase, in the same transaction as payment and card issuance. Opening animations do not allocate another code. If required stock runs out, the entire purchase rolls back. Optional slots are skipped only by their configured probability, not silently because of missing stock. A pool with multiple variants chooses among available outcomes using existing weighted draw rules.

## Configure encrypted stock

Supply a vault to `new CardFramework({store,codeVault})`. Import only codes already valid at the external service. Importing a string does not register it at that service.

```js
import {createCodeVault} from '@digital-card/framework/code-vault';
const codeVault=createCodeVault({
  activeKeyId:'v1',
  keys:{v1:encryptionKeyBuffer}, // 32 random bytes, kept outside the database
  indexKey:indexKeyBuffer      // separate persistent 32-byte key
});

framework.configureCodePool(operator, {key:'pool-create',pool:{
  id:'external.rewards',providerId:'example.game',name:'Game reward',
  normalization:'exact',enabled:true,
  redeemUrl:'https://example.com/redeem',
  instructions:'Enter this code in your game account.',
  metadata:{region:'global'}
}});
framework.importCodes(operator, {key:'delivery-123',poolId:'external.rewards',
  codes:receivedCodes.map(item=>({code:item.value,externalId:item.id,
    expiresAt:item.expiry,metadata:{edition:'summer'}})),
  metadata:{delivery:'123'}
});
```

The server principal needs `codes.manage` to configure pools, `codes.import` to add stock, and `codes.confirm` to record verified external status. Player JSON cannot grant those permissions. HTTP operator routes additionally require `exposeOperators:true`.

Imports are atomic and idempotent, limited to 1,000 entries / 2 MiB per batch. Code values are nonempty strings up to 512 characters without control characters. Duplicate codes and external references are rejected across all pools sharing a provider. `exact` preserves spelling and whitespace; `upper-trim` explicitly trims and uppercases. All pools for one provider must share normalization, and pool provider/normalization cannot change later. Use a stable retry key for the same batch; changed contents require a new key.

`codePools(operator)` returns pool configuration and counts. `codeInventory(operator,{limit,after,search,sort})` returns paginated secret-free stock records, including batch ID, external reference, allocation, holder history and lifecycle. Search by batch or provider reference to reconcile a delivery without revealing values. Both require `codes.manage`.

Stock uses AES-256-GCM envelopes with authenticated row/pool/provider context. Duplicate lookup and retry input fingerprints use a separate HMAC key. Plaintext is absent from saved retry results, state events, catalogs, receipts and history. Do not put secrets in metadata, artwork, legacy arbitrary bindings, URLs, logs or portable card bundles: those fields are not secret storage.

## Generate codes during purchase

A host can issue codes instead of importing stock. Install a synchronous factory when constructing the framework, then reference its ID in the pool:

```js
import {randomBytes,randomUUID} from 'node:crypto';

const framework=new CardFramework({
  store,codeVault,
  codeGenerators:{
    'game.reward':({copy,pool})=>({
      code:randomBytes(18).toString('base64url'),
      externalId:randomUUID(),
      metadata:{edition:1}
    })
  }
});
framework.configureCodePool(operator,{key:'generated-pool',pool:{
  id:'game.generated',providerId:'example.game',
  name:'Game reward',generator:'game.reward',normalization:'exact'
}});
```

The factory runs inside the pack transaction and receives isolated copy and pool snapshots. It returns `{code,externalId?,metadata?}`. Use cryptographically secure randomness. Return synchronously, perform no network or filesystem work, and keep metadata free of secrets. A later rollback cannot undo side effects outside the transaction.

Generation happens at purchase. Repeating a successful purchase or reopening a pack does not call the factory again. A collision, unavailable factory or invalid value rolls back the debit, all packs, codes and retry record together. Generated codes use the same encrypted vault, capacity limits and ownership rules as imported stock. The pool's generator, provider and normalization are immutable.

A trusted host requiring upstream registration can call `codeRegistrationMaterial(operator,codeId)` with `codes.manage`. This server-only method returns `{codeId,providerId,externalId,holderId,copyId,metadata,code}`, including for a sealed pack. It has no HTTP endpoint. Send this material over an authenticated private connection, register idempotently by `codeId`, and withhold player reveal until registration succeeds. Do not log, cache or expose the registration material to the browser. Creating a code does not itself make an external service accept it.

## Reveal, report and verify usage

```js
const history=framework.codeHistory(player,{limit:24,search:'summer'});
const secret=framework.revealCode(player,{key:'reveal-123',codeId});
framework.reportCodeUsage(player,{key:'report-123',codeId,used:true});
```

Private history is paginated and includes used, expired, revoked and retained codes. The reveal endpoint rechecks current entitlement on every retry. It rejects sealed packs, another holder, trade locks and an initial reveal after expiry or revocation/redemption. An authorized holder can reread a code they already revealed, including after expiry or use. History provides `canReveal` and an explanation when access is unavailable.

Three facts stay separate:

- **Revealed:** the server disclosed the code to its holder.
- **Reported used:** the holder marked it used; they can clear this personal annotation.
- **Redeemed / revoked:** a trusted operator or provider confirmed a terminal status.

Code responses use `Cache-Control: no-store`. The reference UI keeps secrets only in memory and clears its view on disposal. A bearer code cannot be made secret again after someone copies it.

For provider status lookup, supply `createCodeGateway({framework,providers})` from the public `code-gateway` subpath. Each configured provider implements `lookup({codeId,providerId,externalId,code,signal})` and returns `{codeId,status:'unknown'}` or `{codeId,status:'redeemed'|'revoked',eventId,occurredAt}`. The adapter must authenticate its upstream response and honor cancellation. The bridge validates code identity, enforces a timeout, sanitizes provider errors and deduplicates confirmed events. It performs no external redemption action.

A verified webhook can instead call `confirmCodeStatus` with those fields plus `providerId`. Verify its signature before constructing a server principal. Restrict that principal with `permissions:['codes.confirm'],codeProviderIds:['example.game']`. Reused events with conflicting payloads and conflicting terminal states fail closed. Without provider integration, reported usage remains unverified.

## Decide what happens on trade

| Attachment policy | Result |
| --- | --- |
| `retain` (default) | The original holder retains the code and history when the physical card copy trades. The next owner cannot reveal it. |
| `follow-unrevealed` | The entitlement moves with the card while undisclosed and unused. Reveal, reported use, confirmed use or revocation blocks later transfer. Prior holders retain a secret-free historical entry. |
| `block` | The attachment blocks card transfer. |

The card's `behavior.tradable` must also allow trading. A code card is nontradable by default. Trade review includes attachment status, and entitlement changes update copy versions so stale offers cannot silently complete. These policies govern in-app access; external providers govern whether a code is valid at redemption time.

## Replace the reveal interaction

`mountFramework(root,{client,codeRevealRenderer})` accepts a complete custom renderer. Use `views.codes` to replace the entire history view or remove `codes` from configured sections. Headless users need no DOM.

```js
import {renderCodeReveal,createCodeRevealController}
  from '@digital-card/framework/code-ui';

const view=renderCodeReveal({codeId,mode:'peel'}, {
  reveal:input=>client.revealCode(input),
  key:client.requestKey,
  threshold:0.45
});
container.append(view.node);
// On unmount:
view.dispose();
```

Built-in `scratch` and `peel` interactions call the authenticated reveal callback after the threshold is reached. An equivalent button supports keyboard users. `open` automatically calls the same endpoint only inside the private history view. No secret sits underneath a cosmetic mask before reveal. The headless controller coalesces in-flight requests and retains the same key for retry. Never put reveal results or import inputs into a persistent command queue.

Custom renderer signature: `({codeId,mode},{reveal,key}) => {node,dispose}`. A renderer receives a callback, not preloaded plaintext. Replace the look and gesture without modifying authorization. The runnable [example](../examples/code-cards.mjs) demonstrates ordinary cards, hybrids, inserts and an alternative provider composition using public APIs.

## Read origin metadata

Every new copy has immutable `provenance` with `version`, `catalogVersion`, `issuedAt`, `definitionDigest`, `variantDigest` and its source fields. Pack copies also record:

- `purchaseId`, `packId`, `productId`, `productRevision`, `productDigest`;
- `packIndex`, `position`, `slotId`, `slotIndex`, `slotRole`, `slotOrdinal`;
- `packMetadata` and `slotMetadata` snapshots.

Trade-up origins record their input copy IDs. Non-pack origins remain explicit. Copy issue, opening, code allocation/disclosure/status and card transfers emit ordered events. Code history retains import/batch information in operator state and holder lifecycle entries. There is no plaintext code in those events. Authorized operators use existing event APIs; owners inspect their copies and private code history. Public views omit purchase linkage, private pack/slot metadata and account transfer trails.

`backfillProvenance(operator)` requires `maintenance.run` and fills only missing records from existing copy/pack evidence. The production host runs it on startup. Reconstructed records are marked `reconstructed:true`; unavailable historical fields remain absent or null. Backfill cannot recover metadata never recorded. Metadata objects are bounded to 32 KiB, depth 16 and 10,000 nodes; they are structured data, not executable code.

## Deploy and operate

The production host reads `CODE_ACTIVE_KEY_ID`, `CODE_VAULT_KEYS` (JSON mapping key ID to 64-digit hexadecimal key) and `CODE_INDEX_KEY` (64 hexadecimal digits). Keys also support `_FILE` secret injection. Keep code keys distinct from each other and the state encryption key. Startup verifies stored code envelopes and fails if a code-bearing catalog lacks vault configuration.

Rotate encryption by loading both old and new keys, selecting the new active key, and invoking trusted server-only `rotateCodeEncryption(operator)`. Verification and rotation include retained generated-issuance custody as well as attached code records; the returned count includes both. Verify with `verifyCodeVault(operator)` before removing old keys. Keep keys needed by old backups. **Keep the index key stable**; replacing it fails closed and requires an explicit migration, which is not provided. Back up the database and both key families separately and test restores.

`codeLimits:{maxCodes,maxRequests}` adjusts bounded inventory and retry/confirmation capacities (defaults 50,000 and 200,000). SQLite still has its whole-state 64 MiB default limit; those row limits do not promise that every payload will fit. Allocation is transactional across connections, not a distributed high-throughput service. Configure production identity, TLS, rate limiting and access according to [production setup](production.md). Refund/reissue policy, upstream redemption, webhook authentication and retention requirements belong to the host.

See [HTTP schemas](openapi.json) for private `/codes`, `/codes/reveal`, `/codes/report`, optional `/codes/reconcile`, and privileged `/operator/codes`, `/operator/code-pools`, `/operator/codes/import`, `/operator/codes/confirm`. All paths are under `/api`.

### Remote code-status providers

The production host accepts data-only `HOST_MODULE.codeProviderEndpoints` configuration. The framework supplies the HTTP client; a provider can implement the JSON protocol in any language. This route performs read-only status lookup, never redemption. Existing `codeProviders` adapters remain supported; the same provider ID cannot be configured in both registries.

```js
export const codeProviderEndpoints = {
  'example.game': {
    url: 'https://codes.example.com/status',
    token: process.env.CODE_STATUS_TOKEN
  }
};
```

Endpoints are trusted operator configuration. Use HTTPS and a provider-specific secret; URLs cannot contain credentials, query strings or fragments, and redirects are rejected. `allowLoopbackHttp: true` permits HTTP only for explicit loopback development endpoints. Never publish credentials or codes in logs. Only a caller authorized by the framework can obtain lookup material; the configured provider receives the selected code and external reference.

The versioned `digital-card-code-status@1` contract is published as [JSON Schema](code-provider.schema.json) and exported from `@digital-card/framework/code-provider-contracts`. Requests include a unique request ID, provider ID, code ID, operation, external reference and code. Replies must echo the identities and contain `unknown`, `redeemed`, `revoked` or a bounded protocol error. Confirmed statuses require the provider's stable event ID and UTC occurrence time; the core deduplicates confirmations. An unknown result remains unverified. Text limits follow the core’s UTF-16 length bounds (512 for codes, 300 for external references and event IDs); unpaired surrogates are rejected. The supplied validators apply these checks in addition to JSON Schema.

Transport defaults are a 10-second deadline, 8 KiB request and response limits, and eight concurrent lookups per provider. Configuration supports `timeoutMs` up to 120000, byte limits up to 65536 and `maxConcurrent` up to 64. The gateway's own deadline also applies. Responses must be uncompressed JSON; mismatched identities, malformed output and oversized bodies are rejected. Provider failures are sanitized at the gateway.

Custom hosts may import `createRemoteCodeProvider` or `createCodeProviderRegistry` from `@digital-card/framework/remote-code-provider`. A registry exposes providers plus `disable(providerId)` and `close()`. Disable permanently rejects new lookups, aborts active transport and prevents results not yet admitted for confirmation. It cannot undo a confirmation already admitted to the framework worker. Replace an instance with a newly configured credential to resume service.

This provider bridge is separate from general plugin commands, policy/allocation hooks and operating-system isolation. Protocol compatibility alone does not establish qualified support for every language or deployment.

The [Python standard-library example](../examples/plugins/python-code-provider.py) implements a synthetic, read-only registry. Set `CODE_PROVIDER_TOKEN` and optionally `CODE_PROVIDER_ID` (default `example.game`), then run `python examples/plugins/python-code-provider.py records.json 8081`. Its loopback endpoint is `/code-status`; use the explicit loopback option in the host for local testing. The registry file contains at most 100 entries within 64 KiB, each with `code`, `externalId`, `status`, `eventId` and `occurredAt`. Only exact code/reference matches return a confirmed status. Replace the fixture lookup with an authenticated authoritative provider integration for real deployment.

## Generated-code allocation

Generated-code allocation uses `weighted-deck@3` with a separately configured issuer. Configure `allocationCodeIssuers` by the pool's generator name. Native `codeGenerators` callbacks retain their existing behavior and are not automatically treated as safe external issuers.

A pure issuer uses `{kind: 'pure', providerId, generate(entry)}`. It must return the same result for the same pinned identity, synchronously and without external effects. An external issuer uses `{kind: 'external', providerId, url, token}` and implements the [code issuance protocol](code-issuance.schema.json). It must deduplicate issuance identities, reject conflicting inputs and make cancellation terminal, including when cancellation races an earlier request. A timeout does not prove that no code was issued.

The framework retains the selected plan and issuance identities before contacting an issuer. Generated results stay encrypted until attachment. Retrying an accepted purchase uses the same identities; it does not draw replacement cards or create a new issuance operation. Payment compensation and issuer cleanup are separate obligations: a completed refund does not prove that an upstream code has been cancelled.

When issuance is reserved, allocation status, stock allocation status and external purchase projections include `codeIssuanceBatchId`. Use this value to identify a batch for recovery. Operators with `codes.manage` can read `GET /api/operator/code-issuance/status?batchId=...` or call `client.codeIssuanceStatus({batchId})`. Status reads never contact the issuer. The response contains the batch identity, lifecycle state, bounded counts and a public error code; it contains no generated material or individual code identities.

To resume a batch, use `POST /api/operator/code-issuance/recover` with `{batchId}`, or `client.recoverCodeIssuance({batchId})`. Recovery looks up retained identities or completes terminal cancellation; it never requests new issuance. Resume the original purchase command to issue missing results after its admission checks are refreshed. Keep operator routes restricted to trusted principals and use the configured host origin for mutations. If recovery remains pending or quarantined, retain its records and issuer identity; do not delete the batch or submit a replacement to bypass it.

The [Node issuer example](../examples/plugins/node-code-issuer.mjs) provides a synthetic durable issuer for local integration testing. Set `CODE_ISSUER_TOKEN` and optionally `CODE_ISSUER_PROVIDER_ID` (default `example.issuer`), then run `node examples/plugins/node-code-issuer.mjs issuer.sqlite 8082`. Its loopback endpoint is `/code-issuance`; enable `allowLoopbackHttp: true` explicitly in the issuer configuration for local use. Keep the database across restarts: it holds deduplicated results and terminal cancellation records. The example creates synthetic codes; connect a real fulfillment service before using this workflow to deliver rewards.

Requests contain at most 128 occurrences per batch. Results may contain a code of up to 512 UTF-16 units, an optional external reference of up to 300 units, and metadata of up to 2 KiB of encoded JSON. The supplied validators also enforce nesting, node and total-byte limits. Use the exported validators alongside the schema when implementing an issuer.
