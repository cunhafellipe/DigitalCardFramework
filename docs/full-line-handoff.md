# Generate a complete example line

This source-checkout example for framework 0.2.0 prepares two cards, a pack jacket, an album layout and a catalog using original procedural geometry. It requires Node 24.14+ and the root frozen dependency installation. It uses no external artwork, fonts, plugins or network service.

From the repository root, choose an empty output directory and an asset base URL you control. Replace `SOURCE_COMMIT` with the exact 40-character commit you downloaded or checked out:

```sh
node examples/full-line.mjs handoff-output --source-revision SOURCE_COMMIT --base-url https://cards.example/content/
```

The command refuses a nonempty output directory. It generates distinct front/back PNGs, a layered Dawn card, a Dusk card, pack and album art, and four portable `.dcard` packages. Each package includes face descriptions. `handoff.json` records source rights, captions, byte hashes, logical presentation digests and framework/presentation compatibility. Geometry and generator source use the repository MIT license; this grant covers no external artwork you add.

The source revision is a supplied label, not verified by the script. Verify it against your checkout or download receipt. The manifest separately hashes the actual generator bytes and marks the revision unverified; no Git installation is required. Retain the emitted inputs: a fresh generation creates new poster identifiers, while rebuilding its `release.json` preserves the emitted card digests.

The output contains:

| File or directory | Purpose |
| --- | --- |
| `sources/` | Editable-source PNG inputs; retain these with the generator |
| `packages/` | Portable card, pack-jacket and album-art archives |
| `content/` | Immutable directories named by logical digest, ready for your asset storage |
| `release.json` | Version 1 input for the existing creator CLI |
| `catalog.json` | Complete catalog with pinned card and pack presentation references |
| `album-layout.json` | Cover/spine/page artwork and stable page IDs; not an issued album |
| `handoff.json` | Rights, hashes, captions, expected output and compatibility ledger |
| `result.json` | Fictional reference-engine acquisition and original-key replay results |
| `cli-verification/` | Independent rebuild of the two card inputs through the shipped CLI |

Successful output reports two cards, one purchased pack, one album, 10 credits spent, zero remaining balance and unchanged receipt replay. Two fixed pack slots issue one Dawn and one Dusk. The script saves/reads the album using those owned copies and verifies their pinned presentation digests. This check uses a fresh in-memory reference engine; it does not change your running website or retain a production collector database.

You can independently rebuild the emitted card configuration into a new directory:

```sh
node src/presentation/creator-cli.mjs handoff-output/release.json rebuilt-cards
```

Compare its reported card digests with `handoff.json`. Logical package digests identify portable content; archive SHA-256 values identify exact ZIP bytes. Catalog and album-layout hashes identify those JSON files. Issued copies and receipts have separate run-specific identities in `result.json`; owning a portable package does not issue a copy.

To use this handoff, serve `content/` at the supplied base URL, retain its immutable directories, and preview/review/publish `catalog.json` using your authorized host. Apply `album-layout.json` when creating an owner's album with that owner's copy IDs. The example prepares files; it does not upload them, configure authentication or deploy a service. Pack and album art are separate resources from card definitions and ownership.

Use the existing [publication ordering and retry contract](complex-cards/creator-api.md#headless-publication-and-packs), [catalog import procedure](content-authoring.md#import-workflow) and [original-request recovery guidance](wire-sdk.md). Publish assets before the catalog; retain unreferenced assets for retry. Do not grant a second local writer authority over a hosted service's funds, copies or receipts.
