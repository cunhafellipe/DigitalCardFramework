# Changelog

## Unreleased

- Added host-approved procedural WASM pixel effects with bounded workers, program revocation and snapshot capture tied to the requested inputs.

- Added verified offline recovery bundles for the database, published artwork, moderation policies and durable imports, with restoration into a new installation directory.

- Added required OS-backed import execution with Windows job or Linux cgroup memory limits, shared validation/publication reservations and bounded staging cleanup.

- Added portable complete collection views with host-owned filtering, comparison, preferences and reviewed trade-ups, plus independent Python/Go layouts.

- Added authenticated remote access decisions with explicit role/permission ceilings, fail-closed revocation and independent Python/Go providers.

- Added reviewed live Studio panels with scoped content/style proposals, native review and Undo/Redo, and Python/Go browser-asset examples.

- Added per-instance Studio localization across editing tools, artwork publishing and card-policy controls.

- Added per-instance administration localization for overview, pricing, people, website settings, activity and review/save workflows.

- Added portable localization for account rewards, private code reveal/history and trading controls, with complete Python/Go Spanish examples.

- Added reviewed full opening views with retained program updates, revealed-only display grants, native fallback and Python/Go examples.

- Added offline editor transform jobs with host grants, visual review, atomic Apply/Undo/Redo, and independent Python/Go layout-and-decoration tools.

- Added Python and Go examples for portable live vector effects using the optional dotLottie adapter, with angle-driven and clock-driven card packages.

- Added approved browser album layouts with explicit display-field grants, bounded full-album snapshots and raster previews, and host-controlled card inspection.

- Added host-approved browser pack renderers with custom front/back artwork, cosmetic reveal progress, native fallback and Python/Go pack examples.

- Added a host-approved browser-program card renderer with bounded frame allocation, native fallback and Python/Go custom HTML/CSS examples.

- Added Python and Go examples that generate editable layered `.dcard` artwork with front and back faces, masked foil and bounded tilt motion.

- Added portable localization bundles for the collector wallet, pack purchase and opening workflow, with per-instance locales, English fallback, plural and number formatting, and Python/Go Spanish bundle examples.
- Extended collector localization to collection filters, favorites, wishlists, trade-up controls, card inspection and comparison, including standalone renderer options.
- Added localization for album, trade and marketplace workflows, with translated review and recovery controls.
- Added version 4 allocation for finite supply shared across slots, using bounded feasibility checks before weighted ticket selection.
- Fixed production startup with an empty optional `HOST_MODULE` setting and added production-host OIDC conformance against a Go issuer.

- Added host-installed declarative Studio panels for selected-layer position and rotation, with bounded field grants and Python/Go manifest examples.

- Added versioned allocation binding factories for deterministic data, cancellable provisioning and post-purchase activation, with scoped user inputs, encrypted recovery records and a durable Node provider example. Quotes disclose deferred activation; pending rewards remain unusable until confirmed. Operators can inspect and reconcile factory work with the separate `bindings.manage` permission.

- Added generated-code issuance for versioned allocation, with durable per-occurrence identities, encrypted result custody, bounded operator recovery, and a restart-safe Node issuer example.

- Added versioned imported-code allocation with shared pool eligibility, private code selection, and reviewed purchase and stock flows.

- Added a versioned conditional ticket strategy for pity and duplicate rules, with reviewed purchase and stock flows, private eligibility snapshots, and compatible Node provider endpoints.

- Added weighted-deck allocation for external pack payments, with asynchronous fulfillment, durable payment recovery, shared allocation retry protection, reserved refund capacity, and an external endpoint in the Node provider example.

- Added reviewed weighted-deck creation of minted pack stock, with atomic listing allocation, shared wallet/stock retry protection, explicit recovery, and a stock endpoint in the Node provider example.

- Added opt-in weighted-deck allocation for supported wallet-funded catalog purchases, with deterministic provider plans, durable retry protection, state revalidation, and allocation status and acknowledgement APIs. Added a Node provider example, ticket-count explanations, separate quote review and purchase actions, and read-only confirmation of failed commands.

- Added a Go transfer/trade policy provider example and compiled-provider conformance checks. Aligned Python policy numeric parsing with exact integer-valued JSON inputs.

