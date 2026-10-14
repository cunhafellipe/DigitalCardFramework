# Procedural pixel effects

The optional `dc.wasm-pixels@0.1` adapter renders a procedural RGBA layer inside the normal card composition. The host installs and approves each WebAssembly program. A card selects an approved program and supplies numeric parameters; importing a card cannot install executable code.

## Generate an example

Either standard-library example produces a complete card package and a separate executable module:

```sh
python examples/plugins/python-wasm-pixels.py output/python
go run examples/plugins/go-wasm-pixels/main.go output/go
```

Each output directory contains `example.dcard`, `program.wasm` and `registry.json`. Python authors a gradient; Go authors a checker effect. Both generators assemble genuine WebAssembly bytecode, PNG posters and the card archive. They do not compile Python or Go into WebAssembly, and the browser does not run a Python or Go interpreter.

Serve the Python output at `/compute/python/` or the Go output at `/compute/go/`. To use another module location, pass its URL after the output directory when generating. Review the generated program and load the one-element array in `registry.json` as the adapter's trusted `programs` configuration. Import and publish `example.dcard` through the ordinary card-package workflow. Keep `program.wasm` outside the card archive.

## Install a program

Review the module, serve it from a controlled URL, and pin its SHA-256 in trusted host configuration:

Deploy the adapter's module worker and its JavaScript dependencies with the application. When bundling, ensure the worker URL relative to the adapter module resolves to the emitted worker asset; copying only the main application bundle is insufficient.

```js
import { wasmPixelAdapter } from '@digital-card/framework/presentation/wasm-pixels';
import { createPlayerStage } from '@digital-card/framework/presentation';

const effects = wasmPixelAdapter({
  programs: [{
    id: 'example.gradient',
    version: '1.0.0',
    url: '/effects/gradient.wasm',
    sha256: approvedModuleHash,
  }],
});
const stage = createPlayerStage({ root: region, adapters: [effects] });
```

An adapter scene node uses `adapter: 'dc.wasm-pixels'` and data such as:

```json
{
  "program": "example.gradient",
  "version": "1.0.0",
  "clock": false,
  "params": [0.25, 0.75]
}
```

Declare `dc.wasm-pixels@0.1` in the package's required capabilities and provide face posters. The node still needs its ordinary scene identity, dimensions and placement. The program identifier and version must exactly match an enabled registry entry. Program URLs and module bytes belong to host configuration, not node data.

## Module interface

The `digital-card.wasm-pixels@1` interface imports only `env.memory`: unshared, 32-bit linear memory with an explicit maximum within the host limit. Modules must not define their own memory, tables, elements or a start function. Additional imports or exports are refused.

Export one function with this signature:

```text
render(width: i32, height: i32,
       angle: f64, tiltX: f64, tiltY: f64,
       activeTimeSeconds: f64, staticMotion: i32,
       paramsPtr: i32, paramsCount: i32) -> i32
```

The host writes up to eight finite parameters as little-endian `f64` values in the first 64 bytes of memory. Read them using `paramsPtr` and `paramsCount`. Return a byte offset of at least 64 pointing to exactly `width × height × 4` tightly packed RGBA8 bytes. The entire output must fit in the current linear memory. A trap or invalid output selects the card's poster fallback.

Use the supplied angle, tilt and time rather than reading an external clock. A clock-driven effect must respect `staticMotion`; reduced-motion rendering must remain stable. This interface provides CPU pixel computation. It does not expose DOM, network, WASI or arbitrary GPU shader callbacks.

## Limits and lifecycle

The host may configure these adapter options:

| Option | Default | Meaning |
| --- | --- | --- |
| `maxWorkers` | `2` | Concurrent effect instances |
| `maxPixels` | `1048576` | Maximum pixels in one surface |
| `memoryPages` | `256` | Linear-memory ceiling in 64 KiB pages; default 16 MiB |
| `maxModuleBytes` | `262144` | Maximum downloaded module size |
| `deadlineMs` | `1000` | Deadline for initialization and each computation |

A requested surface that exceeds configured limits falls back; the adapter does not silently reduce its resolution. Deadlines terminate stalled startup or rendering. Surface accounting includes owned buffers and the configured linear-memory ceiling, but does not measure the browser's total process, engine or JIT memory. Set a stage surface budget that can accommodate the effect's memory estimate as well as the rest of the card.

`view.snapshot()` waits for the effect frame matching its captured inputs. Disposing or replacing that view while the effect frame is pending invalidates the capture. Ordinary rendering can coalesce input updates while a frame is being computed.

Revoke a program for active and future instances with:

```js
effects.setEnabled('example.gradient', '1.0.0', false);
```

Re-enabling it permits new instances; remount an affected view to retry. On host teardown, dispose the stage and adapter:

```js
stage.dispose();
effects.dispose();
```

Keep the matching module available for pinned content. Review new program versions and hashes before changing the registry.
