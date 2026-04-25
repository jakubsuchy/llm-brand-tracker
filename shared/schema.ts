import { pgTable, text, serial, integer, boolean, timestamp, real, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const topics = pgTable("topics", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  deleted: boolean("deleted").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const prompts = pgTable("prompts", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  topicId: integer("topic_id").references(() => topics.id),
  deleted: boolean("deleted").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const responses = pgTable("responses", {
  id: serial("id").primaryKey(),
  promptId: integer("prompt_id").references(() => prompts.id).notNull(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id),
  model: text("model"),
  text: text("text").notNull(),
  brandMentioned: boolean("brand_mentioned").default(false),
  competitorsMentioned: text("competitors_mentioned").array(),
  sources: text("sources").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const competitors = pgTable("competitors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
  domain: text("domain"),
  category: text("category"),
  mentionCount: integer("mention_count").default(0),
  lastMentioned: timestamp("last_mentioned"),
  mergedInto: integer("merged_into"),
});

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  url: text("url").notNull(),
  citationCount: integer("citation_count").default(0),
  lastCited: timestamp("last_cited"),
});

export const sourceUrls = pgTable("source_urls", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").references(() => sources.id).notNull(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id),
  model: text("model"),
  url: text("url").notNull(),
  normalizedUrl: text("normalized_url"),
  // Same as normalizedUrl but with ALL query params stripped. Populated on
  // write + backfilled at startup. Enables watchlist entries with
  // `ignoreQueryStrings = true` to match citations that differ only by
  // query string, without forcing that behavior on strict watchers.
  normalizedUrlStripped: text("normalized_url_stripped"),
  firstSeenAt: timestamp("first_seen_at").defaultNow(),
}, (t) => ({
  normalizedUrlIdx: index("source_urls_normalized_url_idx").on(t.normalizedUrl),
  normalizedUrlStrippedIdx: index("source_urls_normalized_url_stripped_idx").on(t.normalizedUrlStripped),
}));

export const watchedUrls = pgTable("watched_urls", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  normalizedUrl: text("normalized_url").notNull().unique(),
  title: text("title"),
  notes: text("notes"),
  // If true, normalization strips ALL query params (matched against
  // source_urls.normalized_url_stripped). Default false preserves existing
  // behavior — matches use source_urls.normalized_url (utm/tracking
  // params already dropped, the rest kept).
  ignoreQueryStrings: boolean("ignore_query_strings").default(false).notNull(),
  // Origin: 'manual' (user added via UI/API) or 'sitemap' (auto-discovered
  // from brand sitemap.xml on analysis start). Used to split the UI list
  // and decide whether to overwrite on re-import.
  source: text("source").default('manual').notNull(),
  addedByUserId: integer("added_by_user_id"),
  addedAt: timestamp("added_at").defaultNow(),
});

export const analytics = pgTable("analytics", {
  id: serial("id").primaryKey(),
  date: timestamp("date").defaultNow(),
  totalPrompts: integer("total_prompts").default(0),
  brandMentionRate: real("brand_mention_rate").default(0),
  topCompetitor: text("top_competitor"),
  totalSources: integer("total_sources").default(0),
  totalDomains: integer("total_domains").default(0),
});

export const analysisRuns = pgTable("analysis_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default('running'),
  brandName: text("brand_name"),
  brandUrl: text("brand_url"),
  totalPrompts: integer("total_prompts").default(0),
  completedPrompts: integer("completed_prompts").default(0),
});

