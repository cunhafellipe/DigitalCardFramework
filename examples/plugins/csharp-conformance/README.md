# C# wire-contract examples

Requires the .NET 8 SDK to build. This project uses System.Text.Json, HttpClient and the SDK-included ASP.NET Core shared framework; it has no NuGet package dependencies. The adjacent NuGet.Config clears package feeds. This small example supplies an authenticated command client, a read-only `canTransfer` policy and an event receipt recorder. Each uses its existing framework contract; control sessions do not grant policy or delivery authority.

From the repository root:

```sh
dotnet restore examples/plugins/csharp-conformance/Conformance.csproj --configfile examples/plugins/csharp-conformance/NuGet.Config
dotnet build examples/plugins/csharp-conformance/Conformance.csproj --no-restore --configuration Release --output /tmp/dc-csharp
DOTNET=dotnet node test/csharp-conformance.mjs
```

The qualification command restores from the local SDK, compiles into a temporary directory, starts actual C# processes and removes its temporary files. `DOTNET` may name an absolute toolchain path. Ordinary framework installation does not require .NET. A built service uses the .NET 8 and ASP.NET Core runtimes; the SDK includes both for qualification.

For the command client, set `PLUGIN_CONTROL_URL`, `PLUGIN_TOKEN` and a host-issued `PLUGIN_DELEGATION`. Optional `PLUGIN_ID` and `PLUGIN_VERSION` default to `example.reader` and `1.0.0`. Send one JSON command on stdin:

```sh
printf '%s' '{"command":"inventory.read","input":{"limit":1}}' | dotnet /tmp/dc-csharp/Conformance.dll client
```

The client performs handshake, sends the delegated command, correlates the response and closes its session. HTTPS or explicit loopback HTTP is permitted; redirects are refused and streamed responses have byte/deadline bounds. The [control guide](../../../docs/plugin-control.md) describes purchase registration, original-intent recovery and current authority checks. Request IDs are correlation identities; the host creates the economic retry key.

For the service, create an operator-owned records file:

```json
{"actors":[{"id":"alice","recipientIds":["bob"],"allowListingReservation":true}]}
```

Set `PLUGIN_TOKEN` securely and optionally `TRANSFER_POLICY_PROVIDER_ID` (default `example.transfer`). Run:

```sh
dotnet /tmp/dc-csharp/Conformance.dll serve actors.json receipts.json
```

The service prints its ephemeral loopback port and accepts POST `/transfer-policy` and `/actions`. The transfer endpoint implements only `digital-card-transfer-policy@1`, with explicit configured sender/recipient decisions. Native ownership, versions, grants and economic authority remain with the host. The separate trade policy is not implemented here.

The action endpoint implements `digital-card-action@1` for `example.receiver` / `example.record`. It records validated original terms before acknowledging a job; identical terms replay, changed terms conflict and malformed or forged envelopes are rejected. Generic valid event data is retained without gameplay interpretation. The [delivery guide](../../../docs/card-actions.md) describes at-least-once delivery and stable job identities.

One process exclusively opens the receipt lock file. New receipts write and force a temporary file in the journal directory, then atomically move or replace the journal before acknowledgment. Restart verifies stored payload digests. The filesystem must support atomic replacement. An uncertain write poisons the recorder until restart. The journal is bounded to 4 MiB and `PLUGIN_MAX_RECEIPTS` (default 1,000, maximum 10,000); reduced capacity preserves known receipt replay. Back up the journal while stopped. Exact numeric canonicalization uses BigInteger rather than floating-point values, so equivalent decimal spellings replay without merging distinct large integers. JSON input rejects duplicate/reserved keys, invalid Unicode and excessive depth/size.

The targeted runner exercises handshake/version/credential refusal, account/command scope, actual grant revocation after a committed command, original purchase recovery after lost replies, transfer allow/deny and live disable, and actual subscribed-event delivery with lost acknowledgment and framework/receiver restart. Unicode, exact decimals, malformed input, conflicting terms and retained receipt capacity follow the existing Python/Go profiles. These are executable qualification scenarios, not a claim that every environment has executed them.

This is a finite example family, not a general C# SDK. Receipt recording does not establish atomicity with an unrelated provider effect, machine power-loss durability, multiple writers or cross-language journal interchange. Keep the example behind the application's own operating controls; it does not install services or administer host grants.
