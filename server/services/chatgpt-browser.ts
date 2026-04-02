// Browser Actor Client — sends prompts to a local browser-actor container or Apify Cloud.
// Dual mode: local standby container (no APIFY_TOKEN) or Apify Cloud API (APIFY_TOKEN set).

export interface BrowserScraperResult {
  question: string;
  answer: string;
  sources: Array<{ href: string; title: string }>;
  url: string;
  timestamp: string;
  provider: string;
}

export type BrowserProvider = 'chatgpt' | 'perplexity';

const APIFY_ACTOR_ID = 'jakubsuchy~llm-prompt-response';
const APIFY_API_BASE = 'https://api.apify.com/v2';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 300000;

function getBrowserActorUrl(): string {
  return process.env.BROWSER_ACTOR_URL || 'http://browser-actor:8888';
}

function getCredentials() {
  const email = process.env.CHATGPT_EMAIL || '';
  const password = process.env.CHATGPT_PASSWORD || '';
  const totpSecret = process.env.CHATGPT_TOTP_SECRET || '';
  return { email, password, totpSecret };
}

function buildRequestBody(question: string, provider: BrowserProvider) {
  const creds = getCredentials();
  const body: Record<string, any> = {
    prompts: [question],
    provider,
  };
  if (creds.email) body.chatgptEmail = creds.email;
  if (creds.password) body.chatgptPassword = creds.password;
  if (creds.totpSecret) body.chatgptTotpSecret = creds.totpSecret;
  return body;
}

// ─── Local mode: POST to browser-actor standby container ─────────

async function askBrowserLocal(question: string, provider: BrowserProvider): Promise<BrowserScraperResult> {
  const url = getBrowserActorUrl();

  const response = await fetch(`${url}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody(question, provider)),
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Browser actor ${provider} error (${response.status}): ${err.error}`);
  }

  const results: any[] = await response.json();
  const item = results[0];

  if (!item || item.answer === null || item.answer === undefined) {
    throw new Error(item?.error || `${provider} returned no answer`);
  }

  return {
    question: item.question,
    answer: item.answer,
    sources: item.sources || [],
    url: item.url || '',
    timestamp: item.timestamp || new Date().toISOString(),
    provider: item.provider || provider,
  };
}

// ─── Cloud mode: start Apify run, poll, fetch dataset ────────────

async function askBrowserCloud(question: string, provider: BrowserProvider): Promise<BrowserScraperResult> {
  const token = process.env.APIFY_TOKEN!;

  // Start a run
  const startRes = await fetch(`${APIFY_API_BASE}/acts/${APIFY_ACTOR_ID}/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody(question, provider)),
  });

  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({ error: startRes.statusText }));
    throw new Error(`Apify start run failed (${startRes.status}): ${err.error || JSON.stringify(err)}`);
  }

  const runData = await startRes.json();
  const runId = runData.data?.id;
  if (!runId) throw new Error('Apify run did not return a run ID');

  console.log(`[Apify ${provider}] Started run ${runId}`);

  // Poll for completion
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let status = '';
  let runInfo: any;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${APIFY_API_BASE}/actor-runs/${runId}?token=${token}`);
    if (!pollRes.ok) continue;

    runInfo = await pollRes.json();
    status = runInfo.data?.status;

    if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED') {
      break;
    }
  }

  if (status === 'FAILED') {
    throw new Error(`Apify run ${runId} failed: ${runInfo.data?.statusMessage || 'unknown error'}`);
  }

  if (status === 'ABORTED') {
    throw new Error(`ABORTED: Apify run ${runId} was aborted`);
  }

  if (status !== 'SUCCEEDED') {
    throw new Error(`Apify run ${runId} timed out (status: ${status || 'unknown'})`);
  }

  // Fetch results from dataset
  const datasetId = runInfo.data?.defaultDatasetId;
  if (!datasetId) throw new Error(`Apify run ${runId} has no dataset`);

  const datasetRes = await fetch(`${APIFY_API_BASE}/datasets/${datasetId}/items?token=${token}`);
  if (!datasetRes.ok) {
    throw new Error(`Failed to fetch Apify dataset ${datasetId}: ${datasetRes.statusText}`);
  }

  const items: any[] = await datasetRes.json();
  const item = items[0];

  if (!item || item.answer === null || item.answer === undefined) {
    throw new Error(item?.error || `${provider} returned no answer (Apify run ${runId})`);
  }

  console.log(`[Apify ${provider}] Run ${runId} completed: ${item.answer.length} chars, ${item.sources?.length || 0} sources`);

  return {
    question: item.question,
    answer: item.answer,
    sources: item.sources || [],
    url: item.url || '',
    timestamp: item.timestamp || new Date().toISOString(),
    provider: item.provider || provider,
  };
}

// ─── Public API ──────────────────────────────────────────────────

export async function askBrowser(
  question: string,
  provider: BrowserProvider = 'chatgpt',
): Promise<BrowserScraperResult> {
  const startTime = Date.now();
  const mode = process.env.APIFY_TOKEN ? 'cloud' : 'local';

  console.log(`[Browser ${provider}] Sending (${mode}): "${question.substring(0, 80)}..."`);

  const result = mode === 'cloud'
    ? await askBrowserCloud(question, provider)
    : await askBrowserLocal(question, provider);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Browser ${provider}] Done in ${elapsed}s — ${result.answer.length} chars, ${result.sources.length} sources`);

  return result;
}

/**
 * Check if the browser actor is available (either cloud or local).
 */
export async function isBrowserAvailable(): Promise<boolean> {
  if (process.env.APIFY_TOKEN) return true;

  try {
    const res = await fetch(`${getBrowserActorUrl()}/`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
