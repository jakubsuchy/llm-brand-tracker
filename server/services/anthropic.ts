/**
 * Anthropic-specific LLM calls: competitor extraction, prompt generation,
 * topic generation, brand analysis. Same prompts as openai.ts, adapted
 * for Anthropic's message format and structured outputs (JSON schema).
 *
 * Generic analysis logic lives in ./analysis.ts.
 */
import { anthropicCompletion, anthropicJSON, type JSONSchema } from "./anthropic-llm";
import { fetchWebsiteText } from "./scraper";
import {
  type PromptAnalysisResult,
  analyzePromptResponse as runAnalysis,
  deduplicateCompetitors,
} from "./analysis";

export type { PromptAnalysisResult } from "./analysis";

const FAST_MODEL = 'claude-haiku-4-5';
const FULL_MODEL = 'claude-haiku-4-5';

// Reusable schemas
const competitorsSchema: JSONSchema = {
  type: 'object',
  properties: {
    competitors: { type: 'array', items: { type: 'string' } },
  },
  required: ['competitors'],
  additionalProperties: false,
};

const promptsSchema: JSONSchema = {
  type: 'object',
  properties: {
    prompts: { type: 'array', items: { type: 'string' } },
  },
  required: ['prompts'],
  additionalProperties: false,
};

const sourcesSchema: JSONSchema = {
  type: 'object',
  properties: {
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          domain: { type: 'string' },
          snippet: { type: 'string' },
        },
        required: ['title', 'url', 'domain', 'snippet'],
        additionalProperties: false,
      },
    },
  },
  required: ['sources'],
  additionalProperties: false,
};

const topicsSchema: JSONSchema = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['topics'],
  additionalProperties: false,
};

const brandCompetitorsSchema: JSONSchema = {
  type: 'object',
  properties: {
    competitors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          url: { type: 'string' },
          category: { type: 'string' },
        },
        required: ['name', 'url', 'category'],
        additionalProperties: false,
      },
    },
  },
  required: ['competitors'],
  additionalProperties: false,
};

/**
 * Extract competitor names from response text using Anthropic.
 */
export async function extractCompetitorsFromResponse(
  responseText: string,
  brandName?: string,
  knownCompetitors?: string[],
): Promise<string[]> {
  const brandContext = brandName
    ? `\nOUR BRAND: "${brandName}" — do NOT include this brand or its variations as a competitor.`
    : '';
  const competitorContext = knownCompetitors && knownCompetitors.length > 0
    ? `\nKNOWN COMPETITORS: ${knownCompetitors.join(', ')} — these are confirmed competitors.`
    : '';

  const analysis = await anthropicJSON<{ competitors: string[] }>(
    "You extract competitor mentions from text.",
    [
      {
        role: "user",
        content: `Extract competitor mentions from this AI response.

Response to analyze: "${responseText}"
${brandContext}${competitorContext}

Rules:
- "competitors": list ALL companies, products, or services mentioned that compete in the same space as our brand. Include both company names (e.g. "Square") and product names (e.g. "Square Payments"). Be thorough — if it's mentioned as an alternative or option, include it.
- Do NOT include platforms where content is hosted or discussed (e.g. Reddit, GitHub, Stack Overflow, YouTube, Medium, Wikipedia, etc.)
- For cloud providers, prefer their specific product name if mentioned (e.g. "AWS Elastic Load Balancing" over just "AWS"), but include the cloud provider name if no specific product is named
- IMPORTANT: If a competitor matches one already in the known competitors list, use the EXACT full name from that list
- Do NOT include URLs in this response`,
      },
    ],
    competitorsSchema,
    { model: FAST_MODEL, maxTokens: 512 },
  );

  return analysis.competitors || [];
}

/**
 * Full analysis pipeline: get response -> detect brand -> extract competitors (via Anthropic).
 */
export async function analyzePromptResponse(
  prompt: string,
  brandName?: string,
  knownCompetitors?: string[],
  model: string = 'chatgpt',
  context?: { analysisRunId?: number; jobId?: number },
): Promise<PromptAnalysisResult> {
  return runAnalysis(prompt, brandName, knownCompetitors, model, context, extractCompetitorsFromResponse);
}

