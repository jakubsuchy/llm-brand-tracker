import { storage } from "../storage";
import { analyzePromptResponse, generatePromptsForTopic } from "./openai";
import { scrapeBrandWebsite, generateTopicsFromContent, extractDomainFromUrl, extractUrlsFromText } from "./scraper";
import { setCurrentRunId } from "./llm";
import type { 
  InsertPrompt, 
  InsertResponse, 
  Analytics,
  TopicAnalysis,
  CompetitorAnalysis,
  SourceAnalysis 
} from "@shared/schema";

export interface AnalysisProgress {
  status: 'initializing' | 'scraping' | 'generating_prompts' | 'testing_prompts' | 'analyzing' | 'complete' | 'error';
  message: string;
  progress: number; // 0-100
  totalPrompts?: number;
  completedPrompts?: number;
}

// Track ongoing analysis state
let analysisStartTime = Date.now();
let targetPrompts = 100; // Default value, will be updated based on user settings
let currentProgress: AnalysisProgress = {
  status: 'idle' as any,
  message: 'Ready to start analysis',
  progress: 0,
  totalPrompts: 0,
  completedPrompts: 0
};

// Track if analysis is currently running
let isAnalysisRunning = false;

// Function to force stop current analysis
export function stopCurrentAnalysis() {
  isAnalysisRunning = false;
  currentProgress = {
    status: 'error',
    message: 'Analysis cancelled by user',
    progress: 0,
    totalPrompts: 0,
    completedPrompts: 0
  };
}

export async function getCurrentProgress(): Promise<AnalysisProgress> {
  return currentProgress;
}

export class BrandAnalyzer {
  public progressCallback?: (progress: AnalysisProgress) => void;
  private brandName: string = '';
  private brandUrl: string = '';
  private analysisRunId: number | null = null;

  constructor(progressCallback?: (progress: AnalysisProgress) => void) {
    this.progressCallback = progressCallback;
  }

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

  private updateProgress(update: Partial<AnalysisProgress>) {
    currentProgress = { ...currentProgress, ...update };
    if (this.progressCallback) {
      this.progressCallback(currentProgress);
    }
  }

  private resetProgress() {
    currentProgress = {
      status: 'initializing',
      message: 'Starting analysis...',
      progress: 0,
      totalPrompts: 0,
      completedPrompts: 0
    };
    analysisStartTime = Date.now();
  }