- Added remote transfer and trade policies for offers, counteroffers, acceptance, and secondary sales, with batched checks, state revalidation, cancellation, and durable replay. Added a Python provider example for both protocols.

- Added asynchronous trade-draft review with cancellation, expiry feedback, and counteroffer version checks. Custom views using the framework client must call `reviewAsync()` before building an offer.

- Added a read-only Python listing and purchase policy example with authenticated cross-language conformance checks.

- Added remote listing creation policy checks before allocation, with scoped state revalidation, cancellation, durable replay and asynchronous host/worker routing across supported listing kinds.

- Reject malformed SDK cancellation signals before reserving code or currency provider capacity.

- Added remote listing purchase policy evaluation outside database transactions, with commit-time state and grant checks, asynchronous HTTP/worker routing, cancellation and durable receipt replay.

- Added a read-only Python currency provider example and cross-language conformance checks for account ownership, settlement replay and malformed input.

- Added authenticated remote currency account and settlement lookups with strict versioned contracts, trusted conversion mappings, bounded transport and cancellation/disable admission checks.

- Added a validated production host setting for the ordinary storage payload budget, retaining the 64 MiB default and separate completion limits.

- Added a versioned remote code-status provider protocol and bounded authenticated HTTP bridge with data-only host configuration, cancellation and disable controls.

- Moved production authentication session operations into the framework worker, preserving atomic login challenge consumption and awaited session creation/revocation. Synchronous embedded session stores remain supported.

- Removed write-lock acquisition from ordinary session reads so authenticated requests can read committed sessions while framework writes are in progress. Login-challenge consumption remains atomic.

- Added a worker-backed framework service and production host integration with bounded admission, cancellation, readiness checks and draining shutdown. Failed workers do not automatically replay mutations.

- Await asynchronous framework results across API reads, login registration and code/currency reconciliation, preserving authorization checks before provider calls.

- Added selected-record raffle entry, status and drawing, plus indexed automatic due selection. Draw replay preserves committed winners; automatic sweeps attempt every selected raffle before reporting a failure.

- Added bounded listing creation for prepared stores across owned cards/packs, minted cards/packs and custom actions. Creation preserves stock locks, allocation snapshots, code uniqueness, shop limits and future completion reservations.

- Added bounded listing cancellation for prepared stores, preserving seller/manager authorization, stock release, completion reservations and exact-key receipt replay.

- Added bounded listing quotes and purchases for prepared stores, preserving card, sealed-pack, custom-action and raffle-claim behavior. Revision-bound buyer totals enforce purchase limits without scanning order history; payment, stock, ownership, receipts and delivery jobs commit atomically.

- Added indexed, bounded expiration of trades and listings with atomic refunds, stock release and delivery events. SQLite schema 6 adds expiration indexes; stop writers and back up the database and keys before upgrading. Each maintenance cycle processes at most 32 candidates per family.

- Added indexed action-delivery claims, completion and retries for prepared SQLite stores, retaining delivery identities, lease fencing and shared completion reservations. SQLite schema 5 migrates the action-work index atomically; stop writers and back up the database and encryption keys before upgrading. Older applications cannot open the upgraded database.

- Added album cover, spine and page artwork authoring, editable design references, stable card-to-page assignments, book navigation and typed album contracts. Public artwork publication is separate from album visibility and saving.

- Added bounded trade acceptance and counteroffers, including code-holder history, favorites and album cleanup with atomic escrow and recovery.
- Added plugin deployment manifests, configuration/dependency validation, cascading revocation, draining and credential-safe replacement that retains purchase recovery.

- Reject disabled trade workflows before preparing storage accounting, preserving unchanged state on rejected admission.

- Added bounded trade proposals, cancellation and decline with encrypted sender escrow accounting, atomic refunds and retained receipt replay. Stale accounting can fall back to completion recovery at full capacity.

- Added delegated plugin purchases with exact quote review, server-owned intent recovery and safe receipt/acknowledgment replay. Added Python and Go transport examples and shared recovery conformance.

- Added owner-scoped retained command-intent status lookup after acknowledgement, with exact command authorization and no input payload exposure.

- Added an authenticated plugin control handler for delegated inventory and catalog reads, with expiring sessions, live authorization, resource limits and a Python transport example. Added Go receiver distribution notices.