export async function generatePromptsForTopic(topicName: string, topicDescription: string, count: number = 5, competitors: string[] = []): Promise<string[]> {
  try {
    const analysis = await anthropicJSON<{ prompts: string[] }>(
      `You generate simple, natural prompts that someone would type into ChatGPT when researching or evaluating products/services in a category.

CRITICAL RULE: Do NOT mention any specific brand names, company names, or product names in the prompts. The goal is to test whether an LLM will organically recommend certain brands — so the prompts must be brand-neutral.

Keep prompts short and conversational — the way a real person would ask.

Rules:
- NO brand names, company names, or product names — ever
- Simple, direct language — like typing into a search box or chat
- Mix of: recommendations, comparisons, "best of" lists, "what should I use", specific questions
- Vary the angle: features, pricing, scale, compliance, performance, use cases
- ALWAYS include at least one simple, generic prompt like "Recommend a [topic]" or "I need a [topic]" or "What [topic] should I use?"
- Don't add "for enterprise" to every prompt — mix in general/unqualified questions alongside enterprise-specific ones`,
      [
        {
          role: "user",
          content: `Generate ${count} diverse, brand-neutral prompts about: ${topicName}${topicDescription ? ` (${topicDescription})` : ''}\n\nRemember: no brand or product names.`,
        },
      ],
      promptsSchema,
      { model: FULL_MODEL, maxTokens: count * 50, temperature: 0.8 },
    );

    const prompts = (analysis.prompts || [])
      .map(p => p.replace(/^["']+|["']+$/g, '').trim())
      .filter(p => p.length > 0);

    return prompts.slice(0, count);
  } catch (error) {
    console.error("Error generating prompts for topic:", error);
    const topic = topicName.toLowerCase();
    return [
      `What's the best ${topic}?`,
      `Recommend me a ${topic} solution`,
      `Compare top ${topic} options`,
      `Best ${topic} for enterprise`,
      `${topicName} alternatives and pricing`,
    ].slice(0, count);
  }
}

export async function extractSourcesFromText(text: string): Promise<Array<{title: string; url: string; domain: string; snippet?: string}>> {
  try {
    const analysis = await anthropicJSON<{ sources: Array<{title: string; url: string; domain: string; snippet?: string}> }>(
      `You are an expert at identifying relevant documentation sources, references, and URLs from text. Extract ANY mentioned URLs, documentation links, official guides, GitHub repos, Stack Overflow links, or reference materials.`,
      [
        {
          role: "user",
          content: `Extract ALL relevant sources and URLs from this text: "${text}"`,
        },
      ],
      sourcesSchema,
      { model: FULL_MODEL, maxTokens: 1024, temperature: 0.1 },
    );

    return (analysis.sources || []).filter(item => item.title && item.url && item.domain);
  } catch (error) {
    console.error("Error extracting sources from text:", error);
    return [];
  }
}

export async function extractCompetitorsFromText(text: string, brandName?: string): Promise<string[]> {
  try {
    const brandContext = brandName ? `Focus on direct competitors to ${brandName}. ` : '';

    const analysis = await anthropicJSON<{ competitors: string[] }>(
      `You are an expert at identifying ONLY direct competitors to a specific brand.
${brandContext}Be extremely strict - only extract companies that are DIRECT competitors in the EXACT same market space.

CRITICAL RULES:
- Only include companies that directly compete for the same customers
- Do NOT include general technology platforms, tools, or services
- Do NOT include complementary services or partners
- If unsure, do NOT include the company`,
      [
        {
          role: "user",
          content: `Extract ONLY direct competitors from this text: "${text}"
${brandName ? `Focus on companies that DIRECTLY compete with ${brandName}.` : ''}`,
        },
      ],
      competitorsSchema,
      { model: FULL_MODEL, maxTokens: 256, temperature: 0.1 },
    );

    const competitors = (analysis.competitors || []).filter(item => typeof item === 'string');
    return deduplicateCompetitors(competitors);
  } catch (error) {
    console.error("Error extracting competitors from text:", error);
    return [];
  }
}

export async function generateDynamicTopics(brandUrl: string, count: number, competitors: string[]): Promise<Array<{name: string, description: string}>> {
  try {
    const analysis = await anthropicJSON<{ topics: Array<{name: string; description: string}> }>(
      `You generate product/service category topics for brand monitoring research.

Given a brand URL, figure out what industry and product category the brand operates in, then generate topics that describe the CATEGORY or PROBLEM SPACE — NOT the specific brand or any competitor by name.

CRITICAL: Do NOT mention any brand names, company names, or product names in the topic names or descriptions.`,
      [
        {
          role: "user",
          content: `Brand URL: ${brandUrl}

Generate ${count} diverse category/problem-space topics relevant to this brand's market. No brand names.`,
        },
      ],
      topicsSchema,
      { model: FULL_MODEL, maxTokens: 512, temperature: 0.7 },
    );

    const topics = analysis.topics || [];
    if (topics.length > 0) {
      return topics.slice(0, count).map(topic => ({
        name: topic.name || "General Analysis",
        description: topic.description || `Analysis of ${topic.name || "general"} aspects`,
      }));
    }

    return Array.from({ length: count }, (_, i) => ({
      name: `Analysis Topic ${i + 1}`,
      description: `Dynamic analysis topic generated for brand analysis`,
    }));
  } catch (error) {
    console.error("Error generating dynamic topics:", error);
    return Array.from({ length: count }, (_, i) => ({
      name: `Brand Analysis ${i + 1}`,
      description: `Comprehensive analysis of brand positioning and market dynamics`,
    }));
  }
}

export async function categorizeCompetitor(name: string, brandName?: string): Promise<string> {
  try {
    const response = await anthropicCompletion(
      `Categorize this company/product. Return only the category name as a single word or short phrase (e.g. "Technology", "Cloud Platform", "Networking", etc.). No explanation.`,
      [
        {
          role: "user",
          content: `Brand: ${brandName || 'Unknown'}\nCompetitor: ${name}\nCategory?`,
        },
      ],
      { model: FAST_MODEL, maxTokens: 32, temperature: 0.1, timeoutMs: 15000 },
    );

    const textBlock = response.content.find(c => c.type === 'text');
    return (textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '') || 'Technology';
  } catch (error) {
    console.error(`Error categorizing competitor ${name}:`, error);
    return 'Technology';
  }
}

export async function analyzeBrandAndFindCompetitors(brandUrl: string): Promise<Array<{name: string, url: string, category: string}>> {
  try {
    console.log(`[${new Date().toISOString()}] Starting brand analysis (Anthropic) for: ${brandUrl}`);

    if (!process.env.ANTHROPIC_API_KEY) {
      return [
        { name: "Sample Competitor 1", url: "https://competitor1.com", category: "Technology" },
        { name: "Sample Competitor 2", url: "https://competitor2.com", category: "Technology" },
      ];
    }

    const homepageText = await fetchWebsiteText(brandUrl);

    const prompts = [
      { system: "Find 2-3 well-known, established competitors.", focus: "well-known direct" },
      { system: "Find 2-3 newer or emerging competitors.", focus: "newer or emerging direct" },
      { system: "Find 2-3 enterprise-focused or developer-focused competitors.", focus: "enterprise or developer-focused direct" },
    ];

    const results = await Promise.all(prompts.map(async (p, index) => {
      try {
        const analysis = await anthropicJSON<{ competitors: Array<{name: string; url: string; category: string}> }>(
          `You are an expert at identifying direct competitors for technology companies. ${p.system}`,
          [
            {
              role: "user",
              content: `Homepage content: """${homepageText}"""\n\nFind 2-3 ${p.focus} competitors.`,
            },
          ],
          brandCompetitorsSchema,
          { model: FULL_MODEL, maxTokens: 512, temperature: 0.4 },
        );

        return (analysis.competitors || []).filter(item => item.name && item.url && item.category);
      } catch (error) {
        console.error(`Analysis attempt ${index + 1} failed:`, error);
        return [];
      }
    }));

    const allCompetitors: Array<{name: string; url: string; category: string}> = [];
    const seenNames = new Set<string>();
    for (const competitors of results) {
      for (const comp of competitors) {
        const key = comp.name.toLowerCase().trim();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          allCompetitors.push(comp);
        }
      }
    }

    return allCompetitors.slice(0, 8);
  } catch (error) {
    console.error("Error analyzing brand:", error);
    return [];
  }
}
