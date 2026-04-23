/**
 * OpenAI Responses API model — answers prompts via the `web_search` tool
 * instead of a browser session. Returns the same shape as the browser path
 * so the analyzer can treat both uniformly.
 *
 * Ported from the pre-April 2026 implementation (commit d9bd976) and
 * re-integrated as a first-class "model" alongside the browser actors.
 */
import { getOpenAI, getCurrentRunId } from "./llm";
import { db } from "../db";
import { apiUsage } from "@shared/schema";

const MODEL = "gpt-5.4";

export async function askOpenAiApi(
  prompt: string,
  context?: { analysisRunId?: number; jobId?: number },
): Promise<{ responseText: string; sources: string[] }> {
  const logPrefix = context?.jobId ? `[openai-api job ${context.jobId}]` : '[openai-api]';
  console.log(`${logPrefix} Responses API: "${prompt.substring(0, 60)}..."`);

  const result = await getOpenAI().responses.create({
    model: MODEL,
    tools: [{ type: "web_search" as any }],
    input: [
      {
        role: "developer" as any,
        content: `You are a helpful AI assistant answering questions about various products and services.
Provide practical, unbiased recommendations focusing on the most popular and widely-used options.
Be natural and conversational in your responses.`,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_output_tokens: 2048,
  } as any);

  let responseText = "";
  const sources: string[] = [];
  for (const item of (result as any).output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type !== "output_text") continue;
      responseText += content.text;
      for (const ann of content.annotations || []) {
        if (ann.type === "url_citation" && ann.url) sources.push(ann.url);
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
 * The API model needs an OpenAI key, but no browser actor. Mirrors
 * `isBrowserAvailable` so the analyzer can skip it when unconfigured.
 */
export function isOpenAiApiAvailable(): boolean {
  return !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'default_key');
}
