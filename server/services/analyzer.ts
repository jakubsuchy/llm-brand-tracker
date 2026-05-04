import { storage } from "../storage";
import { scrapeBrandWebsite, generateTopicsFromContent, extractDomainFromUrl, extractUrlsFromText } from "./scraper";
import { setCurrentRunId } from "./llm";
import { stripTrackingParams, parseHttpUrl } from "./analysis";

// Dynamic LLM module resolver — reads analysisLlm setting to pick openai or anthropic
async function getLlmModule() {
  const { getSetting } = await import('./settings');
  const provider = await getSetting('analysisLlm') || 'openai';
  return provider === 'anthropic'
    ? await import('./anthropic')
    : await import('./openai');
}
import type {
  Analytics,
  TopicAnalysis,
  CompetitorAnalysis,
  SourceAnalysis,
  JobQueueItem,
  InsertJobQueueItem,
} from "@shared/schema";

export interface AnalysisProgress {
  status: 'initializing' | 'scraping' | 'generating_prompts' | 'testing_prompts' | 'analyzing' | 'complete' | 'error';
  message: string;
  progress: number; // 0-100
  totalPrompts?: number;
  completedPrompts?: number;
  failedCount?: number;
  runningCount?: number;
}

/**
 * Check if an analysis is currently running by looking at the DB.
 */
export async function isAnalysisRunningInDB(): Promise<boolean> {
  const latestRun = await storage.getLatestAnalysisRun();
  if (!latestRun || latestRun.status !== 'running') return false;
  const progress = await storage.getJobQueueProgress(latestRun.id);
  return progress.pending > 0 || progress.processing > 0;
}

/**
 * Cancel the current analysis run via DB.
 */
export async function cancelAnalysisRun(): Promise<void> {
  const latestRun = await storage.getLatestAnalysisRun();
  if (!latestRun || latestRun.status !== 'running') return;
  await storage.cancelJobsForRun(latestRun.id);
  await storage.completeAnalysisRun(latestRun.id, 'cancelled');
  console.log(`[${new Date().toISOString()}] Analysis run #${latestRun.id} cancelled`);
}

/**
 * Get current analysis progress from DB.
 */
export async function getAnalysisProgressFromDB(): Promise<AnalysisProgress> {
  const latestRun = await storage.getLatestAnalysisRun();
  if (!latestRun) {
    return { status: 'complete' as any, message: 'No analysis runs', progress: 0, totalPrompts: 0, completedPrompts: 0 };
  }

  if (latestRun.status === 'complete') {
    const terminalFailures = (await storage.getFailedJobs(latestRun.id)).length;
    const progress = await storage.getJobQueueProgress(latestRun.id);
    return {
      status: 'complete',
      message: terminalFailures > 0 ? `Analysis complete (${terminalFailures} failed)` : 'Analysis complete!',
      progress: 100,
      totalPrompts: latestRun.totalPrompts || 0,
      completedPrompts: progress.completed,
      failedCount: terminalFailures,
    };
  }

  if (latestRun.status === 'error' || latestRun.status === 'cancelled') {
    return { status: 'error', message: `Analysis ${latestRun.status}`, progress: 0, totalPrompts: 0, completedPrompts: 0 };
  }

  // Running — read from job queue
  const progress = await storage.getJobQueueProgress(latestRun.id);
  if (progress.total === 0) {
    return { status: 'initializing', message: 'Preparing analysis...', progress: 10, totalPrompts: 0, completedPrompts: 0 };
  }

  // Count original jobs only (no retries) for the progress denominator
  // Retries have original_job_id set, originals don't
  const terminalFailures = (await storage.getFailedJobs(latestRun.id)).length;
  // Original job count = total jobs without original_job_id
  const originalTotal = latestRun.totalPrompts || progress.total;
  const doneCount = progress.completed + terminalFailures;
  const pct = Math.round((doneCount / originalTotal) * 100);

  const parts = [`${progress.completed} done`];
  if (progress.processing > 0) parts.push(`${progress.processing} running`);
  if (terminalFailures > 0) parts.push(`${terminalFailures} failed`);

  return {
    status: 'testing_prompts',
    message: `Testing prompts... (${parts.join(', ')}/${originalTotal})`,
    progress: Math.min(pct, 99),
    totalPrompts: originalTotal,
    completedPrompts: progress.completed,
    failedCount: terminalFailures,
    runningCount: progress.processing,
  };
}

