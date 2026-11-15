import type { Env } from "@/server/env";

/**
 * What the env says about the optional local model (localLlm.ts). Pure and dependency-free (types only), so the
 * startup hook (instrumentation.ts) can read it without pulling the agent, the Anthropic SDK or the database into
 * its bundle.
 */

/** local models are slow; LOCAL_LLM_TIMEOUT_MS overrides it */
export const DEFAULT_LOCAL_TIMEOUT_MS = 20_000;

export interface LocalLlmConfig {
  /** base URL without a trailing slash, e.g. http://localhost:11434 */
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export type LocalLlmStatus =
  | { kind: "off" }
  | { kind: "refused"; reason: string }
  | { kind: "on"; config: LocalLlmConfig };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

/** pure: what the env says about the local model. Never throws. */
export function localLlmStatus(env: Pick<Env, "localLlmUrl" | "localLlmModel" | "localLlmTimeoutMs" | "localLlmAllowRemote">): LocalLlmStatus {
  if (!env.localLlmUrl && !env.localLlmModel) return { kind: "off" };
  if (!env.localLlmUrl || !env.localLlmModel) return { kind: "refused", reason: "set both LOCAL_LLM_URL and LOCAL_LLM_MODEL" };
  let url: URL;
  try {
    url = new URL(env.localLlmUrl);
  } catch {
    return { kind: "refused", reason: "LOCAL_LLM_URL is not a URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { kind: "refused", reason: "LOCAL_LLM_URL must be http(s)" };
  if (!isLocalHost(url.hostname) && !env.localLlmAllowRemote) {
    return { kind: "refused", reason: "LOCAL_LLM_URL is not on this machine (set LOCAL_LLM_ALLOW_REMOTE=1 to allow it)" };
  }
  return {
    kind: "on",
    config: {
      baseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/u, ""),
      model: env.localLlmModel,
      timeoutMs: env.localLlmTimeoutMs ?? DEFAULT_LOCAL_TIMEOUT_MS,
    },
  };
}

/** the config when the local model is usable, else null */
export function localLlmConfig(env: Env): LocalLlmConfig | null {
  const status = localLlmStatus(env);
  return status.kind === "on" ? status.config : null;
}
