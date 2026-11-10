// The upstream services this fork's build never contacts on its own (DECISIONS 2026-11-10). The single source of the
// denylist: the server's fetch guard imports it too. A redirect followed by Node's fetch is not re-checked here.

/** `suffix` blocks every subdomain of a host; `host` one exact host; `path` narrows it to a path prefix (lowercase). */
export const DENYLIST = Object.freeze([
  { suffix: "posthog.com" },
  { suffix: "openmausbot.com" },
  { suffix: "milindsoni201.workers.dev" },
  { host: "omb-cloud-staging.fly.dev" },
  { host: "www.google.com", path: "/s2/favicons" },
  { host: "github.com", path: "/milind-soni/" },
  { host: "raw.githubusercontent.com", path: "/milind-soni/" },
  { host: "api.github.com", path: "/repos/milind-soni/" },
]);

const WEB_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

function normalizedPath(pathname) {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch {}
  return decoded.replace(/\/{2,}/g, "/").toLowerCase();
}

/** Whether `url` (a string or URL) reaches a denylisted host or path; anything unparsable is left to the caller. */
export function isBlockedUrl(url) {
  let target;
  try { target = new URL(String(url)); } catch { return false; }
  if (!WEB_PROTOCOLS.has(target.protocol)) return false;
  const host = target.hostname.replace(/\.$/, "");
  const path = normalizedPath(target.pathname);
  return DENYLIST.some((rule) => {
    if (rule.suffix) return host.endsWith(`.${rule.suffix}`);
    return host === rule.host && (!rule.path || path.startsWith(rule.path));
  });
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input?.url;
}

/** `fetchImpl` with denylisted requests refused as a network error, before anything is sent. */
export function blockingFetch(fetchImpl = globalThis.fetch) {
  return function fetch(input, init) {
    const url = requestUrl(input);
    if (isBlockedUrl(url)) {
      return Promise.reject(new TypeError(`fetch refused by this build's egress policy: ${new URL(url).host}`));
    }
    return fetchImpl(input, init);
  };
}

/** Cancels denylisted requests of an Electron session; covers its net.fetch, session.fetch and net.request too. */
export function installEgressBlock(session) {
  session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: isBlockedUrl(details.url) }));
}
