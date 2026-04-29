import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, X, CheckCircle, AlertCircle, RefreshCw, PenLine, GripVertical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PromptItem {
  id?: number;
  text: string;
}

interface TopicWithPrompts {
  id?: number;
  name: string;
  description: string;
  prompts: PromptItem[];
}

interface CompetitorSuggestion {
  name: string;
  url: string;
  category: string;
  validated: boolean;
}

interface GenerationSettings {
  promptsPerTopic: number;
  numberOfTopics: number;
  diversityThreshold: number; // Minimum % difference between prompts
  customTopics: string[]; // User-specified topics to use instead of AI-generated ones
}

export default function PromptGeneratorPage() {
  const { toast } = useToast();

  const [brandUrl, setBrandUrl] = useState("");
  const [competitors, setCompetitors] = useState<CompetitorSuggestion[]>([]);
  const [settings, setSettings] = useState<GenerationSettings>({
    promptsPerTopic: 2,
    numberOfTopics: 2,
    diversityThreshold: 50,
    customTopics: []
  });
  const [newTopicInput, setNewTopicInput] = useState('');
  const [generatedTopics, setGeneratedTopics] = useState<TopicWithPrompts[]>([]);
  const [currentStep, setCurrentStep] = useState<'url' | 'competitors' | 'settings' | 'topics' | 'ready'>('url');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [customTopicName, setCustomTopicName] = useState('');
  const [customTopicDescription, setCustomTopicDescription] = useState('');
  const [isAddingCustomTopic, setIsAddingCustomTopic] = useState(false);
  const [dragOverTopicIndex, setDragOverTopicIndex] = useState<number | null>(null);

  // Load state from DB on mount
  const { data: dbTopicsWithPrompts } = useQuery<TopicWithPrompts[]>({
    queryKey: ['/api/topics/with-prompts'],
  });

  const { data: dbCompetitors } = useQuery<CompetitorSuggestion[]>({
    queryKey: ['/api/competitors'],
  });

  useEffect(() => {
    // Load brand URL from DB settings
    fetch('/api/settings/brand').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.brandUrl) setBrandUrl(data.brandUrl);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (dbTopicsWithPrompts && dbTopicsWithPrompts.length > 0) {
      setGeneratedTopics(dbTopicsWithPrompts.map(t => ({
        ...t,
        prompts: t.prompts.map((p: any) => typeof p === 'string' ? { text: p } : p)
      })));
      // Determine step based on available data
      setCurrentStep('topics');
    }
  }, [dbTopicsWithPrompts]);

  useEffect(() => {
    if (dbCompetitors && dbCompetitors.length > 0 && competitors.length === 0) {
      setCompetitors(dbCompetitors.map((c: any) => ({
        name: c.name,
        url: '',
        category: c.category || 'Custom',
        validated: true
      })));
    }
  }, [dbCompetitors]);

  // Analyze brand URL and suggest competitors
  const analyzeUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      console.log(`[${new Date().toISOString()}] analyzeUrlMutation.mutationFn called with URL: ${url}`);
      const response = await apiRequest('POST', `/api/analyze-brand`, { url });
      console.log(`[${new Date().toISOString()}] analyzeUrlMutation response received`);
      return response.json();
    },
    onSuccess: (data: any) => {
      console.log(`[${new Date().toISOString()}] analyzeUrlMutation onSuccess called with data:`, data);
      setCompetitors(data.competitors.map((comp: any) => ({ ...comp, validated: true })));
      setCurrentStep('competitors');
      toast({
        title: "Brand analyzed",
        description: `Found ${data.competitors.length} competitors (auto-validated)`,
      });
    },
    onError: (error: any) => {
      console.error(`[${new Date().toISOString()}] analyzeUrlMutation onError called:`, error);
      toast({
        title: "Analysis failed",
        description: "Unable to analyze the brand URL. Please check the URL and try again.",
        variant: "destructive",
      });
    }
  });

  // Generate topics and prompts
  const generatePromptsMutation = useMutation({
    mutationFn: async () => {
      setIsGenerating(true);
      setGenerationProgress(0);
      
      const response = await apiRequest('POST', `/api/generate-prompts`, {
        brandUrl,
        competitors: competitors.filter(c => c.validated),
        settings
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      setGeneratedTopics(data.topics.map((t: any) => ({
        ...t,
        prompts: t.prompts.map((p: any) => typeof p === 'string' ? { text: p } : p)
      })));
      setCurrentStep('topics');
      setIsGenerating(false);
      toast({
        title: "Prompts generated",
        description: `Created ${data.topics.length} topics with diverse prompts`,
      });
    },
    onError: () => {
      setIsGenerating(false);
      toast({
        title: "Generation failed",
        description: "Unable to generate prompts. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Save prompts and run analysis
  const runAnalysisMutation = useMutation({
    mutationFn: async () => {
      const topicsPayload = generatedTopics.map(t => ({
        ...t,
        prompts: t.prompts.map(p => typeof p === 'string' ? p : p.text)
      }));
      const response = await apiRequest('POST', `/api/save-and-analyze`, { topics: topicsPayload, brandUrl });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/prompts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/progress'] });
      toast({
        title: "Analysis started",
        description: "New prompts saved and analysis is running",
      });
      setCurrentStep('ready');
    }
  });

  const handleAnalyzeBrand = () => {
    console.log(`[${new Date().toISOString()}] handleAnalyzeBrand called with URL: ${brandUrl}`);
    if (!brandUrl.trim()) {
      toast({
        title: "URL required",
        description: "Please enter a brand URL to analyze",
        variant: "destructive",
      });
      return;
    }
    console.log(`[${new Date().toISOString()}] Starting brand analysis for: ${brandUrl}`);
    analyzeUrlMutation.mutate(brandUrl);
  };



  const addCustomCompetitor = () => {
    setCompetitors(prev => [...prev, {
      name: "",
      url: "",
      category: "Custom",
      validated: true
    }]);
  };

  const updateCompetitor = (index: number, field: keyof CompetitorSuggestion, value: string) => {
    setCompetitors(prev => prev.map((comp, i) => 
      i === index ? { ...comp, [field]: value } : comp
    ));
  };

  const removeCompetitor = (index: number) => {
    setCompetitors(prev => prev.filter((_, i) => i !== index));
  };

  const addCustomTopic = async () => {
    if (!customTopicName.trim() || !customTopicDescription.trim()) {
      toast({
        title: "Topic details required",
        description: "Please provide both topic name and description",
        variant: "destructive",
      });
      return;
    }

    setIsAddingCustomTopic(true);
    try {
      const topicRes = await apiRequest('POST', '/api/topics', {
        name: customTopicName,
        description: customTopicDescription,
      });
      const topic = await topicRes.json();

      const response = await apiRequest('POST', '/api/generate-topic-prompts', {
        topicName: customTopicName,
        topicDescription: customTopicDescription,
        competitors: competitors.filter(c => c.validated),
        promptCount: settings.promptsPerTopic
      });
      const data = await response.json();

      const savedPrompts = await Promise.all(
        (data.prompts as string[]).map(async (text) => {
          const r = await apiRequest('POST', '/api/prompts/test', { text, topicId: topic.id });
          const j = await r.json();
          return { id: j.prompt?.id, text };
        })
      );

      const newTopic: TopicWithPrompts = {
        id: topic.id,
        name: customTopicName,
        description: customTopicDescription,
        prompts: savedPrompts,
      };

      setGeneratedTopics(prev => [...prev, newTopic]);
      setCustomTopicName('');
      setCustomTopicDescription('');
      queryClient.invalidateQueries({ queryKey: ['/api/topics/with-prompts'] });

      toast({
        title: "Topic added",
        description: `Created ${savedPrompts.length} prompts for "${customTopicName}"`,
      });
    } catch (error) {
      toast({
        title: "Failed to add topic",
        description: "Unable to create topic and generate prompts",
        variant: "destructive",
      });
    } finally {
      setIsAddingCustomTopic(false);
    }
  };

  const proceedToSettings = () => {
    const validCompetitors = competitors.filter(c => c.name.trim());
    if (validCompetitors.length === 0) {
      toast({
        title: "Competitors required",
        description: "Please add at least one competitor",
        variant: "destructive",
      });
      return;
    }
    setCurrentStep('settings');
  };

  const startOver = async () => {
    try {
      console.log(`[${new Date().toISOString()}] Starting over - clearing database...`);
      const response = await apiRequest('POST', '/api/data/clear', { type: 'all' });
      const result = await response.json();
      console.log(`[${new Date().toISOString()}] Database cleared:`, result);
      
      queryClient.invalidateQueries({ queryKey: ['/api/topics/with-prompts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/competitors'] });
      setBrandUrl("");
      setCompetitors([]);
      setSettings({
        promptsPerTopic: 10,
        numberOfTopics: 5,
        diversityThreshold: 50,
        customTopics: []
      });
      setGeneratedTopics([]);
      setCurrentStep('url');
      setIsGenerating(false);
      setGenerationProgress(0);
      setCustomTopicName('');
      setCustomTopicDescription('');
      setIsAddingCustomTopic(false);
      toast({
        title: "Reset complete",
        description: "All data cleared and starting fresh",
      });
    } catch (error) {
      console.error('Failed to clear database:', error);
      toast({
        title: "Reset failed",
        description: "Failed to clear database data",
        variant: "destructive",
      });
    }
  };

  const navigateToStep = (step: 'url' | 'competitors' | 'settings' | 'topics' | 'ready') => {
    setCurrentStep(step);
  };

  const movePromptToTopic = async (
    promptId: number,
    fromTopicIndex: number,
    fromPromptIndex: number,
    toTopicIndex: number,
  ) => {
    if (fromTopicIndex === toTopicIndex) return;
    const targetTopic = generatedTopics[toTopicIndex];
    const sourceTopic = generatedTopics[fromTopicIndex];
    if (!targetTopic?.id || !sourceTopic) return;
    const movedPrompt = sourceTopic.prompts[fromPromptIndex];
    if (!movedPrompt) return;

    const snapshot = generatedTopics;
    setGeneratedTopics(prev => prev.map((t, i) => {
      if (i === fromTopicIndex) {
        return { ...t, prompts: t.prompts.filter((_, pi) => pi !== fromPromptIndex) };
      }
      if (i === toTopicIndex) {
        return { ...t, prompts: [...t.prompts, movedPrompt] };
      }
      return t;
    }));

    try {
      await apiRequest('PATCH', `/api/prompts/${promptId}`, { topicId: targetTopic.id });
      queryClient.invalidateQueries({ queryKey: ['/api/topics/with-prompts'] });
    } catch (error) {
      setGeneratedTopics(snapshot);
      toast({
        title: "Move failed",
        description: "Could not move the prompt. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-bold">Prompt Generator</h1>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={startOver}>
            Start Over
          </Button>
        </div>
      </div>

      {/* Progress Navigation */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              <Button
                variant={currentStep === 'url' ? "default" : "outline"}
                size="sm"
                onClick={() => navigateToStep('url')}
              >
                1. Brand URL
              </Button>
              <Button 
                variant={currentStep === 'competitors' ? "default" : "outline"} 
                size="sm"
                onClick={() => navigateToStep('competitors')}
                disabled={!brandUrl}
              >
                2. Competitors
              </Button>
              <Button 
                variant={currentStep === 'settings' ? "default" : "outline"} 
                size="sm"
                onClick={() => navigateToStep('settings')}
                disabled={competitors.length === 0}
              >
                3. Settings
              </Button>
              <Button
                variant={currentStep === 'topics' ? "default" : "outline"}
                size="sm"
                onClick={() => navigateToStep('topics')}
              >
                4. Review
              </Button>
              <Button 
                variant={currentStep === 'ready' ? "default" : "outline"} 
                size="sm"
                onClick={() => navigateToStep('ready')}
                disabled={currentStep !== 'ready'}
              >
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
          <CardHeader>
            <CardTitle>Brand Analysis</CardTitle>
          </CardHeader>
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
            <Button 
              onClick={handleAnalyzeBrand}
              disabled={analyzeUrlMutation.isPending}
              className="w-full"
            >
              {analyzeUrlMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing Brand...
                </>
              ) : (
                'Analyze Brand & Find Competitors'
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Competitor Validation */}
      {currentStep === 'competitors' && (
        <Card>
          <CardHeader>
            <CardTitle>Review Competitors</CardTitle>
            <p className="text-sm text-gray-600">
              Review the suggested competitors. Remove any irrelevant ones or add custom competitors.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {competitors.map((competitor, index) => (
              <div key={index} className="flex items-center space-x-3 p-3 border rounded-lg bg-green-50">
                <div className="flex-1 space-y-2">
                  <Input
                    placeholder="Competitor name"
                    value={competitor.name}
                    onChange={(e) => updateCompetitor(index, 'name', e.target.value)}
                  />
                  <Input
                    placeholder="Competitor URL"
                    value={competitor.url}
                    onChange={(e) => updateCompetitor(index, 'url', e.target.value)}
                  />
                </div>
                <Badge variant="default" className="bg-green-600">
                  {competitor.category}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCompetitor(index)}
                  className="text-red-600 hover:text-red-800"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            
            <div className="flex space-x-2">
              <Button variant="outline" onClick={addCustomCompetitor}>
                <Plus className="mr-2 h-4 w-4" />
                Add Custom Competitor
              </Button>
              <Button onClick={proceedToSettings} className="flex-1">
                Continue to Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Generation Settings */}
      {currentStep === 'settings' && (
        <Card>
          <CardHeader>
            <CardTitle>Prompt Generation Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="promptsPerTopic">Prompts per Topic</Label>
                <Input
                  id="promptsPerTopic"
                  type="number"
                  min="5"
                  max="50"
                  value={settings.promptsPerTopic}
                  onChange={(e) => setSettings(prev => ({ ...prev, promptsPerTopic: parseInt(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <Label htmlFor="numberOfTopics">Number of Topics</Label>
                <Input
                  id="numberOfTopics"
                  type="number"
                  min="3"
                  max="10"
                  value={settings.numberOfTopics}
                  onChange={(e) => setSettings(prev => ({ ...prev, numberOfTopics: parseInt(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <Label htmlFor="diversityThreshold">Diversity Threshold (%)</Label>
                <Input
                  id="diversityThreshold"
                  type="number"
                  min="30"
                  max="80"
                  value={settings.diversityThreshold}
                  onChange={(e) => setSettings(prev => ({ ...prev, diversityThreshold: parseInt(e.target.value) || 50 }))}
                />
              </div>
            </div>

            {/* Custom Topics */}
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
                      setSettings(prev => ({
                        ...prev,
                        customTopics: [...(prev.customTopics ?? []), newTopicInput.trim()]
                      }));
                      setNewTopicInput('');
                    }
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    if (newTopicInput.trim()) {
                      setSettings(prev => ({
                        ...prev,
                        customTopics: [...(prev.customTopics ?? []), newTopicInput.trim()]
                      }));
                      setNewTopicInput('');
                    }
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {(settings.customTopics ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(settings.customTopics ?? []).map((topic, index) => (
                    <Badge key={index} variant="secondary" className="flex items-center gap-1 px-3 py-1">
                      {topic}
                      <button
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          customTopics: (prev.customTopics ?? []).filter((_, i) => i !== index)
                        }))}
                        className="ml-1 hover:text-red-600"
                      >
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
            <Button 
              onClick={() => generatePromptsMutation.mutate()}
              disabled={generatePromptsMutation.isPending}
              className="w-full"
            >
              {generatePromptsMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating Prompts...
                </>
              ) : (
                'Generate Topics & Prompts'
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Generation Progress */}
      {isGenerating && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Generating prompts...</span>
                <span>{Math.round(generationProgress)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                  style={{ width: `${generationProgress}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Topic & Prompt Review */}
      {currentStep === 'topics' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg sm:text-xl font-semibold">Review Generated Topics & Prompts</h2>
            {generatedTopics.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={() => generatePromptsMutation.mutate()}
                  disabled={generatePromptsMutation.isPending}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerate
                </Button>
                <Button
                  onClick={() => runAnalysisMutation.mutate()}
                  disabled={runAnalysisMutation.isPending}
                  className="w-full sm:w-auto whitespace-normal text-center"
                >
                  {runAnalysisMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Starting Analysis...
                    </>
                  ) : (
                    `Run Analysis with ${generatedTopics.reduce((sum, t) => sum + t.prompts.length, 0)} Prompts`
                  )}
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {generatedTopics.map((topic, topicIndex) => (
              <Card
                key={topic.id || topicIndex}
                onDragOver={(e) => {
                  if (!topic.id) return;
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
                  const fromTopicIndex = parseInt(e.dataTransfer.getData('fromTopicIndex'));
                  const fromPromptIndex = parseInt(e.dataTransfer.getData('fromPromptIndex'));
                  if (!Number.isFinite(promptId) || !Number.isFinite(fromTopicIndex) || !Number.isFinite(fromPromptIndex)) return;
                  movePromptToTopic(promptId, fromTopicIndex, fromPromptIndex, topicIndex);
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
                      onClick={async () => {
                        if (topic.id) {
                          await fetch(`/api/topics/${topic.id}`, { method: 'DELETE' });
                          queryClient.invalidateQueries({ queryKey: ['/api/topics/with-prompts'] });
                        }
                        setGeneratedTopics(prev => prev.filter((_, i) => i !== topicIndex));
                      }}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 -mt-1 -mr-2"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {topic.prompts.map((prompt, pIndex) => {
                      const promptObj = typeof prompt === 'string' ? { text: prompt } : prompt;
                      const canDrag = typeof promptObj.id === 'number';
                      return (
                        <div
                          key={promptObj.id || pIndex}
                          draggable={canDrag}
                          onDragStart={(e) => {
                            if (!canDrag) return;
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('promptId', String(promptObj.id));
                            e.dataTransfer.setData('fromTopicIndex', String(topicIndex));
                            e.dataTransfer.setData('fromPromptIndex', String(pIndex));
                          }}
                          className="flex items-start gap-1 group"
                        >
                          <span
                            className={`text-gray-300 group-hover:text-gray-500 mt-2 shrink-0 ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed'}`}
                            title={canDrag ? 'Drag to another topic' : 'Save prompt before moving'}
                          >
                            <GripVertical className="h-4 w-4" />
                          </span>
                          <p className="text-sm text-gray-700 p-2 bg-gray-50 rounded flex-1">
                            {promptObj.text}
                          </p>
                          <button
                            onClick={async () => {
                              if (promptObj.id) {
                                await fetch(`/api/prompts/${promptObj.id}`, { method: 'DELETE' });
                                queryClient.invalidateQueries({ queryKey: ['/api/topics/with-prompts'] });
                              }
                              setGeneratedTopics(prev => prev.map((t, i) =>
                                i === topicIndex
                                  ? { ...t, prompts: t.prompts.filter((_, pi) => pi !== pIndex) }
                                  : t
                              ));
                            }}
                            className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 mt-1 shrink-0"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <WriteInPrompt
                    topicId={topic.id}
                    topicName={topic.name}
                    topicDescription={topic.description}
                    onAdd={(prompt) => {
                      setGeneratedTopics(prev => prev.map((t, i) =>
                        i === topicIndex
                          ? { ...t, prompts: [...t.prompts, prompt] }
                          : t
                      ));
                    }}
                    onTopicCreated={(id) => {
                      setGeneratedTopics(prev => prev.map((t, i) =>
                        i === topicIndex ? { ...t, id } : t
                      ));
                    }}
                  />
                </CardContent>
              </Card>
            ))}
            
            {/* Add Custom Topic Card */}
            <Card className="border-dashed border-2 border-gray-300">
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <Plus className="h-8 w-8 text-gray-400 mx-auto" />
                  <div className="space-y-3">
                    <Input
                      placeholder="Topic name (e.g., API Management)"
                      value={customTopicName}
                      onChange={(e) => setCustomTopicName(e.target.value)}
                    />
                    <Input
                      placeholder="Topic description"
                      value={customTopicDescription}
                      onChange={(e) => setCustomTopicDescription(e.target.value)}
                    />
                    <Button 
                      onClick={addCustomTopic}
                      disabled={isAddingCustomTopic}
                      className="w-full"
                    >
                      {isAddingCustomTopic ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Generating Prompts...
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Add Custom Topic
                        </>
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
            <p className="text-gray-600 mb-4">
              Your new prompts have been saved and the analysis is now running with the diverse, weighted prompts.
            </p>
            <Button onClick={() => window.location.href = '/analysis-progress'}>
              View Analysis Progress
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function WriteInPrompt({ topicId, topicName, topicDescription, onAdd, onTopicCreated }: {
  topicId?: number;
  topicName: string;
  topicDescription: string;
  onAdd: (prompt: PromptItem) => void;
  onTopicCreated?: (id: number) => void;
}) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleAdd = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setIsSaving(true);
    try {
      let resolvedTopicId = topicId;
      if (!resolvedTopicId) {
        const topicRes = await apiRequest('POST', '/api/topics', {
          name: topicName,
          description: topicDescription,
        });
        const topic = await topicRes.json();
        resolvedTopicId = topic.id;
        onTopicCreated?.(topic.id);
      }

      const res = await apiRequest('POST', '/api/prompts/test', { text: trimmed, topicId: resolvedTopicId });
      const data = await res.json();
      onAdd({ id: data.prompt?.id, text: trimmed });
      setText('');
      setIsOpen(false);
      queryClient.invalidateQueries({ queryKey: ['/api/topics/with-prompts'] });
    } catch (error) {
      console.error('Failed to add prompt:', error);
      toast({
        title: "Failed to add prompt",
        description: "Unable to save prompt to database",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
      >
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
      <Button size="sm" className="h-8 shrink-0" onClick={handleAdd} disabled={!text.trim() || isSaving}>
        {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Plus className="h-3 w-3 mr-1" /> Add</>}
      </Button>
      <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => { setIsOpen(false); setText(''); }}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}