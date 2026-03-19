import { chatCompletionJSON, extractArray } from "./llm";

export async function generateDiversePrompts(
  topicName: string,
  competitors: string[],
  promptsPerTopic: number,
  diversityThreshold: number
): Promise<string[]> {
  try {
    const parsed = await chatCompletionJSON({
      model: "gpt-5.4",
      messages: [
        {
          role: "system",
          content: `You generate simple, natural prompts that someone would type into ChatGPT when researching or evaluating products/services in a category.

CRITICAL RULE: Do NOT mention any specific brand names, company names, or product names. The goal is to test whether an LLM will organically recommend certain brands — so prompts must be brand-neutral.

Keep prompts short and conversational — the way a real person would ask.

Good examples:
- "What's the best enterprise load balancer?"
- "Recommend me a CI/CD platform for large teams"
- "Top rated API gateways for enterprise"
- "Best monitoring tools for microservices"

Bad examples (DO NOT generate):
- "Compare Stripe vs PayPal vs Square" (names specific brands)
- "Best alternatives to Slack" (names a specific brand)

Rules:
- NO brand names, company names, or product names — ever
- Simple, direct language
- Mix of: recommendations, "best of" lists, "what should I use", specific questions
- Vary the angle: features, pricing, scale, compliance, performance, use cases
- Enterprise-focused context by default

Return a JSON object with a "prompts" key containing an array of strings.`
        },
        {
          role: "user",
          content: `Generate ${promptsPerTopic} diverse, brand-neutral prompts about: ${topicName}\n\nReturn as: {"prompts": [...]}`
        }
      ],
      temperature: 0.8,
      max_completion_tokens: promptsPerTopic * 50
    });

    const prompts = extractArray<string>(parsed)
      .map(p => p.replace(/^["']+|["']+$/g, '').trim())
      .filter(p => p.length > 0);

    if (prompts.length >= promptsPerTopic) {
      return prompts.slice(0, promptsPerTopic);
    }

    // Fill gaps with simple fallbacks
    const topic = topicName.toLowerCase();
    const fallbacks = [
      `What's the best ${topic}?`,
      `Recommend me a ${topic} solution`,
      `Top ${topic} options for enterprise`,
      `Best ${topic} for high availability`,
      `What should I use for ${topic}?`,
    ];

    for (const fb of fallbacks) {
      if (prompts.length >= promptsPerTopic) break;
      if (!prompts.includes(fb)) prompts.push(fb);
    }

    return prompts.slice(0, promptsPerTopic);
  } catch (error) {
    console.error("Error generating diverse prompts:", error);
    const topic = topicName.toLowerCase();
    return [
      `What's the best ${topic}?`,
      `Recommend me a ${topic} solution`,
      `Top ${topic} options for enterprise`,
      `Best ${topic} for high availability`,
      `What should I use for ${topic}?`,
    ].slice(0, promptsPerTopic);
  }
}
