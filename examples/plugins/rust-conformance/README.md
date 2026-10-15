# Rust wire-contract examples

Requires Rust 1.89 or newer and a platform linker. Ordinary framework installation does not require Rust. This opt-in example uses established HTTP, JSON, decimal and cryptographic crates; it is not a general Rust SDK.

From the repository root, populate an explicitly selected Cargo cache once and run the qualification:

```sh
cargo fetch --locked --manifest-path examples/plugins/rust-conformance/Cargo.toml
CARGO=cargo node test/rust-conformance.mjs
```

`CARGO`, `RUSTC` and `CARGO_HOME` can select an existing private toolchain and cache. The runner builds with `--locked --offline` into a temporary target directory, starts actual Rust processes and removes temporary binaries, databases and journals. No global toolchain installation or application package changes are required. Windows needs MSVC Build Tools and a Windows SDK, or an equivalent supported Rust target toolchain.

To build separately:

```sh
cargo build --locked --manifest-path examples/plugins/rust-conformance/Cargo.toml
```

For the authenticated control client, set `PLUGIN_CONTROL_URL`, `PLUGIN_TOKEN` and a host-issued `PLUGIN_DELEGATION`. Optional `PLUGIN_ID` and `PLUGIN_VERSION` default to `example.reader` and `1.0.0`. Send one JSON command on stdin:

```sh
printf '%s' '{"command":"inventory.read","input":{"limit":1}}' | examples/plugins/rust-conformance/target/debug/dc-rust-conformance client
```

The client handshakes, sends its delegated command, correlates the response and closes the session. It accepts HTTPS or explicit loopback HTTP origins and refuses redirects. Requests, responses and deadlines are bounded. The host validates domain results and owns economic retry identities. The [control guide](../../../docs/plugin-control.md) describes original purchase registration, pending discovery and recovery after an uncertain response; request IDs only correlate messages.

For the service, prepare an operator-owned configuration file:

```json
{"actors":[{"id":"alice","recipientIds":["bob"],"allowListingReservation":true}]}
```

Set `PLUGIN_TOKEN` securely and optionally `TRANSFER_POLICY_PROVIDER_ID` (default `example.transfer`), then run:

```sh
examples/plugins/rust-conformance/target/debug/dc-rust-conformance serve actors.json receipts.json
```

It prints an ephemeral loopback port and accepts POST `/transfer-policy` and `/actions`. The transfer endpoint implements only `digital-card-transfer-policy@1`, using configured sender, recipient and listing-reservation decisions. Native ownership, versions, current grants and economic authority remain with the host. It does not implement the separate trade policy.

The action endpoint implements `digital-card-action@1` for `example.receiver` / `example.record`. It persists validated original terms before acknowledging a job, replays identical terms and conflicts on changed terms. Generic event source and data are retained without gameplay interpretation. See the [delivery guide](../../../docs/card-actions.md) for at-least-once delivery and original job identities.

One process exclusively locks the journal sidecar. A new receipt writes and synchronizes a same-directory temporary file, then atomically replaces the journal. Restart verifies all payload digests; an uncertain write poisons the running recorder until restart. `PLUGIN_MAX_RECEIPTS` defaults to 1,000 and is limited to 10,000; reducing capacity preserves replay of retained receipts. The journal is limited to 4 MiB. Before writing, the complete serialized candidate must also pass the restart parser's depth, node and exact-decimal limits. Deterministic capacity refusal leaves retained receipts available for replay. Back up while stopped. This demonstrates receiver restart persistence, not power-loss durability, multiple writers or atomicity with an unrelated provider effect.

Qualification covers identity/version/credential refusal, account and command isolation, committed purchase reply loss and original-intent recovery, actual grant revocation, read-only transfer allow/deny and late disable, and subscribed event delivery across framework/receiver restart. Malformed Unicode/JSON, exact decimal replay, conflicting terms, wrong credentials and retained capacity are also checked. Decimal canonicalization is receiver-local and does not claim RFC 8785 or an interchangeable cross-language journal. The two fixed routes use bounded connections, body sizes and timeouts.