- Upgraded SQLite storage to schema 4 with stable notification identities, indexed account reads and bounded history trimming during pack opening. Stop writers and back up the database and encryption keys before upgrading; older applications cannot open the upgraded database.

### Added

- Added visual pack front/back authoring, optional reveal artwork, reviewed product revisions and reusable pack renderers. Allocated packs retain their original artwork and design references.
- Added opt-in isolated groups with nested compositing, combined masks and effects, explicit bounds, pooled GPU surfaces and poster fallback when resource limits are exceeded.
- Added a versioned action-delivery schema and Python/Go receipt receiver examples with shared authenticated HTTP conformance, durable replay, exact numeric comparison and bounded receipt storage.
- Added independent clipping and effect-mask crops, transforms and inversion, with saved-library round trips and explicit player capability negotiation.
- Added opt-in incremental acquisition storage with bounded record transactions and revision-bound capacity accounting. Supported acquisitions avoid materializing unrelated installation records; other workflows retain their existing storage paths.
- Added embedded-font asset diagnostics, editable declared usage terms and sample glyph-coverage checks. Font uploads preserve locked text-layer assignments.
- Added versioned capability profiles with independent pack acquisition, direct sales, trading and resale controls, plus account-specific availability and recovery hints.
- Added Studio controls for polygon and image clipping masks, inversion, vertex editing and immutable saved-mask reuse.
- Added TypeScript declarations for the trade draft component, with validated inventory responses and persisted draft inputs.
- Added server-owned command recovery with account-scoped discovery, immutable reviewed inputs and explicit acknowledgement. A fresh browser or admin panel can recover an unconfirmed action after local storage is erased without repeating its debit or issuance.
- Added typed existing client/admin-controller APIs and checked inventory, trade, administration and command-recovery responses.
- Added a checked browser HTTP transport with generated TypeScript declarations, request/response validation and strict consumer checks. Acquisition contracts include reviewed revisions, public pack views and consistent error envelopes.
- Added editable stat binding controls, including explicit card/variant scope, labels, units, number formatting and bar ranges. Empty, false and null field values remain distinct.
- Added Studio policy diagnostics that focus the relevant field or select the correct card face, with embedded-font overflow checks and visible rule references.
- Added a styled-text row editor for text, emphasis, colors and embedded icons, with reordering, inherited formatting and undoable conversion to plain text. Rejected edits restore working controls for correction.
- Added custom field controls for scope, help text, units, visibility, nullability, ranges, precision, length bounds and primitive choices.
- Added proof-bound external pack purchases with atomic delivery, original-source refund confirmation, cancellation fences, and attributed recovery of proven legacy purchases.
- Added strict external-purchase schemas, a headless wallet example, and backup/encryption tools that preserve legacy source and rollback artifacts.
- Added synchronous host code generators for atomic pack allocation, with encrypted storage, provider-wide collision checks and retry preservation.
- Added a trusted server registration-material method for connecting issued codes to external reward services before player reveal.

### Changed

- Production worker scheduling now uses revision-bound pending-work summaries instead of loading installation state after every request, while retaining recovery planning when accounting migration is capacity-limited.
- Code-free pack opening now uses bounded record completion when accounting and reservations are prepared, preserving issued snapshots, new-card history, receipt replay and capacity-safe delivery.
- Preference updates now use bounded account and referenced-record transactions with atomic receipt and event delivery, preserving original replay and account identity.
- Pack quotes now read only the requesting account and selected configuration, avoiding inventory and receipt-history materialization while retaining reviewed pricing rules.
- Prepared SQLite installations now register, finalize and acknowledge recovery intents with bounded record transactions, preserving reserved completion at ordinary storage capacity.
- Production HTTP purchases now await incremental acquisition and durable command execution while preserving original receipt recovery after interrupted finalization.
- Converted the admin controller to strict TypeScript and generated declarations. Saved admin commands must match their reviewed inputs before recovery.
- Converted the browser client, code-reveal controller and durable command runner to strict TypeScript with generated declarations and checked build parity.
- New catalogs default to collection-only. The reference frontend loads optional views and data according to enabled workflows and retained recovery needs; the example catalog explicitly selects the demo profile.
- Resale no longer requires enabling user-to-user trade offers. Disabling admission preserves accepted work and original receipt replay.
- Encrypted storage schema 3 adds indexed current/former code-holder history alongside identity and collection queries. Migration preserves existing encrypted records and authentication sessions.
- Trade, listing, pack and action delivery workflows reserve completion capacity separately from new admissions. Legacy pending work receives an atomic reservation backfill before the production host admits traffic.
- Strengthened wallet, receipt, delivery and code audits, and routed code lifecycle events through durable subscriptions. Unchanged command replay does not rewrite state.

