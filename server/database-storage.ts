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
  topics, prompts, responses, competitors, competitorMentions, competitorMerges, sources, sourceUrls, analytics, analysisRuns, appSettings
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, count, sql, isNull } from "drizzle-orm";
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

  async getResponsesWithPrompts(runId?: number): Promise<ResponseWithPrompt[]> {
    let query = db
      .select()
      .from(responses)
      .leftJoin(prompts, eq(responses.promptId, prompts.id))
      .leftJoin(topics, eq(prompts.topicId, topics.id));

    const results = runId
      ? await query.where(eq(responses.analysisRunId, runId))
      : await query;

    return results.map(result => ({
      ...result.responses,
      prompt: {
        ...result.prompts!,
        topic: result.topics
      }
    }));
  }

  async getRecentResponses(limit = 10, runId?: number): Promise<ResponseWithPrompt[]> {
    let query = db
      .select()
      .from(responses)
      .leftJoin(prompts, eq(responses.promptId, prompts.id))
      .leftJoin(topics, eq(prompts.topicId, topics.id))
      .orderBy(desc(responses.createdAt));

    const results = runId
      ? await (limit > 1000 ? query.where(eq(responses.analysisRunId, runId)) : query.where(eq(responses.analysisRunId, runId)).limit(limit))
      : await (limit > 1000 ? query : query.limit(limit));

    return results.map(result => ({
      ...result.responses,
      prompt: {
        ...result.prompts!,
        topic: result.topics
      }
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

  async addSourceUrls(domain: string, urls: string[], analysisRunId?: number, provider?: string): Promise<void> {
    const source = await this.getSourceByDomain(domain);
    if (!source) return;
    for (const url of urls) {
      await db.insert(sourceUrls).values({ sourceId: source.id, url, analysisRunId: analysisRunId || null, provider: provider || null });
    }
  }

  async getSourceUrlsBySourceId(sourceId: number, analysisRunId?: number): Promise<string[]> {
    const condition = analysisRunId
      ? sql`${sourceUrls.sourceId} = ${sourceId} AND ${sourceUrls.analysisRunId} = ${analysisRunId}`
      : eq(sourceUrls.sourceId, sourceId);
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

  async getCompetitorAnalysisAllRuns() {
    const result = await db.execute(sql`
      SELECT
        COALESCE(c.merged_into, cm.competitor_id) as competitor_id,
        primary_c.name as name,
        primary_c.category as category,
        COUNT(*) as mention_count
      FROM competitor_mentions cm
      JOIN competitors c ON cm.competitor_id = c.id
      JOIN competitors primary_c ON primary_c.id = COALESCE(c.merged_into, cm.competitor_id)
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

  async getAnalysisRuns(): Promise<AnalysisRun[]> {
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
}