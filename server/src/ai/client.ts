import OpenAI from "openai";
import { env } from "../config/env";
import { getDb } from "../db/connection";

/**
 * Thin wrapper around the OpenAI SDK that adds the production concerns every AI call needs:
 *
 *  1. Availability — `isAiAvailable()` is false when no key is configured, AI is disabled by
 *     flag, or the circuit breaker is open. Callers then go straight to their fallback.
 *  2. Circuit breaker — after N consecutive failures (outage, rate limiting) we stop calling
 *     the API for a cool-down window instead of making every ticket wait for a timeout.
 *  3. Usage logging — every call records tokens, cache hits, latency and outcome to `ai_usage`
 *     so cost and reliability are observable from the admin dashboard.
 *
 * The SDK itself retries 408/409/429/5xx with backoff (maxRetries below).
 */

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI | null {
  if (env.AI_DISABLED || !env.OPENAI_API_KEY) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.AI_TIMEOUT_MS,
      maxRetries: 2,
    });
  }
  return client;
}

/** Test hook. */
export function setOpenAI(c: OpenAI | null): void {
  client = c;
}

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
const breaker = { consecutiveFailures: 0, openUntil: 0 };

export function isAiAvailable(): boolean {
  return getOpenAI() !== null && Date.now() >= breaker.openUntil;
}

export function aiStatus() {
  return {
    configured: getOpenAI() !== null,
    model: env.AI_MODEL,
    circuitOpen: Date.now() < breaker.openUntil,
    consecutiveFailures: breaker.consecutiveFailures,
  };
}

export function resetBreaker(): void {
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
}

type Usage = OpenAI.CompletionUsage;

interface CallMeta {
  operation: "classify" | "draft";
  ticketId: number | null;
}

interface CompletionLike {
  usage?: Usage;
  choices: Array<{ finish_reason: string; message: { refusal?: string | null } }>;
}

/**
 * Runs one model call with breaker accounting and usage logging. Throws on failure (including
 * refusals and truncated output) so the caller can apply its own domain-specific fallback.
 */
export async function trackedCall<T extends CompletionLike>(meta: CallMeta, fn: (client: OpenAI) => Promise<T>): Promise<T> {
  const openai = getOpenAI();
  if (!openai || !isAiAvailable()) throw new AiUnavailableError("AI is not available");

  const started = Date.now();
  try {
    const response = await fn(openai);
    const choice = response.choices[0];
    if (choice?.message.refusal) throw new AiUnavailableError("Model declined the request");
    if (choice?.finish_reason === "length") throw new AiUnavailableError("Model output was truncated");
    breaker.consecutiveFailures = 0;
    logUsage(meta, true, Date.now() - started, response.usage ?? null, null);
    return response;
  } catch (err) {
    breaker.consecutiveFailures += 1;
    if (breaker.consecutiveFailures >= BREAKER_THRESHOLD) {
      breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
      console.warn(`[ai] circuit open for ${BREAKER_COOLDOWN_MS / 1000}s after repeated failures`);
    }
    logUsage(meta, false, Date.now() - started, null, describeError(err));
    throw err;
  }
}

export class AiUnavailableError extends Error {}

function describeError(err: unknown): string {
  if (err instanceof OpenAI.RateLimitError) return "rate_limited";
  if (err instanceof OpenAI.AuthenticationError) return "authentication_failed";
  if (err instanceof OpenAI.APIConnectionTimeoutError) return "timeout";
  if (err instanceof OpenAI.APIConnectionError) return "connection_error";
  if (err instanceof OpenAI.APIError) return `api_error_${err.status ?? "unknown"}`;
  if (err instanceof Error) return err.message.slice(0, 200);
  return "unknown_error";
}

function logUsage(meta: CallMeta, success: boolean, latencyMs: number, usage: Usage | null, error: string | null) {
  try {
    getDb()
      .prepare(
        `INSERT INTO ai_usage (ticket_id, operation, model, success, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, latency_ms, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        meta.ticketId,
        meta.operation,
        env.AI_MODEL,
        success ? 1 : 0,
        usage?.prompt_tokens ?? null,
        usage?.completion_tokens ?? null,
        usage?.prompt_tokens_details?.cached_tokens ?? null,
        null, // OpenAI caches automatically and doesn't report cache writes
        latencyMs,
        error,
      );
  } catch (e) {
    // Never let observability break the request path.
    console.warn("[ai] failed to log usage", e);
  }
}
