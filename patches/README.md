# Fontkit variation patch

`fontkit@2.0.4.patch` backports the six functional source changes from [fontkit pull request 389](https://github.com/foliojs/fontkit/pull/389), commit `072384d67ac04de47bd50c787b2bf8a6e4eab9e3`. That upstream proposal remains unmerged. The patch preserves compressed font directories and streams, applies variation deltas to copied WOFF2 glyphs, and reads compressed WOFF variation data from the correct table stream. Fontkit remains MIT licensed; its attribution is retained in `THIRD_PARTY_NOTICES.txt`.

The four distribution exports were regenerated with the fontkit 2.0.4 upstream Parcel pipeline (`parcel@2.0.0-canary.1713`, release `jsconfig.json` with `experimentalDecorators: true`) using `parcel build --no-source-maps`. Functional distribution code is generated, not hand edited. Patched exports have no source-map references; the original package's unused map files are not updated and are unsuitable for debugging those exports.

pnpm applies the exact versioned patch during installation. Consumers need no Parcel toolchain. Reassess the backport when adopting an upstream release; retain both source and generated export changes until that release passes the compressed-font variation regressions.
