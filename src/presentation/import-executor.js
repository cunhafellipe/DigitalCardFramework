/** Required OS resource envelopes for data-only import and publication jobs. */
import { spawn, execFile } from "node:child_process";
import { mkdir, readFile, writeFile, rmdir, access, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensure, sha256 } from "./data.js";

const workerPath = fileURLToPath(new URL("./import-worker.js", import.meta.url));
const helperPath = fileURLToPath(new URL("./import-job.ps1", import.meta.url));
const scrubEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "SYSTEMROOT", "WINDIR"].includes(key.toUpperCase())));
const failure = (message) => Object.assign(new Error(message), { code: "IMPORT_ISOLATION" });
const helperCommand = (values) => {
  const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
  const command = "$importArguments=@(" + values.map(quote).join(",") + "); & ([scriptblock]::Create([IO.File]::ReadAllText(" + quote(helperPath) + "))) @importArguments";
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")];
};

export async function createImportExecutor({ backend, memoryBytes = 512 * 1024 ** 2, aggregateMemoryBytes = 1024 * 1024 ** 2, temporaryBytes = 2 * 1024 ** 3, aggregateTemporaryBytes = 4 * 1024 ** 3, cgroupRoot, powershellPath } = {}) {
  for (const value of [memoryBytes, aggregateMemoryBytes, temporaryBytes, aggregateTemporaryBytes]) ensure(Number.isSafeInteger(value) && value >= 64 * 1024 ** 2, "IMPORT_ISOLATION", "Invalid import resource budget");
  ensure(aggregateMemoryBytes >= memoryBytes, "IMPORT_ISOLATION", "Aggregate import budget is smaller than one job");
  ensure(aggregateTemporaryBytes >= temporaryBytes, "IMPORT_ISOLATION", "Aggregate temporary budget is smaller than one job");
  let scope, assemblyDirectory, assemblyPath, assemblyDigest;
  const startupDeadline = Date.now() + 30000;
  const scopeName = "digital-card-import-" + randomUUID();
  if (backend === "windows-job") {
    ensure(process.platform === "win32", "IMPORT_ISOLATION", "Windows Job Objects require Windows");
    powershellPath ??= path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    ensure(path.isAbsolute(powershellPath), "IMPORT_ISOLATION", "PowerShell executable must be absolute");
    await access(powershellPath, constants.X_OK);
    const taskkillPath = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    await access(taskkillPath, constants.X_OK);
    assemblyDirectory = await mkdtemp(path.join(tmpdir(), "dc-import-helper-"));
    assemblyPath = path.join(assemblyDirectory, "launcher.dll");
    try {
      await new Promise((resolve, reject) => {
        const compiler = spawn(powershellPath, helperCommand(["--compile", assemblyPath]), { env: { ...scrubEnvironment(), TEMP: assemblyDirectory, TMP: assemblyDirectory }, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
        let expired = false, diagnostic = "", cleanup;
        const timer = setTimeout(() => {
          expired = true;
          cleanup = new Promise((done, failed) => {
            // Kill the owned compiler tree before its parent disappears.
            execFile(taskkillPath, ["/PID", String(compiler.pid), "/T", "/F"], { env: scrubEnvironment(), windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 }, (error) => {
              if (error) { if (compiler.exitCode === null) compiler.kill("SIGKILL"); failed(failure("Import compiler process-tree cleanup failed")); }
              else done();
            });
          });
          void cleanup.catch(reject);
        }, Math.max(1, startupDeadline - Date.now()));
        compiler.stderr.on("data", (chunk) => { if (diagnostic.length < 16384) diagnostic += chunk.toString("utf8").slice(0, 16384 - diagnostic.length); });
        compiler.once("error", (error) => { clearTimeout(timer); reject(error); });
        compiler.once("close", async (code) => {
          clearTimeout(timer);
          if (cleanup) { try { await cleanup; } catch (error) { return reject(error); } }
          if (expired) return reject(failure("Import launcher compilation exceeded the startup deadline"));
          if (code !== 0 || !diagnostic.includes("DC_IMPORT_STAGE:compiled")) return reject(failure("Import launcher compilation failed"));
          resolve();
        });
      });
      assemblyDigest = await readFile(assemblyPath).then((bytes) => sha256(bytes));
    } catch (error) { await rm(assemblyDirectory, { recursive: true, force: true }); throw error; }
  } else if (backend === "linux-cgroup") {
    ensure(process.platform === "linux" && typeof cgroupRoot === "string" && path.isAbsolute(cgroupRoot), "IMPORT_ISOLATION", "Linux import enforcement requires an absolute delegated cgroup v2 directory");
    const controllers = await readFile(path.join(cgroupRoot, "cgroup.controllers"), "utf8").catch(() => { throw failure("Delegated cgroup v2 directory is unavailable"); });
    ensure(controllers.split(/\s+/).includes("memory") && controllers.split(/\s+/).includes("pids"), "IMPORT_ISOLATION", "Delegated memory and pids controllers are required");
    await access(path.join(cgroupRoot, "cgroup.procs"), constants.W_OK).catch(() => { throw failure("Import delegation requires write access to the delegated root cgroup.procs; launch the service in a host leaf beneath that root"); });
    scope = path.join(cgroupRoot, scopeName);
    await mkdir(scope);
    try {
      await writeFile(path.join(scope, "memory.max"), String(aggregateMemoryBytes));
      await writeFile(path.join(scope, "memory.swap.max"), "0");
      await writeFile(path.join(scope, "cgroup.subtree_control"), "+memory +pids");
      await access(path.join(scope, "cgroup.kill"), constants.W_OK);
    } catch (error) { await rmdir(scope); throw failure("Delegated import cgroup cannot enforce required limits: " + error.message); }
  } else throw failure("Select windows-job or linux-cgroup import enforcement");
  let reserved = 0, reservedTemporary = 0, closed = false, closePromise;
  const active = new Set();
  async function run(operation, file, options = {}) {
    ensure(!closed, "CLOSED", "Import executor closed");
    ensure(reserved + memoryBytes <= aggregateMemoryBytes, "QUOTA", "Aggregate import memory budget is reserved");
    ensure(reservedTemporary + temporaryBytes <= aggregateTemporaryBytes, "QUOTA", "Aggregate import temporary budget is reserved");
    const timeoutMs = options.timeoutMs ?? 30000, maxHeapMb = options.maxHeapMb ?? 256;
    ensure(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 300000, "LIMIT", "Invalid validation timeout");
    ensure(Number.isSafeInteger(maxHeapMb) && maxHeapMb >= 32 && maxHeapMb <= 4096, "LIMIT", "Invalid validation heap budget");
    if (operation === "publish") ensure(typeof options.contentRoot === "string" && path.isAbsolute(options.contentRoot), "PATH", "Publication content root must be absolute");
    const stagingPath = operation === "publish" ? path.join(options.contentRoot, ".pending-" + randomUUID()) : undefined;
    const request = JSON.stringify({ operation, path: file, limits: options.limits, performance: options.performance, contentRoot: options.contentRoot, expectedDigest: options.expectedDigest, stagingPath, temporaryBytes });
    ensure(Buffer.byteLength(request) <= 1024 * 1024, "LIMIT", "Import worker request exceeds its budget");
    options.signal?.throwIfAborted();
    reserved += memoryBytes;
    reservedTemporary += temporaryBytes;
    let group, child;
    let stop;
    const completion = (async () => {
      try {
        if (scope) {
          group = path.join(scope, "job-" + randomUUID());
          await mkdir(group);
          await writeFile(path.join(group, "memory.max"), String(memoryBytes));
          await writeFile(path.join(group, "memory.swap.max"), "0");
          await writeFile(path.join(group, "memory.oom.group"), "1");
          await writeFile(path.join(group, "pids.max"), "32");
          child = spawn("/bin/sh", ["-c", 'printf "%s" "$$" > "$1/cgroup.procs" || exit 125; exec "$2" --max-old-space-size="$4" "$3" --stdio', "import-gate", group, process.execPath, workerPath, String(maxHeapMb)], { env: scrubEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
        } else {
          ensure(await readFile(assemblyPath).then((bytes) => sha256(bytes)) === assemblyDigest, "IMPORT_ISOLATION", "Import launcher assembly changed");
          child = spawn(powershellPath, helperCommand([process.execPath, workerPath, memoryBytes, aggregateMemoryBytes, scopeName, maxHeapMb, assemblyPath]), { env: scrubEnvironment(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        }
        return await new Promise((resolve, reject) => {
          let output = "", metrics = "", size = 0, outcomeError;
          const startedAt = Date.now(), diagnostics = [];
          const recordStage = (stage) => {
            if (diagnostics.length < 16 && !diagnostics.some((entry) => entry.stage === stage)) diagnostics.push({ stage, elapsedMs: Date.now() - startedAt });
          };
          let timer;
          stop = (error = new DOMException("Import cancelled", "AbortError")) => {
            outcomeError ??= error;
            if (group) void writeFile(path.join(group, "cgroup.kill"), "1").catch(() => {});
            child.kill("SIGKILL");
          };
          const abort = () => stop();
          timer = setTimeout(() => {
            const last = diagnostics.at(-1);
            stop(failure("Import worker time limit exceeded" + (last ? " at " + last.stage + " (" + last.elapsedMs + " ms)" : " before launcher diagnostics")));
          }, timeoutMs);
          options.signal?.addEventListener("abort", abort, { once: true });
          const decoder = new StringDecoder("utf8");
          child.stdout.on("data", (chunk) => {
            recordStage("response-received");
            size += chunk.length;
            if (size > 4 * 1024 ** 2) return stop(failure("Import worker response exceeds its budget"));
            output += decoder.write(chunk);
          });
          child.stdin.on("error", (error) => { outcomeError ??= error; });
          child.stderr.on("data", (chunk) => {
            if (metrics.length < 16384) metrics += chunk.toString("utf8").slice(0, 16384 - metrics.length);
            for (const stage of metrics.matchAll(/DC_IMPORT_STAGE:(bootstrap|compiled|assembly-loaded|created|assigned|resumed|exited|terminated|worker-started|request-end|result-writing)/g)) recordStage(stage[1]);
          });
          child.once("error", (error) => { outcomeError ??= error; });
          child.once("close", async (code) => {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", abort);
            let resources;
            try {
              const measurement = metrics.match(/\{"peakJobMemoryBytes":\d+,"memoryLimitBytes":\d+,"processMemoryLimitBytes":\d+\}/)?.[0];
              resources = group ? { peakJobMemoryBytes: Number(await readFile(path.join(group, "memory.peak"), "utf8")), memoryLimitBytes: memoryBytes } : JSON.parse(measurement ?? "null");
              resources.backend = backend;
            } catch { /* Diagnostics are optional on interrupted startup. */ }
            if (group && code === 125) return reject(Object.assign(failure("Cannot enter the import cgroup before execution: launch the service in a host leaf under the delegated root and grant write access to destination and common-ancestor cgroup.procs"), { resources }));
            if (outcomeError) return reject(Object.assign(outcomeError, { resources, diagnostics }));
            try {
              if (code !== 0) throw failure("Import worker exited within its resource envelope (" + code + ")");
              const result = JSON.parse(output + decoder.end());
              if (!result?.ok) throw Object.assign(new Error(result?.message ?? "Import worker failed"), { code: result?.code ?? "IMPORT" });
              resolve({ ...result, resources, diagnostics });
            } catch (error) { reject(Object.assign(error, { resources, diagnostics })); }
          });
          if (options.signal?.aborted || closed) stop();
          else child.stdin.end(request);
        });
      } finally {
        try {
          if (group) {
            await writeFile(path.join(group, "cgroup.kill"), "1");
            const deadline = Date.now() + 5000;
            while (!/^populated 0$/m.test(await readFile(path.join(group, "cgroup.events"), "utf8"))) {
              if (Date.now() >= deadline) { closed = true; throw failure("Import process tree did not terminate; executor stopped"); }
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            await rmdir(group);
          }
          if (stagingPath) await rm(stagingPath, { recursive: true, force: true });
        } finally { reserved -= memoryBytes; reservedTemporary -= temporaryBytes; }
      }
    })();
    const entry = { completion, cancel: () => stop?.() };
    active.add(entry);
    try { return await completion; } finally { active.delete(entry); }
  }
  const executor = {
    validate: (file, options) => run("validate", file, options),
    publish: (file, options) => run("publish", file, options),
    async close() {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        for (const entry of active) entry.cancel();
        await Promise.allSettled([...active].map((entry) => entry.completion));
        if (scope) await rmdir(scope);
        if (assemblyDirectory) await rm(assemblyDirectory, { recursive: true, force: true });
      })();
      return closePromise;
    },
  };
  // A worker must complete a control-only probe before the store accepts uploads.
  try {
    ensure(Date.now() < startupDeadline, "IMPORT_ISOLATION", "Import isolation startup deadline exceeded");
    await run("probe", null, { timeoutMs: Math.max(1, startupDeadline - Date.now()) });
  }
  catch (error) { await executor.close(); throw Object.assign(failure("Import isolation startup probe failed: " + error.message), { diagnostics: error.diagnostics }); }
  return executor;
}
