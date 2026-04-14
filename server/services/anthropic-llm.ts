/**
 * Anthropic SDK wrapper — mirrors llm.ts pattern.
 * Lazy-initialized client, retry logic, token recording.
 */
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { apiUsage } from "@shared/schema";

let _anthropic: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (!_anthropic || !(process.env.ANTHROPIC_API_KEY)) {
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || 'default_key',
    });
  }
  return _anthropic;
}

let currentRunId: number | null = null;

export function setAnthropicRunId(id: number | null) {
  currentRunId = id;
}

interface CompletionOptions {
  maxRetries?: number;
  timeoutMs?: number;
}

/**
 * Send a message to Anthropic with retry logic.
 */
export async function anthropicCompletion(
  system: string,
  messages: Anthropic.MessageParam[],
  options?: CompletionOptions & { model?: string; maxTokens?: number; temperature?: number },
): Promise<Anthropic.Message> {
  const maxRetries = options?.maxRetries ?? 3;
  const timeoutMs = options?.timeoutMs ?? 30000;
  const model = options?.model ?? 'claude-sonnet-4-6';
  const maxTokens = options?.maxTokens ?? 1024;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Anthropic API timeout (attempt ${attempt})`)), timeoutMs)
      );

      const result = await Promise.race([
        getAnthropic().messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages,
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        }),
        timeoutPromise,
      ]);

      recordTokens(result as Anthropic.Message, model).catch(() => {});
      return result as Anthropic.Message;
    } catch (error: any) {
      const isRateLimit = error?.status === 429;
      const isTimeout = error?.message?.includes('timeout');
      const isOverloaded = error?.status === 529;

      if (attempt < maxRetries && (isRateLimit || isTimeout || isOverloaded)) {
        const delay = Math.pow(3, attempt) * 5000;
        console.log(`[Anthropic] Attempt ${attempt} failed (${isRateLimit ? 'rate limit' : isOverloaded ? 'overloaded' : 'timeout'}), retrying in ${Math.round(delay / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error('Unreachable');
}

/**
 * JSON schema type for output_config.format
 */
interface JSONSchemaProperty {
  type: string;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JSONSchema {
  type: string;
  properties: Record<string, JSONSchemaProperty>;
  required: string[];
  additionalProperties?: boolean;
}

/**
 * Send a message and get back parsed JSON using structured outputs.
 * Pass a raw JSON schema — no Zod dependency needed.
 */
export async function anthropicJSON<T>(
  system: string,
  messages: Anthropic.MessageParam[],
  schema: JSONSchema,
  options?: CompletionOptions & { model?: string; maxTokens?: number; temperature?: number },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const timeoutMs = options?.timeoutMs ?? 30000;
  const model = options?.model ?? 'claude-sonnet-4-6';
  const maxTokens = options?.maxTokens ?? 1024;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Anthropic API timeout (attempt ${attempt})`)), timeoutMs)
      );

      const result = await Promise.race([
        getAnthropic().messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages,
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
          output_config: {
            format: {
              type: 'json_schema' as any,
              schema,
            },
          },
        } as any),
        timeoutPromise,
      ]);

      const msg = result as Anthropic.Message;
      recordTokens(msg, model).catch(() => {});

      const textBlock = msg.content.find((c: any) => c.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Anthropic response has no text block');
      }
      return JSON.parse(textBlock.text);
    } catch (error: any) {
      const isRateLimit = error?.status === 429;
      const isTimeout = error?.message?.includes('timeout');
      const isOverloaded = error?.status === 529;

      if (attempt < maxRetries && (isRateLimit || isTimeout || isOverloaded)) {
        const delay = Math.pow(3, attempt) * 5000;
        console.log(`[Anthropic] Attempt ${attempt} failed, retrying in ${Math.round(delay / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error('Unreachable');
}

async function recordTokens(response: Anthropic.Message, model: string) {
  try {
    const usage = response?.usage;
    if (!usage) return;

    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    if (inputTokens === 0 && outputTokens === 0) return;

    await db.insert(apiUsage).values({
      analysisRunId: currentRunId,
      model,
      inputTokens,
      outputTokens,
    });
  } catch (error) {
    console.error('Failed to record Anthropic token usage:', error);
  }
}
