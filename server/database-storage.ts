import {
  Topic, InsertTopic,
  Prompt, InsertPrompt, PromptWithTopic,
  Response, InsertResponse, ResponseWithPrompt,
  Competitor, InsertCompetitor,
  InsertCompetitorMention,
  Source, InsertSource,
  Analytics, InsertAnalytics,
  AnalysisRun, InsertAnalysisRun,
  TopicAnalysis, CompetitorAnalysis, SourceAnalysis,
  MergeSuggestion, MergeHistoryEntry,
  JobQueueItem, InsertJobQueueItem, JobQueueProgress,
  topics, prompts, responses, competitors, competitorMentions, competitorMerges, sources, sourceUrls, analytics, analysisRuns, appSettings, jobQueue, apiUsage
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, count, sql, isNull, and, gte, lte } from "drizzle-orm";
import { IStorage } from "./storage";

export class DatabaseStorage implements IStorage {
  constructor() {
    this.initializeBasicData();
  }

  private async initializeBasicData() {
    // Check if topics exist, if not initialize them
    const existingTopics = await this.getTopics();
    if (existingTopics.length === 0) {
      await this.initializeTopics();
      await this.initializeCompetitors();
      await this.initializeSources();
    }
  }

  private async initializeTopics() {
    // Don't pre-populate topics - they will be created dynamically during analysis
    // This makes the system flexible and based on actual analysis needs
  }

  private async initializeCompetitors() {
    // Don't pre-populate competitors - they will be discovered during analysis
    // This makes the system dynamic and based on actual analysis results
  }

  private async initializeSources() {
    // Initialize with empty sources - they'll be populated during analysis
  }

  // Topics
  async getTopics(): Promise<Topic[]> {
    return await db.select().from(topics).where(sql`${topics.deleted} = false OR ${topics.deleted} IS NULL`);
  }

  async createTopic(topic: InsertTopic): Promise<Topic> {
    const [created] = await db.insert(topics).values(topic).returning();
    return created;
  }

  async getTopicById(id: number): Promise<Topic | undefined> {
    const [topic] = await db.select().from(topics).where(eq(topics.id, id));
    return topic || undefined;
  }

  async softDeleteTopic(id: number): Promise<void> {
    await db.update(topics).set({ deleted: true }).where(eq(topics.id, id));
    // Also soft-delete all prompts in this topic
    await db.update(prompts).set({ deleted: true }).where(eq(prompts.topicId, id));
  }

  // Prompts
  async getPrompts(): Promise<Prompt[]> {
    return await db.select().from(prompts).where(sql`${prompts.deleted} = false OR ${prompts.deleted} IS NULL`);
  }

  async softDeletePrompt(id: number): Promise<void> {
    await db.update(prompts).set({ deleted: true }).where(eq(prompts.id, id));
  }

  async updateCompetitorDomain(id: number, domain: string): Promise<void> {
    // Only set if not already set — first match wins
    const [comp] = await db.select().from(competitors).where(eq(competitors.id, id));
    if (comp && !comp.domain) {
      await db.update(competitors).set({ domain }).where(eq(competitors.id, id));
    }
  }

  async createPrompt(prompt: InsertPrompt): Promise<Prompt> {
    const [created] = await db.insert(prompts).values(prompt).returning();
    return created;
  }

  async getPromptById(id: number): Promise<Prompt | undefined> {
    const [prompt] = await db.select().from(prompts).where(eq(prompts.id, id));
    return prompt || undefined;
  }

  async getPromptsWithTopics(): Promise<PromptWithTopic[]> {
    const results = await db
      .select()
      .from(prompts)
      .leftJoin(topics, eq(prompts.topicId, topics.id));
    
    return results.map(result => ({
      ...result.prompts,
      topic: result.topics
    }));
  }

  async getPromptsByTopic(topicId: number): Promise<Prompt[]> {
    return await db.select().from(prompts).where(eq(prompts.topicId, topicId));
  }

  // Responses
  async getResponses(): Promise<Response[]> {
    return await db.select().from(responses);
  }

  async createResponse(response: InsertResponse): Promise<Response> {
    const [created] = await db.insert(responses).values(response).returning();
    return created;
  }

  async getResponseById(id: number): Promise<Response | undefined> {
    const [response] = await db.select().from(responses).where(eq(responses.id, id));
    return response || undefined;
  }