export class BrandAnalyzer {
  private brandName: string = '';
  private brandUrl: string = '';
  private analysisRunId: number | null = null;

  setBrandName(brandName: string) {
    this.brandName = brandName;
  }

  setAnalysisRunId(id: number) {
    this.analysisRunId = id;
    setCurrentRunId(id);
  }

  setBrandUrl(brandUrl: string) {
    this.brandUrl = brandUrl;
  }

  async runFullAnalysis(useExistingPrompts: boolean = false, savedPrompts?: any[], settings?: { promptsPerTopic: number; numberOfTopics: number }): Promise<void> {
    try {
      // Prevent multiple simultaneous analyses
      if (await isAnalysisRunningInDB()) {
        console.log('Analysis already running, skipping new request');
        return;
      }

      let allPrompts: any[] = [];

      if (savedPrompts && savedPrompts.length > 0) {
        console.log(`[${new Date().toISOString()}] Loading saved prompts (keeping historical data)`);

        // Deduplicate by text and mark as existing (they already have DB records)
        const seen = new Set<string>();
        allPrompts = savedPrompts.filter(p => {
          const key = p.text.toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map(p => ({ id: p.id, text: p.text, topicId: p.topicId || null, _existing: true }));
      } else if (useExistingPrompts) {
        const existingPrompts = await storage.getPrompts();
        const seen = new Set<string>();
        const uniquePrompts = existingPrompts.filter(p => {
          const key = p.text.toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        allPrompts = uniquePrompts.map(p => ({ id: p.id, text: p.text, topicId: p.topicId, _existing: true }));
      } else {
        // Scrape brand website content
        console.log(`[${new Date().toISOString()}] Scraping brand website...`);
        const content = await scrapeBrandWebsite(this.brandUrl || 'https://example.com');
        const generatedTopics = await generateTopicsFromContent(content);

        console.log(`[${new Date().toISOString()}] Generating test prompts...`);
        for (const topic of generatedTopics) {
          let topicRecord = await storage.getTopics().then(topics =>
            topics.find(t => t.name === topic.name)
          );

          if (!topicRecord) {
            topicRecord = await storage.createTopic(topic);
          }

          const promptsPerTopic = settings?.promptsPerTopic || 20;
          const llm = await getLlmModule();
          const promptTexts = await llm.generatePromptsForTopic(topic.name, topic.description, promptsPerTopic);

          for (const promptText of promptTexts) {
            allPrompts.push({
              text: promptText,
              topicId: topicRecord.id
            });
          }
        }
      }

      // Determine which models to use from settings
      let activeModels: string[] = [];

      try {
        const raw = await storage.getSetting('modelsConfig');
        const config = raw ? JSON.parse(raw) : {
          perplexity: { enabled: true, type: 'browser' },
          chatgpt: { enabled: true, type: 'browser' },
          gemini: { enabled: true, type: 'browser' },
          'google-aimode': { enabled: true, type: 'browser' },
          'openai-api': { enabled: false, type: 'api' },
          'anthropic-api': { enabled: false, type: 'api' },
        };

        const { isBrowserAvailable } = await import('./browser-actor');
        const { isOpenAiApiAvailable } = await import('./openai-api');
        const { isAnthropicApiAvailable } = await import('./anthropic-api');
        const browserAvailable = await isBrowserAvailable();

        const apiAvailability: Record<string, { ok: boolean; reason: string }> = {
          'openai-api': { ok: isOpenAiApiAvailable(), reason: 'OpenAI API key not configured' },
          'anthropic-api': { ok: isAnthropicApiAvailable(), reason: 'Anthropic API key not configured' },
        };

        for (const [name, settings] of Object.entries(config) as [string, any][]) {
          if (!settings.enabled) continue;
          if (settings.type === 'browser' && !browserAvailable) {
            console.log(`[${new Date().toISOString()}] Skipping ${name} — browser not available`);
            continue;
          }
          if (settings.type === 'api') {
            const check = apiAvailability[name];
            if (!check?.ok) {
              console.log(`[${new Date().toISOString()}] Skipping ${name} — ${check?.reason || 'API not available'}`);
              continue;
            }
          }
          activeModels.push(name);
        }
      } catch {
        console.log(`[${new Date().toISOString()}] Failed to load model config, using defaults`);
      }

      if (activeModels.length === 0) {
        throw new Error('No models available. Enable at least one model in Settings and ensure browser actor or Apify token is configured.');
      }
      activeModels = [...new Set(activeModels)];

      // Enqueue jobs
      await this.enqueueJobs(allPrompts, activeModels, this.analysisRunId!);

      const totalTasks = allPrompts.length * activeModels.length;
      const { isApiModel } = await import('./analysis');
      const hasBrowserModels = activeModels.some(m => !isApiModel(m));
      console.log(`[${new Date().toISOString()}] Enqueued: ${allPrompts.length} prompts x ${activeModels.length} models (${activeModels.join(', ')}) = ${totalTasks} tasks`);

      // Run worker loop — browser jobs run serially, API jobs can run in parallel
      await this.runWorkerLoop(this.analysisRunId!, hasBrowserModels);

      // Generate analytics
      await this.generateAnalytics();

      setCurrentRunId(null);
      console.log(`[${new Date().toISOString()}] Analysis completed successfully.`);

    } catch (error) {
      console.error("Analysis failed:", error);
      throw error;
    }
  }

  /**
   * Bulk insert one job per (prompt, model) pair.
   */
  async enqueueJobs(allPrompts: any[], activeModels: string[], analysisRunId: number): Promise<void> {
    const jobs: InsertJobQueueItem[] = [];
    for (const promptData of allPrompts) {
      for (const model of activeModels) {
        jobs.push({
          analysisRunId,
          promptId: promptData._existing && promptData.id ? promptData.id : null,
          promptText: promptData.text,
          promptTopicId: promptData.topicId || null,
          promptIsExisting: !!(promptData._existing && promptData.id),
          model: model,
          status: 'pending',
          attempts: 0,
          maxAttempts: process.env.APIFY_TOKEN ? 100 : 10,
          lastError: null,
        });
      }
    }

    await storage.enqueueJobs(jobs);

    // Update total_prompts on the analysis run
    await storage.updateAnalysisRunProgress(analysisRunId, 0);
    // We use a raw approach to set totalPrompts since updateAnalysisRunProgress only sets completedPrompts
    const { db } = await import("../db");
    const { analysisRuns } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(analysisRuns).set({ totalPrompts: jobs.length }).where(eq(analysisRuns.id, analysisRunId));
  }

  /**
   * Spawn worker promises that poll the job queue.
   * Browser jobs run serially (concurrency 1), API jobs can run in parallel.
   */
  async runWorkerLoop(analysisRunId: number, hasBrowserModels: boolean = false): Promise<void> {
    // Cloud: all jobs fire in parallel (each is an independent Apify run).
    // Local browser: serial (single browser instance). API: 3 concurrent.
    const isCloud = !!process.env.APIFY_TOKEN;
    const concurrency = isCloud ? 30 : (hasBrowserModels ? 1 : 3);
    const POLL_INTERVAL_MS = 500;
    const STALL_TIMEOUT_MS = 300000; // 5 minutes

    let lastStallCheck = Date.now();

    const workers = Array.from({ length: concurrency }, async (_, workerIdx) => {
      let idleCount = 0;
      while (true) {
        // Periodic stall recovery — worker 0 checks every 2 minutes
        if (workerIdx === 0 && Date.now() - lastStallCheck > 120000) {
          lastStallCheck = Date.now();
          const recovered = await storage.recoverStalledJobs(STALL_TIMEOUT_MS);
          if (recovered > 0) {
            console.log(`[${new Date().toISOString()}] Recovered ${recovered} stalled jobs`);
          }
        }

        // Check for cancellation
        const latestRun = await storage.getLatestAnalysisRun();
        if (!latestRun || latestRun.status === 'cancelled' || latestRun.status === 'error') {
          console.log(`[${new Date().toISOString()}] Worker ${workerIdx}: run status is ${latestRun?.status}, exiting`);
          break;
        }

        const job = await storage.dequeueJob(analysisRunId);
        if (!job) {
          // Small delay before checking — allow any in-flight failJob to create retry jobs
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

          // Check if we should exit: no pending and no processing jobs
          const progress = await storage.getJobQueueProgress(analysisRunId);
          if (progress.pending === 0 && progress.processing === 0) {
            console.log(`[${new Date().toISOString()}] Worker ${workerIdx}: no more jobs, exiting`);
            break;
          }
          // Other workers are processing — wait and retry
          idleCount++;
          if (idleCount * POLL_INTERVAL_MS > STALL_TIMEOUT_MS) {
            console.log(`[${new Date().toISOString()}] Worker ${workerIdx}: stall timeout exceeded, exiting`);
            break;
          }
          continue;
        }

        idleCount = 0; // Reset idle counter on successful dequeue

        try {
          await this.processJob(job);
          await storage.completeJob(job.id);
        } catch (error: any) {
          const isQuota = error?.code === 'insufficient_quota' || error?.type === 'insufficient_quota';
          const isAborted = error?.message?.startsWith('ABORTED:');
          const isBusy = error?.message?.includes('(429)') || error?.message?.includes('busy');
          // Retry everything except quota and aborted errors
          const shouldRetry = !isQuota && !isAborted;
          await storage.failJob(job.id, error.message || 'Unknown error', shouldRetry, isBusy);
          console.error(`[${new Date().toISOString()}] Worker ${workerIdx}: job ${job.id} failed: ${error.message?.substring(0, 200)}`);

          if (shouldRetry && isCloud) {
            const backoff = 60000 + Math.random() * 30000;
            console.log(`[${new Date().toISOString()}] Worker ${workerIdx}: backing off ${Math.round(backoff / 1000)}s before next job`);
            await new Promise(resolve => setTimeout(resolve, backoff));
          } else if (shouldRetry && isBusy) {
            console.log(`[${new Date().toISOString()}] Worker ${workerIdx}: browser busy, waiting 10s`);
            await new Promise(resolve => setTimeout(resolve, 10000));
          }
        }

        // Update run progress
        const queueProgress = await storage.getJobQueueProgress(analysisRunId);
        const completedCount = queueProgress.completed + queueProgress.failed;
        await storage.updateAnalysisRunProgress(analysisRunId, completedCount);
      }
    });

    await Promise.all(workers);
  }

  /**
   * Process a single job: fetch response from model, analyze, save to DB.
   */
  private async processJob(job: JobQueueItem): Promise<void> {
    const { model, promptText, promptId, promptIsExisting, promptTopicId } = job;
    const analysisRunId = job.analysisRunId;

    console.log(`[${new Date().toISOString()}] [${model}] Processing job ${job.id}: ${promptText.substring(0, 50)}...`);

    // Resolve prompt record
    let prompt: { id: number; text: string; topicId: number | null };
    if (promptIsExisting && promptId) {
      prompt = { id: promptId, text: promptText, topicId: promptTopicId };
    } else {
      const created = await storage.createPrompt({ text: promptText, topicId: promptTopicId });
      prompt = { id: created.id, text: created.text, topicId: created.topicId };
      // Update the job's promptId for reference (fire-and-forget)
    }

    // Get response from LLM
    const knownCompetitors = (await storage.getCompetitors()).map(c => c.name);
    const llm = await getLlmModule();
    const analysis = await llm.analyzePromptResponse(promptText, this.brandName, knownCompetitors, model, { analysisRunId, jobId: job.id });

    // Empty response text = scraping/API failure, not a valid "brand not
    // mentioned" outcome. Treat it as a job failure so the existing retry
    // chain re-runs the prompt instead of persisting a misleading 0% data
    // point. Browser models (chatgpt, perplexity) drop responses
    // intermittently — historically ~18% of chatgpt rows were empty.
    if (!analysis.response || analysis.response.trim().length === 0) {
      throw new Error(`Empty response from ${model || 'unknown model'} — treating as failure so the job retries`);
    }

    // Process competitors
    const brandLower = (this.brandName || '').toLowerCase();
    const knownCompetitorRecords = await storage.getCompetitors();

    const blocklistSetting = await storage.getSetting('competitorBlocklist');
    const defaultBlocklist = ['g2.com', 'reddit.com', 'facebook.com', 'gartner.com', 'idc.com'];
    const blocklist = new Set(
      (blocklistSetting ? blocklistSetting.split(',') : defaultBlocklist)
        .map(s => s.trim().toLowerCase()).filter(Boolean)
    );
    // brandDomains is the user's explicit "this is the brand's domain" list
    // (set via "Mark as Brand" in the UI). The auto-stamper below must
    // refuse to stamp these as competitor.domain bindings.
    const brandDomainsSetting = await storage.getSetting('brandDomains');
    const brandDomainsSet = new Set(
      (brandDomainsSetting || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    );

    const filteredCompetitors: string[] = [];
    for (const name of analysis.competitors) {
      const nameLower = name.toLowerCase();
      if (brandLower && (nameLower.includes(brandLower) || brandLower.includes(nameLower))) continue;
      if (blocklist.has(nameLower) || [...blocklist].some(b => {
        const bBase = b.replace(/\.com$|\.org$|\.io$|\.net$/, '');
        return nameLower === bBase || nameLower.includes(bBase) || bBase.includes(nameLower);
      })) continue;

      const existingMatch = knownCompetitorRecords.find(c =>
        c.name.toLowerCase().startsWith(nameLower + ' ') ||
        c.name.toLowerCase().startsWith(nameLower + '-')
      );
      if (existingMatch) {
        filteredCompetitors.push(existingMatch.name);
      } else if (name.length >= 2) {
        filteredCompetitors.push(name);
      }
    }

    const uniqueCompetitors = [...new Set(filteredCompetitors)];

    // Resolve competitor records
    const resolvedCompetitors: { name: string; id: number }[] = [];
    for (const competitorName of uniqueCompetitors) {
      try {
        let competitor = await storage.getCompetitorByName(competitorName);
        if (!competitor) {
          competitor = await storage.createCompetitor({
            name: competitorName,
            category: await (await getLlmModule()).categorizeCompetitor(competitorName, this.brandName),
            mentionCount: 0
          });
        }
        resolvedCompetitors.push({ name: competitor.name, id: competitor.id });
      } catch (error) {
        console.error(`Error resolving competitor ${competitorName}:`, error);
      }
    }

    // Process sources. Strip utm/click-tracking params at the storage boundary
    // so display URLs in sources.urls and responses.sources stay clean and
    // collapse correctly across runs (e.g. ?utm_source=openai variants).
    // Also drop anything that isn't http(s) — `responses.sources` is later
    // rendered as `<a href>`, and a `javascript:` URL there is a stored-XSS
    // sink. The client side has a matching guard (`safeHttpHref`).
    const isHttp = (u: string) => parseHttpUrl(u) !== null;
    const responseUrls = extractUrlsFromText(analysis.response).map(stripTrackingParams).filter(isHttp);
    const analysisSources = (analysis.sources || []).map(stripTrackingParams).filter(isHttp);
    const allUrls = Array.from(new Set([...responseUrls, ...analysisSources]));

    const urlsByDomain = new Map<string, string[]>();
    for (const url of allUrls) {
      try {
        const domain = extractDomainFromUrl(url);
        if (!domain || domain.length < 3 || domain === 'example.com' || domain === 'localhost') continue;
        if (!urlsByDomain.has(domain)) urlsByDomain.set(domain, []);
        urlsByDomain.get(domain)!.push(url);
      } catch {}
    }

    for (const [domain, urls] of urlsByDomain) {
      try {
        const primaryUrl = urls.find((u: string) =>
          u.includes('/docs') || u.includes('/api') || u.includes('/developer') || u.includes('/guide') || u.includes('/tutorial')
        ) || urls[0];

        let source = await storage.getSourceByDomain(domain);
        if (!source) {
          source = await storage.createSource({
            domain,
            url: primaryUrl,
            citationCount: 0
          });
        }
        await storage.addSourceUrls(domain, urls, analysisRunId || undefined, model);
        await storage.updateSourceCitationCount(domain, 1);

        // Strip well-known subdomain prefixes BEFORE deriving the base label.
        // Without this, "en.wikipedia.org" yields domainBase="en", which then
        // substring-matched any competitor name containing "en" — silently
        // stamping en.wikipedia.org as the website for OpenResty, Telenor,
        // Cequence, Azure OpenAI, etc. Same pattern blew up cloud.google.com
        // (domainBase="cloud" matched "Cloudflare X") and others.
        // Same list as competitorSubdomains default in sources.ts classifier.
        const KNOWN_SUBDOMAIN_PREFIXES = new Set([
          'www', 'en', 'fr', 'de', 'es', 'ja', 'zh', 'ru', 'pt', 'it', 'ko',
          'blog', 'docs', 'doc', 'support', 'learn', 'help', 'developer', 'developers', 'api', 'm',
        ]);
        const labels = domain.toLowerCase().split('.');
        const stripped = labels.length >= 3 && KNOWN_SUBDOMAIN_PREFIXES.has(labels[0]) ? labels.slice(1) : labels;
        const domainBase = stripped[0];
        // Respect the user's explicit classifications. Without these guards,
        // the next analysis run re-stamps competitor.domain on a domain the
        // user just marked as "neutral" (in blocklist) or "brand" — silently
        // reverting their decision. This was the recurring bug behind the
        // honeycomb.io issue: reclassify-route fix alone wasn't enough.
        const domainLower = domain.toLowerCase();
        const strippedDomain = stripped.join('.');
        const userClassified =
          blocklist.has(domainLower) || blocklist.has(strippedDomain) ||
          brandDomainsSet.has(domainLower) || brandDomainsSet.has(strippedDomain);
        if (domainBase && !userClassified) {
          for (const comp of resolvedCompetitors) {
            if (!comp.name) continue;
            // Exact match only — substring matching here is what caused the
            // wrong-domain pile-ups above. We accept either: any whitespace-
            // split name word equals the registrable base ("AWS Application
            // Load Balancer" → "aws.amazon.com" via "aws"), OR the whole
            // name with spaces removed equals it ("A10 Networks" →
            // "a10networks.com" via "a10networks").
            const nameLower = comp.name.toLowerCase();
            const compWords = nameLower.split(/\s+/);
            const nameNoSpace = nameLower.replace(/\s+/g, '');
            if (compWords.some(w => w === domainBase) || nameNoSpace === domainBase) {
              await storage.updateCompetitorDomain(comp.id, domain);
            }
          }
        }
      } catch {}
    }

    // Create response record
    const responseRecord = await storage.createResponse({
      promptId: prompt.id,
      analysisRunId,
      model: model || analysis.model || null,
      text: analysis.response,
      brandMentioned: analysis.brandMentioned,
      competitorsMentioned: uniqueCompetitors.map(name => {
        const resolved = resolvedCompetitors.find(r => r.name.toLowerCase() === name.toLowerCase());
        return resolved?.name || name;
      }),
      // Persist the union of structured citations (from analysis.sources) and
      // URLs extracted from the response body. Previously responses.sources
      // only held the structured set, which made inline-cited URLs invisible
      // to the Source Pages aggregation (it reads from this array). The
      // source_urls table already stored the union, so this brings the two
      // back into agreement.
      sources: allUrls,
    });

    // Create competitor mention records + log identification source
    for (const comp of resolvedCompetitors) {
      try {
        await storage.createCompetitorMention({
          competitorId: comp.id,
          analysisRunId,
          responseId: responseRecord.id,
        });
        const source = analysis.competitorSources?.get(comp.name.toLowerCase()) || 'unknown';
        console.log(`[Competitor] "${comp.name}" (id=${comp.id}) found by ${source} in response #${responseRecord.id} [${model}]`);
      } catch {}
    }

    console.log(`[${new Date().toISOString()}] [${model}] Completed job ${job.id}`);
  }



  async generateAnalytics(): Promise<Analytics> {
    const responses = await storage.getResponsesWithPrompts();
    const competitors = await storage.getCompetitors();
    const sources = await storage.getSources();

    const brandMentions = responses.filter(r => r.brandMentioned).length;
    const brandMentionRate = responses.length > 0 ? (brandMentions / responses.length) * 100 : 0;

    const topCompetitor = competitors
      .sort((a, b) => (b.mentionCount || 0) - (a.mentionCount || 0))[0]?.name || null;

    const uniqueDomains = new Set(sources.map(s => s.domain)).size;

    return await storage.createAnalytics({
      totalPrompts: responses.length,
      brandMentionRate,
      topCompetitor,
      totalSources: sources.length,
      totalDomains: uniqueDomains
    });
  }

  async getOverviewMetrics() {
    const allResponses = await storage.getResponsesWithPrompts();
    const competitorAnalysis = await storage.getCompetitorAnalysis();
    const sourceAnalysis = await storage.getSourceAnalysis();

    const brandMentions = allResponses.filter(r => r.brandMentioned).length;
    const brandMentionRate = allResponses.length > 0 ? (brandMentions / allResponses.length) * 100 : 0;

    const topCompetitor = competitorAnalysis
      .sort((a, b) => b.mentionCount - a.mentionCount)[0];

    const uniqueDomains = new Set(sourceAnalysis.map(s => s.domain)).size;

    return {
      brandMentionRate,
      totalPrompts: allResponses.length,
      topCompetitor: topCompetitor?.name || 'N/A',
      totalSources: sourceAnalysis.length,
      totalDomains: uniqueDomains
    };
  }

  async getTopicAnalysis(): Promise<TopicAnalysis[]> {
    return await storage.getTopicAnalysis();
  }

  async getCompetitorAnalysis(): Promise<CompetitorAnalysis[]> {
    return await storage.getCompetitorAnalysis();
  }

  async getSourceAnalysis(): Promise<SourceAnalysis[]> {
    return await storage.getSourceAnalysis();
  }
}

export const analyzer = new BrandAnalyzer();
