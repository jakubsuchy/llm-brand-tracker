// Browser Scraper Client — sends prompts to the camoufox container via HTTP.
// Supports multiple providers: chatgpt, perplexity, etc.

export interface BrowserScraperResult {
  question: string;
  answer: string;
  sources: Array<{ href: string; title: string }>;
  url: string;
  timestamp: string;
  provider: string;
}

export type BrowserProvider = 'chatgpt' | 'perplexity';

export async function askBrowser(
  question: string,
  provider: BrowserProvider = 'chatgpt',
  credentials?: { email: string; password: string },
): Promise<BrowserScraperResult> {
  const camoufoxUrl = process.env.CAMOUFOX_URL || 'http://camoufox:8888';
  const startTime = Date.now();

  console.log(`[Browser ${provider}] Sending: "${question.substring(0, 80)}..."`);

  const body: any = { question, provider };
  if (credentials) {
    body.email = credentials.email;
    body.password = credentials.password;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const camoufoxApiKey = process.env.CAMOUFOX_API_KEY;
  if (camoufoxApiKey) headers['Authorization'] = `Bearer ${camoufoxApiKey}`;

  const response = await fetch(`${camoufoxUrl}/ask`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Camoufox ${provider} error (${response.status}): ${err.error}`);
  }

  const result: BrowserScraperResult = await response.json();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`[Browser ${provider}] Done in ${elapsed}s — ${result.answer.length} chars, ${result.sources.length} sources`);
  console.log(`[Browser ${provider}] Sources: ${result.sources.map(s => s.title || s.href).join(', ') || 'none'}`);

  return result;
}

// Backwards-compatible alias
export async function askChatGPT(
  question: string,
  credentials: { email: string; password: string },
): Promise<BrowserScraperResult> {
  return askBrowser(question, 'chatgpt', credentials);
}