  async getResponsesWithPrompts(runId?: number, from?: Date, to?: Date): Promise<ResponseWithPrompt[]> {
    let query = db
      .select()
      .from(responses)
      .leftJoin(prompts, eq(responses.promptId, prompts.id))
      .leftJoin(topics, eq(prompts.topicId, topics.id));

    if (runId) {
      const results = await query.where(eq(responses.analysisRunId, runId));
      return results.map(result => ({
        ...result.responses,
        prompt: { ...result.prompts!, topic: result.topics }
      }));
    }

    // All completed runs, optionally filtered by date range
    const conditions = [eq(analysisRuns.status, 'complete')];
    if (from) conditions.push(gte(analysisRuns.completedAt, from));
    if (to) conditions.push(lte(analysisRuns.completedAt, to));

    const results = await query
      .innerJoin(analysisRuns, eq(responses.analysisRunId, analysisRuns.id))
      .where(and(...conditions));

    return results.map(result => ({
      ...result.responses,
      prompt: { ...result.prompts!, topic: result.topics }
    }));
  }

  async getRecentResponses(limit = 10, runId?: number, from?: Date, to?: Date): Promise<ResponseWithPrompt[]> {
    let query = db
      .select()
      .from(responses)
      .leftJoin(prompts, eq(responses.promptId, prompts.id))
      .leftJoin(topics, eq(prompts.topicId, topics.id))
      .orderBy(desc(responses.createdAt));

    let filtered;
    if (runId) {
      filtered = limit > 1000 ? query.where(eq(responses.analysisRunId, runId)) : query.where(eq(responses.analysisRunId, runId)).limit(limit);
    } else {
      const conditions = [eq(analysisRuns.status, 'complete')];
      if (from) conditions.push(gte(analysisRuns.completedAt, from));
      if (to) conditions.push(lte(analysisRuns.completedAt, to));
      const joined = query
        .innerJoin(analysisRuns, eq(responses.analysisRunId, analysisRuns.id))
        .where(and(...conditions));
      filtered = limit > 1000 ? joined : joined.limit(limit);
    }
    const results = await filtered;

    return results.map(result => ({
      ...result.responses,
      prompt: { ...result.prompts!, topic: result.topics }
    }));
  }

  // Competitors
  async getCompetitors(): Promise<Competitor[]> {
    return await db.select().from(competitors).where(isNull(competitors.mergedInto));
  }

  async getAllCompetitorsIncludingMerged(): Promise<Competitor[]> {
    return await db.select().from(competitors);
  }

