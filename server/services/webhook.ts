import { storage } from '../storage';

interface WebhookConfig {
  url: string;
  authType: 'none' | 'bearer';
  token?: string;
}

interface WebhookPayload {
  event: 'analysis.completed' | 'analysis.failed';
  runId: number;
  startedAt: string | null;
  completedAt: string | null;
  responseCount: number;
  brandMentionedRate: number;
  brandMentions: number;
}

async function getWebhookConfig(): Promise<WebhookConfig | null> {
  const raw = await storage.getSetting('webhookConfig');
  if (!raw) return null;
  try {
    const config = JSON.parse(raw) as WebhookConfig;
    if (!config.url) return null;
    return config;
  } catch {
    return null;
  }
}

/**
 * Fire webhook asynchronously after analysis completes.
 * Never throws — logs errors and moves on so it doesn't block callers.
 */
export async function fireWebhook(runId: number, status: 'complete' | 'error'): Promise<void> {
  try {
    const config = await getWebhookConfig();
    if (!config) return;

    // Gather run data
    const run = await storage.getLatestAnalysisRun();
    if (!run || run.id !== runId) return;

    const progress = await storage.getJobQueueProgress(runId);
    const responseCount = progress.completed;

    // Count brand mentions from responses
    const responses = await storage.getResponsesWithPrompts(runId);
    const brandMentions = responses.filter(r => r.brandMentioned).length;
    const brandMentionedRate = responseCount > 0 ? brandMentions / responseCount : 0;

    const payload: WebhookPayload = {
      event: status === 'complete' ? 'analysis.completed' : 'analysis.failed',
      runId,
      startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
      completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
      responseCount,
      brandMentionedRate: Math.round(brandMentionedRate * 10000) / 10000,
      brandMentions,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.authType === 'bearer' && config.token) {
      headers['Authorization'] = `Bearer ${config.token}`;
    }

    const res = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.error(`[WEBHOOK] POST ${config.url} returned ${res.status}`);
    } else {
      console.log(`[WEBHOOK] Delivered run #${runId} (${status}) to ${config.url}`);
    }
  } catch (error) {
    console.error('[WEBHOOK] Failed to fire webhook:', error);
  }
}
