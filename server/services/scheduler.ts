import * as schedule from 'node-schedule';
import { storage } from '../storage';
import { isAnalysisRunningInDB } from './analyzer';
import { getSetting, setSetting } from './settings';

export type ScheduleFrequency = 'manual' | 'hourly' | 'daily' | 'weekly' | 'monthly';

const CRON_RULES: Record<Exclude<ScheduleFrequency, 'manual'>, string> = {
  hourly: '0 * * * *',       // top of every hour
  daily: '0 3 * * *',        // 3 AM every day
  weekly: '0 3 * * 1',       // 3 AM every Monday
  monthly: '0 3 1 * *',      // 3 AM 1st of month
};

let currentJob: schedule.Job | null = null;
let expirationInterval: ReturnType<typeof setInterval> | null = null;
// launchAnalysis is set via setLauncher() from routes.ts to avoid circular imports
let launchFn: (() => Promise<string>) | null = null;

export function setLauncher(fn: () => Promise<string>) {
  launchFn = fn;
}

/**
 * Read the saved schedule frequency from DB and set up the cron job.
 */
export async function initScheduler(): Promise<void> {
  const freq = (await getSetting('analysisSchedule') as ScheduleFrequency) || 'manual';
  updateSchedule(freq);
  initExpirationWatchdog();
  console.log(`[SCHEDULER] Initialized with frequency: ${freq}`);
}

/**
 * Update the schedule. Cancels any existing job and creates a new one if not manual.
 */
export function updateSchedule(frequency: ScheduleFrequency): void {
  if (currentJob) {
    currentJob.cancel();
    currentJob = null;
  }

  if (frequency === 'manual') return;

  const rule = CRON_RULES[frequency];
  currentJob = schedule.scheduleJob(rule, async () => {
    console.log(`[SCHEDULER] Tick — frequency=${frequency}`);
    try {
      if (await isAnalysisRunningInDB()) {
        console.log('[SCHEDULER] Analysis already running, skipping scheduled run');
        return;
      }
      if (!launchFn) {
        console.error('[SCHEDULER] No launch function registered');
        return;
      }
      const sessionId = await launchFn();
      console.log(`[SCHEDULER] Started scheduled analysis: ${sessionId}`);
    } catch (error) {
      console.error('[SCHEDULER] Failed to start scheduled analysis:', error);
    }
  });
}

/**
 * Get the next scheduled invocation time, or null if manual/no job.
 */
export function getNextRunTime(): Date | null {
  if (!currentJob) return null;
  const next = currentJob.nextInvocation();
  return next ? new Date(next.getTime()) : null;
}

/**
 * Every 10 minutes, check for analysis runs stuck longer than 24 hours and expire them.
 */
function initExpirationWatchdog(): void {
  if (expirationInterval) clearInterval(expirationInterval);

  const check = async () => {
    try {
      const runs = await storage.getAnalysisRuns();
      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;

      for (const run of runs) {
        if (run.status !== 'running') continue;
        if (!run.startedAt) continue;
        const elapsed = now - new Date(run.startedAt).getTime();
        if (elapsed > twentyFourHours) {
          console.log(`[WATCHDOG] Analysis run #${run.id} exceeded 24h (${Math.round(elapsed / 3600000)}h), expiring`);
          await storage.cancelJobsForRun(run.id);
          await storage.completeAnalysisRun(run.id, 'error');
          const { fireWebhook } = await import('./webhook');
          fireWebhook(run.id, 'error');
        }
      }
    } catch (error) {
      console.error('[WATCHDOG] Error checking for expired runs:', error);
    }
  };

  // Run immediately on startup, then every 10 minutes
  check();
  expirationInterval = setInterval(check, 10 * 60 * 1000);
}
