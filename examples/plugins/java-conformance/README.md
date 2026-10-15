# Java wire-contract examples

Requires a Java 21 JDK. No third-party libraries are used. This small example supplies an authenticated command client, a read-only `canTransfer` policy and an event receipt recorder. Each uses its existing framework contract; control sessions do not grant policy or delivery authority.

From the repository root:

```sh
mkdir -p /tmp/dc-java
javac --release 21 -d /tmp/dc-java examples/plugins/java-conformance/Conformance.java
JAVA=java JAVAC=javac node test/java-conformance.mjs
```

The qualification command compiles into a temporary directory, starts actual Java processes and removes its temporary files. `JAVA` and `JAVAC` can name absolute toolchain paths. Ordinary framework installation does not require Java. Existing JavaScript and TypeScript hosts can continue to use their native APIs.

For the command client, set `PLUGIN_CONTROL_URL`, `PLUGIN_TOKEN` and a host-issued `PLUGIN_DELEGATION`. Optional `PLUGIN_ID` and `PLUGIN_VERSION` default to `example.reader` and `1.0.0`. Send one JSON command on stdin:

```sh
printf '%s' '{"command":"inventory.read","input":{"limit":1}}' | java -cp /tmp/dc-java Conformance client
```

The client performs handshake, sends the delegated command, correlates the response and closes its session. Endpoint configuration permits HTTPS or explicit loopback HTTP and refuses redirects. The [control guide](../../../docs/plugin-control.md) describes purchase registration, original-intent recovery and current authority checks. Request IDs are correlation identities; the host creates the economic retry key.

For the service modes, create an operator-owned records file:

```json
{"actors":[{"id":"alice","recipientIds":["bob"],"allowListingReservation":true}]}
```

Set `PLUGIN_TOKEN` securely and optionally `TRANSFER_POLICY_PROVIDER_ID` (default `example.transfer`). Run:

```sh
java -cp /tmp/dc-java Conformance serve actors.json receipts.json
```

It prints its ephemeral loopback port and accepts POST `/transfer-policy` and `/actions`. The transfer endpoint implements only `digital-card-transfer-policy@1`, with explicit configured sender/recipient decisions. Native ownership, versions, grants and economic authority remain with the host. It does not implement the separate trade policy.

The action endpoint implements `digital-card-action@1` for `example.receiver` / `example.record`. It records validated original terms before acknowledging a job; an identical job replays, changed terms conflict, and malformed or forged envelopes are rejected. Generic valid event data is retained without gameplay interpretation. The [delivery guide](../../../docs/card-actions.md) describes at-least-once delivery and stable job identities.

One process exclusively locks the receipt journal. Each new receipt writes and forces a temporary file, then atomically replaces the journal; restart verifies every stored payload digest. The filesystem must support atomic replacement. An uncertain write poisons the running recorder until restart. Retained receipts are bounded by `PLUGIN_MAX_RECEIPTS` (default 1,000, maximum 10,000) and a 4 MiB journal; reducing capacity preserves known receipt replay. Back up the journal while the service is stopped. The recorder demonstrates receipt persistence across process restart, not atomicity with an unrelated provider effect, power-loss durability or multiple writers. Socket/body/concurrency limits are deliberately small for this example.

Qualification covers handshake/version/credential refusal, account and command scope, actual host grant revocation after a committed command, original purchase recovery after lost replies, transfer allow/deny and live disable, and actual subscribed-event delivery with lost acknowledgment and framework/receiver restart. Unicode, exact decimals, malformed input, conflicting terms and retained receipt capacity share the existing Python/Go contract semantics. This is a finite example family, not a general Java SDK.
