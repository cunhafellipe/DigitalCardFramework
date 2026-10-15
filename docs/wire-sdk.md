# Checked HTTP transport

`@digital-card/framework/wire-client` provides a TypeScript-checked transport for the published HTTP operation IDs. It validates JSON requests and responses with generated browser-compatible validators before returning data. It sends same-origin session credentials and binds JSON writes to the principal returned by the host session.

```ts
import {createWireTransport} from '@digital-card/framework/wire-client';

let principal: string | null = null;
const call = createWireTransport({principal: () => principal});
const me = await call('me', undefined);
principal = me.userId;

const quote = await call('quote', {productId: 'starter', quantity: 1});
const purchase = await call('purchase', {...quote, key: crypto.randomUUID()});
const opened = await call('openPack', {
  key: crypto.randomUUID(), packId: purchase.packs[0]!.id
});
```

The browser supplies the request origin. The production host still verifies the session, origin, principal, permissions and immutable review. Trade acceptance and counteroffers require the reviewed `expectedDigest`. Transport validation does not authorize a command or manage retry keys: preserve an original command and its key before sending, and recover that same command after an uncertain outcome.

An independently hosted authoritative service owns funds, copies, command receipts and the durable action outbox together. Send complete commands to that service and keep their atomic writes there; do not apply its responses through a second local writer. The host must authenticate each caller and construct its trusted actor; forwarding an actor object in JSON does not authenticate that actor. Hosting the reference engine separately retains its storage behavior; a different storage implementation needs its own invariant and recovery qualification. Presentation publication follows the [assets-first, catalog-last contract](complex-cards/creator-api.md#headless-publication-and-packs).

Use the options argument for path parameters, query parameters and cancellation:

```ts
await call('tradeInventory', undefined, {
  path: {userId: 'account-id'}, query: {limit: 50}, signal
});
```

`WireApiError` exposes the server's `code`, `message` and HTTP `status`. `WireContractError` identifies an invalid request, response or operation and provides validation diagnostics. A timeout, disconnect or malformed successful response leaves the command outcome uncertain. Recover its original command intent or replay the exact command with its original key; a new key can create another operation.

The acquisition schemas describe quote revisions, integer prices, public pack views and opening receipts. Pack responses reject sealed copy IDs and internal receipts. Every documented error status uses the `{code, message}` envelope. Other operations are checked to the detail currently present in their schemas; unspecified object fields remain `unknown` and need an application-level contract before use. These declarations cover the wire transport, not the entire JavaScript browser or backend implementation.

Inventory responses include checked copy identities, public definitions, variant identities, binding lifecycle fields and transfer eligibility. Administration responses describe permissions, effective product odds, account restrictions, sanitized copy summaries and changes by scope. Trade responses describe immutable offers, snapshots, status and review digests. Extension metadata remains extensible.

The server-owned command intent routes retain original commands across browser sessions. Register an input, execute its returned intent ID, recover that same ID after an uncertain outcome, and acknowledge its resolved outcome before starting another command of that kind:

```ts
const intent = await call('registerCommandIntent', {
  command: 'purchase', input: quote
});
const executed = await call('executeCommandIntent', {id: intent.id});
await call('acknowledgeCommandIntent', {id: executed.intent.id});
```

Registration supplies a retry key when one is absent. An existing unacknowledged head is returned unchanged even when the proposed input differs; compare and resolve the original before continuing. `commandIntents` lists account-owned current heads, including completed and failed commands. Execution responses validate their result against the returned command's schema. Failed execution uses the regular error envelope, and its retained intent contains the failure for recovery.

Contract generation uses the pinned Ajv dependency. Strict SDK compilation uses the pinned TypeScript development dependency. Run `pnpm contract` after changing wire schemas and `pnpm test:sdk` to check consumer types and generated-file drift. The runtime uses generated ESM and requires no schema compiler in the browser.
