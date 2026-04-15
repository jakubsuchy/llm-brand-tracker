// Browser Actor Client — sends prompts to a local browser-actor container or Apify Cloud.
// Dual mode: local standby container (no APIFY_TOKEN) or Apify Cloud API (APIFY_TOKEN set).

import { db } from '../db';
import { apifyUsage } from '@shared/schema';

export interface BrowserScraperResult {
  question: string;
  answer: string;
  sources: Array<{ href: string; title: string }>;
  url: string;
  timestamp: string;
  model: string;
}

export type BrowserModel = 'chatgpt' | 'perplexity' | 'google-aimode';

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

function buildRequestBody(question: string, model: BrowserModel) {
  const creds = getCredentials();
  const body: Record<string, any> = {
    prompts: [question],
    provider: model,
  };
  if (creds.email) body.chatgptEmail = creds.email;
  if (creds.password) body.chatgptPassword = creds.password;
  if (creds.totpSecret) body.chatgptTotpSecret = creds.totpSecret;
  return body;
}

// ─── Local mode: POST to browser-actor standby container ─────────

async function askBrowserLocal(question: string, model: BrowserModel): Promise<BrowserScraperResult> {
  const url = getBrowserActorUrl();

  const response = await fetch(`${url}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody(question, model)),
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Browser actor ${model} error (${response.status}): ${err.error}`);
  }

  const results: any[] = await response.json();
  const item = results[0];

  if (!item || item.answer === null || item.answer === undefined) {
    throw new Error(item?.error || `${model} returned no answer`);
  }

  return {
    question: item.question,
    answer: item.answer,
    sources: item.sources || [],
    url: item.url || '',
    timestamp: item.timestamp || new Date().toISOString(),
    model: item.provider || model,
  };
}

// ─── Cloud mode: start Apify run, poll, fetch dataset ────────────

async function askBrowserCloud(question: string, model: BrowserModel): Promise<BrowserScraperResult> {
  const token = process.env.APIFY_TOKEN!;

  // Start a run
  const startRes = await fetch(`${APIFY_API_BASE}/acts/${APIFY_ACTOR_ID}/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody(question, model)),
  });

  if (!startRes.ok) {
    const errBody = await startRes.text().catch(() => startRes.statusText);
    throw new Error(`Apify start run failed (${startRes.status}): ${errBody}`);
  }

  const runData = await startRes.json();
  const runId = runData.data?.id;
  if (!runId) throw new Error('Apify run did not return a run ID');

  console.log(`[Apify ${model}] Started run ${runId}`);

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

  // Record usage for any terminal status (fire-and-forget)
  if (runInfo?.data) {
    recordApifyUsage(runInfo.data, model).catch(() => {});
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
    throw new Error(item?.error || `${model} returned no answer (Apify run ${runId})`);
  }

  console.log(`[Apify ${model}] Run ${runId} completed: ${item.answer.length} chars, ${item.sources?.length || 0} sources`);

  return {
    question: item.question,
    answer: item.answer,
    sources: item.sources || [],
    url: item.url || '',
    timestamp: item.timestamp || new Date().toISOString(),
    model: item.provider || model,
  };
}

// ─── Apify usage tracking ────────────────────────────────────────

let _currentContext: { analysisRunId?: number; jobId?: number } | null = null;

async function recordApifyUsage(runData: any, model: string) {
  try {
    const stats = runData.stats || {};
    const usage = runData.usageUsd || {};
    await db.insert(apifyUsage).values({
      analysisRunId: _currentContext?.analysisRunId || null,
      jobId: _currentContext?.jobId || null,
      apifyRunId: runData.id,
      model: model,
      status: runData.status,
      costUsd: runData.usageTotalUsd || null,
      durationMs: stats.durationMillis ? Math.round(stats.durationMillis) : null,
      computeUnits: stats.computeUnits || null,
      proxyGbytes: usage.PROXY_RESIDENTIAL_TRANSFER_GBYTES || null,
      memMaxBytes: stats.memMaxBytes || null,
      datasetId: runData.defaultDatasetId || null,
    });
  } catch (err) {
    console.error('[Apify] Failed to record usage:', (err as Error).message);
  }
}

// ─── Public API ──────────────────────────────────────────────────

export async function askBrowser(
  question: string,
  model: BrowserModel = 'chatgpt',
  context?: { analysisRunId?: number; jobId?: number },
): Promise<BrowserScraperResult> {
  const startTime = Date.now();
  // Check DB setting first, fall back to env var detection
  const { storage } = await import('../storage');
  const savedMode = await storage.getSetting('browserMode');
  const mode = savedMode === 'local' ? 'local' : savedMode === 'cloud' ? 'cloud' : (process.env.APIFY_TOKEN ? 'cloud' : 'local');

  console.log(`[Browser ${model}] Sending (${mode}): "${question.substring(0, 80)}..."`);

  // Pass context to cloud mode for usage tracking
  _currentContext = context || null;
  const result = mode === 'cloud'
    ? await askBrowserCloud(question, model)
    : await askBrowserLocal(question, model);
  _currentContext = null;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Browser ${model}] Done in ${elapsed}s — ${result.answer.length} chars, ${result.sources.length} sources`);

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
