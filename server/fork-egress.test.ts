import { afterEach, describe, expect, it, vi } from "vitest";

import { guardFetch } from "./fork-egress.ts";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

describe("the server's egress guard", () => {
  it("refuses a denylisted request without calling the network", async () => {
    const calls: unknown[] = [];
    const target = { fetch: (async (...args: unknown[]) => { calls.push(args); return new Response("ok"); }) as typeof fetch };
    guardFetch(target);
    await expect(target.fetch("https://openmausbot-composio.milindsoni201.workers.dev/v1/installations")).rejects.toThrow(/egress/);
    await expect(target.fetch("https://cloud.openmausbot.com/api/bug-reports", { method: "POST" })).rejects.toBeInstanceOf(TypeError);
    expect(calls).toEqual([]);
  });

  it("passes every other request through unchanged", async () => {
    const calls: unknown[] = [];
    const response = new Response("ok");
    const target = { fetch: (async (...args: unknown[]) => { calls.push(args); return response; }) as typeof fetch };
    guardFetch(target);
    const init = { method: "POST", body: "x" };
    expect(await target.fetch("https://api.anthropic.com/v1/messages", init)).toBe(response);
    expect(calls).toEqual([["https://api.anthropic.com/v1/messages", init]]);
  });

  it("is in force for the whole process once the module is loaded", async () => {
    const calls: unknown[] = [];
    globalThis.fetch = (async (...args: unknown[]) => { calls.push(args); return new Response("ok"); }) as typeof fetch;
    vi.resetModules();
    await import("./fork-egress.ts");
    await expect(globalThis.fetch("https://us.i.posthog.com/e/")).rejects.toThrow(/egress/);
    expect(calls).toEqual([]);
  });
});