  async createCompetitor(competitor: InsertCompetitor): Promise<Competitor> {
    const nameKey = competitor.name.toLowerCase().trim();
    try {
      const [created] = await db.insert(competitors)
        .values({ ...competitor, nameKey })
        .returning();
      return created;
    } catch (error: any) {
      // Unique constraint violation on name_key — return existing
      if (error?.code === '23505') {
        const existing = await this.getCompetitorByName(competitor.name);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async getCompetitorByName(name: string): Promise<Competitor | undefined> {
    const [competitor] = await db.select().from(competitors)
      .where(eq(competitors.nameKey, name.toLowerCase().trim()));
    return competitor || undefined;
  }

  async updateCompetitorMentionCount(name: string, increment: number): Promise<void> {
    await db
      .update(competitors)
      .set({ mentionCount: sql`${competitors.mentionCount} + ${increment}` })
      .where(eq(competitors.nameKey, name.toLowerCase().trim()));
  }

  // Sources
  async getSources(): Promise<Source[]> {
    return await db.select().from(sources);
  }

  async createSource(source: InsertSource): Promise<Source> {
    const [created] = await db.insert(sources).values(source).returning();
    return created;
  }

  async getSourceByDomain(domain: string): Promise<Source | undefined> {
    const [source] = await db.select().from(sources).where(eq(sources.domain, domain));
    return source || undefined;
  }

  async updateSourceCitationCount(domain: string, increment: number): Promise<void> {
    await db
      .update(sources)
      .set({ citationCount: sql`${sources.citationCount} + ${increment}` })
      .where(eq(sources.domain, domain));
  }

  async addSourceUrls(domain: string, urls: string[], analysisRunId?: number, model?: string): Promise<void> {
    const source = await this.getSourceByDomain(domain);
    if (!source) return;
    for (const url of urls) {
      await db.insert(sourceUrls).values({ sourceId: source.id, url, analysisRunId: analysisRunId || null, model: model || null });
    }
  }

  async getSourceUrlsBySourceId(sourceId: number, analysisRunId?: number, model?: string): Promise<string[]> {
    let condition = analysisRunId
      ? sql`${sourceUrls.sourceId} = ${sourceId} AND ${sourceUrls.analysisRunId} = ${analysisRunId}`
      : sql`${sourceUrls.sourceId} = ${sourceId}`;
    if (model) {
      condition = analysisRunId
        ? sql`${sourceUrls.sourceId} = ${sourceId} AND ${sourceUrls.analysisRunId} = ${analysisRunId} AND ${sourceUrls.model} = ${model}`
        : sql`${sourceUrls.sourceId} = ${sourceId} AND ${sourceUrls.model} = ${model}`;
    }
    const rows = await db
      .select({ url: sourceUrls.url })
      .from(sourceUrls)
      .where(condition);
    // Deduplicate
    return [...new Set(rows.map(r => r.url))];
  }

  // Competitor mentions
  async createCompetitorMention(mention: InsertCompetitorMention): Promise<void> {
    await db.insert(competitorMentions).values(mention);
  }

  async getCompetitorAnalysisByRun(runId: number) {
    const result = await db.execute(sql`
      SELECT
        COALESCE(c.merged_into, cm.competitor_id) as competitor_id,
        primary_c.name as name,
        primary_c.category as category,
        COUNT(*) as mention_count
      FROM competitor_mentions cm
      JOIN competitors c ON cm.competitor_id = c.id
      JOIN competitors primary_c ON primary_c.id = COALESCE(c.merged_into, cm.competitor_id)
      WHERE cm.analysis_run_id = ${runId}
      GROUP BY COALESCE(c.merged_into, cm.competitor_id), primary_c.name, primary_c.category
    `);

    const rows = (result as any).rows ?? result;
    return (rows as any[]).map(r => ({
      competitorId: Number(r.competitor_id),
      name: r.name as string,
      category: r.category as string | null,
      mentionCount: Number(r.mention_count),
    }));
  }

  async getCompetitorAnalysisAllRuns(from?: Date, to?: Date) {
    const dateFilter = from && to
      ? sql`AND ar.completed_at >= ${from} AND ar.completed_at <= ${to}`
      : from
        ? sql`AND ar.completed_at >= ${from}`
        : to
          ? sql`AND ar.completed_at <= ${to}`
          : sql``;

    const result = await db.execute(sql`
      SELECT
        COALESCE(c.merged_into, cm.competitor_id) as competitor_id,
        primary_c.name as name,
        primary_c.category as category,
        COUNT(*) as mention_count
      FROM competitor_mentions cm
      JOIN competitors c ON cm.competitor_id = c.id
      JOIN competitors primary_c ON primary_c.id = COALESCE(c.merged_into, cm.competitor_id)
      JOIN analysis_runs ar ON cm.analysis_run_id = ar.id
      WHERE ar.status = 'complete' ${dateFilter}
      GROUP BY COALESCE(c.merged_into, cm.competitor_id), primary_c.name, primary_c.category
    `);

    const rows = (result as any).rows ?? result;
    return (rows as any[]).map(r => ({
      competitorId: Number(r.competitor_id),
      name: r.name as string,
      category: r.category as string | null,
      mentionCount: Number(r.mention_count),
    }));
  }

  // Analysis runs
  async createAnalysisRun(run: InsertAnalysisRun): Promise<AnalysisRun> {
    const [record] = await db.insert(analysisRuns).values(run).returning();
    return record;
  }

  async completeAnalysisRun(id: number, status: string): Promise<void> {
    await db.update(analysisRuns).set({ status, completedAt: new Date() }).where(eq(analysisRuns.id, id));
  }

  async getAnalysisRuns(from?: Date, to?: Date): Promise<AnalysisRun[]> {
    if (from || to) {
      const conditions = [];
      if (from) conditions.push(gte(analysisRuns.completedAt, from));
      if (to) conditions.push(lte(analysisRuns.completedAt, to));
      return await db.select().from(analysisRuns).where(and(...conditions)).orderBy(desc(analysisRuns.startedAt));
    }
    return await db.select().from(analysisRuns).orderBy(desc(analysisRuns.startedAt));
  }

  async getLatestAnalysisRun(): Promise<AnalysisRun | undefined> {
    const [run] = await db.select().from(analysisRuns).orderBy(desc(analysisRuns.startedAt)).limit(1);
    return run || undefined;
  }

  async updateAnalysisRunProgress(id: number, completedPrompts: number): Promise<void> {
    await db.update(analysisRuns).set({ completedPrompts }).where(eq(analysisRuns.id, id));
  }

  // Settings
  async getSetting(key: string): Promise<string | null> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const existing = await this.getSetting(key);
    if (existing !== null) {
      await db.update(appSettings).set({ value }).where(eq(appSettings.key, key));
    } else {
      await db.insert(appSettings).values({ key, value });
    }
  }

  // Analytics
  async getLatestAnalytics(): Promise<Analytics | undefined> {
    const [latestAnalytics] = await db
      .select()
      .from(analytics)
      .orderBy(desc(analytics.date))
      .limit(1);
    return latestAnalytics || undefined;
  }

  async createAnalytics(analyticsData: InsertAnalytics): Promise<Analytics> {
    const [created] = await db.insert(analytics).values(analyticsData).returning();
    return created;
  }

  // Analysis methods
  async getTopicAnalysis(): Promise<TopicAnalysis[]> {
    const results = await db
      .select({
        topicId: topics.id,
        topicName: topics.name,
        totalPrompts: count(prompts.id),
        brandMentions: sql<number>`count(case when ${responses.brandMentioned} = true then 1 end)`,
      })
      .from(topics)
      .leftJoin(prompts, eq(topics.id, prompts.topicId))
      .leftJoin(responses, eq(prompts.id, responses.promptId))
      .groupBy(topics.id, topics.name);

    return results.map(result => ({
      topicId: result.topicId,
      topicName: result.topicName,
      totalPrompts: result.totalPrompts,
      brandMentions: result.brandMentions,
      mentionRate: result.totalPrompts > 0 ? (result.brandMentions / result.totalPrompts) * 100 : 0
    }));
  }

  async getCompetitorAnalysis(): Promise<CompetitorAnalysis[]> {
    const competitorList = await this.getCompetitors();
    const totalResponses = (await this.getResponses()).length;

    return competitorList.map(competitor => ({
      competitorId: competitor.id,
      name: competitor.name,
      category: competitor.category,
      mentionCount: competitor.mentionCount || 0,
      mentionRate: totalResponses > 0 ? ((competitor.mentionCount || 0) / totalResponses) * 100 : 0,
      changeRate: 0 // This would need historical data to calculate
    }));
  }

  async getSourceAnalysis(): Promise<SourceAnalysis[]> {
    const sourceList = await this.getSources();
    return await Promise.all(sourceList.map(async source => {
      const urls = await this.getSourceUrlsBySourceId(source.id);
      return {
        sourceId: source.id,
        domain: source.domain,
        citationCount: source.citationCount || 0,
        urls: urls.length > 0 ? urls : [source.url]
      };
    }));
  }

  // Latest analysis results only
  async getLatestResponses(): Promise<ResponseWithPrompt[]> {
    return await this.getRecentResponses(1000); // Increased from 50 to 1000
  }

  async getLatestPrompts(): Promise<Prompt[]> {
    return await db.select().from(prompts).orderBy(desc(prompts.createdAt));
  }

  // Competitor merging
  async mergeCompetitors(primaryId: number, absorbedIds: number[]): Promise<number> {
    // Validate primary exists and is not itself merged
    const [primary] = await db.select().from(competitors).where(eq(competitors.id, primaryId));
    if (!primary) throw new Error('Primary competitor not found');
    if (primary.mergedInto) throw new Error('Primary competitor is itself merged into another');

    let count = 0;
    for (const absorbedId of absorbedIds) {
      if (absorbedId === primaryId) continue;
      await db.update(competitors).set({ mergedInto: primaryId }).where(eq(competitors.id, absorbedId));
      // Also re-point anything merged into the absorbed competitor to the new primary
      await db.update(competitors).set({ mergedInto: primaryId }).where(eq(competitors.mergedInto, absorbedId));
      await db.insert(competitorMerges).values({
        primaryCompetitorId: primaryId,
        mergedCompetitorId: absorbedId,
      });
      count++;
    }
    return count;
  }

  async unmergeCompetitor(competitorId: number): Promise<void> {
    await db.update(competitors).set({ mergedInto: null }).where(eq(competitors.id, competitorId));
    await db.delete(competitorMerges).where(eq(competitorMerges.mergedCompetitorId, competitorId));
  }

  async getMergeSuggestions(): Promise<MergeSuggestion[]> {
    // Only consider competitors that have actual mentions — zero-mention competitors are noise
    const allCompsRaw = await db.select().from(competitors).where(isNull(competitors.mergedInto));
    const mentionRows = await db.execute(sql`
      SELECT competitor_id, COUNT(*) as cnt FROM competitor_mentions GROUP BY competitor_id
    `);
    const mentionCounts = new Map<number, number>();
    for (const r of ((mentionRows as any).rows ?? mentionRows) as any[]) {
      mentionCounts.set(Number(r.competitor_id), Number(r.cnt));
    }
    const allComps = allCompsRaw.filter(c => (mentionCounts.get(c.id) || 0) > 0);

    // Compute pairwise name similarity, group into clusters
    const clusters: Map<number, { ids: Set<number>; maxSim: number }> = new Map();
    const assigned = new Set<number>();

    for (let i = 0; i < allComps.length; i++) {
      for (let j = i + 1; j < allComps.length; j++) {
        const sim = this.nameSimilarity(allComps[i].name, allComps[j].name);
        if (sim >= 0.7) {
          const existingI = [...clusters.entries()].find(([, v]) => v.ids.has(allComps[i].id));
          const existingJ = [...clusters.entries()].find(([, v]) => v.ids.has(allComps[j].id));
          if (existingI && existingJ && existingI[0] !== existingJ[0]) {
            // Merge clusters
            for (const id of existingJ[1].ids) existingI[1].ids.add(id);
            existingI[1].maxSim = Math.max(existingI[1].maxSim, existingJ[1].maxSim, sim);
            clusters.delete(existingJ[0]);
          } else if (existingI) {
            existingI[1].ids.add(allComps[j].id);
            existingI[1].maxSim = Math.max(existingI[1].maxSim, sim);
          } else if (existingJ) {
            existingJ[1].ids.add(allComps[i].id);
            existingJ[1].maxSim = Math.max(existingJ[1].maxSim, sim);
          } else {
            const clusterKey = allComps[i].id;
            clusters.set(clusterKey, {
              ids: new Set([allComps[i].id, allComps[j].id]),
              maxSim: sim,
            });
          }
          assigned.add(allComps[i].id);
          assigned.add(allComps[j].id);
        }
      }
    }

    const compMap = new Map(allComps.map(c => [c.id, c]));
    const suggestions: MergeSuggestion[] = [];
    for (const [, cluster] of clusters) {
      const comps = [...cluster.ids]
        .filter(id => compMap.has(id)) // only competitors with mentions
        .map(id => {
          const c = compMap.get(id)!;
          return { id: c.id, name: c.name, mentionCount: mentionCounts.get(c.id) || 0 };
        });
      if (comps.length >= 2) {
        suggestions.push({ competitors: comps, similarity: cluster.maxSim });
      }
    }

    return suggestions.sort((a, b) => b.similarity - a.similarity);
  }

  private nameSimilarity(a: string, b: string): number {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    if (al === bl) return 1;

    // Substring check
    if (al.includes(bl) || bl.includes(al)) return 0.85;

    // Word overlap
    const wordsA = al.split(/[\s\-_]+/).filter(Boolean);
    const wordsB = bl.split(/[\s\-_]+/).filter(Boolean);
    const allWords = new Set([...wordsA, ...wordsB]);
    const shared = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb)));
    if (allWords.size > 0 && shared.length > 0) {
      return shared.length / allWords.size;
    }

