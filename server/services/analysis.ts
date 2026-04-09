/**
 * Generic analysis utilities — no LLM dependency.
 * Everything here works regardless of which AI provider is used.
 */

export interface PromptAnalysisResult {
  response: string;
  brandMentioned: boolean;
  competitors: string[];
  sources: string[];
  model: string;
}

/**
 * Check if a brand name appears in text via regex.
 * Strips markdown formatting, then matches with word boundaries
 * and an optional trailing dot+TLD (e.g. "Acme.com", "Acme.io").
 */
export function isBrandMentioned(text: string, brandName: string): boolean {
  const clean = text.replace(/\*{1,2}|`/g, '');
  const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}(?:\\.[a-z]{2,})?\\b`, 'i');
  return pattern.test(clean);
}

/**
 * Extract URLs from markdown-formatted text.
 * Handles [text](url) links and [1]: url footnote-style references.
 */
export function extractUrlsFromMarkdown(text: string): string[] {
  const urls: string[] = [];
  // Inline links: [text](https://...)
  const inlinePattern = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = inlinePattern.exec(text)) !== null) {
    urls.push(match[2]);
  }
  // Footnote-style: [1]: https://...
  const footnotePattern = /^\[(\d+)\]:\s*(https?:\/\/\S+)/gm;
  while ((match = footnotePattern.exec(text)) !== null) {
    urls.push(match[2]);
  }
  return urls;
}

/**
 * Calculate string similarity between two competitor names.
 * Used for deduplication — returns 0-100.
 */
export function calculateCompetitorSimilarity(competitor1: string, competitor2: string): number {
  const text1 = competitor1.toLowerCase();
  const text2 = competitor2.toLowerCase();
  if (text1 === text2) return 100;
  if (text1.includes(text2) || text2.includes(text1)) return 90;
  const words1 = text1.split(/\s+/).filter(word => word.length > 2);
  const words2 = text2.split(/\s+/).filter(word => word.length > 2);
  const intersection = words1.filter(word => words2.includes(word));
  const union = new Set([...words1, ...words2]);
  return union.size > 0 ? (intersection.length / union.size) * 100 : 0;
}

/**
 * Deduplicate a list of competitor names by similarity threshold.
 */
export function deduplicateCompetitors(competitors: string[], maxResults: number = 10, threshold: number = 70): string[] {
  const result: string[] = [];
  for (const competitor of competitors) {
    if (result.length >= maxResults) break;
    const isDiverse = result.every(existing =>
      calculateCompetitorSimilarity(competitor, existing) < threshold
    );
    if (isDiverse) result.push(competitor);
  }
  return result;
}

/**
 * Get a response from the browser actor and extract sources.
 * This is the transport layer — works with any browser-based model.
 */
export async function getResponseViaBrowser(
  prompt: string,
  model: string,
  context?: { analysisRunId?: number; jobId?: number },
): Promise<{ responseText: string; sources: string[] }> {
  const { askBrowser } = await import('./chatgpt-browser');

  const result = await askBrowser(prompt, model as any, context);

  const urlSources = extractUrlsFromMarkdown(result.answer);
  const sidebarSources = result.sources.map(s => s.href).filter(Boolean);

  return {
    responseText: result.answer,
    sources: [...new Set([...sidebarSources, ...urlSources])],
  };
}

/**
 * Core analysis pipeline: get response, detect brand, extract competitors.
 * The competitor extraction is delegated to a provider-specific function.
 */
export async function analyzePromptResponse(
  prompt: string,
  brandName: string | undefined,
  knownCompetitors: string[] | undefined,
  model: string,
  context: { analysisRunId?: number; jobId?: number } | undefined,
  extractCompetitors: (responseText: string, brandName?: string, knownCompetitors?: string[]) => Promise<string[]>,
): Promise<PromptAnalysisResult> {
  const startTime = Date.now();

  console.log(`[analyzePromptResponse] Model: ${model} | Prompt: "${prompt.substring(0, 80)}..."`);

  const { responseText, sources } = await getResponseViaBrowser(prompt, model, context);

  console.log(`[analyzePromptResponse] ${model} response: ${responseText.length} chars, ${sources.length} sources in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  const brandMentioned = brandName ? isBrandMentioned(responseText, brandName) : false;
  const competitors = await extractCompetitors(responseText, brandName, knownCompetitors);

  return {
    response: responseText,
    brandMentioned,
    competitors,
    sources,
    model,
  };
}
