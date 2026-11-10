import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { blockingFetch, installEgressBlock, isBlockedUrl } from "./fork-egress.mjs";

const BLOCKED = [
  "https://us.i.posthog.com/e/",
  "https://us-assets.i.posthog.com/static/array.js",
  "https://accounts.openmausbot.com/oauth",
  "https://cloud.openmausbot.com/api/bug-reports",
  "wss://device.openmausbot.com/socket",
  "https://openmausbot-composio.milindsoni201.workers.dev/v1/installations",
  "https://omb-cloud-staging.fly.dev/api",
  "https://www.google.com/s2/favicons?domain=x.com&sz=64",
  "https://github.com/milind-soni/OpenMausBot/releases/latest",
  "https://raw.githubusercontent.com/milind-soni/OpenMausBot/main/x.json",
  "https://api.github.com/repos/milind-soni/OpenMausBot/releases",
  "HTTPS://US.I.POSTHOG.COM/e/",
  "https://us.i.posthog.com./e/",
  "https://github.com/Milind-Soni/OpenMausBot",
  "https://github.com//milind-soni/OpenMausBot",
  "https://github.com/%6Dilind-soni/OpenMausBot",
  "http://cloud.openmausbot.com:8080/x",
];

const ALLOWED = [
  "https://api.anthropic.com/v1/messages",
  "https://chatgpt.com/backend-api",
  "https://posthog.com.evil.example/e/",
  "https://notposthog.com/e/",
  "https://openmausbot.com.example/x",
  "https://milindsoni201.workers.dev.example/x",
  "https://other.workers.dev/x",
  "https://omb-u-1.fly.dev/api",
  "https://www.google.com/search?q=s2/favicons",
  "https://github.com/milind-sonix/repo",
  "https://github.com/other/milind-soni",
  "https://raw.githubusercontent.com/other/repo/main/x",
  "https://api.github.com/users/milind-soni",
  "http://127.0.0.1:5173/api/bots",
  "file:///C:/cloud.openmausbot.com/x",
  "not a url",
  "",
];

test("the denylist blocks every upstream host and path in any spelling that reaches it", () => {
  for (const url of BLOCKED) assert.equal(isBlockedUrl(url), true, url);
});

test("everything else stays reachable, lookalike hosts and paths included", () => {
  for (const url of ALLOWED) assert.equal(isBlockedUrl(url), false, url);
});

test("the fetch wrapper refuses a denylisted request without calling the network", async () => {
  const calls = [];
  const fetch = blockingFetch(async (...args) => { calls.push(args); return new Response("ok"); });
  for (const input of [
    "https://us.i.posthog.com/e/",
    new URL("https://cloud.openmausbot.com/x"),
    new Request("https://openmausbot-composio.milindsoni201.workers.dev/v1/me"),
  ]) {
    await assert.rejects(fetch(input), (error) => error instanceof TypeError && /egress/.test(error.message));
  }
  assert.equal(calls.length, 0);
});

test("the fetch wrapper passes an allowed request through unchanged", async () => {
  const calls = [];
  const response = new Response("ok");
  const fetch = blockingFetch(async (...args) => { calls.push(args); return response; });
  const init = { method: "POST", body: "x" };
  assert.equal(await fetch("https://api.anthropic.com/v1/messages", init), response);
  assert.deepEqual(calls, [["https://api.anthropic.com/v1/messages", init]]);
});

test("the desktop guards its own fetch at load and blocks the default session before anything is ready", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.match(main, /^import \{ blockingFetch, installEgressBlock \} from "\.\/fork-egress\.mjs";\r?$/m);
  assert.match(main, /^globalThis\.fetch = blockingFetch\(globalThis\.fetch\);\r?$/m);
  const ready = main.indexOf("app.whenReady().then(async () => {");
  assert.ok(ready > 0);
  assert.equal(main.slice(ready).split("\n")[1].trim(), "installEgressBlock(session.defaultSession);", "the first step once ready");
});

test("the session block cancels exactly the denylisted requests", () => {
  let listener = null;
  const session = { webRequest: { onBeforeRequest: (fn) => { listener = fn; } } };
  installEgressBlock(session);
  const answer = (url) => {
    let result;
    listener({ url }, (value) => { result = value; });
    return result;
  };
  assert.deepEqual(answer("https://www.google.com/s2/favicons?domain=a.com"), { cancel: true });
  assert.deepEqual(answer("https://api.anthropic.com/v1/messages"), { cancel: false });
});
