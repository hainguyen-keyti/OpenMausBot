// This build's server never contacts an upstream service on its own (DECISIONS 2026-11-10): loading this module
// guards the process's fetch with the denylist in electron/fork-egress.mjs. Node's raw https and ws are not covered.
import { blockingFetch } from "../electron/fork-egress.mjs";

export function guardFetch(target: { fetch: typeof fetch } = globalThis): void {
  target.fetch = blockingFetch(target.fetch);
}

guardFetch();
