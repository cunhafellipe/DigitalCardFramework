import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { deflateRawSync } from "node:zlib";
import path from "node:path";
import { createImportExecutor } from "../src/presentation/import-executor.js";
import { createPresentationStore } from "../src/presentation/service.js";
import { importPackage } from "../src/presentation/package.js";
import { publishPackage } from "../src/presentation/compiler.js";
import { build, fixture } from "./presentation-fixtures.mjs";

const required = process.env.DC_REQUIRE_IMPORT_ISOLATION === "1";
const available = process.platform === "win32" || (process.platform === "linux" && !!process.env.DC_IMPORT_CGROUP_ROOT);
const profile = process.platform === "win32" ? { backend: "windows-job" } : { backend: "linux-cgroup", cgroupRoot: process.env.DC_IMPORT_CGROUP_ROOT };
const enforced = { skip: available ? false : required ? false : "A delegated Linux cgroup v2 directory or Windows is required" };
const waitFor = async (predicate) => {
  const deadline = Date.now() + 20000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Import completion timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
function expandingArchive() {
  // A real DEFLATE stream reaches native allocations before package JSON parsing.
  const inflated = 160 * 1024 ** 2;
  const compressed = deflateRawSync(Buffer.alloc(inflated, 7));
  const name = Buffer.from("card.json"), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(inflated, 22); local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(inflated, 24); central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}

test("required isolation rejects unavailable platforms and malformed budgets before admission", async () => {
  await assert.rejects(createImportExecutor({ backend: "invalid" }), { code: "IMPORT_ISOLATION" });
  await assert.rejects(createImportExecutor({ ...profile, memoryBytes: -1 }), { code: "IMPORT_ISOLATION" });
  await assert.rejects(createImportExecutor({ backend: "linux-cgroup", cgroupRoot: "relative" }), { code: "IMPORT_ISOLATION" });
  if (required) assert.ok(available, "The dedicated isolation job must have its platform enforcement prerequisite");
});

test("isolated validation and atomic publication retain archive fidelity and digest identity", enforced, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "dc-isolation-fidelity-"));
  const executor = await createImportExecutor(profile);
  try {
    const pkg = await build(fixture()), file = path.join(root, "upload.dcard"), contentRoot = path.join(root, "content");
    await writeFile(file, pkg.archive);
    const validation = await executor.validate(file);
    assert.equal(validation.digest, pkg.digest);
    assert.ok(validation.resources.peakJobMemoryBytes > 0);
    if (process.platform === "win32") assert.ok(validation.resources.peakJobMemoryBytes <= validation.resources.memoryLimitBytes);
    t.diagnostic(JSON.stringify({ ...validation.resources, stages: validation.diagnostics }));
    const publication = await executor.publish(file, { contentRoot, expectedDigest: pkg.digest });
    assert.equal(publication.digest, pkg.digest);
    assert.deepEqual(new Uint8Array(await readFile(path.join(publication.folder, "download.dcard"))), pkg.archive);
    assert.equal((await importPackage(new Uint8Array(await readFile(path.join(publication.folder, "download.dcard"))))).digest, pkg.digest);
    assert.equal((await executor.publish(file, { contentRoot, expectedDigest: pkg.digest })).digest, pkg.digest);
    await assert.rejects(executor.publish(file, { contentRoot, expectedDigest: "sha256:" + "0".repeat(64) }), { code: "INTEGRITY" });
    assert.equal((await readdir(contentRoot)).filter((name) => name.startsWith(".pending-")).length, 0);
    await assert.rejects(publishPackage(pkg.archive, { contentRoot, temporaryBytes: 1 }), /temporary byte budget/);
  } finally { await executor.close(); await rm(root, { recursive: true, force: true }); }
});

