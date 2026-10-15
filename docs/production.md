# Production host and operations

Version 0.2.0 supports one small installation with local framework currencies, encrypted SQLite, verified OIDC identity and a replaceable browser application. The loopback playground uses fictional login and funding. Run `host/server.js` for real accounts.

## Configure and start

Choose an explicit [capability profile](capabilities.md) in the catalog. New installations default to collection-only; the sample catalog explicitly enables the demo workflows. For an existing database without a versioned profile, publish a reviewed profile through catalog import before admitting new pack, trade or commerce operations. Retain primitives required by pending work during disable or migration.

Use Node 24.14+ (verified with 24.19) and pnpm 11.19.0. Install with `pnpm install --frozen-lockfile`. Copy `.env.example` to an ignored `.env` and supply:

| Setting | Meaning |
| --- | --- |
| `SITE_ORIGIN` | Exact HTTPS origin, without a trailing slash |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID` | Registered OIDC application; redirect URI is `SITE_ORIGIN/auth/callback` |
| `OIDC_CLIENT_SECRET_FILE` | UTF-8 file containing the confidential client secret |
| `STATE_ENCRYPTION_KEY_FILE` | UTF-8 file containing exactly 64 hex characters: a random 32-byte AES key |
| `OPERATOR_SUBJECTS` | JSON array of immutable subjects authorized to operate the catalog; default empty |
| `CATALOG_FILE` | Complete JSON/YAML catalog for first initialization |
| `DATABASE_PATH` | Protected persistent storage path; default `data/production.sqlite` |
| `ASSET_ORIGINS` | Comma-separated exact HTTPS origins permitted for artwork |
| `HOST_MODULE` | Optional trusted server extension module |

Secrets can also be supplied by environment variables without the `_FILE` suffix. Keep files and backups out of Git. Generate the state key directly into a protected file, rather than printing it to logs:

```sh
node -e "require('node:fs').mkdirSync('secrets',{recursive:true});require('node:fs').writeFileSync('secrets/state-key.txt',require('node:crypto').randomBytes(32).toString('hex'),{mode:0o600})"
```

On Windows, restrict the directory ACL to the service/operator account. Preserve the key in separate protected recovery storage. Losing it makes encrypted state and sessions unreadable.

Create your licensed catalog and assets. Starter content in `examples/catalog.js` is a generic demo, including a named demo binding factory. Production startup refuses missing factories; provide your real factories or remove unused bindings from a new catalog before its first publication. Optional operator imports are server-authorized; a browser cannot grant itself an operator role.

Run `node --env-file=.env host/server.js` behind your HTTPS reverse proxy. Native Node binds loopback by default. The Docker image binds port 8080 on its container network. `compose.yaml` includes Caddy TLS ingress, a non-root app, read-only application filesystem, a persistent data volume, secret mounts and health checks. Set `SITE_HOST` to the hostname matching `SITE_ORIGIN`, point DNS to the host and run `docker compose up --build -d`. No application port is published directly.

## Identity and HTTP boundary

OIDC is the supported language-independent sign-in route. Configure `OIDC_ISSUER`, `OIDC_CLIENT_ID` and the client secret for a registered application with the exact `SITE_ORIGIN/auth/callback` redirect URI. A provider written in Go, Python or another language connects through OIDC discovery and authorization-code endpoints; it does not need a JavaScript `identityProvider` adapter. Provider role claims do not grant framework permissions. Operator access remains under the host's access configuration, including explicit grants for an optional remote access provider.

The default maintained OIDC client verifies authorization-code flow with PKCE, state, nonce and issuer. Stable issuer/subject pairs identify collectors. Sessions use opaque random tokens, hashed lookup keys and encrypted payloads in SQLite. Production cookies are `__Host-`, Secure, HttpOnly and SameSite=Lax. Logout revokes the durable session. Login challenges expire and are consumed once. Ordinary session lookups use read-only queries; expired rows are rejected immediately and cleaned during later session allocation. Consuming a login challenge still uses an atomic write transaction. At most 20,000 active sessions/challenges are retained by default; allocation cleans expired rows and enforces capacity atomically. Trusted `sessionOptions.maxSessions` can adjust the cap through `HOST_MODULE`.

Every write requires exact `Origin`, JSON content type and `X-DC-Principal` matching the verified session. The browser client learns the principal through `me()`. This also stops a stale tab from sending another account's saved commands after account switching. Accept/counter commands require the reviewed immutable trade digest. Snapshot versions, ownership, feature flags, funds and transfer policies are checked again at execution.

Normal request bodies are capped at 1 MiB; operator import requests at 8 MiB. Default rate limits are 240 reads and 40 writes per minute with at most 20,000 buckets. Both direct peer and authenticated principal are limited. Forwarded IP headers are ignored. A proxy makes many users share a peer bucket: configure a trusted proxy-aware limiter through `HOST_MODULE` for your topology; never trust arbitrary forwarded headers.

The reference app serves an explicit file allowlist with restrictive CSP, no framing, no embedded executable card code and no database/secret paths. Album CSS is contained in a Shadow DOM; authorized content authors still control their album's appearance and external asset references. List permitted content origins deliberately. Imported metadata is rendered as text.

## Supported capacity

The default production limits are 500 users, 5,000 lifetime allocated copies (including consumed and sealed copies), 2,000 packs, 20,000 durable commands, 2,000 albums and 2,000 trades. A collector can have at most 1,000 non-consumed copies and 500 lifetime packs. Encoded record payloads plus admitted external-purchase completion space have a 64 MiB budget. SQLite pages, indexes, sessions and WAL files need additional disk space. Large metadata, snapshots, events and receipts can hit the payload budget earlier. Capacity failures return 507 and roll back the whole transaction. Limits are trusted server configuration, validated as positive integers, and may be changed through `HOST_MODULE` after capacity planning.

Set the ordinary payload budget with `export const storageOptions = {maxStateBytes: 128 * 1024 * 1024}` in the trusted `HOST_MODULE`. The default is 64 MiB; values must be positive safe integers in bytes. Only `maxStateBytes` is accepted in this configuration object. This changes storage admission, not copy, pack, command or completion limits. Plan these limits together, allow additional disk and memory headroom, and preserve the same configuration when restarting or restoring. Raising the budget does not establish acceptable performance at the larger capacity.

Trade offers, listings and sealed packs also reserve completion receipts, events, queued actions and encoded bytes when admitted. The default completion limits are 100,000 obligations, 100,000 receipts, 100,000 jobs, 500,000 events and 64 MiB. These are separate from ordinary command and queue limits. SQLite's `maxCompletionBytes` bounds the additional payload allowance; configure it consistently with `limits.completionBytes`. Both ordinary and completion payloads count toward the combined ceiling. Once actual payloads exceed the ordinary budget, unrelated growing writes are rejected; retained completion receipts do not create a reusable storage discount.

Every newly queued action reserves 64 KiB for delivery bookkeeping, covering up to 100 automatic attempts. That reservation remains until delivery succeeds or reaches its terminal failed state. Operator retries are new admissions and can fail for capacity before dispatch. Pending completion subscriptions retain their admitted handlers; removing a subscription prevents future delivery jobs from that obligation, while adding one does not expand its reservation. Do not lower limits below outstanding reservations. These logical limits cannot prevent disk exhaustion or replace backup and restore procedures.

The production host backfills reservations for older pending trades, active listings, sealed packs and queued deliveries before admitting traffic. This migration is atomic and repeatable; it preserves existing receipts, escrow and job identities. SDK hosts must call `framework.backfillCompletionReservations(maintenancePrincipal)` with `maintenance.run` permission before serving new commands. Until backfill succeeds, new admissions return `COMPLETION_MIGRATION_REQUIRED`; reads, existing receipt replay and obligation resolution remain available. `COMPLETION_CAPACITY` leaves the old state unchanged: increase the named completion count limit, or `limits.completionBytes` for a byte-capacity failure, then retry backfill. The production host applies `limits.completionBytes` to SQLite's completion ceiling too. A custom SDK host must also set `SQLiteStore({maxCompletionBytes})` consistently. Backfill can use completion space when ordinary storage is full; opening a read-only SQLite store never performs this logical migration.

Storage schema 8 persists encrypted entity records and indexed identity, collection, pack and payment queries. Code history selects records for the current or former holder, excludes sealed copies, and preserves search and paging behavior. History search and sorting still inspect that holder's eligible records. Compatibility command callbacks still synchronously materialize the logical state; commits write changed records. Unchanged reads and exact command replays do not rewrite framework state. Use one app instance for this deployment profile, monitor state size, latency, disk space and failures, and plan migration before reaching limits. Durable receipts and event history are preserved; there is no automatic destructive retention or hidden idempotency cutoff. Larger installations need measured asynchronous command and storage contracts before increasing this profile.

The server command-intent journal defaults to 100,000 retained intents (`limits.commandIntents`). Each registered input is bounded to 1 MiB and has reserved space for finalization and acknowledgement. Current recovery heads are indexed by account and command kind; discovery reads at most one head for each of the 22 supported command kinds. Completed and failed heads remain until explicit acknowledgement. Acknowledged records and original receipts remain retained, so reaching this limit rejects new registrations without deleting unresolved evidence. Previously admitted recovery and acknowledgement remain available within their completion reservations. Plan journal capacity before reaching the retained-intent limit.

`node tools/benchmark.js` creates isolated temporary encrypted state, seeds 5 users/5,000 copies and exercises read/write/trade paths. Measure on your deployment hardware and include concurrent traffic and provider delays. Serial fixture timings do not establish a service SLA.

## Upgrade the state schema

Stop writers and take a verified backup with its matching encryption keys using the current application's tools. Opening a supported schema-1 through schema-7 framework database with writable `SQLiteStore` migrates it atomically to schema 8, preserving the logical records and co-located authentication sessions. Schema-2 migration adds an index of current and former code holders. Schema 4 replaces positional notification storage keys with blind hashes of stable notification IDs and adds an operational owner/order index; notification content stays encrypted. Schemas 5 and 6 add indexed action and expiration work; schemas 7 and 8 add owned-card and imported-code projections. Other entity ciphertext is preserved when upgrading indexed databases. Logical notification order and public IDs remain unchanged. Notification accounting is invalidated and prepared again by writable service startup. If longer encrypted identities need capacity, migration rolls back with `STORAGE_CAPACITY`; increase `maxStateBytes` before retrying, or reopen read-only for inspection. The migration does not change card, pack, code or receipt identities. Read-only opens cannot migrate; schema-3 through schema-7 databases remain available for read-only inspection using the new application. An unsupported newer schema or incorrect encryption key is refused before framework schema changes.

Startup inspects a protected temporary copy of the database and its recovery files before opening the authoritative source. Provide temporary disk space for those copies. Successful SQLite readers may update shared-memory coordination files. Identity, private map lookup keys and code-history holder lookup keys are blinded; operational card/pack/code IDs and the names and states needed by indexed collection queries remain visible in indexes. Code-history indexes also expose the association between code IDs and copy IDs. Encryption protects record contents; restrict access to the entire database directory and its sidecars.

Retain the old database and application revision for rollback. Applications supporting only earlier schemas refuse schema 8; do not run an older writer against the upgraded database. Roll back only before the upgraded service accepts new activity; otherwise preserve its current state and repair or migrate forward. Verify integrity, an existing collector's cards, administrator access, code history and any pending external purchases before resuming traffic. A state schema upgrade does not reconcile a host's payment journal or external wallet; follow that adapter's recovery procedure too.

## Backup, restore and encryption rotation

Take online backups using the SQLite backup API, with the same key configuration as the host:

```sh
node --env-file=.env tools/backup.js data/production.sqlite backups/cards-2026-10-01.sqlite
```

For a stopped-writer backup before an upgrade, stop the service and append `--stopped`. This preserves the source files and storage schema in the backup artifact, including a schema-1 database needed by an older application:

```sh
node --env-file=.env tools/backup.js data/production.sqlite backups/cards-before-upgrade.sqlite --stopped
```

The destination must be new. The tool captures a consistent SQLite snapshot and verifies its integrity and framework supply, ownership, escrow, album and ledger invariants in a separate validation copy. It includes durable authentication sessions. Store backups and encryption keys separately, restrict access and exercise restores on isolated paths. Avoid copying a live database file without its WAL protocol.

To restore, stop the service, preserve the damaged/current database and its SQLite sidecars, place the verified backup at a new configured `DATABASE_PATH`, provide its matching key, then start. Startup performs integrity checks. Restore the service and run a collector sign-in and a synthetic transaction before accepting normal traffic. Recovery rolls state back to the backup; reconcile any external systems separately.

`tools/migrate-encryption.js source.sqlite new.sqlite` writes a verified new encrypted database and preserves the source. Supply the new `STATE_ENCRYPTION_KEY`/file; supply `OLD_STATE_ENCRYPTION_KEY`/file when the source is already encrypted. A plaintext demo source needs no old key. Sessions are intentionally not copied during migration, so collectors sign in again. Stop writers during migration/cutover. Keep the old key with old backups until the recovery policy permits retiring them.

### Recover database and published artwork together

For a host using `PRESENTATION_ROOT`, stop the host and all other database or presentation writers before creating a recovery bundle:

```sh
node --env-file=.env tools/recovery.js backup data/production.sqlite data/presentations backups/full-recovery --stopped
```

The destination must be new. The bundle contains the database, published presentation files and availability policies, durable import jobs, and their retained uploads. It preserves encrypted state, sessions and code-vault data; it does not contain encryption keys. Supply the same state and code-vault key configuration used by the host. Keep those keys in separate protected recovery storage.

The tool verifies database invariants, decryption, file hashes, presentation archives and local presentation references. Stop and drain active imports before backup. A writer lock, active job or unfinished publication causes refusal rather than a partial checkpoint. References to externally hosted assets remain external; back up those assets and reconcile external payment or fulfillment systems separately.

Restore into a new installation directory while the host is stopped:

```sh
node --env-file=.env tools/recovery.js restore backups/full-recovery data/restored --stopped
```

After verification, the tool publishes `data/restored/state.sqlite` and `data/restored/presentations` together. Existing destinations are refused. Configure `DATABASE_PATH` and `PRESENTATION_ROOT` to those paths, retain the matching keys, and start an isolated host first. Check collector sign-in, card artwork, moderation policy, preserved import jobs and a synthetic transaction before returning traffic. Presentation URLs are not rewritten: retain their routing or configure the corresponding origin separately.

An older bundle can omit payment intents created after backup while an external debit survives. Keep the newer installation stopped and preserved, and consult its authoritative order status together with the provider's durable journal before admitting recovery. A debit receipt alone does not prove that fulfillment never happened. Only when the newer ledger proves the order remained prepared and unfulfilled, no other later economic activity is lost, and the exact original review remains admissible may trusted host code reconstruct it: expect original-transaction lookup on the older restore to return `NOT_FOUND`, call `prepareExternalPurchase` with the journal's unchanged original input, verify the original preparation ID/fingerprint, then commit using the authenticated original debit proof. Reuse that transaction/key for status and replay; do not debit again.

If earlier fulfillment is known or uncertain, records are missing or contradictory, or the original reviewed terms no longer admit, refuse automatic reconstruction. Reconcile or repair forward from the preserved newer ledger and provider history. Do not refund from an exception, issue replacement copies, inject later receipt/copy records into an older database, or substitute the separate legacy-credit adoption route. This procedure qualifies a known-unfulfilled paid order; it does not restore copies or other economic activity committed after backup. See [external purchase recovery](external-purchases.md#states-and-recovery) for the existing trusted-host operations and proof requirements.

If a backup process stops abruptly, its unpublished `.recovery-` staging directory and presentation `writer.lock` may remain. Neither a staging directory nor a lock's age proves a usable backup or a stopped writer. Identify the processes responsible for that database and presentation root and verify that every writer has exited; a timeout or missing response is insufficient. Preserve the interrupted stage for investigation, and remove a stale lock only after verifying its owner is gone and no replacement writer is active. The tool never unlocks it automatically. Retry into a new destination and verify the complete bundle before restoring. Final rename controls visibility on the supported local filesystem. Atomic visibility does not guarantee durability across power loss; filesystem and hardware flush guarantees remain deployment-specific.

A recovery manifest detects missing or changed files; it is not a signature proving who created the bundle. Restrict access to the entire bundle, preserve the original installation until recovery is verified, and treat an interrupted staging directory as incomplete rather than a usable backup.

## Health and extensibility

`GET /healthz` returns 200 when the framework worker is ready and its admission queue is not saturated; otherwise it returns 503. Startup does full integrity checks; `/api/operator/audit` provides authenticated read-only diagnostics. Request logs contain request ID, path, method and status, never bodies, tokens or attached codes. Monitor these logs, latency and storage externally. Trade expiration maintenance runs each minute and relevant commands also handle expiry. SIGINT/SIGTERM stop accepting new work and close stores.

Applications embedding the asynchronous service can import `FrameworkWorkerService` from `@digital-card/framework/worker`:

```js
import { FrameworkWorkerService } from "@digital-card/framework/worker";

