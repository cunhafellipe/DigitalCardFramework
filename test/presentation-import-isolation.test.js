import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm, access } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
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
    if (process.platform === "win32") {
      assert.ok(validation.diagnostics.some((entry) => entry.stage === "assembly-loaded"));
      assert.ok(!validation.diagnostics.some((entry) => entry.stage === "compiled"));
    }
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
    let completed = false, workerOutcome;
    const failure = load.then((result) => {
      workerOutcome = { status: "fulfilled", resources: result.resources, diagnostics: result.diagnostics };
      assert.fail("Expanding input unexpectedly completed");
    }, (error) => {
      workerOutcome = { status: "rejected", name: error.name, code: error.code, message: error.message, resources: error.resources, diagnostics: error.diagnostics };
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
      const requestStarted = performance.now();
      try {
        assert.equal(await (await fetch("http://127.0.0.1:" + server.address().port, { signal: AbortSignal.timeout(2000) })).text(), "available");
      } catch (error) {
        t.diagnostic(JSON.stringify({ event: "host-request-failed", requestElapsedMs: performance.now() - requestStarted, completedRequests: requests, workerCompleted: completed, workerOutcome }));
        throw error;
      }
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

test("Windows launcher compilation and assembly integrity failures clean owned temporary files", { skip: process.platform !== "win32" }, async () => {
  const cacheDirectories = async () => (await readdir(tmpdir())).filter((name) => name.startsWith("dc-import-helper-"));
  const before = new Set(await cacheDirectories());
  await assert.rejects(createImportExecutor({ backend: "windows-job", powershellPath: process.execPath }), /compilation failed/);
  assert.deepEqual((await cacheDirectories()).filter((name) => !before.has(name)), []);
  const executor = await createImportExecutor({ backend: "windows-job" });
  const owned = (await cacheDirectories()).filter((name) => !before.has(name));
  assert.equal(owned.length, 1);
  try {
    await writeFile(path.join(tmpdir(), owned[0], "launcher.dll"), Buffer.from("invalid assembly"));
    await assert.rejects(executor.validate("unused"), /assembly changed/);
  } finally { await executor.close(); }
  assert.deepEqual((await cacheDirectories()).filter((name) => !before.has(name)), []);
});

test("Windows compiler runtime diagnostics", { skip: process.env.DC_IMPORT_RUNTIME_DIAGNOSTICS !== "1" }, async (t) => {
  assert.equal(process.platform, "win32", "Windows runtime diagnostics require Windows");
  const root = await mkdtemp(path.join(tmpdir(), "dc-import-runtime-"));
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const runtimes = [
    ["powershell5", path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")],
    ["powershell7", process.env.DC_IMPORT_DIAGNOSTIC_PWSH ?? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe")],
  ];
  const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
  const minimumKeys = ["PATH", "SYSTEMROOT", "WINDIR"];
  const runtimeKeys = [...minimumKeys, "TEMP", "TMP", "COMSPEC", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "PROGRAMDATA", "PSMODULEPATH", "DOTNET_ROOT"];
  const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
  async function invoke(executable, command, env) {
    const started = Date.now(), stages = [];
    const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false, cleanup;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        cleanup = new Promise((done, failed) => execFile(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000, maxBuffer: 65536 }, (error) => error ? failed(new Error("Runtime diagnostic process-tree cleanup failed")) : done()));
        void cleanup.catch(reject);
      }, 30000);
      child.stdout.on("data", (chunk) => { if (stdout.length < 8192) stdout += chunk.toString("utf8").slice(0, 8192 - stdout.length); });
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 8192) stderr += chunk.toString("utf8").slice(0, 8192 - stderr.length);
        for (const stage of stderr.matchAll(/DC_RUNTIME_STAGE:(bootstrap|compiled|loaded)/g)) if (!stages.some((entry) => entry.stage === stage[1])) stages.push({ stage: stage[1], elapsedMs: Date.now() - started });
      });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", async (code) => {
        clearTimeout(timer);
        if (cleanup) { try { await cleanup; } catch (error) { return reject(error); } }
        resolve({ code, timedOut, elapsedMs: Date.now() - started, version: stdout.match(/DC_RUNTIME_VERSION:([\d.]+)/)?.[1], stages });
      });
    });
  }
  try {
    for (const [runtime, executable] of runtimes) {
      assert.ok(path.isAbsolute(executable)); await access(executable);
      for (const [environment, keys] of [["minimum", minimumKeys], ["runtime", runtimeKeys]]) {
        const scratch = path.join(root, runtime + "-" + environment);
        await import("node:fs/promises").then((fs) => fs.mkdir(scratch));
        const assembly = path.join(scratch, "probe.dll");
        const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => keys.includes(key.toUpperCase()))), TEMP: scratch, TMP: scratch };
        const prefix = "$ErrorActionPreference='Stop';[Console]::Error.WriteLine('DC_RUNTIME_STAGE:bootstrap');[Console]::Out.WriteLine('DC_RUNTIME_VERSION:'+$PSVersionTable.PSVersion.ToString());";
        const compiled = await invoke(executable, prefix + "Add-Type -TypeDefinition 'public static class RuntimeProbe { public static int Value=1; }' -OutputAssembly " + quote(assembly) + " -OutputType Library;[Console]::Error.WriteLine('DC_RUNTIME_STAGE:compiled');", env);
        t.diagnostic(JSON.stringify({ runtime, environment, operation: "compile", ...compiled }));
        if (compiled.code === 0 && !compiled.timedOut) {
          const loaded = await invoke(executable, prefix + "Add-Type -Path " + quote(assembly) + ";[Console]::Error.WriteLine('DC_RUNTIME_STAGE:loaded');", env);
          t.diagnostic(JSON.stringify({ runtime, environment, operation: "load", ...loaded }));
        } else t.diagnostic(JSON.stringify({ runtime, environment, operation: "load", skipped: "Compilation did not complete" }));
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
