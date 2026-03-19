import { pgTable, text, serial, integer, boolean, timestamp, real, jsonb } from "drizzle-orm/pg-core";
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
  title: text("title"),
  citationCount: integer("citation_count").default(0),
  lastCited: timestamp("last_cited"),
});

export const sourceUrls = pgTable("source_urls", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").references(() => sources.id).notNull(),
  analysisRunId: integer("analysis_run_id").references(() => analysisRuns.id),
  url: text("url").notNull(),
  firstSeenAt: timestamp("first_seen_at").defaultNow(),
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

export type MergeSuggestion = {
  competitors: { id: number; name: string; mentionCount: number }[];
  similarity: number;
};

export type MergeHistoryEntry = {
  id: number;
  primaryCompetitorId: number;
  primaryName: string;
  mergedCompetitorId: number;
  mergedName: string;
  performedAt: Date | null;
};