const framework = new FrameworkWorkerService({
  filename: databasePath,
  storeOptions: { encryptionKey },
  extensionModule: trustedModulePath
});
await framework.ready;
try {
  const page = await framework.inventoryPage(principal, { limit: 50 });
  // Use the page in the application.
} finally {
  await framework.close();
}
```

Enable the optional session adapter with `sessionOptions: { encryptionKey, maxSessions }` when constructing the service. Its `sessions.create`, `sessions.get` and `sessions.revoke` methods return Promises and share the framework queue and shutdown lifecycle. Login challenge consumption is atomic and is never automatically retried after an uncertain worker failure. Existing synchronous `SessionStore` embedders remain supported.

Use plain data arguments. Functions belong in the trusted module; action dispatch supports its explicit AbortSignal cancellation bridge. The service exposes a fixed set of framework operations and selected store diagnostics, not arbitrary storage callbacks. `status()` is synchronous; framework operations return Promises. A close deadline or forced `terminate()` can leave a mutation's outcome uncertain, requiring original-key reconciliation.

The production host runs CardFramework, its SQLite store and authentication session operations in a worker thread. HTTP and authentication adapters await their results. Presentation/import work has separate execution boundaries; this is not a guarantee that every request is free of blocking work. A worker failure rejects pending requests without replaying them. Recover mutations using their original idempotency keys after restarting the service.

Trusted `workerOptions` may set `maxPendingRequests` (default 128), `maxPendingBytes` (default 8 MiB), `startupTimeoutMs` (default 30000) and `closeTimeoutMs` (default 10000). Queue limits apply before dispatch; overload returns 503. Admission includes serialized command overhead, so a body near the HTTP limit may require a larger worker byte budget. Shutdown stops scheduling, awaits in-flight cycles and drains the service within the shutdown deadline.

The host module is loaded separately in the HTTP process and framework worker. Framework binding, policy and action callbacks execute in the worker; identity, currency/code provider gateways and static handlers execute on the HTTP side. Module-local state is not shared between them. The worker accepts named framework exports or a `createFrameworkOptions(options)` factory; a factory supplies the framework configuration in place of named exports. Its limits merge with the production defaults. Startup validates bindings and code-vault availability against the actual worker configuration. Keep import-time initialization safe in both contexts. Static handlers receive an optional third argument `{framework}` containing the asynchronous service.

An ESM `HOST_MODULE` may export `bindings`, `policies`, `limits`, `sessionOptions`, `rateLimits`, `rateLimiter`, `identityProvider`, `resolveAccess`, `remoteAccess`, `currencyProviders`, `presentationOptions` and `handleStatic`. These are trusted code, not imported card data. Public contracts and examples are in [customization recipes](customization-recipes.md#version-02-extension-contracts). Replace identity, storage or presentation independently. External wallets, payment processing, game reward redemption and webhook delivery require host adapters with their own transaction and recovery protocols.

The executable production entrypoint, real OIDC verification fixtures, encrypted sessions, origin/principal controls, quotas, import CLI, migration and backup/restore are tested. The Linux container build passed CI. A live issuer, DNS/TLS, production secrets and site deployment require operational configuration; no live production deployment is claimed by this release.


## Optional card upload service

Set `PRESENTATION_ROOT` to a durable directory to enable the reference server's `/presentations` endpoints. The host uses the same verified identity and rate limiter as the domain API. Mutations require the exact configured Origin and X-DC-Principal headers. Creator, reviewer, publisher and moderation grants remain separate; unauthorized collectors are refused before their upload body is buffered. Read/publish rules are enforced again by the store.

`HOST_MODULE.presentationOptions` configures import limits, scan hooks, scan timeout, allowed capabilities and `performance` policy. Default performance policy warns and accepts; `mode: 'reject'` is opt-in. Use one import-store writer per directory. The endpoint accepts compiled `.dcard` packages; the public authoring APIs handle loose images, layered artwork and GIF conversion before upload. Uploaded content is data, never installation code. Published art is readable by signed-in collectors; do not embed private codes or personal data in presentation assets.

For externally funded wallets, export direct `currencyProviders` or data-only `currencyProviderEndpoints` from HOST_MODULE. The authenticated `/api/currency/reconcile` endpoint verifies the provider receipt and recipient before a durable, deduplicated credit. See [provider contract and boundaries](complex-cards/customization-and-safety.md#currency-integration-and-its-boundary) and [security boundaries](../SECURITY.md).

## Code-card stock

### Remote listing purchase policies

A trusted `HOST_MODULE` can export `remotePolicies`, or return it from `createFrameworkOptions`. Configure `canPurchase` with `scope: 'listing'`, a provider ID, HTTPS URL and bearer token. The policy runs inside the framework worker and evaluates listing quotes and purchases. Existing direct `policies.canPurchase` checks also apply. Catalog-pack issuance and external catalog purchases use separate contracts; unsupported scopes and remote hook names are rejected.

```js
export const remotePolicies = {
  canPurchase: {
    scope: 'listing',
    providerId: 'shop.policy',
    url: 'https://policy.example/listing-purchases',
    token: process.env.PURCHASE_POLICY_TOKEN
  }
};
```

Defaults are a 10000 ms timeout, 65536 request bytes, 8192 response bytes and eight concurrent evaluations. Configurable maxima are 120000 ms, 65536 bytes per body and 64 concurrent evaluations; excess calls fail immediately. HTTPS is required except explicit `allowLoopbackHttp: true` for local development. Redirects, URL credentials, query strings, fragments and compressed responses are rejected. Keep endpoint credentials in trusted server configuration.

The framework prepares a scoped immutable proposal, releases database access while awaiting the provider, then rechecks authority, current state, policy generation and deadline before purchase commit. The provider receives identifiers, listing price, quantity and selected unit IDs; an allow decision cannot override native ownership, balance, stock or administrator checks. Responses must echo the proposal identity from [the purchase-policy schema](purchase-policy.schema.json). Policy providers must perform no external side effects during evaluation.

Embedded callers use `quoteListingAsync(actor, input, {signal})` and `buyListingAsync(actor, input, {signal})`. Synchronous listing methods reject configured remote policy work with `POLICY_ASYNC_REQUIRED`. A changed dependency produces `POLICY_STALE`: obtain and review a fresh quote before attempting again. The framework does not silently retry policy evaluation. Retry an uncertain purchase with its original command key and input to recover an existing receipt; an authenticated committed replay does not depend on provider availability.

Trusted SDK operators with `commerce.manage` can call `setRemotePolicyEnabled(actor, {hook: 'canPurchase', enabled: false})`. Disabling aborts evaluations and invalidates their grants; enabling creates a new generation. It cannot retract committed purchases. Runtime policy state is local to the framework instance; configure startup policy deliberately when restarting. Framework close aborts provider requests.

### Remote listing creation policies

Configure `remotePolicies.canList` with `scope: 'listing'`, `providerId`, `url` and `token` to require remote approval before creating listings. It uses [the listing policy protocol](listing-policy.schema.json), `digital-card-listing-policy@1`, separately from purchase approval. Both hooks can be configured together. Transport limits, HTTPS requirements and trusted credential handling match the purchase-policy bridge above.

This gate covers owned copies, owned sealed packs, minted cards, minted packs and action listings. Preparation sends the actor and shop identifiers, price and requested stock identifiers, kind and quantity. Action parameters, bindings and code secrets are excluded. Evaluation happens before allocation, code assignment, binding factories or randomness; an allowed decision does not replace native authority, stock, supply, currency or administrator checks. Commit rejects changed dependencies and invalidated policy grants before creating the listing and its completion reservations.

Embedded callers use `createListingAsync(actor, input, {signal})`. A configured remote creation policy causes synchronous `createListing` to reject new work with `POLICY_ASYNC_REQUIRED`; authenticated committed-key replay remains available. Reuse the original command key and input after an uncertain response. A stale decision requires a fresh review; the framework does not retry evaluation automatically. Existing direct `policies.canList` also applies at commit. This permission gate does not let the provider choose allocation results or odds.

Use `setRemotePolicyEnabled(actor, {hook: 'canList', enabled: false})` from a trusted SDK operator with `commerce.manage` to stop evaluations. Disabling invalidates in-flight grants; committed listings remain. Runtime enable state belongs to the framework instance, so startup configuration must be set deliberately after restart.

#### Try the Python policy fixture

The [Python standard-library policy example](../examples/plugins/python-listing-policy.py) implements both listing and purchase protocols at `/listing-policy`. Set `LISTING_POLICY_TOKEN` and optionally `LISTING_POLICY_PROVIDER_ID` (default `example.policy`), then run `python examples/plugins/python-listing-policy.py records.json [port]`. It prints a loopback port; use that endpoint with explicit `allowLoopbackHttp: true` in the corresponding trusted policy configuration.

Records contain `actors: [{id, listShopIds, purchaseListingIds}]`. Use framework user IDs and real shop/listing UUIDs. A configured actor may create listings only in its listed shop IDs and purchase only its listed listing IDs. All other actors or targets are denied. This synthetic read-only fixture makes no allocations and changes no records. It accepts at most 100 actors, 100 targets per list, 64 KiB of configuration and 64 KiB per request. Native framework checks still apply after every allow decision.

### Transfer and trade policy protocols

Configure either hook in the trusted host module's `remotePolicies` export:

```js
export const remotePolicies = {
  canTransfer: {scope: 'transfer', providerId: 'example.transfer',
    url: process.env.TRANSFER_POLICY_URL, token: process.env.TRANSFER_POLICY_TOKEN},
  canTrade: {scope: 'exchange', providerId: 'example.transfer',
    url: process.env.TRANSFER_POLICY_URL, token: process.env.TRANSFER_POLICY_TOKEN},
};
```

Use HTTPS in deployment. The loopback Python fixture requires explicit `allowLoopbackHttp: true`. Embedded callers use `proposeTradeAsync`, `counterTradeAsync`, and `acceptTradeAsync`, with `{signal}` as the final options argument. Use `createListingAsync`, `quoteListingAsync`, and `buyListingAsync` for affected resale operations. Synchronous mutation methods cannot bypass configured remote policies. Committed idempotent retries return the original result after authentication without requesting a new provider decision.

`reviewTransferAsync(actor, input, {signal})` checks an offer without reserving cards or currency. Browser clients expose `reviewTransfer(input, {signal})`; custom trade views should follow the [asynchronous draft review guidance](customization-recipes.md). Review is temporary and submission evaluates policy again. Disable a hook through the trusted SDK with `setRemotePolicyEnabled(actor, {hook: 'canTransfer', enabled: false})` or `hook: 'canTrade'`; this requires `commerce.manage` and invalidates in-flight grants. Cancellation, expiration, and escrow refunds remain available without provider approval.

The [transfer policy schema](transfer-policy.schema.json) describes `digital-card-transfer-policy@1` requests with operation `canTransfer` and scope `transfer`. Each request groups the selected copies by transfer direction, with matching copy IDs and versions. A listing reservation uses a null destination until a buyer is known. The [trade policy schema](trade-policy.schema.json) describes `digital-card-trade-policy@1` requests with operation `canTrade` and scope `exchange`; its context contains both parties and both sides of the card and currency exchange.

Import the schemas and validators from `@digital-card/framework/transfer-policy-contracts` and `@digital-card/framework/trade-policy-contracts`. Transport factories are available from `@digital-card/framework/remote-transfer-policy` and `@digital-card/framework/remote-trade-policy`. These protocols support at most 2,000 copies across a request. Their default and maximum request body size is 256 KiB; the default response limit is 8 KiB. The default timeout is 10 seconds and each transport admits at most eight concurrent evaluations unless configured otherwise.

Providers must echo the request identity fields, including the phase, grant, generation, command and snapshot digests, and deadline. Return `allowed`, `denied` with a documented reason code, or a bounded protocol error. An allow response is advisory: the framework remains responsible for authorization, native restrictions, current ownership, balances, and committing the exchange. Provider credentials belong only in trusted server configuration.

The [Python transfer policy example](../examples/plugins/python-transfer-policy.py) implements both protocols at `/transfer-policy`. Set `TRANSFER_POLICY_TOKEN` and optionally `TRANSFER_POLICY_PROVIDER_ID` (default `example.transfer`), then run `python examples/plugins/python-transfer-policy.py records.json [port]`. It prints its loopback port. Records use `{"actors":[{"id":"alice","recipientIds":["bob"],"allowListingReservation":true}]}`. Each transfer leg must have an authorized sender and destination; null destinations require explicit listing reservation permission. Trade policy checks the exchange sender and recipient. Unconfigured routes are denied. This read-only fixture supports at most 100 actors and 100 recipients per actor within 64 KiB of configuration.

The [Go transfer policy example](../examples/plugins/go-transfer-policy/main.go) uses the same records, environment variables, endpoint and limits. Build it with `go -C examples/plugins/go-transfer-policy build -mod=readonly -o transfer-policy .`, then run the resulting executable with `records.json [port]`. It uses only the Go standard library. Run `node test/go-transfer-policy-conformance.mjs <executable-path>` to exercise the compiled provider through the framework transports. Both examples accept exact integer-valued JSON numbers and reject fractional or unsafe values without rounding them into valid amounts.

### Remote pack allocation strategy

Products can select `allocationStrategy: {algorithm: 'weighted-deck@1', version: 1, deckScope: 'purchase-slot'}`. This strategy treats each slot's weights as ticket counts shared across the purchase batch. Selecting a variant consumes one ticket. For example, two variants with one ticket each produce one of each across two draws; they are not two independent draws with replacement. Finite remaining supply caps the available tickets. Optional slot presence is evaluated separately, and a skipped slot consumes no tickets.

Configure the trusted host module's `remoteAllocation` export with `scope: 'catalog-purchase'`, `algorithm: 'weighted-deck@1'`, `providerId`, `url`, and `token`. The [allocation protocol schema](allocation-strategy.schema.json) defines the immutable request and ordered plan response. `@digital-card/framework/allocation-planner` exports `planAllocation` for a compatible Node provider; the core independently checks the returned plan against the reviewed algorithm and its private entropy. Provider access is privileged: requests contain private allocation entropy and must not be exposed to a collector or logged by the provider.

Use the quote's `allocationDigest` unchanged in `purchaseAsync(actor, request, {signal})`. Wallet-funded catalog pack purchases use this route. Version 1 products require no pity, `duplicatePolicy.scope: 'none'`, no code allocation or binding factories, and no overlapping finite-supply pools across slots. The batch is limited to 2,000 possible cards and must have sufficient tickets for its maximum slot draws. Unsupported combinations are rejected. External payment fulfillment uses `remoteExternalAllocation` as described in [external purchases](external-purchases.md); commerce stock creation uses the separate configuration below.

Wallet purchase preparation records a private durable attempt before the provider call. No cards or wallet debit are committed during that wait. Retries retain the attempt's entropy; changing request keys cannot request a new roll. Commit rechecks current permissions, funds, supply, terms, provider grant and deadline before atomically storing the purchase result. A committed idempotent retry returns the original result.

Use `client.allocationStatus({productId})` to recover an attempt's state and `client.acknowledgeAllocation({attemptId})` before deliberately reviewing new terms. Only prepared or stale attempts can be abandoned; completed purchases retain their original receipts. An abandoned attempt's original request key cannot start another purchase. Acknowledgement does not refresh unused entropy. An evaluation active in the same instance may return `ALLOCATION_BUSY`; acknowledgement by another instance invalidates the old attempt, so its late result cannot commit. After `ALLOCATION_STALE`, obtain a fresh quote rather than automatically retrying changed terms.

The default shop presents strategy purchases in two steps: review a quote, then buy the reviewed packs. Inspecting an allocation attempt does not execute a purchase. Custom views using `createCommandRunner` can call `confirmFailed('purchase', originalInput)` to confirm a matching failed server command without retrying it. A `false` result leaves the original journal unresolved; retain its key and input. Never infer purchase failure from allocation acknowledgement alone, and never use a fresh key to retry an uncertain purchase.

The journal has a 100,000-attempt limit and a 1 MiB preparation-record limit, in addition to the store's byte budget. Records are not automatically deleted. Back up and restore the journal and entropy heads with the authoritative store; deleting them to bypass a capacity error loses retry protection. Treat journal capacity as an operator action, not permission to clear allocation history.

The [Node allocation provider example](../examples/plugins/node-allocation-provider.mjs) serves `/allocate-packs` on loopback. Set `ALLOCATION_PROVIDER_TOKEN` and optionally `ALLOCATION_PROVIDER_ID` (default `example.allocation`), then run `node examples/plugins/node-allocation-provider.mjs [port]`. It prints the selected port. Point trusted `remoteAllocation.url` at that endpoint and set `allowLoopbackHttp: true` for local testing. The example imports the framework validators and deterministic planner, accepts requests up to 1 MiB and returns responses up to 256 KiB. It does not write inventory or settle purchases. Never log provider requests: they contain private allocation entropy.

### Allocation for minted pack stock

To issue a supported weighted-deck product as shop stock, configure trusted `remoteStockAllocation` with `scope: 'commerce-stock'`, `algorithm: 'weighted-deck@1'`, provider identity, URL and credential. The stock protocol is `digital-card-commerce-stock-allocation@1`; its schema and transport are exported from `@digital-card/framework/stock-allocation-strategy-contracts` and `@digital-card/framework/remote-stock-allocation-strategy`. The provider receives the shop identity and allocation context. Protect its requests as private allocation data.

The Node allocation example also serves `/allocate-stock` using the same credential and provider identity. Point `remoteStockAllocation.url` at that endpoint; the wallet and stock endpoints reject each other's protocols.

Call `client.quoteMintPackStock({shopId, productId, quantity})`, review the returned terms, then supply its `allocationDigest` at the top level of a `createListing` request whose items use `kind: 'mint-pack'`. Embedded hosts use `createListingAsync`. Stock creation must satisfy the shop's native permissions and listing policies. The initial supported product restrictions and 2,000-card batch bound also apply here. Stock creation must additionally fit the listing transaction budget; a batch can therefore reach its transaction limit before reaching 2,000 cards. Reduce the batch size after an explicit limit rejection; preserve the original key after an uncertain response.

Use `client.stockAllocationStatus({shopId, productId})` to inspect recovery state. Wallet purchases and stock creation share the account/product allocation attempt: `command` identifies the originating operation and `attemptShopId` identifies its shop when applicable. Resolve that original operation before starting a new one. Changing shops, quantities or request keys does not refresh unused entropy. Explicit acknowledgement never creates stock; preserve unresolved command input until its failed result is confirmed.

### Remote currency providers

The framework-owned bridge uses [the currency settlement schema](currency-provider.schema.json), protocol `digital-card-currency-settlement@1`. Export endpoint configuration from the trusted host module:

```js
export const currencyProviderEndpoints = {
  'wallet.example': {
    url: 'https://wallet.example/framework/settlements',
    token: process.env.WALLET_PROVIDER_TOKEN,
    currencies: { POINT: { currencyId: 'credits', numerator: 1, denominator: 1 } }
  }
};
```

The provider first resolves the authenticated framework `userId` to an external account, then looks up a transaction for that account. Both calls are authenticated POST requests. Responses must echo protocol, operation, request ID, provider ID and all request identity fields. A `resolve-account` response uses `status: "resolved"` and an `account`; a `lookup` response uses `settled`, `pending`, `refunded` or `unknown`. Only `settled` includes `currency` and a positive integer-string `amountUnits` of at most 40 digits. Use settled only for irrevocable funds; the bridge does not process payments or reverse credits after a chargeback. Account linking and authoritative settlement evidence are the provider's responsibility.

Conversion mappings belong to the trusted host. Conversion must produce whole ledger units within the safe integer range. The gateway verifies account and transaction identity before submitting a durable, deduplicated credit; browser requests never supply an amount. Timeouts may leave an already-admitted credit committed: reconcile again with the same provider and transaction identity to recover it.

Responses are strict flat JSON without extra or duplicate keys. Strings must also satisfy the runtime UTF-16 bounds and reject unpaired surrogates. Error replies use `status: "error"` and `errorCode`: `invalid-request`, `unauthenticated`, `not-found`, `rate-limited` or `unavailable`, paired with HTTP 400, 401, 404, 429 or 503. Successful protocol replies use HTTP 200. Provider error details are not exposed.

HTTPS is required; explicit `allowLoopbackHttp: true` permits local development endpoints. Redirects, URL credentials, query strings, fragments and compressed responses are rejected. Defaults are `timeoutMs: 10000`, `maxRequestBytes: 8192`, `maxResponseBytes: 8192` and `maxConcurrent: 8`; maximum values are 120000 ms, 65536 bytes per body and 64 concurrent calls. Excess calls fail immediately. The bearer token must contain 16–4096 printable non-space ASCII characters. Endpoint credentials and mappings are server configuration and must not enter card bundles or browser code.

SDK hosts can import `createCurrencyProviderRegistry` from `./remote-currency-provider`, pass its `providers` to `createCurrencyGateway`, and call `disable(providerId)` or `close()` to stop remote calls. Disabling is permanent for that registry and aborts outstanding transport requests. The production host closes its registry during shutdown. Cancellation or disabling prevents new settlement admission; it cannot retract a command already admitted by the framework worker. Direct adapters remain supported; duplicate direct and remote provider IDs are rejected.

#### Try the Python currency fixture

The [Python standard-library example](../examples/plugins/python-currency-provider.py) reports synthetic, read-only evidence. Set `CURRENCY_PROVIDER_TOKEN` and optionally `CURRENCY_PROVIDER_ID` (default `example.points`), then run `python examples/plugins/python-currency-provider.py records.json [port]`. It prints the selected loopback port and serves `/currency-settlement`. Configure the host endpoint with the same provider ID and token, explicit `allowLoopbackHttp: true`, and a trusted `POINTS` conversion mapping.

A records file has this form; replace the local user ID with the authenticated framework user you intend to test:

```json
{
  "accounts": [{"userId": "local-collector", "account": "external:collector"}],
  "transactions": [{"transactionId": "fixture-1", "account": "external:collector", "status": "settled", "currency": "POINTS", "amountUnits": "150"}]
}
```

Accounts and transaction IDs must be unique; each transaction references a configured account. Only settled records include currency and amount. Pending, refunded and unknown records contain identity and status alone. Missing transactions return unknown; unknown users or accounts and wrong-owner transactions return not-found. Limits are 64 KiB per records file, 100 accounts, 100 transactions and 8192 bytes per request. The fixture binds to loopback, handles requests serially and never modifies the file. It is a protocol example, not a payment service or production account-linking system.

For catalogs with code attachments, configure the separate code-vault key ring and stable index key described in [code-card operations](card-types-and-codes.md#deploy-and-operate). Startup verifies existing envelopes and reconstructs missing legacy provenance from stored evidence. `HOST_MODULE` may export `codeProviders` with authenticated read-only status lookups, or data-only `codeProviderEndpoints` for the framework-owned remote HTTP bridge. Remote providers use the versioned [code-status protocol](card-types-and-codes.md#remote-code-status-providers); shutdown disables their lookups. Configure `codeLimits` for bounded inventory/request capacity. A provider confirmation is distinct from a player marking a code used. Include the vault keys in isolated restore drills; state encryption keys alone cannot recover code secrets.


## Shops and durable account rewards

`HOST_MODULE` may export `actionHandlers`, `actionOptions`, `eventSubscriptions`, `actionWorker` and `raffleRandom`. These are trusted server extensions. The host runs one delivery cycle at a time when handlers are configured; set `actionWorker:false` to use an independent worker. Handlers must validate public parameters, map the immutable framework beneficiary to a verified external account, honor cancellation and deduplicate the supplied job ID at the receiver. See [delivery and recovery](card-actions.md).

Minute-based maintenance expires listings and draws due raffles, in addition to expiring trades. Time and stock checks also run inside purchase transactions. Monitor private action jobs, dead deliveries, stock reservations and `audit()`; reconcile ambiguous upstream outcomes before manual retries. Missing handlers and exhausted capacities require operator action. Preserve the state database when restarting: it contains stock, orders, draw results, leases and retry identities.

`trading.manage`, `commerce.manage`, `raffles.draw`, `actions.manage` and `actions.dispatch` are distinct permissions. Give background workers only their required permissions. Admin shop creation requires a registered framework account; proceeds go to the shop owner. Player shops and sealed-pack resale default to disabled. See [trading controls](trading-controls.md), [shops](shops-and-releases.md), and [raffles](raffles.md) for complete defaults and APIs. External currencies use verified ledger reconciliation; the shop transaction never performs an unverified remote debit.

## Idle maintenance and transaction results

When preflight finds no due work, action dispatch and listing-expiry cycles return without committing framework-state changes. A competing worker can consume work between preflight and the transaction; the serialized recheck remains safe. Due work is checked again before it is claimed or expired. The adapter suppresses unchanged record writes. Legacy command callbacks and unconverted reads still materialize their logical state; indexed queries serve the converted collection and identity paths.

Store callbacks must return a structured-cloneable synchronous value. Return-value validation occurs before commit; unsupported results and asynchronous callbacks leave state unchanged. Keep callbacks free of external effects.

### Allocation after an external payment

Configure `remoteExternalAllocation` with `scope: 'external-fulfillment'`, `algorithm: 'weighted-deck@1'`, provider identity, URL and credential. The Node allocation example serves `/allocate-external`; each allocation endpoint rejects the other protocols. The schema and transport are exported from `@digital-card/framework/external-allocation-strategy-contracts` and `@digital-card/framework/remote-external-allocation-strategy`.

Use the [external purchase lifecycle](external-purchases.md) to prepare before charging, then call `commitExternalPurchaseAsync` with verified debit evidence. This flow records the debit before remote allocation and reserves completion space before charging. Status may report `allocation_pending`; resume with the exact original proof after reconciling an uncertain result. A durable `refund_required` outcome must be compensated at the original payment source and cannot later fulfill.

Wallet, stock and external allocation share the beneficiary's product attempt. Generic acknowledgement cannot release paid work. Verified no-debit cancellation or refund compensation releases the attempt while preserving unused entropy. These recovery operations do not require the allocation provider, but do require the trusted payment provider to verify the evidence. Include pending paid allocations in operational recovery passes and preserve all allocation records in backups.

### Conditional tickets, duplicate rules and pity

Version 2 protocol references: [wallet](allocation-strategy-v2.schema.json), [stock](stock-allocation-strategy-v2.schema.json), and [external payment](external-allocation-strategy-v2.schema.json).

SQLite schema 7 adds an ownership index for candidate-card lookups. Back up the store and stop older writers before upgrading. Opening a schema 6 store with writable access installs the index transactionally while preserving its records and history. Read-only schema 6 inspection remains available, but the new ownership query requires writable migration. Keep the matching application version and backup available for rollback; do not open an upgraded store with an older writer.

Select `allocationStrategy: {algorithm: 'weighted-deck@2', version: 2, deckScope: 'purchase-slot'}` to combine ticket allocation with duplicate rules and pity. Configure the corresponding wallet, stock or external allocation transport with `algorithm: 'weighted-deck@2'`. A v2-capable provider must also accept v1 requests for retained attempts. Existing v1 products and receipts keep their original distribution; changing the catalog does not reinterpret an active attempt.

Version 2 filters the remaining tickets by the configured duplicate and pity rules before drawing. Ticket counts alone are therefore not final draw probabilities. Duplicate rules compare card IDs across variants. Pack scope resets for each pack; personalized inventory scope also considers owned and sealed cards and earlier packs in the batch. Inserts bypass duplicate filtering. An `allow` fallback can permit duplicates when the eligible pool is empty; it cannot restore exhausted tickets or supply.

Personalized pity applies to the first draw of the first card slot when its counter is due. The catalog requires that first pity slot to be guaranteed. A qualifying noninsert card resets the counter; otherwise it advances after the pack. Minted shop stock ignores the seller's personal inventory and pity, while retaining within-pack duplicate filtering when configured.

The framework validates the returned choices and derives the resulting pity counter. Providers cannot supply authoritative counter updates. Ownership or pity changes during an outstanding request invalidate the captured allocation state. A failed attempt retains unused entropy, including across strategy versions; changing a request key does not reroll it. Paid failures follow the external purchase refund lifecycle.

Versions 1 and 2 do not support code-bearing variants. Binding factories and overlapping finite-supply pools remain unsupported by these remote strategies. Do not remove their admission checks or route them through a native fallback.


### Imported-code ticket allocation

Version 3 protocol references: [wallet](allocation-strategy-v3.schema.json), [stock](stock-allocation-strategy-v3.schema.json), and [external payment](external-allocation-strategy-v3.schema.json).

SQLite schema 8 adds imported-code expiry and unique import-order indexes. Back up the store and stop older writers before upgrading. A writable open upgrades schema 7 transactionally; imported-code allocation also requires prepared record projections, including persistent import ordering. Read-only schema 7 inspection remains available, but imported-code prefix queries require migration. Retain the matching application and backup for rollback.

Select `allocationStrategy: {algorithm: 'weighted-deck@3', version: 3, deckScope: 'purchase-slot'}` for imported-code attachments. Configure the corresponding allocation transport with `algorithm: 'weighted-deck@3'`; its provider must also accept retained v1 and v2 requests. Version 3 retains the conditional duplicate and pity rules above and filters each draw by remaining shared code-pool capacity. Choosing a variant consumes all of its attachment demands, including repeated attachments from the same pool. Code-free alternatives remain eligible. Duplicate fallback cannot restore exhausted code supply.

The provider receives bounded pool availability and per-variant demand, and returns only variant choices. It cannot choose code records or supply code material. The framework selects imported codes by earliest expiry, then import order, with nonexpiring codes last. This ordering applies to v3 allocation; native issuance keeps its existing ordering. A quote does not reserve codes. Changes to the captured code prefix or its expiry can invalidate the attempt before fulfillment. Review and payment recovery follow the existing allocation lifecycle.

Sequential draws can exhaust resources needed by a later draw. The strategy can therefore refuse a batch even when a different sequence could have completed it; it does not search for a globally feasible combination or reroll failed attempts. The supported imported-code scope is at most 64 referenced imported pools and 1,000 total worst-case code attachments, alongside the existing copy and request-size limits. Imported code records must use UUIDv4 identities; unsupported legacy identities are rejected before payment. Overlapping finite-supply pools remain unsupported by v3.

Version 3 also supports [generated-code issuers](card-types-and-codes.md#generated-code-allocation) and [binding factories](core-api.md#binding-factories-with-versioned-allocation) through their separate configured registries. These extensions retain selected plans and invocation identities across retries. Configure their lifecycle and recovery requirements before enabling products that use them; legacy generator and binding callbacks are not automatically adapted.

### Finite supply shared across allocation slots

Version 4 protocol references: [wallet](allocation-strategy-v4.schema.json), [stock](stock-allocation-strategy-v4.schema.json), and [external payment](external-allocation-strategy-v4.schema.json). Select `allocationStrategy: {algorithm: 'weighted-deck@4', version: 4, deckScope: 'purchase-slot'}` and configure the corresponding allocation transport with `algorithm: 'weighted-deck@4'`. Providers must continue accepting the versions used by retained attempts. Existing v1–v3 attempts keep their original rules.

The [Node allocation provider example](../examples/plugins/node-allocation-provider.mjs) accepts versions 1–4 at its `/allocate-packs`, `/allocate-stock` and `/allocate-external` endpoints. Use the endpoint matching the configured scope. Its plans are read-only; inventory changes and payment settlement remain with the framework.

Version 4 supports finite variants shared across slot pools. Before each draw, it excludes choices that would leave no legal completion for the remaining batch, then samples proportionally to the remaining eligible ticket counts. For example, if the first slot offers A or B and the second requires A, with one copy of each available, the first slot chooses B. This is not uniform sampling of complete batches, and ticket percentages are not fixed independent odds. Duplicate, pity and code-supply rules still apply; duplicate fallback cannot introduce a repeat while locally eligible nonduplicate choices remain.

Optional slot presence is sampled independently first. The completion guarantee applies to that frozen layout within the admitted solver scope. An infeasible layout refuses without resampling, even if another presence layout could have succeeded. Refusal and retry retain the original entropy; changing request keys does not create another draw.

The solver admits batches within deterministic work and memory limits before provider dispatch. Supply-and-ticket matching and forced-choice batches have separate bounds from ambiguous combinations involving duplicate rules, pity or shared codes. `ALLOCATION_SOLVER_LIMIT` means the configuration exceeds the supported solver scope; it is not proof that no valid batch exists. A runtime work-limit failure also preserves the original attempt rather than selecting a weaker strategy. Do not automatically split or retry a refused purchase under new terms without a new explicit review. Generated issuers and binding factories run only after selection, through their existing recovery lifecycles.

If an external debit has already been recorded, an infeasible layout or runtime `ALLOCATION_SOLVER_LIMIT` enters the durable `refund_required` lifecycle. Reconcile and refund at the original payment source, then confirm compensation through the external purchase API. Compensation releases the active attempt while retaining its unused entropy; it does not automatically retry fulfillment or draw a new outcome.

The maximum is 2,000 potential draws per batch. Supply-only matching must also fit a 50-million-edge-visit bound. Ambiguous interacting rules allow at most 64 potential draws, with a conservative admission estimate capped at 20,000 states, 200,000 transitions and a 16 MiB serialized memo-key budget. This budget is not a total process-memory limit. These are ceilings, not guaranteed batch sizes: for example, 20 two-choice draws with duplicate rules can exceed the search bound. Forced-choice batches use a separate iterative path, while existing code-attachment and storage limits still apply. Check the intended product and quantity during configuration; a mathematically feasible product can remain outside this supported domain.


## Delegate access decisions to a service

Keep OIDC for sign-in and use an optional access provider when your permissions are managed by a service in another language. Export `remoteAccess` from your trusted `HOST_MODULE`:

```js
export const remoteAccess = {
  providerId: 'example.access',
  url: 'https://access.example.test/access-provider',
  token: process.env.ACCESS_PROVIDER_TOKEN,
  allowRoles: ['player'],
  allowPermissions: ['art.import', 'art.review'],
};
```

Store the service credential in your deployment's secret configuration. The endpoint receives only the authenticated session's issuer, subject and framework user ID, plus request identity and lifetime fields. It does not receive browser cookies, session secrets or OIDC credentials. Do not configure both `remoteAccess` and `resolveAccess`; the host rejects that ambiguity.

The host checks the provider on each authenticated request. A decision must echo the exact request identity and remain within the configured role and permission limits. Unknown permissions, excessive grants, malformed responses, service failures and disabled providers deny access. There is no stale access cache or fallback to administrator-subject configuration when a remote decision fails. Granting the `admin` role requires an explicit ceiling containing every framework permission because that role confers all permissions.

The [access-provider schema](access-provider.schema.json) defines the versioned request and response. Successful HTTP 200 responses use `allowed` with `role` and `permissions`, or `denied`/`disabled` without those fields. Services authenticate the bearer credential and enforce the request deadline. Errors for valid request identities carry the correlated request fields and a supported error code; malformed requests can be rejected without echoing their fields. Errors must not disclose diagnostic secrets.

The independent Python and Go examples read an operator-owned JSON identity map and default-deny missing identities. Their file is reread for each request so permission changes take effect without restarting the example service. See the example source for its record format and required `ACCESS_PROVIDER_TOKEN` configuration:

```sh
python examples/plugins/python-access-provider.py access-records.json 8091
go run examples/plugins/go-access-provider/main.go access-records.json 8091
```

For example, `access-records.json` can contain:

```json
{"identities":[{"issuer":"https://issuer.example","subject":"collector","userId":"collector","status":"allowed","role":"player","permissions":["art.import"]}]}
```

Use the issuer, subject and framework user ID from your actual authenticated account. A `denied` or `disabled` record contains those three identity fields and its `status`, with no role or permission fields.

The example loopback HTTP listener is for local integration. Production endpoints require HTTPS; explicit `allowLoopbackHttp: true` is available only for loopback testing. Existing hosts without a remote provider retain their default access configuration.

## Enforce import process memory limits

For hosts that accept presentation uploads, configure required process isolation in the trusted host module. Validation and publication processing share the executor's memory reservations:

```js
export const presentationOptions = {
  importIsolation: {
    backend: process.platform === 'win32' ? 'windows-job' : 'linux-cgroup',
    memoryBytes: 512 * 1024 ** 2,
    aggregateMemoryBytes: 1024 * 1024 ** 2,
    temporaryBytes: 2 * 1024 ** 3,
    aggregateTemporaryBytes: 4 * 1024 ** 3,
    ...(process.platform === 'linux' ? {
      cgroupRoot: '/sys/fs/cgroup/card-imports',
    } : {}),
  },
};
```

Provision the Linux path as an empty, writable cgroup v2 subtree delegated to the service account, with the memory and process-count controllers available. Run the main application in a separate leaf beneath that delegated subtree; the executor creates a sibling scope with its aggregate memory limit, so the main service stays outside the worker memory envelope. Provisioning must place the service in that leaf before startup. Linux process migration requires write permission on the common ancestor of the source and destination groups; a runner outside the delegated subtree cannot assume it can move children into it. The executor must be able to create child groups and configure their limits; an ordinary directory is not a substitute. No Docker socket or privileged application container is required by the executor. A container deployment must explicitly provide the delegated execution environment; the base Compose file alone does not establish per-import isolation.

Temporary-byte reservations bound application-managed publication staging; they are not filesystem quotas. Retained published content and uploaded archives have their own storage lifecycle.

Windows uses an OS job object assigned before the worker executes. Its memory budget limits committed memory, including native buffer allocations; it is not an RSS sampling limit. Peak accounting counters can show small overages during allocation failure, so use the configured limits and failure diagnostics together rather than assuming every peak sample stays below the configured value. The trusted PowerShell/.NET launcher has startup overhead outside the worker memory envelope and does not execute imported code. The helper uses Windows PowerShell by default; `powershellPath` may select a trusted absolute PowerShell executable. Linux uses cgroup memory and swap controls. The kernel can temporarily charge memory beyond `memory.max` before reclaim or termination, so do not interpret that value as a promise of zero transient overage.

When `importIsolation` is configured, missing or unsupported enforcement must prevent startup rather than silently falling back to the heap-only worker. Existing configurations without it retain their previous behavior. Size budgets against representative accepted artwork and reserve separate capacity for the main service. These resource controls do not make trusted host callbacks or arbitrary executable plugins a general-purpose sandbox.
