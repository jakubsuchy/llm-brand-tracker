# LLM Prompt Response

Scrape real responses from ChatGPT and Perplexity AI by submitting prompts through an actual browser. Get the exact same answers a human user would see -- complete with cited sources, links, and full-length responses.

Unlike API-based approaches, this Actor uses **Camoufox** (anti-detect Firefox) with human-like behavior to interact with LLM chat interfaces directly. This means you get responses identical to what users see in the browser, including web search results, citations, and source links that are not available through official APIs.

## What can you use it for?

- **Brand monitoring** -- Track how AI chatbots mention your brand vs. competitors in organic responses
- **SEO & AI visibility research** -- Discover which websites ChatGPT and Perplexity cite as sources
- **Competitor analysis** -- See which brands get recommended for specific queries
- **LLM output benchmarking** -- Compare how different AI providers answer the same questions
- **Content gap analysis** -- Find out what AI recommends and identify content opportunities
- **Market research** -- Understand how AI perceives products, services, and industries
- **Citation tracking** -- Monitor which URLs appear in AI-generated answers over time

## Supported providers

| Provider | Auth required | Sources | Notes |
|----------|--------------|---------|-------|
| **Perplexity** | No | Yes | Default. No login needed, great for quick research queries |
| **ChatGPT** | Yes | Yes | Requires email + password. Optional TOTP for 2FA accounts |

## Input

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompts` | `string[]` | Yes | -- | One or more prompts to send. Each prompt produces one dataset item. |
| `provider` | `string` | No | `perplexity` | Which LLM provider to use: `chatgpt` or `perplexity` |
| `chatgptEmail` | `string` | If ChatGPT | -- | Email for ChatGPT login |
| `chatgptPassword` | `string` | If ChatGPT | -- | Password for ChatGPT login (stored securely) |
| `chatgptTotpSecret` | `string` | No | -- | Base32 TOTP secret or `otpauth://` URI for ChatGPT 2FA |

### Example input

```json
{
    "prompts": [
        "What is the best enterprise load balancer?",
        "Top project management tools for remote teams"
    ],
    "provider": "perplexity"
}
```

### Example input with ChatGPT

```json
{
    "prompts": ["What are the best CRM platforms for startups?"],
    "provider": "chatgpt",
    "chatgptEmail": "you@example.com",
    "chatgptPassword": "your-password",
    "chatgptTotpSecret": "JBSWY3DPEHPK3PXP"
}
```

## Output

Each prompt produces one item in the dataset with the following structure:

```json
{
    "question": "What is the best enterprise load balancer?",
    "answer": "There are several excellent enterprise load balancers to consider...",
    "sources": [
        {
            "href": "https://www.example.com/load-balancer-guide",
            "title": "Complete Guide to Enterprise Load Balancers"
        }
    ],
    "provider": "perplexity",
    "url": "https://www.perplexity.ai/search/what-is-the-best...",
    "timestamp": "2026-04-01T12:00:00.000Z"
}
```

### Output fields

| Field | Type | Description |
|-------|------|-------------|
| `question` | `string` | The original prompt that was submitted |
| `answer` | `string` | The full text response from the LLM provider |
| `sources` | `array` | List of cited sources with `href` (URL) and `title` |
| `provider` | `string` | Which provider generated this response (`chatgpt` or `perplexity`) |
| `url` | `string` | The browser URL of the conversation page |
| `timestamp` | `string` | ISO 8601 timestamp of when the response was captured |

If a prompt fails, the dataset item will include `"answer": null` and an `"error"` field with the failure reason. Successful prompts are not affected by individual failures.

## How it works

1. Launches **Camoufox** -- a modified Firefox build with anti-fingerprinting and human-like mouse movements, typing delays, and scroll behavior
2. Navigates to the selected provider (ChatGPT or Perplexity)
3. Handles authentication if needed (email/password login with optional TOTP 2FA)
4. Automatically dismisses cookie banners, popups, and Cloudflare challenges
5. Submits each prompt, waits for the full streamed response to complete
6. Extracts the response text and cited source URLs
7. Pushes each result to the Apify Dataset

All requests are routed through **US residential proxies** for maximum reliability and anti-detection.

## Performance & resources

- Each prompt takes approximately **30 seconds to 3 minutes** depending on the provider and response length
- Prompts are processed **sequentially** (browser automation is single-threaded)
- Recommended memory: **4 GB** minimum
- No browser profile is persisted between runs -- each run starts with a clean session

## Integrations

Connect LLM Prompt Response with other tools using Apify's built-in integrations:

- **Webhooks** -- Get notified when a run completes
- **API** -- Trigger runs programmatically and fetch results via the Apify API
- **Schedules** -- Run on a recurring schedule to track AI responses over time
- **Google Sheets** -- Export results directly to a spreadsheet
- **Slack / Email** -- Send notifications when runs finish
