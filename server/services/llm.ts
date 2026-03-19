import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { db } from "../db";
import { apiUsage } from "@shared/schema";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key"
});

// Current analysis run ID for token tracking
let currentRunId: number | null = null;

export function setCurrentRunId(id: number | null) {
  currentRunId = id;
}

export function getCurrentRunId(): number | null {
  return currentRunId;
}

/**
 * Single entry point for all OpenAI chat completion calls.
 * Handles: retry with exponential backoff, timeout, token usage recording.
 */
export async function chatCompletion(
  params: ChatCompletionCreateParamsNonStreaming,
  options?: { maxRetries?: number; timeoutMs?: number }
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const maxRetries = options?.maxRetries ?? 3;
  const timeoutMs = options?.timeoutMs ?? 30000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`OpenAI API timeout (attempt ${attempt})`)), timeoutMs)
      );

      const result = await Promise.race([
        openai.chat.completions.create(params),
        timeoutPromise
      ]);

      // Record token usage (fire-and-forget, never blocks)
      recordTokens(result).catch(() => {});

      return result;
    } catch (error: any) {
      // Quota exhaustion — don't retry, it won't resolve
      const isQuota = error?.code === 'insufficient_quota' || error?.type === 'insufficient_quota';
      if (isQuota) {
        console.error(`[LLM] Quota exceeded — not retrying. Check billing at https://platform.openai.com/settings/organization/billing`);
        throw error;
      }

      const isRateLimit = error?.status === 429 || error?.code === 'rate_limit_exceeded' || error?.message?.includes('rate limit');
      const isTimeout = error?.message?.includes('timeout');

      if (attempt < maxRetries && (isRateLimit || isTimeout)) {
        // Longer backoff: 5s, 15s, 45s (rate limits need real breathing room)
        const delay = Math.pow(3, attempt) * 5000;
        console.log(`[LLM] Attempt ${attempt} failed (${isRateLimit ? 'rate limit' : 'timeout'}), retrying in ${Math.round(delay / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error('Unreachable');
}

/**
 * Convenience: call chatCompletion and parse the JSON response.
 * Handles the common pattern of response_format: json_object + extracting first array from wrapper object.
 */
export async function chatCompletionJSON<T = any>(
  params: ChatCompletionCreateParamsNonStreaming
): Promise<T> {
  // OpenAI requires the word "json" in messages when using json_object response format.
  // Ensure it's present by appending to the last message if needed.
  const messages = [...params.messages];
  const allText = messages.map(m => m.content).join(' ').toLowerCase();
  if (!allText.includes('json')) {
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = { ...last, content: last.content + '\n\nRespond in JSON.' };
  }

  const result = await chatCompletion({
    ...params,
    messages,
    response_format: { type: "json_object" }
  });

  const content = result.choices[0].message.content || '{}';
  return JSON.parse(content);
}

/**
 * Extract the first array from a JSON object response.
 * OpenAI's json_object mode always returns an object, never a bare array.
 * So {"prompts": ["a","b"]} → ["a","b"]
 */
export function extractArray<T = any>(parsed: any): T[] {
  if (Array.isArray(parsed)) return parsed;
  const firstArray = Object.values(parsed).find(v => Array.isArray(v)) as T[] | undefined;
  return firstArray || [];
}

async function recordTokens(response: OpenAI.Chat.Completions.ChatCompletion) {
  try {
    const usage = response?.usage;
    if (!usage) return;

    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    if (inputTokens === 0 && outputTokens === 0) return;

    await db.insert(apiUsage).values({
      analysisRunId: currentRunId,
      model: response.model || 'unknown',
      inputTokens,
      outputTokens,
    });
  } catch (error) {
    console.error('Failed to record token usage:', error);
  }
}
