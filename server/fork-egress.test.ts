import { afterEach, describe, expect, it, vi } from "vitest";

import { guardFetch, quietEngineTelemetry } from "./fork-egress.ts";

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

  it("turns off the Claude CLI's telemetry and error reports for every engine it spawns, unless already set", async () => {
    const env: NodeJS.ProcessEnv = { DISABLE_ERROR_REPORTING: "0" };
    quietEngineTelemetry(env);
    expect(env).toEqual({ DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "0" });
    const saved = { telemetry: process.env.DISABLE_TELEMETRY, errors: process.env.DISABLE_ERROR_REPORTING };
    delete process.env.DISABLE_TELEMETRY;
    delete process.env.DISABLE_ERROR_REPORTING;
    try {
      vi.resetModules();
      await import("./fork-egress.ts");
      expect([process.env.DISABLE_TELEMETRY, process.env.DISABLE_ERROR_REPORTING]).toEqual(["1", "1"]);
    } finally {
      for (const [key, value] of [["DISABLE_TELEMETRY", saved.telemetry], ["DISABLE_ERROR_REPORTING", saved.errors]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
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