    return 0;
  }

  async getMergeHistory(): Promise<MergeHistoryEntry[]> {
    const result = await db.execute(sql`
      SELECT
        cm.id,
        cm.primary_competitor_id,
        pc.name as primary_name,
        cm.merged_competitor_id,
        mc.name as merged_name,
        cm.performed_at
      FROM competitor_merges cm
      JOIN competitors pc ON pc.id = cm.primary_competitor_id
      JOIN competitors mc ON mc.id = cm.merged_competitor_id
      ORDER BY cm.performed_at DESC
    `);

    const rows = (result as any).rows ?? result;
    return (rows as any[]).map(r => ({
      id: Number(r.id),
      primaryCompetitorId: Number(r.primary_competitor_id),
      primaryName: r.primary_name as string,
      mergedCompetitorId: Number(r.merged_competitor_id),
      mergedName: r.merged_name as string,
      performedAt: r.performed_at ? new Date(r.performed_at) : null,
    }));
  }

  // Job queue methods
  async enqueueJobs(jobs: InsertJobQueueItem[]): Promise<void> {
    // Batch insert in chunks of 100
    for (let i = 0; i < jobs.length; i += 100) {
      const batch = jobs.slice(i, i + 100);
      await db.insert(jobQueue).values(batch);
    }
  }

  async dequeueJob(analysisRunId: number): Promise<JobQueueItem | null> {
    const result = await db.execute(sql`
      UPDATE job_queue
      SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM job_queue
        WHERE analysis_run_id = ${analysisRunId} AND status = 'pending'
        ORDER BY id LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    const rows = (result as any).rows ?? result;
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      analysisRunId: r.analysis_run_id,
      promptId: r.prompt_id,
      promptText: r.prompt_text,
      promptTopicId: r.prompt_topic_id,
      promptIsExisting: r.prompt_is_existing,
      model: r.model,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      lastError: r.last_error,
      lockedAt: r.locked_at ? new Date(r.locked_at) : null,
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
      createdAt: r.created_at ? new Date(r.created_at) : null,
    };
  }

  async completeJob(jobId: number): Promise<void> {
    await db.update(jobQueue)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(jobQueue.id, jobId));
  }

  async failJob(jobId: number, error: string, shouldRetry: boolean, wasBusy: boolean = false): Promise<void> {
    // Always mark the current job as failed with the error
    const [job] = await db.select().from(jobQueue).where(eq(jobQueue.id, jobId));
    await db.update(jobQueue)
      .set({ status: 'failed', lastError: error, completedAt: new Date() })
      .where(eq(jobQueue.id, jobId));

    // If retryable and under max attempts, create a new job for the retry
    if (shouldRetry && job && job.attempts < (job.maxAttempts || 3)) {
      // 429/busy shouldn't count as a real attempt — dequeueJob already incremented,
      // so subtract 2 to net zero (one for dequeue increment, one for this retry)
      const retryAttempts = wasBusy ? Math.max(0, job.attempts - 2) : job.attempts;
      const originalId = job.originalJobId || job.id;
      await db.insert(jobQueue).values({
        analysisRunId: job.analysisRunId,
        promptId: job.promptId,
        promptText: job.promptText,
        promptTopicId: job.promptTopicId,
        promptIsExisting: job.promptIsExisting,
        model: job.model,
        status: 'pending',
        attempts: retryAttempts,
        maxAttempts: job.maxAttempts,
        lastError: null,
        originalJobId: originalId,
      });
    }
  }

  async getJobQueueProgress(analysisRunId: number): Promise<JobQueueProgress> {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM job_queue
      WHERE analysis_run_id = ${analysisRunId}
    `);
    const rows = (result as any).rows ?? result;
    const r = rows[0];
    return {
      total: Number(r.total),
      pending: Number(r.pending),
      processing: Number(r.processing),
      completed: Number(r.completed),
      failed: Number(r.failed),
    };
  }

  async recoverStalledJobs(stallTimeoutMs: number = 300000): Promise<number> {
    // Find stalled jobs
    const stalledJobs = await db.select().from(jobQueue)
      .where(sql`${jobQueue.status} = 'processing' AND ${jobQueue.lockedAt} < NOW() - INTERVAL '1 millisecond' * ${stallTimeoutMs}`);

    for (const job of stalledJobs) {
      // Mark as failed with the stall reason
      await db.update(jobQueue)
        .set({ status: 'failed', lastError: 'Stalled — container crashed or timed out', completedAt: new Date() })
        .where(eq(jobQueue.id, job.id));

      // Create a retry job if under max attempts
      if (job.attempts < (job.maxAttempts || 3)) {
        const originalId = job.originalJobId || job.id;
        await db.insert(jobQueue).values({
          analysisRunId: job.analysisRunId,
          promptId: job.promptId,
          promptText: job.promptText,
          promptTopicId: job.promptTopicId,
          promptIsExisting: job.promptIsExisting,
          model: job.model,
          status: 'pending',
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          lastError: null,
          originalJobId: originalId,
        });
      }
    }

    return stalledJobs.length;
  }

  async getFailedJobs(analysisRunId: number): Promise<JobQueueItem[]> {
    // Only return terminal failures: failed jobs where no retry in the same chain succeeded.
    // A chain is linked by original_job_id. The last failed job in a chain with no
    // completed/pending sibling is a terminal failure.
    const result = await db.execute(sql`
      SELECT f.* FROM job_queue f
      WHERE f.analysis_run_id = ${analysisRunId}
        AND f.status = 'failed'
        -- No completed, pending, processing, or cancelled job shares this chain
        AND NOT EXISTS (
          SELECT 1 FROM job_queue s
          WHERE s.analysis_run_id = ${analysisRunId}
            AND s.status IN ('completed', 'pending', 'processing', 'cancelled')
            AND (
              -- same chain: both point to the same original, or one IS the original
              s.original_job_id = COALESCE(f.original_job_id, f.id)
              OR s.id = COALESCE(f.original_job_id, f.id)
              OR COALESCE(s.original_job_id, s.id) = COALESCE(f.original_job_id, f.id)
            )
        )
        -- Only show the latest failure per chain
        AND f.id = (
          SELECT MAX(f2.id) FROM job_queue f2
          WHERE f2.analysis_run_id = ${analysisRunId}
            AND f2.status = 'failed'
            AND COALESCE(f2.original_job_id, f2.id) = COALESCE(f.original_job_id, f.id)
        )
      ORDER BY f.id DESC
    `);
    const rows = (result as any).rows ?? result;
    return (rows as any[]).map(r => ({
      id: r.id,
      analysisRunId: r.analysis_run_id,
      promptId: r.prompt_id,
      promptText: r.prompt_text,
      promptTopicId: r.prompt_topic_id,
      promptIsExisting: r.prompt_is_existing,
      model: r.model,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      lastError: r.last_error,
      originalJobId: r.original_job_id,
      lockedAt: r.locked_at ? new Date(r.locked_at) : null,
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
      createdAt: r.created_at ? new Date(r.created_at) : null,
    }));
  }

  async cancelJobsForRun(analysisRunId: number): Promise<void> {
    await db.update(jobQueue)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(sql`${jobQueue.analysisRunId} = ${analysisRunId} AND (${jobQueue.status} = 'pending' OR ${jobQueue.status} = 'processing')`);
  }

  // Data clearing methods
  async clearAllPrompts(): Promise<void> {
    await db.delete(responses); // Delete responses first due to foreign key
    await db.delete(prompts);
  }

  async clearAllResponses(): Promise<void> {
    await db.delete(responses);
  }

  async clearAllCompetitors(): Promise<void> {
    console.log(`[${new Date().toISOString()}] DatabaseStorage: Clearing all competitors...`);
    await db.delete(competitors);
    console.log(`[${new Date().toISOString()}] DatabaseStorage: All competitors cleared successfully`);
  }

  async clearResultsOnly(): Promise<void> {
    console.log(`[${new Date().toISOString()}] DatabaseStorage: Clearing results (keeping prompts/topics)...`);
    await db.delete(jobQueue);
    await db.delete(competitorMentions);
    await db.delete(competitorMerges);
    await db.delete(sourceUrls);
    await db.delete(responses);
    await db.delete(competitors);
    await db.delete(sources);
    await db.delete(analytics);
    await db.delete(apiUsage);
    await db.delete(apifyUsage);
    await db.delete(analysisRuns);
    console.log(`[${new Date().toISOString()}] DatabaseStorage: Results cleared, prompts and topics preserved`);
  }

  async clearAllAnalysisData(): Promise<void> {
    console.log(`[${new Date().toISOString()}] DatabaseStorage: Clearing ALL analysis data...`);
    // Order matters — respect foreign key constraints
    await db.delete(jobQueue);
    await db.delete(competitorMentions);
    await db.delete(competitorMerges);
    await db.delete(sourceUrls);
    await db.delete(responses);
    await db.delete(prompts);
    await db.delete(competitors);
    await db.delete(sources);
    await db.delete(analytics);
    await db.delete(apiUsage);
    await db.delete(apifyUsage);
    await db.delete(analysisRuns);
    await db.delete(topics);
    console.log(`[${new Date().toISOString()}] DatabaseStorage: All analysis data cleared`);
  }
}