### Fixed

- Reject preferences admission before preparing storage metadata when legacy completion reservations still require migration.
- Preserve full-image alpha sampling for renderer masks without decoded dimensions, and synchronize the published mask schema.
- Keep the visual editor inactive until its card and policy finish loading, preventing early edits from racing initialization.
- Validate recovered command results and their original intent before confirming success. Malformed recovery replies preserve the original key for safe retry.
- Serialized Studio authoring and undo actions, and prevented queued edits from running after disposal. Mask inversion now requires a boolean value.
- Preserved original purchase inputs and retry keys across remounts and later authentication/rate-limit failures. Admin saves stop before dispatch when their recovery journal cannot be stored safely.
- Reserved refundable balance headroom so later credits cannot prevent escrow refunds, and fenced disposed controllers against obsolete requests and callbacks.
- Fixed concurrent SQLite startup snapshot copying and pending purchase pagination after terminal transitions.
- Contained album appearance rules and prevented style edits from changing locked text layers. Ambiguous stat keys now require an explicit scope.

### Upgrade notes

- Existing catalogs without a capability profile require an explicit profile publication before new pack, trade or commerce operations. Follow the [capability migration guide](docs/capabilities.md), retaining primitives needed by pending work.
- Commands registered after upgrade use the server recovery journal. Older commands whose browser identity was already lost still require host reconciliation. Plan the retained-intent limit; unresolved records are not automatically discarded.
- Back up the database and required keys before upgrading. Follow [production operations](docs/production.md) for schema migration and completion limits. Custom hosts must backfill legacy completion reservations before accepting new commands.
- New completion budgets are separate from the ordinary payload budget; configure the framework and SQLite limits consistently. Existing receipts and unresolved recovery records are retained.
- The checked transport does not manage retry identities. Preserve reviewed commands and their original keys as described in the [SDK guide](docs/wire-sdk.md).

## 0.2.0 — 1 October 2026

- Added editable text, embedded custom fonts, styled spans/icons, stat bindings and CSV metadata controls; reusable personal/shared masks, styles, templates and reviewed migrations.
- Added versioned administrator card policies, inherited requirements, template sets, impact previews, retirement/restore, source permissions and publication enforcement with pinned copy schemas.

- Rebuilt the default collector website with clear navigation, illustrated pack previews, collection tools, album editor, import studio and account activity.
- Added two-inventory visual trading, drag/drop and accessible Add/Remove controls, review-bound snapshots, counters, privacy/blocking and notifications.
- Added JSON/YAML catalogs/patches, schema-validated stats/metadata, reviewed atomic publication, CLI export/import and creator examples.
- Added card orbit/flip/zoom/reset, layered crop/depth/effects, shared comparison and composable panoramic pieces.
- Added optional pity, availability windows, finite-stock display, favorites, wishlists and discovery completion.
- Added complete-view replacement/lifecycle and inspector/comparison contracts; maintained the alternate host example and compact tilt inspector.
- Added a separate OIDC production host, encrypted state/sessions, account-bound writes, limits/quotas, audit, backup/restore, encryption migration and Docker/TLS deployment template.
- Added meaningful core, host, UI and operational tests, dependency audit/CI image build, white paper, public customization examples and measured capacity documentation.

Existing catalog IDs, edition caps and acquired snapshots remain stable. The logical state schema remains 1; the storage adapter's current schema is described above and in the operations guide. Browser/client usage requires installing pinned dependencies for the server/importer. The public `renderInspector` defaults to orbit; `renderTiltInspector` preserves the prior compact interaction. External payment and reward services remain host responsibilities.

## 0.1.0 — 30 September 2026

Initial transactional core, durable SQLite, HTTP/client, optional UI, currencies, pack allocation/opening, finite copies, bindings, albums, escrow trades, trade-ups and public replacement callbacks.
