import { chatCompletion, chatCompletionJSON, extractArray, openai } from "./llm";
import { fetchWebsiteText } from "./scraper";

export interface PromptAnalysisResult {
  response: string;
  brandMentioned: boolean;
  competitors: string[];
  sources: string[];
  provider: string;
}

// Response method: 'browser' uses ChatGPT web UI, 'api' uses OpenAI Responses API
export type ResponseMethod = 'browser' | 'api';
let activeResponseMethod: ResponseMethod = 'api';

export function setResponseMethod(method: ResponseMethod) {
  activeResponseMethod = method;
  console.log(`[Response Method] Set to: ${method}`);
}

export function getResponseMethod(): ResponseMethod {
  return activeResponseMethod;
}

export async function analyzePromptResponse(
  prompt: string,
  brandName?: string,
  knownCompetitors?: string[],
  provider: string = activeResponseMethod
): Promise<PromptAnalysisResult> {
  let responseText = "";
  let sources: string[] = [];
  const startTime = Date.now();
  const effectiveProvider = provider;

  console.log(`[analyzePromptResponse] Provider: ${effectiveProvider} | Prompt: "${prompt.substring(0, 80)}..."`);

  if (effectiveProvider === 'api') {
    const apiResult = await getResponseViaAPI(prompt);
    responseText = apiResult.responseText;
    sources = apiResult.sources;
  } else {
    // Browser provider (chatgpt, perplexity, etc.)
    try {
      const result = await getResponseViaBrowser(prompt, effectiveProvider);
      responseText = result.responseText;
      sources = result.sources;
    } catch (browserError) {
      console.error(`[analyzePromptResponse] Browser ${effectiveProvider} failed:`, (browserError as Error).message);
      throw browserError; // Don't fallback silently — let the caller decide
    }
  }

  console.log(`[analyzePromptResponse] ${effectiveProvider} response: ${responseText.length} chars, ${sources.length} sources in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  // Step 2: Analyze for brand/competitor mentions (always via API — fast structured extraction)
  try {
    const brandContext = brandName
      ? `\nOUR BRAND: "${brandName}" — any mention of this brand (including variations like ${brandName}.com, ${brandName}.org, ${brandName}.io, open-source ${brandName}, etc.) counts as a brand mention, NOT a competitor.`
      : '';
    const competitorContext = knownCompetitors && knownCompetitors.length > 0
      ? `\nKNOWN COMPETITORS: ${knownCompetitors.join(', ')} — these are confirmed competitors.`
      : '';

    const analysis = await chatCompletionJSON<{ brandMentioned: boolean; competitors: string[] }>({
      model: "gpt-5.4-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert at analyzing text for brand mentions and extracting structured data. Respond only with valid JSON.",
        },
        {
          role: "user",
          content: `Analyze the following AI response for brand mentions and competitor mentions.

Response to analyze: "${responseText}"
${brandContext}${competitorContext}

Return JSON:
{
  "brandMentioned": boolean,
  "competitors": string[]
}

Rules:
- "brandMentioned": true if our brand "${brandName || 'unknown'}" appears anywhere (any TLD variant: .com, .org, .io, etc.)
- "competitors": list ALL companies, products, or services mentioned that compete in the same space as our brand. Include both company names (e.g. "Square") and product names (e.g. "Square Payments"). Be thorough — if it's mentioned as an alternative or option, include it.
- Do NOT include platforms where content is hosted or discussed (e.g. Reddit, GitHub, Stack Overflow, YouTube, Medium, Wikipedia, etc.)
- For cloud providers, prefer their specific product name if mentioned (e.g. "AWS Elastic Load Balancing" over just "AWS"), but include the cloud provider name if no specific product is named
- IMPORTANT: If a competitor matches one already in the known competitors list, use the EXACT full name from that list
- Do NOT include URLs in this response`,
        },
      ],
      max_completion_tokens: 512,
    });

    console.log(`[DEBUG] parsed: brandMentioned=${analysis.brandMentioned}, competitors=${JSON.stringify(analysis.competitors)}`);

    return {
      response: responseText,
      brandMentioned: analysis.brandMentioned || false,
      competitors: analysis.competitors || [],
      sources,
      provider: effectiveProvider,
    };
  } catch (error) {
    console.error("Error analyzing prompt response:", error);
    throw new Error("Failed to analyze prompt response: " + (error as Error).message);
  }
}

// --- Browser method: send to browser actor (local or Apify Cloud) ---

async function getResponseViaBrowser(prompt: string, provider: string): Promise<{ responseText: string; sources: string[] }> {
  const { askBrowser } = await import('./chatgpt-browser');

  const result = await askBrowser(prompt, provider as any);

  // Extract URLs from markdown links in the response text
  const urlSources: string[] = [];
  const urlPattern = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = urlPattern.exec(result.answer)) !== null) {
    urlSources.push(match[2]);
  }
  // Footnote-style links: [1]: https://...
  const footnotePattern = /^\[(\d+)\]:\s*(https?:\/\/\S+)/gm;
  while ((match = footnotePattern.exec(result.answer)) !== null) {
    urlSources.push(match[2]);
  }
  // Also include sources from the sidebar extraction
  const sidebarSources = result.sources.map(s => s.href).filter(Boolean);

  return {
    responseText: result.answer,
    sources: [...new Set([...sidebarSources, ...urlSources])],
  };
}

// --- API method: OpenAI Responses API with web search ---

async function getResponseViaAPI(prompt: string): Promise<{ responseText: string; sources: string[] }> {
  console.log(`[API] Calling Responses API for: "${prompt.substring(0, 60)}..."`);
  const responsesResult = await openai.responses.create({
    model: "gpt-5.4",
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
  for (const item of (responsesResult as any).output) {
    if (item.type === "message") {
      for (const content of item.content) {
        if (content.type === "output_text") {
          responseText += content.text;
          if (content.annotations) {
            for (const ann of content.annotations) {
              if (ann.type === "url_citation" && ann.url) {
                sources.push(ann.url);
              }
            }
          }
        }
      }
    }
  }

  // Record token usage
  const usage = (responsesResult as any).usage;
  if (usage) {
    try {
      const { db } = await import("../db");
      const { apiUsage } = await import("@shared/schema");
      const { getCurrentRunId } = await import("./llm");
      await db.insert(apiUsage).values({
        analysisRunId: getCurrentRunId(),
        model: (responsesResult as any).model || "gpt-5.4",
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
      });
    } catch {}
  }

  return { responseText, sources: [...new Set(sources)] };
}

export async function generatePromptsForTopic(topicName: string, topicDescription: string, count: number = 5, competitors: string[] = []): Promise<string[]> {
  try {
    const parsed = await chatCompletionJSON({
      model: "gpt-5.4",
      messages: [
        {
          role: "system",
          content: `You generate simple, natural prompts that someone would type into ChatGPT when researching or evaluating products/services in a category.

CRITICAL RULE: Do NOT mention any specific brand names, company names, or product names in the prompts. The goal is to test whether an LLM will organically recommend certain brands — so the prompts must be brand-neutral.

Keep prompts short and conversational — the way a real person would ask.

Good examples:
- "What's the best enterprise load balancer?"
- "Recommend me a CI/CD platform for large teams"
- "Top rated API gateways for enterprise"
- "Best monitoring tools for microservices"

Bad examples (DO NOT generate these):
- "Compare Stripe vs PayPal vs Square" (names specific brands)
- "Best alternatives to Slack" (names a specific brand)

Rules:
- NO brand names, company names, or product names — ever
- Simple, direct language — like typing into a search box or chat
- Mix of: recommendations, comparisons, "best of" lists, "what should I use", specific questions
- Vary the angle: features, pricing, scale, compliance, performance, use cases
- ALWAYS include at least one simple, generic prompt like "Recommend a [topic]" or "I need a [topic]" or "What [topic] should I use?" — without any qualifier like "enterprise" or "for large teams"
- Don't add "for enterprise" to every prompt — mix in general/unqualified questions alongside enterprise-specific ones

Return a JSON object with a "prompts" key containing an array of strings.`
        },
        {
          role: "user",
          content: `Generate ${count} diverse, brand-neutral prompts about: ${topicName}${topicDescription ? ` (${topicDescription})` : ''}\n\nRemember: no brand or product names.\n\nReturn as: {"prompts": [...]}`
        }
      ],
      temperature: 0.8,
      max_completion_tokens: count * 50
    });

    const prompts = extractArray<string>(parsed)
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

function calculateCompetitorSimilarity(competitor1: string, competitor2: string): number {
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

export async function extractSourcesFromText(text: string): Promise<Array<{title: string; url: string; domain: string; snippet?: string}>> {
  try {
    const parsed = await chatCompletionJSON({
      model: "gpt-5.4",
      messages: [
        {
          role: "system",
          content: `You are an expert at identifying relevant documentation sources, references, and URLs from text.
          Extract ANY mentioned URLs, documentation links, official guides, GitHub repos, Stack Overflow links, or reference materials.
          Return as a JSON object with a "sources" key containing an array of source objects.`
        },
        {
          role: "user",
          content: `Extract ALL relevant sources and URLs from this text: "${text}"
          Return as: {"sources": [{"title": "Source Title", "url": "https://example.com", "domain": "example.com", "snippet": "Description"}]}`
        }
      ],
      temperature: 0.1,
      max_completion_tokens: 1024
    });

    const sources = extractArray(parsed);
    return sources.filter(item =>
      typeof item === 'object' && item.title && item.url && item.domain
    );
  } catch (error) {
    console.error("Error extracting sources from text:", error);
    return [];
  }
}

export async function extractCompetitorsFromText(text: string, brandName?: string): Promise<string[]> {
  try {
    const brandContext = brandName ? `Focus on direct competitors to ${brandName}. ` : '';

    const parsed = await chatCompletionJSON({
      model: "gpt-5.4",
      messages: [
        {
          role: "system",
          content: `You are an expert at identifying ONLY direct competitors to a specific brand.
          ${brandContext}Be extremely strict - only extract companies that are DIRECT competitors in the EXACT same market space.

          CRITICAL RULES:
          - Only include companies that directly compete for the same customers
          - Do NOT include general technology platforms, tools, or services
          - Do NOT include complementary services or partners
          - If unsure, do NOT include the company

          Return as: {"competitors": ["Name1", "Name2"]}`
        },
        {
          role: "user",
          content: `Extract ONLY direct competitors from this text: "${text}"
          ${brandName ? `Focus on companies that DIRECTLY compete with ${brandName}.` : ''}
          Return as: {"competitors": [...]}`
        }
      ],
      temperature: 0.1,
      max_completion_tokens: 256
    });

    const competitors = extractArray<string>(parsed).filter(item => typeof item === 'string');

    // Apply diversity check
    const diverseCompetitors: string[] = [];
    for (const competitor of competitors) {
      if (diverseCompetitors.length >= 10) break;
      const isDiverse = diverseCompetitors.every(existing =>
        calculateCompetitorSimilarity(competitor, existing) < 70
      );
      if (isDiverse) diverseCompetitors.push(competitor);
    }

    return diverseCompetitors;
  } catch (error) {
    console.error("Error extracting competitors from text:", error);
    return [];
  }
}

export async function generateDynamicTopics(brandUrl: string, count: number, competitors: string[]): Promise<Array<{name: string, description: string}>> {
  try {
    const parsed = await chatCompletionJSON({
      model: "gpt-5.4",
      messages: [
        {
          role: "system",
          content: `You generate product/service category topics for brand monitoring research.

Given a brand URL, figure out what industry and product category the brand operates in, then generate topics that describe the CATEGORY or PROBLEM SPACE — NOT the specific brand or any competitor by name.

CRITICAL: Do NOT mention any brand names, company names, or product names in the topic names or descriptions.

Return as: {"topics": [{"name": "Topic Name", "description": "Brief description"}]}`
        },
        {
          role: "user",
          content: `Brand URL: ${brandUrl}

Generate ${count} diverse category/problem-space topics relevant to this brand's market. No brand names.

Return as: {"topics": [{"name": "Topic Name", "description": "Brief category description"}]}`
        }
      ],
      temperature: 0.7,
      max_completion_tokens: 512
    });

    const topics = extractArray(parsed);
    if (topics.length > 0) {
      return topics.slice(0, count).map(topic => ({
        name: topic.name || "General Analysis",
        description: topic.description || `Analysis of ${topic.name || "general"} aspects`
      }));
    }

    return Array.from({ length: count }, (_, i) => ({
      name: `Analysis Topic ${i + 1}`,
      description: `Dynamic analysis topic generated for brand analysis`
    }));
  } catch (error) {
    console.error("Error generating dynamic topics:", error);
    return Array.from({ length: count }, (_, i) => ({
      name: `Brand Analysis ${i + 1}`,
      description: `Comprehensive analysis of brand positioning and market dynamics`
    }));
  }
}

export async function analyzeBrandAndFindCompetitors(brandUrl: string): Promise<Array<{name: string, url: string, category: string}>> {
  try {
    console.log(`[${new Date().toISOString()}] Starting brand analysis for: ${brandUrl}`);

    if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY_ENV_VAR) {
      return [
        { name: "Sample Competitor 1", url: "https://competitor1.com", category: "Technology" },
        { name: "Sample Competitor 2", url: "https://competitor2.com", category: "Technology" }
      ];
    }

    const homepageText = await fetchWebsiteText(brandUrl);

    const prompts = [
      { system: "Find 2-3 well-known, established competitors.", focus: "well-known direct" },
      { system: "Find 2-3 newer or emerging competitors.", focus: "newer or emerging direct" },
      { system: "Find 2-3 enterprise-focused or developer-focused competitors.", focus: "enterprise or developer-focused direct" }
    ];

    const results = await Promise.all(prompts.map(async (p, index) => {
      try {
        const parsed = await chatCompletionJSON({
          model: "gpt-5.4",
          messages: [
            {
              role: "system",
              content: `You are an expert at identifying direct competitors for technology companies. ${p.system} ALWAYS return a JSON object with a "competitors" array.`
            },
            {
              role: "user",
              content: `Homepage content: """${homepageText}"""\n\nFind 2-3 ${p.focus} competitors. Return as: {"competitors": [{"name": "Name", "url": "https://...", "category": "Category"}]}`
            }
          ],
          temperature: 0.4,
          max_completion_tokens: 512
        });

        return extractArray(parsed).filter((item: any) =>
          typeof item === 'object' && item.name && item.url && item.category
        );
      } catch (error) {
        console.error(`Analysis attempt ${index + 1} failed:`, error);
        return [];
      }
    }));

    // Deduplicate
    const allCompetitors: Array<{name: string, url: string, category: string}> = [];
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
