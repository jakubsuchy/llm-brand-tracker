// Prompt generator — server-state-only design.
//
// There is NO React state for topics or prompts. Everything renders from the
// `/api/topics/with-prompts` query, and every edit is a mutation that
// invalidates the query. Generating prompts persists them server-side; the
// UI never holds unsaved data.
//
// Form-input state (brand URL, competitors, settings, in-progress text
// fields) is the only React-local state in this page. Step navigation is
// also local — that's pure UI position, not data.

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, X, CheckCircle, RefreshCw, PenLine, GripVertical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PromptItem {
  id: number;
  text: string;
}

interface TopicWithPrompts {
  id: number;
  name: string;
  description: string | null;
  prompts: PromptItem[];
}

interface DbCompetitor {
  id: number;
  name: string;
  category: string | null;
  // `domain` is the persisted form of the legacy "URL" field — the user
  // edits a URL, we strip to host and store on competitors.domain. Used
  // by the source classifier so cited URLs from this domain map back to
  // this competitor.
  domain: string | null;
}

interface GenerationSettings {
  promptsPerTopic: number;
  numberOfTopics: number;
  diversityThreshold: number;
  customTopics: string[];
}

type ExtractionMode = 'static' | 'dynamic';

const TOPICS_QUERY_KEY = ['/api/topics/with-prompts'] as const;
const COMPETITORS_QUERY_KEY = ['/api/competitors'] as const;
const EXTRACTION_MODE_QUERY_KEY = ['/api/settings/competitor-extraction-mode'] as const;

function invalidateTopics() {
  queryClient.invalidateQueries({ queryKey: TOPICS_QUERY_KEY });
}
function invalidateCompetitors() {
  queryClient.invalidateQueries({ queryKey: COMPETITORS_QUERY_KEY });
}

