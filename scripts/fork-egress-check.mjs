#!/usr/bin/env node
// Launches the packaged Windows app on temp data behind a logging proxy that forwards nothing, waits, and
// counts the hosts it tried to reach. Exit 0 = no denylisted host and the server came up; 1 = a denylisted
// host was contacted; 2 = the server never came up. Traffic that ignores proxy settings is not seen.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const READY_LINE = "openmausbot server on ";

// Path-scoped entries of the plan's denylist (google favicons, milind-soni GitHub paths) are matched by host:
// a CONNECT tunnel shows only host:port, so this check is stricter than the runtime block.
const DENIED = [
  { rule: "*.posthog.com", match: (h) => h === "posthog.com" || h.endsWith(".posthog.com") },
  { rule: "*.openmausbot.com", match: (h) => h === "openmausbot.com" || h.endsWith(".openmausbot.com") },
  { rule: "*.milindsoni201.workers.dev", match: (h) => h.endsWith(".milindsoni201.workers.dev") },
  { rule: "omb-cloud-staging.fly.dev", match: (h) => h === "omb-cloud-staging.fly.dev" },
  { rule: "www.google.com (s2/favicons)", match: (h) => h === "www.google.com" },
  { rule: "github.com (milind-soni)", match: (h) => h === "github.com" },
  { rule: "raw.githubusercontent.com (milind-soni)", match: (h) => h === "raw.githubusercontent.com" },
  { rule: "api.github.com (milind-soni)", match: (h) => h === "api.github.com" },
];

const { values } = parseArgs({
  options: {
    exe: { type: "string", default: join(ROOT, "release", "win-unpacked", "OpenMausBot.exe") },
    seconds: { type: "string", default: "90" },
  },
});
const seconds = Number(values.seconds);
if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`--seconds must be a positive number, got ${values.seconds}`);
if (!existsSync(values.exe)) throw new Error(`packaged app not found: ${values.exe} (run pnpm package:win)`);

const counts = new Map();
function record(host) {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  counts.set(bare, (counts.get(bare) ?? 0) + 1);
}

const proxy = http.createServer((req, res) => {
  try { record(new URL(req.url).hostname); } catch { record(`(unparsed) ${req.url}`); }
  res.writeHead(502).end();
});
// The app resets refused tunnels; the request is already counted, so a reset is not an error here.
proxy.on("clientError", (_error, socket) => socket.destroy());
proxy.on("connect", (req, socket) => {
  socket.on("error", () => socket.destroy());
  record(req.url.replace(/:\d+$/, ""));
  socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;

const tempRoot = mkdtempSync(join(tmpdir(), "omb-egress-"));
const userData = join(tempRoot, "user-data");
const dataDir = join(tempRoot, "omb-data");
const serverLog = join(userData, "logs", "server.log");

console.log(`exe       ${values.exe}`);
console.log(`proxy     ${proxyUrl}`);
console.log(`temp      ${tempRoot}`);
console.log(`idle for  ${seconds}s`);

const app = spawn(values.exe, [`--proxy-server=${proxyUrl}`, `--user-data-dir=${userData}`], {
  env: {
    ...process.env,
    OMB_DATA_DIR: dataDir,
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    NO_PROXY: "localhost,127.0.0.1,::1",
  },
  stdio: "ignore",
});
let appExit = null;
app.on("exit", (code, signal) => { appExit = { code, signal }; });

const readyAt = await new Promise((resolve) => {
  const started = Date.now();
  let ready = null;
  const tick = setInterval(() => {
    if (ready === null && existsSync(serverLog) && readFileSync(serverLog, "utf8").includes(READY_LINE)) {
      ready = Math.round((Date.now() - started) / 1000);
    }
    if (Date.now() - started >= seconds * 1000) {
      clearInterval(tick);
      resolve(ready);
    }
  }, 500);
});

function stopTree() {
  if (appExit || app.pid === undefined) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
  else app.kill("SIGTERM");
}
const exitedEarly = appExit;
stopTree();
await new Promise((resolve) => (appExit ? resolve() : app.once("exit", resolve)));
await new Promise((resolve) => proxy.close(resolve));
rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });

const rows = [...counts].sort((a, b) => b[1] - a[1]).map(([host, n]) => {
  const rule = DENIED.find((d) => d.match(host))?.rule ?? "";
  return { host, n, rule };
});
const width = Math.max(4, ...rows.map((r) => r.host.length));
console.log("");
console.log(`${"host".padEnd(width)}  count  denied by`);
for (const r of rows) console.log(`${r.host.padEnd(width)}  ${String(r.n).padStart(5)}  ${r.rule || "-"}`);
if (rows.length === 0) console.log("(no proxied requests)");

const denied = rows.filter((r) => r.rule);
const deniedRequests = denied.reduce((sum, r) => sum + r.n, 0);
console.log("");
console.log(`hosts ${rows.length}, requests ${rows.reduce((s, r) => s + r.n, 0)}, denylisted hosts ${denied.length}, denylisted requests ${deniedRequests}`);
console.log(`server ready: ${readyAt === null ? "NO" : `yes after ${readyAt}s`}`);
console.log(`app: ${exitedEarly ? `exited on its own (code ${exitedEarly.code}, signal ${exitedEarly.signal})` : `running until stopped at ${seconds}s`}`);
const verdict = denied.length > 0 ? "FAIL (denylisted host contacted)" : readyAt === null ? "FAIL (server never ready)" : "PASS";
console.log(`RESULT ${verdict}`);
process.exitCode = denied.length > 0 ? 1 : readyAt === null ? 2 : 0;
