import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeAgent, type LlmClient } from "./claudeAgent";
import type { LocalLlmConfig } from "./localLlmConfig";

/**
 * Optional local language model: Ollama on the same machine, through its Anthropic-compatible Messages endpoint
 * (POST {LOCAL_LLM_URL}/v1/messages, https://docs.ollama.com/api/anthropic-compatibility). The endpoint takes the
 * same request and returns the same Message shape (text and tool_use blocks, stop_reason), so the local model runs
 * through the existing ClaudeAgent with a plain-fetch LlmClient: the same prompt, tools, validation and AgentDecision.
 *
 * Off unless LOCAL_LLM_URL and LOCAL_LLM_MODEL are both set (they are not on Vercel). The host must be this machine
 * (localhost, 127.0.0.1, [::1]) unless LOCAL_LLM_ALLOW_REMOTE=1, so the astronaut's health data stays on it. That
 * check lives in localLlmConfig.ts, which has no runtime imports, so the startup hook can use it cheaply.
 * Any HTTP error, timeout or malformed response throws inside ClaudeAgent and becomes LlmUnavailable, so the rules
 * and templates take over exactly as they do when Claude is unavailable.
 */

/**
 * The request as Ollama documents it: prompt caching (cache_control) and tool_choice are listed as unsupported, so
 * they are left out (tool_choice "auto" is the default anyway), as is the tools' `strict` flag, which is not
 * documented there. Everything else - system prompt, tools, messages, max_tokens - is sent unchanged, non-streaming.
 *
 * Thinking is switched off explicitly (`thinking.type: "disabled"`, an on/off control in Ollama's Anthropic API):
 * thinking models such as qwen3 may think by default, and the hidden reasoning counts against the same max_tokens,
 * which would end most turns at stop_reason "max_tokens" before any reply text.
 */
export function toLocalBody(body: Anthropic.MessageStreamParams, model: string): Record<string, unknown> {
  const { tool_choice: _toolChoice, ...rest } = body;
  void _toolChoice;
  const system = Array.isArray(rest.system)
    ? rest.system.map((block) => {
        const { cache_control: _cache, ...plain } = block;
        void _cache;
        return plain;
      })
    : rest.system;
  const tools = rest.tools?.map((t) => {
    const { strict: _strict, ...plain } = t as typeof t & { strict?: boolean };
    void _strict;
    return plain;
  });
  return { ...rest, model, system, ...(tools ? { tools } : {}), thinking: { type: "disabled" }, stream: false };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** the response must look like an Anthropic Message: content blocks we know, a stop_reason. Anything else throws. */
export function parseLocalMessage(json: unknown): Anthropic.Message {
  if (!isObject(json) || !Array.isArray(json.content) || typeof json.stop_reason !== "string") {
    throw new Error("local model returned an invalid message");
  }
  for (const block of json.content as unknown[]) {
    if (!isObject(block)) throw new Error("local model returned an invalid content block");
    if (block.type === "text") {
      if (typeof block.text !== "string") throw new Error("local model returned an invalid text block");
    } else if (block.type === "tool_use") {
      if (typeof block.id !== "string" || typeof block.name !== "string" || !isObject(block.input)) {
        throw new Error("local model returned an invalid tool_use block");
      }
    } else if (block.type !== "thinking") {
      throw new Error("local model returned an unknown content block");
    }
  }
  return json as unknown as Anthropic.Message;
}

/** an LlmClient over plain fetch (no SDK, no new dependency) */
export function localLlmClient(config: LocalLlmConfig, fetchImpl: typeof fetch = (...a) => fetch(...a)): LlmClient {
  return {
    messages: {
      stream(body, options) {
        return {
          finalMessage: async () => {
            const res = await fetchImpl(`${config.baseUrl}/v1/messages`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "anthropic-version": "2023-06-01",
                // a local Ollama does not check it; the docs use this placeholder
                "x-api-key": "ollama",
              },
              body: JSON.stringify(toLocalBody(body, config.model)),
              signal: options?.signal,
            });
            if (!res.ok) {
              throw Object.assign(new Error(`local model HTTP ${res.status}`), { status: res.status });
            }
            let json: unknown;
            try {
              json = await res.json();
            } catch {
              throw new Error("local model returned invalid JSON");
            }
            return parseLocalMessage(json);
          },
        };
      },
    },
  };
}

/**
 * The local model as an agent: the ClaudeAgent with the fetch client, the local model name and the longer timeout.
 * The per-turn directive goes into the user turn (Ollama documents a system prompt, not system messages mid-way).
 */
export function createLocalAgent(config: LocalLlmConfig, fetchImpl?: typeof fetch): ClaudeAgent {
  return new ClaudeAgent({
    client: localLlmClient(config, fetchImpl),
    model: config.model,
    timeoutMs: config.timeoutMs,
    directiveRole: "user",
  });
}
