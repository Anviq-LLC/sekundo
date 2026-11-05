import { DEFAULT_MODEL_MAX_TOKENS } from "@anviq/contracts";

/** Per-attempt wait for response headers; this does not cap active streaming duration. */
export const MODEL_STREAM_TIMEOUT_MS = 120_000;
/** Bound connection establishment independently of response streaming. */
export const MODEL_CONNECT_TIMEOUT_MS = 30_000;
/**
 * `timeoutMs` bounds only time-to-headers; the SSE body that follows is
 * unbounded. Bound silence for every provider so a stalled stream can fail
 * and advance the configured fallback chain.
 */
export const MODEL_STREAM_IDLE_TIMEOUT_MS = 180_000;
export const DEFAULT_MODEL_STREAM_MAX_RETRIES = 1;

/** More retries extend the worst-case turn; the executor heartbeat renews its leases. */
export function modelStreamMaxRetries(): number {
  const value = process.env.MODEL_STREAM_MAX_RETRIES?.trim();
  const raw = Number(value || DEFAULT_MODEL_STREAM_MAX_RETRIES);
  return Number.isInteger(raw) && raw >= 0 && raw <= 5 ? raw : DEFAULT_MODEL_STREAM_MAX_RETRIES;
}

/** Smallest per-result bound, used when the model's context window is unknown. */
/**
 * Whole milliseconds from 1 second to 5 minutes; blank or out of range keeps the default.
 * Node's fetch stops waiting for headers or the next body chunk after 5 minutes, so a longer
 * setting would not take effect for most providers.
 */
function timeoutMsFromEnv(value: string | undefined, fallback: number): number {
  const raw = Number(value?.trim() || fallback);
  return Number.isInteger(raw) && raw >= 1_000 && raw <= 300_000 ? raw : fallback;
}

export function modelStreamTimeoutMs(): number {
  return timeoutMsFromEnv(process.env.MODEL_STREAM_TIMEOUT_MS, MODEL_STREAM_TIMEOUT_MS);
}

export function modelConnectTimeoutMs(): number {
  return timeoutMsFromEnv(process.env.MODEL_CONNECT_TIMEOUT_MS, MODEL_CONNECT_TIMEOUT_MS);
}

export function modelStreamIdleTimeoutMs(): number {
  return timeoutMsFromEnv(process.env.MODEL_STREAM_IDLE_TIMEOUT_MS, MODEL_STREAM_IDLE_TIMEOUT_MS);
}

export const TOOL_RESULT_TEXT_LIMIT = 12_000;
const TOOL_RESULT_TEXT_CEILING = 250_000;

/** About 12% of the window (half its size in characters), so a large-window model reads a long result whole. */
export function toolResultTextLimit(contextWindow?: number): number {
  const pinned = Number(process.env.TOOL_RESULT_MAX_CHARS?.trim());
  if (Number.isInteger(pinned) && pinned >= 1_000) return pinned;
  if (!contextWindow || !Number.isFinite(contextWindow)) return TOOL_RESULT_TEXT_LIMIT;
  return Math.min(
    TOOL_RESULT_TEXT_CEILING,
    Math.max(TOOL_RESULT_TEXT_LIMIT, Math.floor(contextWindow * 0.5)),
  );
}

export function clipToolResultText(text: string, limit: number = TOOL_RESULT_TEXT_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Share one remaining character budget across all text parts.
 * Later text is omitted once the aggregate limit is exhausted; non-text parts stay.
 */
export function clipToolResultContent<T>(
  content: T[],
  limit: number = TOOL_RESULT_TEXT_LIMIT,
): T[] {
  let remaining = limit;
  const clipped: T[] = [];
  for (const part of content) {
    if (
      !part ||
      typeof part !== "object" ||
      !("type" in part) ||
      (part as { type?: unknown }).type !== "text" ||
      !("text" in part)
    ) {
      clipped.push(part);
      continue;
    }
    if (remaining <= 0) continue;
    const text = String((part as { text: unknown }).text);
    if (text.length <= remaining) {
      clipped.push(part);
      remaining -= text.length;
      continue;
    }
    clipped.push({ ...part, text: clipToolResultText(text, remaining) });
    remaining = 0;
  }
  return clipped;
}

/**
 * Prompt tokens providers bill, including cache read/write rather than the uncached remainder.
 * The cache halves are reported alongside so downstream views can show what a cache hit saved.
 */
export function billedPromptTokens(usage: {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  const cacheReadTokens = nonNegativeCount(usage.cacheRead);
  const cacheWriteTokens = nonNegativeCount(usage.cacheWrite);
  return {
    inputTokens: nonNegativeCount(usage.input) + cacheReadTokens + cacheWriteTokens,
    outputTokens: nonNegativeCount(usage.output),
    cacheReadTokens,
    cacheWriteTokens,
  };
}

/**
 * A reasoning model spends this same budget on its thinking, so the modest default
 * can be consumed before the reply starts. Wide enough for thinking plus an answer,
 * still far below a model card's 128k ceiling.
 */
export const REASONING_MODEL_MAX_TOKENS = 32_768;

/** Leave at least three quarters of the window for input; token limits are positive integers. */
export function effectiveOutputReserve(contextWindow: number, maxTokens: number): number {
  return Math.min(maxTokens, Math.max(1, Math.floor(contextWindow / 4)));
}

/**
 * Completions default to a modest output cap so OpenRouter-style providers do not
 * hold credit for a model card's 128k ceiling. A configured maxTokens overrides this
 * default, still bounded to a quarter of the context window when it is supplied.
 * Reasoning models get the wider default because their thinking is billed against
 * the same ceiling: at 4k a hard question can leave no room for the reply at all.
 */
export function resolveCompletionMaxTokens(
  modelMaxTokens?: number,
  configuredMaxTokens?: number,
  optionsMaxTokens?: number,
  reasoning?: boolean,
  contextWindow?: number,
): number {
  const userCap =
    typeof configuredMaxTokens === "number" && configuredMaxTokens >= 1
      ? configuredMaxTokens
      : reasoning
        ? REASONING_MODEL_MAX_TOKENS
        : DEFAULT_MODEL_MAX_TOKENS;
  const optionCap =
    typeof optionsMaxTokens === "number" && optionsMaxTokens >= 1
      ? Math.min(optionsMaxTokens, userCap)
      : userCap;
  const maxTokens =
    typeof modelMaxTokens === "number" && modelMaxTokens >= 1
      ? Math.min(modelMaxTokens, optionCap)
      : optionCap;
  return contextWindow === undefined ? maxTokens : effectiveOutputReserve(contextWindow, maxTokens);
}

function nonNegativeCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}