export default function PromptGeneratorPage() {
  const { toast } = useToast();

  const [brandUrl, setBrandUrl] = useState("");
  const [settings, setSettings] = useState<GenerationSettings>({
    promptsPerTopic: 2,
    numberOfTopics: 2,
    diversityThreshold: 50,
    customTopics: [],
  });
  const [newTopicInput, setNewTopicInput] = useState('');
  const [currentStep, setCurrentStep] = useState<'url' | 'competitors' | 'settings' | 'topics' | 'ready'>('url');
  const [customTopicName, setCustomTopicName] = useState('');
  const [customTopicDescription, setCustomTopicDescription] = useState('');
  const [dragOverTopicIndex, setDragOverTopicIndex] = useState<number | null>(null);
  const [newCompetitorName, setNewCompetitorName] = useState('');
  const [newCompetitorUrl, setNewCompetitorUrl] = useState('');

  // Single source of truth for topic + prompt data.
  const { data: topicsData } = useQuery<TopicWithPrompts[]>({
    queryKey: TOPICS_QUERY_KEY,
  });
  const topics: TopicWithPrompts[] = topicsData || [];

  // Single source of truth for the competitors list. Every add / edit /
  // remove is a mutation; the React state used to hold this got drifty
  // between the DB and the UI.
  const { data: competitorsData } = useQuery<DbCompetitor[]>({
    queryKey: COMPETITORS_QUERY_KEY,
  });
  const competitors: DbCompetitor[] = competitorsData || [];

  // Static vs dynamic competitor extraction mode (analyzer setting).
  const { data: extractionModeData } = useQuery<{ mode: ExtractionMode }>({
    queryKey: EXTRACTION_MODE_QUERY_KEY,
  });
  const extractionMode: ExtractionMode = extractionModeData?.mode === 'static' ? 'static' : 'dynamic';

  // Load brand URL once on mount — form-input state, not data state.
  useEffect(() => {
    fetch('/api/settings/brand').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.brandUrl) setBrandUrl(data.brandUrl);
    }).catch(() => {});
  }, []);

  // Auto-jump to Step 4 once topics exist in the DB.
  useEffect(() => {
    if (topics.length > 0 && currentStep === 'url') {
      setCurrentStep('topics');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics.length > 0]);

  // ── Mutations ────────────────────────────────────────────────────

  const analyzeUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      const response = await apiRequest('POST', `/api/analyze-brand`, { url });
      const data = await response.json();
      // Persist the suggestions immediately. createCompetitor is idempotent
      // (revives soft-deleted; returns existing on duplicate name) so this
      // is safe to re-run.
      for (const comp of (data.competitors || [])) {
        await apiRequest('POST', '/api/competitors', {
          name: comp.name,
          category: comp.category || null,
        });
      }
      return data;
    },
    onSuccess: (data: any) => {
      invalidateCompetitors();
      setCurrentStep('competitors');
      toast({
        title: "Brand analyzed",
        description: `Found ${data.competitors.length} competitors`,
      });
    },
    onError: () => {
      toast({
        title: "Analysis failed",
        description: "Unable to analyze the brand URL. Please check the URL and try again.",
        variant: "destructive",
      });
    },
  });

  // Best-effort: convert whatever the user typed (a URL or a bare host) to
  // a domain string for storage. Bad input → null (we'll just save the
  // name without a domain rather than fail the add).
  const urlToDomain = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      return u.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return null;
    }
  };

  const addCompetitorMutation = useMutation({
    mutationFn: async ({ name, url }: { name: string; url: string }) => {
      const domain = urlToDomain(url);
      const r = await apiRequest('POST', '/api/competitors', { name, domain });
      return r.json();
    },
    onSuccess: () => {
      setNewCompetitorName('');
      setNewCompetitorUrl('');
      invalidateCompetitors();
    },
    onError: () => toast({ title: 'Failed to add competitor', variant: 'destructive' }),
  });

  const updateCompetitorMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: { name?: string; category?: string | null } }) => {
      const r = await apiRequest('PATCH', `/api/competitors/${id}`, patch);
      return r.json();
    },
    onSuccess: invalidateCompetitors,
    onError: (err: any) => toast({ title: 'Update failed', description: err?.message, variant: 'destructive' }),
  });

  const deleteCompetitorMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/competitors/${id}`, { method: 'DELETE' });
    },
    onSuccess: invalidateCompetitors,
    onError: () => toast({ title: 'Failed to remove competitor', variant: 'destructive' }),
  });

  const updateExtractionModeMutation = useMutation({
    mutationFn: async (mode: ExtractionMode) => {
      const r = await apiRequest('PUT', '/api/settings/competitor-extraction-mode', { mode });
      return r.json();
    },
    onSuccess: (_d, mode) => {
      queryClient.setQueryData(EXTRACTION_MODE_QUERY_KEY, { mode });
    },
    onError: () => toast({ title: 'Failed to update mode', variant: 'destructive' }),
  });

  const generatePromptsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/generate-prompts`, {
        brandUrl,
        competitors: competitors.map(c => ({ name: c.name, category: c.category })),
        settings,
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      // Server already persisted everything. We just refresh the query so
      // the UI picks up the new IDs and any newly-added prompts.
      invalidateTopics();
      setCurrentStep('topics');
      toast({
        title: "Prompts generated",
        description: `Created ${data.topics.length} topics with diverse prompts`,
      });
    },
    onError: () => {
      toast({
        title: "Generation failed",
        description: "Unable to generate prompts. Please try again.",
        variant: "destructive",
      });
    },
  });

  const runAnalysisMutation = useMutation({
    mutationFn: async () => {
      const topicsPayload = topics.map(t => ({
        ...t,
        prompts: t.prompts.map(p => p.text),
      }));
      const response = await apiRequest('POST', `/api/save-and-analyze`, { topics: topicsPayload, brandUrl });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/prompts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/progress'] });
      invalidateTopics();
      toast({
        title: "Analysis started",
        description: "New prompts saved and analysis is running",
      });
      setCurrentStep('ready');
    },
  });

  // Topic + prompt edits — every one of these immediately persists. The
  // single source of truth (the query) refreshes via invalidation.

  const deleteTopicMutation = useMutation({
    mutationFn: async (topicId: number) => {
      await fetch(`/api/topics/${topicId}`, { method: 'DELETE' });
    },
    onSuccess: invalidateTopics,
    onError: () => toast({ title: "Failed to delete topic", variant: "destructive" }),
  });

  const deletePromptMutation = useMutation({
    mutationFn: async (promptId: number) => {
      await fetch(`/api/prompts/${promptId}`, { method: 'DELETE' });
    },
    onSuccess: invalidateTopics,
    onError: () => toast({ title: "Failed to delete prompt", variant: "destructive" }),
  });

  const movePromptMutation = useMutation({
    mutationFn: async ({ promptId, topicId }: { promptId: number; topicId: number }) => {
      await apiRequest('PATCH', `/api/prompts/${promptId}`, { topicId });
    },
    onSuccess: invalidateTopics,
    onError: () => toast({ title: "Move failed", variant: "destructive" }),
  });

  const addCustomTopicMutation = useMutation({
    mutationFn: async () => {
      // POST /api/topics is find-or-create on name (server-side fix added
      // earlier), so re-using a name returns the existing topic instead of
      // duplicating it. The downstream prompt-generation step then dedupes
      // by text within that topic.
      const topicRes = await apiRequest('POST', '/api/topics', {
        name: customTopicName,
        description: customTopicDescription,
      });
      const topic = await topicRes.json();
      const response = await apiRequest('POST', '/api/generate-topic-prompts', {
        topicName: customTopicName,
        topicDescription: customTopicDescription,
        competitors,
        promptCount: settings.promptsPerTopic,
      });
      const data = await response.json();
      // Persist each generated prompt under the topic.
      for (const text of (data.prompts as string[])) {
        await apiRequest('POST', '/api/prompts/test', { text, topicId: topic.id });
      }
      return { topic, count: (data.prompts as string[]).length };
    },
    onSuccess: ({ count }) => {
      setCustomTopicName('');
      setCustomTopicDescription('');
      invalidateTopics();
      toast({
        title: "Topic added",
        description: `Created ${count} prompts for "${customTopicName}"`,
      });
    },
    onError: () => {
      toast({
        title: "Failed to add topic",
        description: "Unable to create topic and generate prompts",
        variant: "destructive",
      });
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────

  const handleAnalyzeBrand = () => {
    if (!brandUrl.trim()) {
      toast({ title: "URL required", description: "Please enter a brand URL to analyze", variant: "destructive" });
      return;
    }
    analyzeUrlMutation.mutate(brandUrl);
  };

  const handleAddCompetitor = () => {
    const name = newCompetitorName.trim();
    if (!name) return;
    addCompetitorMutation.mutate({ name, url: newCompetitorUrl });
  };

  const handleAddCustomTopic = () => {
    if (!customTopicName.trim() || !customTopicDescription.trim()) {
      toast({ title: "Topic details required", description: "Please provide both topic name and description", variant: "destructive" });
      return;
    }
    addCustomTopicMutation.mutate();
  };

  const proceedToSettings = () => {
    const validCompetitors = competitors.filter(c => c.name.trim());
    if (validCompetitors.length === 0) {
      toast({ title: "Competitors required", description: "Please add at least one competitor", variant: "destructive" });
      return;
    }
    setCurrentStep('settings');
  };

  const startOver = async () => {
    try {
      await apiRequest('POST', '/api/data/clear', { type: 'all' });
      invalidateTopics();
      invalidateCompetitors();
      setBrandUrl("");
      setSettings({ promptsPerTopic: 10, numberOfTopics: 5, diversityThreshold: 50, customTopics: [] });
      setCurrentStep('url');
      setCustomTopicName('');
      setCustomTopicDescription('');
      toast({ title: "Reset complete", description: "All data cleared and starting fresh" });
    } catch {
      toast({ title: "Reset failed", description: "Failed to clear database data", variant: "destructive" });
    }
  };

  const navigateToStep = (step: typeof currentStep) => setCurrentStep(step);

  const totalPrompts = topics.reduce((sum, t) => sum + t.prompts.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-bold">Prompt Generator</h1>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={startOver}>Start Over</Button>
        </div>
      </div>

      {/* Progress Navigation */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              <Button variant={currentStep === 'url' ? "default" : "outline"} size="sm" onClick={() => navigateToStep('url')}>
                1. Brand URL
              </Button>
              <Button variant={currentStep === 'competitors' ? "default" : "outline"} size="sm" onClick={() => navigateToStep('competitors')} disabled={!brandUrl}>
                2. Competitors
              </Button>
              <Button variant={currentStep === 'settings' ? "default" : "outline"} size="sm" onClick={() => navigateToStep('settings')} disabled={competitors.length === 0}>
                3. Settings
              </Button>
              <Button variant={currentStep === 'topics' ? "default" : "outline"} size="sm" onClick={() => navigateToStep('topics')}>
                4. Review
              </Button>
              <Button variant={currentStep === 'ready' ? "default" : "outline"} size="sm" onClick={() => navigateToStep('ready')} disabled={currentStep !== 'ready'}>
                5. Complete
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Progress indicator */}
      <div className="hidden sm:flex items-center space-x-4">
        {['url', 'competitors', 'settings', 'topics', 'ready'].map((step, index) => (
          <div key={step} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              currentStep === step ? 'bg-blue-600 text-white' :
              ['url', 'competitors', 'settings', 'topics'].indexOf(currentStep) > index ? 'bg-green-600 text-white' :
              'bg-gray-200 text-gray-600'
            }`}>
              {['url', 'competitors', 'settings', 'topics'].indexOf(currentStep) > index ?
                <CheckCircle className="h-4 w-4" /> : index + 1
              }
            </div>
            {index < 4 && <div className="w-8 h-0.5 bg-gray-200" />}
          </div>
        ))}
      </div>

      {/* Step 1: Brand URL */}
      {currentStep === 'url' && (
        <Card>
          <CardHeader><CardTitle>Brand Analysis</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="brandUrl">Brand Website URL</Label>
              <Input
                id="brandUrl"
                placeholder="https://yourbrand.com"
                value={brandUrl}
                onChange={(e) => setBrandUrl(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button onClick={handleAnalyzeBrand} disabled={analyzeUrlMutation.isPending} className="w-full">
              {analyzeUrlMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing Brand...</>
              ) : 'Analyze Brand & Find Competitors'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Competitor Validation */}
      {currentStep === 'competitors' && (
        <Card>
          <CardHeader>
            <CardTitle>Review Competitors</CardTitle>
            <p className="text-sm text-gray-600">Edit, remove, or add competitors. Every change saves to the database immediately — no draft state.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Static / Dynamic mode toggle. Persisted as a setting; affects
                every analysis run from the moment it's saved. */}
            <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
              <div className="flex items-center gap-3">
                <select
                  id="extraction-mode"
                  className="text-sm border rounded px-2 py-1 bg-white shrink-0"
                  value={extractionMode}
                  onChange={(e) => updateExtractionModeMutation.mutate(e.target.value as ExtractionMode)}
                  disabled={updateExtractionModeMutation.isPending}
                >
                  <option value="dynamic">Dynamic — discover new</option>
                  <option value="static">Static — fixed list</option>
                </select>
                <Label htmlFor="extraction-mode" className="text-sm font-medium text-slate-800">
                  Competitor extraction mode
                </Label>
              </div>
              {extractionMode === 'dynamic' ? (
                <p className="text-xs text-slate-600">
                  <strong className="text-slate-800">Dynamic.</strong> Each analysis run asks the LLM to find new competitors in addition to your list. Catches emerging players, but may add irrelevant or hallucinated names. <em>Costs an extra LLM call per response.</em>
                </p>
              ) : (
                <p className="text-xs text-slate-600">
                  <strong className="text-slate-800">Static.</strong> Only the competitors below are matched (case-insensitive regex). 100% accurate to your curated list, no surprises. <em>No LLM calls for competitor extraction — faster and cheaper.</em>
                </p>
              )}
            </div>

            {competitors.length === 0 && (
              <div className="text-sm text-slate-500 p-4 text-center bg-white border rounded-lg">
                No competitors yet. Add one below or run brand analysis from Step 1.
              </div>
            )}

            {competitors.map(competitor => (
              <div key={competitor.id} className="flex items-center space-x-3 p-3 border rounded-lg bg-green-50">
                <div className="flex-1 space-y-2">
                  <Input
                    placeholder="Competitor name"
                    defaultValue={competitor.name}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next && next !== competitor.name) {
                        updateCompetitorMutation.mutate({ id: competitor.id, patch: { name: next } });
                      } else if (!next) {
                        e.target.value = competitor.name;  // restore on empty
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />
                  <Input
                    placeholder="Competitor URL (optional)"
                    defaultValue={competitor.domain || ''}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const nextDomain = urlToDomain(raw);
                      const current = competitor.domain || null;
                      if ((nextDomain || null) === current) return;
                      if (raw && !nextDomain) {
                        e.target.value = current || '';
                        toast({ title: 'Invalid URL', variant: 'destructive' });
                        return;
                      }
                      updateCompetitorMutation.mutate({ id: competitor.id, patch: { domain: nextDomain } });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />
                </div>
                {competitor.category && (
                  <Badge variant="default" className="bg-green-600">{competitor.category}</Badge>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteCompetitorMutation.mutate(competitor.id)}
                  disabled={deleteCompetitorMutation.isPending}
                  className="text-red-600 hover:text-red-800"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <div className="flex flex-col sm:flex-row gap-2 items-start">
              <div className="flex-1 w-full space-y-2">
                <Input
                  placeholder="Competitor name"
                  value={newCompetitorName}
                  onChange={(e) => setNewCompetitorName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCompetitor();
                    }
                  }}
                />
                <Input
                  placeholder="Competitor URL (optional)"
                  value={newCompetitorUrl}
                  onChange={(e) => setNewCompetitorUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCompetitor();
                    }
                  }}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={(e) => { e.preventDefault(); handleAddCompetitor(); }}
                disabled={!newCompetitorName.trim() || addCompetitorMutation.isPending}
              >
                {addCompetitorMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-2 h-4 w-4" /> Add</>}
              </Button>
            </div>

            <Button type="button" onClick={proceedToSettings} className="w-full">Continue to Settings</Button>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Generation Settings */}
      {currentStep === 'settings' && (
        <Card>
          <CardHeader><CardTitle>Prompt Generation Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="promptsPerTopic">Prompts per Topic</Label>
                <Input id="promptsPerTopic" type="number" min="5" max="50" value={settings.promptsPerTopic} onChange={(e) => setSettings(prev => ({ ...prev, promptsPerTopic: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label htmlFor="numberOfTopics">Number of Topics</Label>
                <Input id="numberOfTopics" type="number" min="3" max="10" value={settings.numberOfTopics} onChange={(e) => setSettings(prev => ({ ...prev, numberOfTopics: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label htmlFor="diversityThreshold">Diversity Threshold (%)</Label>
                <Input id="diversityThreshold" type="number" min="30" max="80" value={settings.diversityThreshold} onChange={(e) => setSettings(prev => ({ ...prev, diversityThreshold: parseInt(e.target.value) || 50 }))} />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Custom Topics (optional)</Label>
              <p className="text-sm text-gray-600">
                Specify your own topics instead of letting AI generate them. If you add fewer than the number above, the rest will be AI-generated.
              </p>
              <div className="flex space-x-2">
                <Input
                  placeholder="e.g. Enterprise pricing, Developer experience, Migration from competitors"
                  value={newTopicInput}
                  onChange={(e) => setNewTopicInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTopicInput.trim()) {
                      setSettings(prev => ({ ...prev, customTopics: [...(prev.customTopics ?? []), newTopicInput.trim()] }));
                      setNewTopicInput('');
                    }
                  }}
                />
                <Button variant="outline" onClick={() => {
                  if (newTopicInput.trim()) {
                    setSettings(prev => ({ ...prev, customTopics: [...(prev.customTopics ?? []), newTopicInput.trim()] }));
                    setNewTopicInput('');
                  }
                }}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {(settings.customTopics ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(settings.customTopics ?? []).map((topic, index) => (
                    <Badge key={index} variant="secondary" className="flex items-center gap-1 px-3 py-1">
                      {topic}
                      <button onClick={() => setSettings(prev => ({ ...prev, customTopics: (prev.customTopics ?? []).filter((_, i) => i !== index) }))} className="ml-1 hover:text-red-600">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 bg-blue-50 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-2">Generation Summary</h4>
              <p className="text-sm text-blue-800">
                {(settings.customTopics ?? []).length > 0 ? (
                  <>
                    Will use <strong>{(settings.customTopics ?? []).length} custom topic{(settings.customTopics ?? []).length !== 1 ? 's' : ''}</strong>
                    {(settings.customTopics ?? []).length < settings.numberOfTopics && (
                      <> + <strong>{settings.numberOfTopics - (settings.customTopics ?? []).length} AI-generated</strong></>
                    )} with{' '}
                  </>
                ) : (
                  <>Will generate <strong>{settings.numberOfTopics} topics</strong> with{' '}</>
                )}
                <strong>{settings.promptsPerTopic} prompts each</strong> ({Math.max(settings.numberOfTopics, (settings.customTopics ?? []).length) * settings.promptsPerTopic} total).
                Prompts will differ by at least <strong>{settings.diversityThreshold}%</strong> in word content.
              </p>
            </div>
            <Button onClick={() => generatePromptsMutation.mutate()} disabled={generatePromptsMutation.isPending} className="w-full">
              {generatePromptsMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating Prompts...</>
              ) : 'Generate Topics & Prompts'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Topic & Prompt Review */}
      {currentStep === 'topics' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg sm:text-xl font-semibold">Review Generated Topics & Prompts</h2>
            {topics.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={() => generatePromptsMutation.mutate()} disabled={generatePromptsMutation.isPending}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Regenerate
                </Button>
                <Button onClick={() => runAnalysisMutation.mutate()} disabled={runAnalysisMutation.isPending} className="w-full sm:w-auto whitespace-normal text-center">
                  {runAnalysisMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting Analysis...</>
                  ) : `Run Analysis with ${totalPrompts} Prompts`}
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {topics.map((topic, topicIndex) => (
              <Card
                key={topic.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverTopicIndex !== topicIndex) setDragOverTopicIndex(topicIndex);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setDragOverTopicIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverTopicIndex(null);
                  const promptId = parseInt(e.dataTransfer.getData('promptId'));
                  const fromTopicId = parseInt(e.dataTransfer.getData('fromTopicId'));
                  if (!Number.isFinite(promptId) || !Number.isFinite(fromTopicId)) return;
                  if (fromTopicId === topic.id) return;
                  movePromptMutation.mutate({ promptId, topicId: topic.id });
                }}
                className={dragOverTopicIndex === topicIndex ? 'ring-2 ring-blue-400 ring-offset-2' : ''}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{topic.name}</CardTitle>
                      <p className="text-sm text-gray-600">{topic.description}</p>
                      <Badge variant="secondary" className="mt-1">{topic.prompts.length} prompts</Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteTopicMutation.mutate(topic.id)}
                      disabled={deleteTopicMutation.isPending}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 -mt-1 -mr-2"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {topic.prompts.map(prompt => (
                      <div
                        key={prompt.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('promptId', String(prompt.id));
                          e.dataTransfer.setData('fromTopicId', String(topic.id));
                        }}
                        className="flex items-start gap-1 group"
                      >
                        <span className="text-gray-300 group-hover:text-gray-500 mt-2 shrink-0 cursor-grab active:cursor-grabbing" title="Drag to another topic">
                          <GripVertical className="h-4 w-4" />
                        </span>
                        <p className="text-sm text-gray-700 p-2 bg-gray-50 rounded flex-1">{prompt.text}</p>
                        <button
                          onClick={() => deletePromptMutation.mutate(prompt.id)}
                          disabled={deletePromptMutation.isPending}
                          className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 mt-1 shrink-0 disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <WriteInPrompt topicId={topic.id} />
                </CardContent>
              </Card>
            ))}

            {/* Add Custom Topic Card */}
            <Card className="border-dashed border-2 border-gray-300">
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <Plus className="h-8 w-8 text-gray-400 mx-auto" />
                  <div className="space-y-3">
                    <Input placeholder="Topic name (e.g., API Management)" value={customTopicName} onChange={(e) => setCustomTopicName(e.target.value)} />
                    <Input placeholder="Topic description" value={customTopicDescription} onChange={(e) => setCustomTopicDescription(e.target.value)} />
                    <Button onClick={handleAddCustomTopic} disabled={addCustomTopicMutation.isPending} className="w-full">
                      {addCustomTopicMutation.isPending ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating Prompts...</>
                      ) : (
                        <><Plus className="mr-2 h-4 w-4" /> Add Custom Topic</>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Step 5: Ready State */}
      {currentStep === 'ready' && (
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Analysis Started!</h3>
            <p className="text-gray-600 mb-4">Your new prompts have been saved and the analysis is now running with the diverse, weighted prompts.</p>
            <Button onClick={() => window.location.href = '/analysis-progress'}>View Analysis Progress</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Inline "Add custom prompt" — single mutation, no callbacks.
// `topicId` is required: the parent topic must exist (it's loaded from the
// /api/topics/with-prompts query, which only returns persisted topics with
// real IDs).
function WriteInPrompt({ topicId }: { topicId: number }) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState('');

  const addMutation = useMutation({
    mutationFn: async (promptText: string) => {
      await apiRequest('POST', '/api/prompts/test', { text: promptText, topicId });
    },
    onSuccess: () => {
      setText('');
      setIsOpen(false);
      invalidateTopics();
    },
    onError: () => {
      toast({ title: "Failed to add prompt", description: "Unable to save prompt to database", variant: "destructive" });
    },
  });

  const handleAdd = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    addMutation.mutate(trimmed);
  };

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
        <PenLine className="h-3 w-3" /> Add custom prompt
      </button>
    );
  }

  return (
    <div className="mt-2 flex gap-2">
      <Input
        placeholder="Type your own prompt..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        className="text-sm h-8"
        autoFocus
      />
      <Button size="sm" className="h-8 shrink-0" onClick={handleAdd} disabled={!text.trim() || addMutation.isPending}>
        {addMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Plus className="h-3 w-3 mr-1" /> Add</>}
      </Button>
      <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => { setIsOpen(false); setText(''); }}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