  async runFullAnalysis(useExistingPrompts: boolean = false, savedPrompts?: any[], settings?: { promptsPerTopic: number; numberOfTopics: number }): Promise<void> {
    try {
      // Prevent multiple simultaneous analyses
      if (isAnalysisRunning) {
        console.log('Analysis already running, skipping new request');
        return;
      }
      
      isAnalysisRunning = true;
      
      // Update target prompts based on user settings
      if (settings) {
        targetPrompts = settings.promptsPerTopic * settings.numberOfTopics;
      } else if (savedPrompts && savedPrompts.length > 0) {
        targetPrompts = savedPrompts.length;
      }
      
      // Reset progress state for fresh analysis
      this.resetProgress();
      
      this.updateProgress({
        status: 'initializing',
        message: 'Starting brand analysis...',
        progress: 0
      });

      // Add delay to ensure reset progress is visible
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Only clear data if explicitly requested or using saved prompts
      if (savedPrompts && savedPrompts.length > 0) {
        this.updateProgress({
          status: 'initializing',
          message: 'Clearing previous data and loading saved prompts...',
          progress: 5
        });
        
        console.log(`[${new Date().toISOString()}] Preparing analysis (savedPrompts provided, keeping historical data)`);
      } else if (!useExistingPrompts) {
        // For new analysis, don't clear existing data - append to it
        this.updateProgress({
          status: 'initializing',
          message: 'Preparing for new analysis...',
          progress: 5
        });
      }

      let allPrompts: any[] = [];

      if (savedPrompts && savedPrompts.length > 0) {
        // Clear existing data before using saved prompts
        this.updateProgress({
          status: 'initializing',
          message: 'Clearing previous data and loading saved prompts...',
          progress: 10
        });

        console.log(`[${new Date().toISOString()}] Loading saved prompts (keeping historical data)`);

        this.updateProgress({
          status: 'testing_prompts',
          message: 'Processing saved prompts...',
          progress: 20
        });

        // Deduplicate by text and mark as existing (they already have DB records)
        const seen = new Set<string>();
        allPrompts = savedPrompts.filter(p => {
          const key = p.text.toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map(p => ({ id: p.id, text: p.text, topicId: p.topicId || null, _existing: true }));
      } else if (useExistingPrompts) {
        // Use existing prompts from the database — clear old responses only
        this.updateProgress({
          status: 'testing_prompts',
          message: 'Using existing prompts for analysis...',
          progress: 20
        });

        const existingPrompts = await storage.getPrompts();
        // Deduplicate by text — keep the first occurrence of each prompt
        const seen = new Set<string>();
        const uniquePrompts = existingPrompts.filter(p => {
          const key = p.text.toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        // Mark these as already-saved so processPrompt skips createPrompt
        allPrompts = uniquePrompts.map(p => ({ id: p.id, text: p.text, topicId: p.topicId, _existing: true }));
      } else {
        // Step 1: Scrape brand website content
        this.updateProgress({
          status: 'scraping',
          message: 'Analyzing brand website...',
          progress: 10
        });

        const content = await scrapeBrandWebsite(this.brandUrl || 'https://example.com');
        const generatedTopics = await generateTopicsFromContent(content);

        // Step 2: Generate prompts for each topic
        this.updateProgress({
          status: 'generating_prompts',
          message: 'Generating test prompts...',
          progress: 20
        });

        for (const topic of generatedTopics) {
          let topicRecord = await storage.getTopics().then(topics => 
            topics.find(t => t.name === topic.name)
          );
          
          if (!topicRecord) {
            topicRecord = await storage.createTopic(topic);
          }

          // Generate prompts for this topic using user settings or defaults
          const promptsPerTopic = settings?.promptsPerTopic || 20;
          const promptTexts = await generatePromptsForTopic(topic.name, topic.description, promptsPerTopic);
          
          for (const promptText of promptTexts) {
            allPrompts.push({
              text: promptText,
              topicId: topicRecord.id
            });
          }
        }
      }

      // Step 3: Test prompts with ChatGPT
      this.updateProgress({
        status: 'testing_prompts',
        message: 'Testing prompts with ChatGPT...',
        progress: 30,
        totalPrompts: allPrompts.length,
        completedPrompts: 0
      });

      let completedCount = 0;
      
      // Process prompts sequentially to avoid rate limits
      console.log(`[${new Date().toISOString()}] Starting to process ${allPrompts.length} prompts (concurrency: 3)`);

      const CONCURRENCY = 3;
      let nextIndex = 0;

      const processPrompt = async (promptData: any, idx: number): Promise<void> => {
        if (!isAnalysisRunning) return;

        console.log(`[${new Date().toISOString()}] Processing prompt ${idx + 1}/${allPrompts.length}: ${promptData.text.substring(0, 50)}...`);

        let prompt;
        if (promptData._existing && promptData.id) {
          // Reuse existing prompt record
          prompt = { id: promptData.id, text: promptData.text, topicId: promptData.topicId };
        } else {
          prompt = await storage.createPrompt(promptData);
          if (!prompt) {
            console.error('Failed to create prompt:', promptData.text);
            return;
          }
        }

        // Analyze with rate-limit retry
        let analysis;
        let retries = 0;
        while (true) {
          try {
            const knownCompetitors = (await storage.getCompetitors()).map(c => c.name);
            analysis = await analyzePromptResponse(promptData.text, this.brandName, knownCompetitors);
            break;
          } catch (error: any) {
            // Quota exhaustion — stop entirely, don't retry
            const isQuota = error?.code === 'insufficient_quota' || error?.type === 'insufficient_quota';
            if (isQuota) {
              console.error(`[${new Date().toISOString()}] Quota exceeded on prompt ${idx + 1} — stopping. Check billing.`);
              return; // Skip this prompt, don't retry
            }

            const isRateLimit = error?.status === 429 || error?.code === 'rate_limit_exceeded' || error?.message?.includes('rate limit');
            if (isRateLimit && retries < 5) {
              const backoff = Math.pow(3, retries) * 5000; // 5s, 15s, 45s, 135s, 405s
              console.log(`[${new Date().toISOString()}] Rate limited on prompt ${idx + 1}, retrying in ${Math.round(backoff / 1000)}s (attempt ${retries + 1}/5)`);
              await new Promise(resolve => setTimeout(resolve, backoff));
              retries++;
              continue;
            }
            console.error(`[${new Date().toISOString()}] OpenAI API failed for prompt ${idx + 1}:`, error.message);
            return; // Skip this prompt
          }
        }

        // Filter out our own brand, then normalize generic names to existing records
        const brandLower = (this.brandName || '').toLowerCase();
        const knownCompetitors = await storage.getCompetitors();
        const filteredCompetitors: string[] = [];

        for (const name of analysis.competitors) {
          const nameLower = name.toLowerCase();

          // Skip our own brand
          if (brandLower && (nameLower.includes(brandLower) || brandLower.includes(nameLower))) continue;

          // Try to match short/generic names to existing full names
          // e.g. "AWS" matches "AWS Elastic Load Balancing"
          const existingMatch = knownCompetitors.find(c =>
            c.name.toLowerCase().startsWith(nameLower + ' ') ||
            c.name.toLowerCase().startsWith(nameLower + '-')
          );
          if (existingMatch) {
            filteredCompetitors.push(existingMatch.name);
          } else if (name.length >= 2) {
            filteredCompetitors.push(name);
          }
        }

        // Deduplicate after normalization
        const uniqueCompetitors = [...new Set(filteredCompetitors)];

        // Ensure competitor records exist — lookup first, only categorize if new
        const resolvedCompetitors: { name: string; id: number }[] = [];
        for (const competitorName of uniqueCompetitors) {
          try {
            let competitor = await storage.getCompetitorByName(competitorName);
            if (!competitor) {
              competitor = await storage.createCompetitor({
                name: competitorName,
                category: await this.categorizeCompetitor(competitorName),
                mentionCount: 0
              });
            }
            resolvedCompetitors.push({ name: competitor.name, id: competitor.id });
          } catch (error) {
            console.error(`Error resolving competitor ${competitorName}:`, error);
          }
        }

        // Process sources
        const responseUrls = extractUrlsFromText(analysis.response);
        const analysisSources = analysis.sources || [];
        const promptUrls = extractUrlsFromText(promptData.text);
        const allUrls = Array.from(new Set([...responseUrls, ...analysisSources, ...promptUrls]));

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
                title: this.generateSourceTitle(domain, primaryUrl),
                citationCount: 0
              });
            }
            await storage.addSourceUrls(domain, urls, this.analysisRunId || undefined);
            await storage.updateSourceCitationCount(domain, 1);

            // Auto-populate competitor domain if this source matches a competitor by name
            const domainBase = domain.toLowerCase().split('.')[0];
            for (const comp of resolvedCompetitors) {
              if (!comp.name) continue;
              const compWords = comp.name.toLowerCase().split(/\s+/);
              if (compWords.some(w => domainBase.includes(w) || w.includes(domainBase))) {
                await storage.updateCompetitorDomain(comp.id, domain);
              }
            }
          } catch {}
        }

        // Create response record
        const responseRecord = await storage.createResponse({
          promptId: prompt.id,
          analysisRunId: this.analysisRunId,
          text: analysis.response,
          brandMentioned: analysis.brandMentioned,
          competitorsMentioned: uniqueCompetitors.map(name => {
            const resolved = resolvedCompetitors.find(r => r.name.toLowerCase() === name.toLowerCase());
            return resolved?.name || name;
          }),
          sources: analysis.sources
        });

        // Create competitor mention records for this run
        if (this.analysisRunId) {
          for (const comp of resolvedCompetitors) {
            try {
              await storage.createCompetitorMention({
                competitorId: comp.id,
                analysisRunId: this.analysisRunId,
                responseId: responseRecord.id,
              });
            } catch {}
          }
        }

        completedCount++;
        console.log(`[${new Date().toISOString()}] Completed prompt ${idx + 1}/${allPrompts.length} (${completedCount} total)`);

        // Update run progress in DB
        if (this.analysisRunId) {
          await storage.updateAnalysisRunProgress(this.analysisRunId, completedCount);
        }

        this.updateProgress({
          status: 'testing_prompts',
          message: `Testing prompts with ChatGPT... (${completedCount}/${allPrompts.length})`,
          progress: 30 + (completedCount / allPrompts.length) * 50,
          totalPrompts: allPrompts.length,
          completedPrompts: completedCount
        });
      };

      // Run with concurrency pool
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (nextIndex < allPrompts.length && isAnalysisRunning) {
          const idx = nextIndex++;
          try {
            await processPrompt(allPrompts[idx], idx);
          } catch (error) {
            console.error(`[${new Date().toISOString()}] Error processing prompt ${idx + 1}:`, error);
          }
        }
      });
      await Promise.all(workers);

      // Step 4: Generate analytics
      this.updateProgress({
        status: 'analyzing',
        message: 'Generating analytics...',
        progress: 85
      });

      await this.generateAnalytics();

      setCurrentRunId(null);
      console.log(`[${new Date().toISOString()}] Analysis completed successfully. Processed ${completedCount} out of ${allPrompts.length} prompts`);

      this.updateProgress({
        status: 'complete',
        message: 'Analysis complete!',
        progress: 100
      });

    } catch (error) {
      console.error("Analysis failed:", error);
      this.updateProgress({
        status: 'error',
        message: `Analysis failed: ${(error as Error).message}`,
        progress: 0
      });
      throw error;
    } finally {
      // Reset analysis running flag when complete or failed
      isAnalysisRunning = false;
    }
  }

  private generateSourceTitle(domain: string, url: string): string {
    // Generate a descriptive title based on the domain and URL
    const domainParts = domain.split('.');
    const mainDomain = domainParts[0];
    
    // Handle common patterns
    if (url.includes('/docs')) {
      return `${mainDomain} Documentation`;
    } else if (url.includes('/api')) {
      return `${mainDomain} API Documentation`;
    } else if (url.includes('/developer')) {
      return `${mainDomain} Developer Portal`;
    } else if (url.includes('/guide') || url.includes('/tutorial')) {
      return `${mainDomain} Guides & Tutorials`;
    } else if (domain.includes('github.com')) {
      return 'GitHub Repository';
    } else if (domain.includes('stackoverflow.com')) {
      return 'Stack Overflow Discussion';
    } else if (domain.includes('medium.com')) {
      return 'Medium Article';
    } else if (domain.includes('dev.to')) {
      return 'Dev.to Article';
    } else if (domain.includes('reddit.com')) {
      return 'Reddit Discussion';
    } else if (domain.includes('youtube.com')) {
      return 'YouTube Video';
    } else if (domain.includes('twitter.com') || domain.includes('x.com')) {
      return 'Social Media Post';
    } else if (domain.includes('linkedin.com')) {
      return 'LinkedIn Article';
    } else if (domain.includes('hackernews.com') || domain.includes('news.ycombinator.com')) {
      return 'Hacker News Discussion';
    } else if (domain.includes('discord.com') || domain.includes('discord.gg')) {
      return 'Discord Community';
    } else if (domain.includes('slack.com')) {
      return 'Slack Community';
    } else if (domain.includes('substack.com')) {
      return 'Substack Newsletter';
    } else if (domain.includes('hashnode.dev')) {
      return 'Hashnode Article';
    } else if (domain.includes('css-tricks.com')) {
      return 'CSS-Tricks Article';
    } else if (domain.includes('smashingmagazine.com')) {
      return 'Smashing Magazine Article';
    } else if (domain.includes('sitepoint.com')) {
      return 'SitePoint Article';
    } else if (domain.includes('toptal.com')) {
      return 'Toptal Article';
    } else if (domain.includes('freecodecamp.org')) {
      return 'freeCodeCamp Resource';
    } else if (domain.includes('mozilla.org')) {
      return 'Mozilla Developer Network';
    } else if (domain.includes('web.dev')) {
      return 'Web.dev Article';
    } else if (domain.includes('css-tricks.com')) {
      return 'CSS-Tricks Article';
    } else {
      // For unknown domains, create a more generic title
      const tld = domainParts[domainParts.length - 1];
      if (tld === 'org') {
        return `${mainDomain} Organization`;
      } else if (tld === 'edu') {
        return `${mainDomain} Educational Resource`;
      } else if (tld === 'gov') {
        return `${mainDomain} Government Resource`;
      } else if (tld === 'io') {
        return `${mainDomain} Platform`;
      } else if (tld === 'app') {
        return `${mainDomain} Application`;
      } else if (tld === 'dev') {
        return `${mainDomain} Developer Resource`;
      } else {
        return `${mainDomain} Website`;
      }
    }
  }

  private async categorizeCompetitor(name: string): Promise<string> {
    const existingCompetitor = await storage.getCompetitorByName(name);
    if (existingCompetitor?.category) {
      return existingCompetitor.category;
    }

    try {
      console.log(`[${new Date().toISOString()}] Categorizing competitor: ${name}`);
      const { chatCompletion } = await import("./llm");
      const response = await chatCompletion({
        model: "gpt-5.4-mini",
        messages: [
          {
            role: "system",
            content: `Categorize this company/product. Return only the category name as a single word or short phrase (e.g. "Technology", "Cloud Platform", "Networking", etc.). No explanation.`
          },
          {
            role: "user",
            content: `Brand: ${this.brandName || 'Unknown'}\nCompetitor: ${name}\nCategory?`
          }
        ],
        temperature: 0.1,
        max_completion_tokens: 32
      }, { timeoutMs: 15000 });

      const category = response.choices[0].message.content?.trim() || 'Technology';
      console.log(`[${new Date().toISOString()}] Categorized ${name} as: ${category}`);
      return category;
    } catch (error) {
      console.error(`Error categorizing competitor ${name}:`, error);
      return 'Technology';
    }
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
      totalPrompts: responses.length, // Use full dataset count
      brandMentionRate,
      topCompetitor,
      totalSources: sources.length,
      totalDomains: uniqueDomains
    });
  }

  async getOverviewMetrics() {
    // Get full dataset for accurate metrics
    const allResponses = await storage.getResponsesWithPrompts();
    const competitorAnalysis = await storage.getCompetitorAnalysis();
    const sourceAnalysis = await storage.getSourceAnalysis();
    
    // Calculate metrics from full dataset
    const brandMentions = allResponses.filter(r => r.brandMentioned).length;
    const brandMentionRate = allResponses.length > 0 ? (brandMentions / allResponses.length) * 100 : 0;
    
    const topCompetitor = competitorAnalysis
      .sort((a, b) => b.mentionCount - a.mentionCount)[0];
    
    const uniqueDomains = new Set(sourceAnalysis.map(s => s.domain)).size;
    
    return {
      brandMentionRate,
      totalPrompts: allResponses.length, // Use full dataset count
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