export const competitorMentions = pgTable("competitor_mentions", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").references(() => competitors.id).notNull(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id).notNull(),
  responseId: integer("response_id").references(() => responses.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const apiUsage = pgTable("api_usage", {
  id: serial("id").primaryKey(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  calledAt: timestamp("called_at").defaultNow(),
});

export const apifyUsage = pgTable("apify_usage", {
  id: serial("id").primaryKey(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id),
  jobId: integer("job_id"),
  apifyRunId: text("apify_run_id").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull(),
  costUsd: real("cost_usd"),
  durationMs: integer("duration_ms"),
  computeUnits: real("compute_units"),
  proxyGbytes: real("proxy_gbytes"),
  memMaxBytes: real("mem_max_bytes"),
  datasetId: text("dataset_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const competitorMerges = pgTable("competitor_merges", {
  id: serial("id").primaryKey(),
  primaryCompetitorId: integer("primary_competitor_id").references(() => competitors.id).notNull(),
  mergedCompetitorId: integer("merged_competitor_id").references(() => competitors.id).notNull(),
  performedAt: timestamp("performed_at").defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  hashedPassword: text("hashed_password"),
  salt: text("salt"),
  googleId: text("google_id"),
  apiKey: text("api_key"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const userRoles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  roleId: integer("role_id").references(() => roles.id).notNull(),
});

export const jobQueue = pgTable("job_queue", {
  id: serial("id").primaryKey(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id).notNull(),
  promptId: integer("prompt_id").references(() => prompts.id),
  promptText: text("prompt_text").notNull(),
  promptTopicId: integer("prompt_topic_id"),
  promptIsExisting: boolean("prompt_is_existing").default(false),
  model: text("model").notNull(),
  status: text("status").notNull().default('pending'),
  attempts: integer("attempts").default(0),
  maxAttempts: integer("max_attempts").default(3),
  lastError: text("last_error"),
  originalJobId: integer("original_job_id"),  // links retries back to the first job in the chain
  lockedAt: timestamp("locked_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertTopicSchema = createInsertSchema(topics).omit({
  id: true,
  createdAt: true,
});

export const insertPromptSchema = createInsertSchema(prompts).omit({
  id: true,
  createdAt: true,
});

export const insertResponseSchema = createInsertSchema(responses).omit({
  id: true,
  createdAt: true,
});

export const insertCompetitorSchema = createInsertSchema(competitors).omit({
  id: true,
  lastMentioned: true,
});

export const insertSourceSchema = createInsertSchema(sources).omit({
  id: true,
  lastCited: true,
});

export const insertSourceUrlSchema = createInsertSchema(sourceUrls).omit({
  id: true,
  firstSeenAt: true,
});

export const insertCompetitorMentionSchema = createInsertSchema(competitorMentions).omit({
  id: true,
  createdAt: true,
});

export const insertAnalysisRunSchema = createInsertSchema(analysisRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export const insertAnalyticsSchema = createInsertSchema(analytics).omit({
  id: true,
  date: true,
});

export const insertJobQueueSchema = createInsertSchema(jobQueue).omit({
  id: true,
  createdAt: true,
  lockedAt: true,
  completedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
});

export const insertUserRoleSchema = createInsertSchema(userRoles).omit({
  id: true,
});

export const insertWatchedUrlSchema = createInsertSchema(watchedUrls).omit({
  id: true,
  addedAt: true,
  normalizedUrl: true,
  ignoreQueryStrings: true,
  source: true,
});

// Types
export type Topic = typeof topics.$inferSelect;
export type InsertTopic = z.infer<typeof insertTopicSchema>;

export type Prompt = typeof prompts.$inferSelect;
export type InsertPrompt = z.infer<typeof insertPromptSchema>;

export type Response = typeof responses.$inferSelect;
export type InsertResponse = z.infer<typeof insertResponseSchema>;

export type Competitor = typeof competitors.$inferSelect;
export type InsertCompetitor = z.infer<typeof insertCompetitorSchema>;

export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;

export type SourceUrl = typeof sourceUrls.$inferSelect;
export type InsertSourceUrl = z.infer<typeof insertSourceUrlSchema>;

export type CompetitorMention = typeof competitorMentions.$inferSelect;
export type InsertCompetitorMention = z.infer<typeof insertCompetitorMentionSchema>;

export type AnalysisRun = typeof analysisRuns.$inferSelect;
export type InsertAnalysisRun = z.infer<typeof insertAnalysisRunSchema>;

export type Analytics = typeof analytics.$inferSelect;
export type InsertAnalytics = z.infer<typeof insertAnalyticsSchema>;

export type CompetitorMerge = typeof competitorMerges.$inferSelect;

export type JobQueueItem = typeof jobQueue.$inferSelect;
export type InsertJobQueueItem = z.infer<typeof insertJobQueueSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;

export type UserRole = typeof userRoles.$inferSelect;
export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;

export type UserWithRoles = User & { roles: string[] };

export type WatchedUrl = typeof watchedUrls.$inferSelect;
export type InsertWatchedUrl = z.infer<typeof insertWatchedUrlSchema>;

export type WatchedUrlCitation = {
  responseId: number;
  runId: number | null;
  model: string | null;
  url: string;
  citedAt: Date | null;
  promptText: string;
  brandMentioned: boolean;
};

export type WatchedUrlWithCitations = WatchedUrl & {
  citationCount: number;
  firstCitedAt: Date | null;
  firstCitedRunId: number | null;
  citationsByModel: Record<string, number>;
  citations: WatchedUrlCitation[];
};

// Extended types for API responses
export type PromptWithTopic = Prompt & { topic: Topic | null };
export type ResponseWithPrompt = Response & { prompt: PromptWithTopic };

export type TopicAnalysis = {
  topicId: number;
  topicName: string;
  mentionRate: number;
  totalPrompts: number;
  brandMentions: number;
};

export type CompetitorAnalysis = {
  competitorId: number;
  name: string;
  category: string | null;
  mentionCount: number;
  mentionRate: number;
  changeRate: number;
};

export type SourceAnalysis = {
  sourceId: number;
  domain: string;
  sourceType: string;
  citationCount: number;
  urls: string[];
};

export type PageAnalysis = {
  url: string;
  domain: string;
  sourceType: string;
  citationCount: number;
};

export type MergeSuggestion = {
  competitors: { id: number; name: string; mentionCount: number }[];
  similarity: number;
};

export type JobQueueProgress = {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
};

export type MergeHistoryEntry = {
  id: number;
  primaryCompetitorId: number;
  primaryName: string;
  mergedCompetitorId: number;
  mergedName: string;
  performedAt: Date | null;
};
