/**
 * Anthropic Messages API model — answers prompts via the `web_search`
 * server tool. Mirrors openai-api.ts but uses Claude + Anthropic's citation
 * format (web_search_result_location inside text block `citations`).
 *
 * Docs: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/web-search-tool
 */
import { getAnthropic } from "./anthropic-llm";
import { getCurrentRunId } from "./llm";
import { db } from "../db";
import { apiUsage } from "@shared/schema";

const MODEL = "claude-sonnet-4-6";
const TOOL_VERSION = "web_search_20250305";
const MAX_SEARCHES = 5;
const MAX_TOKENS = 2048;

const SYSTEM_PROMPT = `You are a helpful AI assistant answering questions about various products and services.
Provide practical, unbiased recommendations focusing on the most popular and widely-used options.
Be natural and conversational in your responses.`;

export async function askAnthropicApi(
  prompt: string,
  context?: { analysisRunId?: number; jobId?: number },
): Promise<{ responseText: string; sources: string[] }> {
  const logPrefix = context?.jobId ? `[anthropic-api job ${context.jobId}]` : '[anthropic-api]';
  console.log(`${logPrefix} Messages API + web_search: "${prompt.substring(0, 60)}..."`);

  const result = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    tools: [
      {
        type: TOOL_VERSION,
        name: "web_search",
        max_uses: MAX_SEARCHES,
      } as any,
    ],
  });

  let responseText = "";
  const sources: string[] = [];

  for (const block of (result as any).content || []) {
    if (block.type === "text") {
      responseText += block.text || "";
      for (const cite of block.citations || []) {
        if (cite.type === "web_search_result_location" && cite.url) {
          sources.push(cite.url);
        }
      }
    } else if (block.type === "web_search_tool_result") {
      // Pull URLs from raw results too — Claude sometimes references them
      // without emitting a text-block citation.
      const inner = block.content;
      if (Array.isArray(inner)) {
        for (const r of inner) {
          if (r?.type === "web_search_result" && r.url) sources.push(r.url);
        }
      }
    }
  }

  const usage = (result as any).usage;
  if (usage) {
    try {
      await db.insert(apiUsage).values({
        analysisRunId: context?.analysisRunId ?? getCurrentRunId(),
        model: (result as any).model || MODEL,
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
      });
    } catch (err) {
      console.error(`${logPrefix} Failed to record token usage:`, err);
    }
  }

  return { responseText, sources: Array.from(new Set(sources)) };
}

/**
 * Gate used by the analyzer to skip this model when no key is configured.
 */
export function isAnthropicApiAvailable(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'default_key');
}
