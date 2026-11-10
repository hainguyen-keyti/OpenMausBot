// This build's server never contacts an upstream service on its own (DECISIONS 2026-11-10): loading this module
// guards the process's fetch with the denylist in electron/fork-egress.mjs, and the engine CLIs it spawns inherit
// telemetry off. Node's raw https and ws are not covered.
import { blockingFetch } from "../electron/fork-egress.mjs";

export function guardFetch(target: { fetch: typeof fetch } = globalThis): void {
  target.fetch = blockingFetch(target.fetch);
}

/** The Claude Code CLI's Datadog metrics and error reports (code.claude.com/docs/en/network-config); an explicit value wins. */
export function quietEngineTelemetry(env: NodeJS.ProcessEnv = process.env): void {
  env.DISABLE_TELEMETRY ??= "1";
  env.DISABLE_ERROR_REPORTING ??= "1";
}

quietEngineTelemetry();

guardFetch();