test("expanding native allocations remain in the OS envelope while host requests remain available", enforced, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "dc-isolation-expansion-"));
  const executor = await createImportExecutor({ ...profile, memoryBytes: 128 * 1024 ** 2, aggregateMemoryBytes: 128 * 1024 ** 2 });
  const server = createServer((_request, response) => response.end("available"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const file = path.join(root, "expanding.dcard"); await writeFile(file, expandingArchive());
    const load = executor.validate(file, { maxHeapMb: 256, limits: { ratio: 10000 }, timeoutMs: 15000 });
    let completed = false;
    const failure = load.then(() => assert.fail("Expanding input unexpectedly completed"), (error) => {
      assert.match(error.message, /resource envelope|allocat|memory|heap/i);
      assert.ok(error.resources?.peakJobMemoryBytes > 0);
      t.diagnostic(JSON.stringify({ ...error.resources, error: error.message, stages: error.diagnostics }));
      assert.equal(error.resources.memoryLimitBytes, 128 * 1024 ** 2);
      if (process.platform === "win32") {
        assert.equal(error.resources.processMemoryLimitBytes, 128 * 1024 ** 2);
        // Qualify the observed counter margin without equating it with RSS.
        assert.ok(error.resources.peakJobMemoryBytes <= error.resources.memoryLimitBytes + 1024 ** 2);
      }
    }).finally(() => { completed = true; });
    void failure.catch(() => {});
    let requests = 0;
    while (!completed) {
      assert.equal(await (await fetch("http://127.0.0.1:" + server.address().port, { signal: AbortSignal.timeout(2000) })).text(), "available");
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await failure; assert.ok(requests > 0);
    const pkg = await build(fixture()); await writeFile(file, pkg.archive);
    assert.equal((await executor.validate(file)).digest, pkg.digest);
  } finally { await executor.close(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});

test("aggregate reservations survive timeout, cancellation, malformed input and shutdown", enforced, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dc-isolation-recovery-"));
  const executor = await createImportExecutor({ ...profile, memoryBytes: 128 * 1024 ** 2, aggregateMemoryBytes: 128 * 1024 ** 2 });
  try {
    const pkg = await build(fixture()), file = path.join(root, "upload.dcard"); await writeFile(file, pkg.archive);
    const timed = executor.validate(file, { timeoutMs: 1 });
    await assert.rejects(executor.validate(file), { code: "QUOTA" });
    await assert.rejects(timed, /time limit/);
    const controller = new AbortController();
    const cancelled = executor.validate(file, { signal: controller.signal }); controller.abort();
    await assert.rejects(cancelled, { name: "AbortError" });
    await writeFile(file, Buffer.from("invalid")); await assert.rejects(executor.validate(file));
    await writeFile(file, pkg.archive); assert.equal((await executor.validate(file)).digest, pkg.digest);
    await assert.rejects(executor.validate(file, { timeoutMs: 0 }), { code: "LIMIT" });
    const active = executor.validate(file); const outcome = assert.rejects(active, { name: "AbortError" });
    await executor.close(); await outcome; await executor.close();
    await assert.rejects(executor.validate(file), { code: "CLOSED" });
  } finally { await executor.close(); await rm(root, { recursive: true, force: true }); }
});

test("store aligns its queue with reserved worker budgets and publishes through isolation", enforced, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dc-isolation-store-"));
  const store = await createPresentationStore({ root, authorize: () => true, maxConcurrentImports: 4, importIsolation: { ...profile, memoryBytes: 128 * 1024 ** 2, aggregateMemoryBytes: 128 * 1024 ** 2 } });
  try {
    const pkg = await build(fixture()), actor = { id: "creator" };
    const jobs = [];
    for (let i = 0; i < 3; i++) jobs.push(await store.import(actor, pkg.archive, { idempotencyKey: "isolated-import-" + i }));
    await waitFor(async () => (await store.get(actor, jobs[0].id)).state === "ready");
    assert.equal((await store.publish(actor, jobs[0].id)).state, "published");
    await waitFor(async () => (await store.get(actor, jobs[2].id)).state === "ready");
    assert.equal((await store.publish(actor, jobs[0].id)).state, "published");
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});
