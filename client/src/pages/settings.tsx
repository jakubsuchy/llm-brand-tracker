import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, Save, CheckCircle, XCircle, Globe, X, Plus, ShieldX, Trash2, Clock } from "lucide-react";

const SETTINGS_TABS = ['brand', 'credentials', 'models', 'sources', 'danger'] as const;
const WIZARD_TABS = ['brand', 'credentials', 'models'] as const;

export default function SettingsPage({ wizardMode = false }: { wizardMode?: boolean }) {
  const [, setLocation] = useLocation();
  const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
  const initialTab = SETTINGS_TABS.includes(hash as any) ? hash : 'brand';
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const onHashChange = () => {
      const h = window.location.hash.slice(1);
      if (SETTINGS_TABS.includes(h as any)) setActiveTab(h);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  const apifyRef = useRef<ApifyTokenCardRef>(null);
  const { toast } = useToast();

  const { data: openaiStatus } = useQuery<{ hasKey: boolean }>({
    queryKey: ['/api/settings/openai-key'],
  });
  const { data: anthropicStatus } = useQuery<{ hasKey: boolean }>({
    queryKey: ['/api/settings/anthropic-key'],
  });
  const hasAnyLlmKey = openaiStatus?.hasKey || anthropicStatus?.hasKey || false;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">{wizardMode ? 'Setup' : 'Settings'}</h1>
          <p className="text-gray-600">{wizardMode ? 'Configure your brand tracker to get started' : 'Configure your brand tracker'}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="max-w-2xl">
        <TabsList className="mb-6 h-auto flex-wrap gap-1">
          {wizardMode ? (
            <>
              <TabsTrigger value="brand">1. Brand</TabsTrigger>
              <TabsTrigger value="credentials">2. Credentials</TabsTrigger>
              <TabsTrigger value="models">3. Models</TabsTrigger>
            </>
          ) : (
            <>
              <TabsTrigger value="brand">Brand</TabsTrigger>
              <TabsTrigger value="credentials">Credentials</TabsTrigger>
              <TabsTrigger value="models">Models</TabsTrigger>
              <TabsTrigger value="sources">Sources</TabsTrigger>
              <TabsTrigger value="danger">Danger</TabsTrigger>
            </>
          )}</TabsList>

        <TabsContent value="brand" className="space-y-6">
          <BrandDetailsCard wizardMode={wizardMode} onContinue={() => handleTabChange('credentials')} />
          {!wizardMode && <AnalysisScheduleCard />}
        </TabsContent>

        <TabsContent value="credentials" className="space-y-6">
          <AnalysisLlmCard />
          <ApifyTokenCard ref={apifyRef} />
          {wizardMode && (
            <Button onClick={async () => {
              if (!hasAnyLlmKey) {
                toast({ title: "API Key required", description: "Please configure at least one analysis LLM key (OpenAI or Anthropic)", variant: "destructive" });
                return;
              }
              await apifyRef.current?.savePending();
              handleTabChange('models');
            }} className="w-full">
              Continue to Models →
            </Button>
          )}
        </TabsContent>

        <TabsContent value="models" className="space-y-6">
          <ModelsCard />
          {wizardMode && (
            <Button onClick={() => setLocation('/prompt-generator')} className="w-full">
              Continue to Prompt Generator →
            </Button>
          )}
        </TabsContent>

        {!wizardMode && (
          <TabsContent value="sources" className="space-y-6">
            <CompetitorSubdomainsCard />
            <CompetitorExclusionsCard />
          </TabsContent>
        )}

        {!wizardMode && (
          <TabsContent value="danger" className="space-y-6">
            <DangerZoneCard />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

interface ModelConfig {
  [key: string]: {
    enabled: boolean;
    type: string;
    label?: string;
  };
}

const MODEL_INFO: Record<string, { label: string; description: string; icon: string }> = {
  perplexity: {
    label: 'Perplexity',
    description: 'Browser-based. Uses residential proxy. Returns responses with source citations.',
    icon: '🔍',
  },
  chatgpt: {
    label: 'ChatGPT',
    description: 'Browser-based. Supports anonymous and authenticated mode. Returns responses with sources.',
    icon: '💬',
  },
  gemini: {
    label: 'Google Gemini',
    description: 'Browser-based. Google AI responses with grounding sources.',
    icon: '✨',
  },
  'google-aimode': {
    label: 'Google AI Mode',
    description: 'Browser-based. Google Search AI Mode with web-grounded responses.',
    icon: '🌐',
  },
};

function AnalysisLlmCard() {
  const { toast } = useToast();
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data: llmSetting, refetch: refetchLlm } = useQuery<{ llm: string }>({
    queryKey: ['/api/settings/analysis-llm'],
  });
  const { data: openaiStatus, refetch: refetchOpenai } = useQuery<{ hasKey: boolean }>({
    queryKey: ['/api/settings/openai-key'],
  });
  const { data: anthropicStatus, refetch: refetchAnthropic } = useQuery<{ hasKey: boolean }>({
    queryKey: ['/api/settings/anthropic-key'],
  });

  const currentLlm = llmSetting?.llm || 'openai';

  const switchLlm = async (llm: string) => {
    // Allow switching even without key — they'll enter it after
    try {
      const res = await fetch('/api/settings/analysis-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      refetchLlm();
      toast({ title: "Switched", description: `Analysis LLM set to ${llm === 'openai' ? 'OpenAI' : 'Anthropic'}` });
    } catch (error) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    }
  };

  const saveOpenaiKey = async () => {
    if (!openaiKey.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/openai-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: openaiKey.trim() }),
      });
      if (res.ok) {
        toast({ title: "Success", description: "OpenAI API key saved and validated" });
        setOpenaiKey("");
        refetchOpenai();
      } else {
        toast({ title: "Error", description: "Invalid OpenAI API key", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to save key", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const saveAnthropicKey = async () => {
    if (!anthropicKey.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/anthropic-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: anthropicKey.trim() }),
      });
      if (res.ok) {
        toast({ title: "Success", description: "Anthropic API key saved and validated" });
        setAnthropicKey("");
        refetchAnthropic();
      } else {
        toast({ title: "Error", description: "Invalid Anthropic API key", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to save key", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis LLM</CardTitle>
        <p className="text-sm text-gray-600">
          Choose which LLM processes your analysis (competitor extraction, prompt generation, categorization).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* OpenAI option */}
          <div
            onClick={() => switchLlm('openai')}
            className={`p-4 rounded-lg border-2 cursor-pointer transition-colors ${
              currentLlm === 'openai'
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">OpenAI</div>
                <div className="text-xs text-gray-500 mt-0.5">GPT-4o</div>
              </div>
              {openaiStatus?.hasKey && (
                <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200">
                  <CheckCircle className="h-3 w-3 mr-1" /> Connected
                </Badge>
              )}
            </div>
            {currentLlm === 'openai' && !openaiStatus?.hasKey && (
              <div className="mt-3 pt-3 border-t" onClick={e => e.stopPropagation()}>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="sk-..."
                    value={openaiKey}
                    onChange={e => setOpenaiKey(e.target.value)}
                    className="flex-1 h-8 text-sm"
                  />
                  <Button size="sm" onClick={saveOpenaiKey} disabled={isSaving || !openaiKey.trim()}>
                    {isSaving ? 'Checking...' : 'Connect'}
                  </Button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  Get your key at{' '}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                    platform.openai.com/api-keys
                  </a>
                </p>
              </div>
            )}
          </div>

          {/* Anthropic option */}
          <div
            onClick={() => switchLlm('anthropic')}
            className={`p-4 rounded-lg border-2 cursor-pointer transition-colors ${
              currentLlm === 'anthropic'
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Anthropic</div>
                <div className="text-xs text-gray-500 mt-0.5">Claude Sonnet 4.6</div>
              </div>
              {anthropicStatus?.hasKey && (
                <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200">
                  <CheckCircle className="h-3 w-3 mr-1" /> Connected
                </Badge>
              )}
            </div>
            {currentLlm === 'anthropic' && !anthropicStatus?.hasKey && (
              <div className="mt-3 pt-3 border-t" onClick={e => e.stopPropagation()}>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="sk-ant-..."
                    value={anthropicKey}
                    onChange={e => setAnthropicKey(e.target.value)}
                    className="flex-1 h-8 text-sm"
                  />
                  <Button size="sm" onClick={saveAnthropicKey} disabled={isSaving || !anthropicKey.trim()}>
                    {isSaving ? 'Checking...' : 'Connect'}
                  </Button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  Get your key at{' '}
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                    console.anthropic.com
                  </a>
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ModelsCard() {
  const { toast } = useToast();
  const { data: config, refetch } = useQuery<ModelConfig>({
    queryKey: ['/api/settings/models'],
  });

  const toggleModel = async (name: string) => {
    if (!config) return;
    const updated = { ...config, [name]: { ...config[name], enabled: !config[name].enabled } };
    try {
      const res = await fetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error('Failed');
      refetch();
      const model = MODEL_INFO[name]?.label || name;
      const enabled = updated[name].enabled;
      toast({ title: enabled ? 'Enabled' : 'Disabled', description: `${model} ${enabled ? 'will be included' : 'will be skipped'} in analysis runs` });
    } catch {
      toast({ title: 'Error', description: 'Failed to update model', variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis Models</CardTitle>
        <p className="text-sm text-gray-600">
          Choose which models to query during analysis. Each enabled model generates one response per prompt.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {config && Object.entries(config).map(([name, settings]) => {
          const info = MODEL_INFO[name] || { label: name, description: '', icon: '🤖' };
          return (
            <div key={name} className={`flex items-center justify-between p-4 rounded-lg border ${settings.enabled ? 'border-blue-200 bg-blue-50/50' : 'border-gray-200 bg-gray-50'}`}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{info.icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{info.label}</span>
                    <Badge variant="outline" className="text-xs">{settings.type}</Badge>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{info.description}</p>
                </div>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={() => toggleModel(name)}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function BrandDetailsCard({ wizardMode, onContinue }: { wizardMode?: boolean; onContinue?: () => void } = {}) {
  const [brandUrl, setBrandUrl] = useState('');
  const [brandName, setBrandName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const { data, refetch } = useQuery<{ brandUrl: string | null; brandName: string | null }>({
    queryKey: ['/api/settings/brand'],
  });

  // Populate fields from DB on load
  useState(() => {
    if (data) {
      if (data.brandUrl && !brandUrl) setBrandUrl(data.brandUrl);
      if (data.brandName && !brandName) setBrandName(data.brandName);
    }
  });

  // Update fields when data loads
  const displayUrl = brandUrl || data?.brandUrl || '';
  const displayName = brandName || data?.brandName || '';

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandUrl: brandUrl || data?.brandUrl || '',
          brandName: brandName || data?.brandName || '',
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      refetch();
      toast({ title: "Saved", description: "Brand details updated" });
    } catch {
      toast({ title: "Error", description: "Failed to save brand details", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Brand Details
          {data?.brandName && (
            <Badge className="bg-green-100 text-green-800 border-green-200">
              <CheckCircle className="h-3 w-3 mr-1" />
              {data.brandName}
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-gray-600">
          Your brand identity used for analysis. The Prompt Generator reads these values.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="brandUrl">Brand Website URL</Label>
          <Input
            id="brandUrl"
            type="url"
            placeholder="https://example.com"
            value={brandUrl || data?.brandUrl || ''}
            onChange={(e) => setBrandUrl(e.target.value)}
          />
          <p className="text-xs text-gray-500">Used to scrape brand content and generate relevant analysis topics</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="brandName">Brand Name</Label>
          <Input
            id="brandName"
            placeholder="My Brand"
            value={brandName || data?.brandName || ''}
            onChange={(e) => setBrandName(e.target.value)}
          />
          <p className="text-xs text-gray-500">Used to detect brand mentions in LLM responses</p>
        </div>
        <Button onClick={async () => { await handleSave(); if (wizardMode && onContinue) onContinue(); }} disabled={isSaving} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? 'Saving...' : wizardMode ? 'Save and continue to Credentials →' : 'Save Brand Details'}
        </Button>
      </CardContent>
    </Card>
  );
}

function AnalysisScheduleCard() {
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const { data, refetch } = useQuery<{ frequency: string; nextRun: string | null }>({
    queryKey: ['/api/settings/analysis-schedule'],
  });

  const handleChange = async (frequency: string) => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/analysis-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency }),
      });
      if (!res.ok) throw new Error('Failed to save');
      refetch();
      toast({ title: "Saved", description: `Analysis schedule set to ${frequency}` });
    } catch {
      toast({ title: "Error", description: "Failed to save schedule", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const nextRun = data?.nextRun ? new Date(data.nextRun) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Analysis Schedule
        </CardTitle>
        <p className="text-sm text-gray-600">
          How often to automatically run brand analysis. Runs at 3:00 AM local time.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Frequency</Label>
          <Select
            value={data?.frequency || 'manual'}
            onValueChange={handleChange}
            disabled={isSaving}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="hourly">Hourly</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {nextRun && data?.frequency !== 'manual' && (
          <p className="text-sm text-gray-600">
            Next run: {nextRun.toLocaleDateString()} {nextRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        {data?.frequency === 'manual' && (
          <p className="text-sm text-gray-500">
            Analysis will only run when started manually from the Analysis page.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export interface ApifyTokenCardRef {
  savePending: () => Promise<void>;
}

const ApifyTokenCard = forwardRef<ApifyTokenCardRef>(function ApifyTokenCard(_props, ref) {
  const [token, setToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const { data: tokenStatus, refetch: refetchToken } = useQuery<{ hasToken: boolean }>({
    queryKey: ['/api/settings/apify-token'],
  });

  const { data: browserStatus } = useQuery<{ mode: string; hasApifyToken: boolean; localContainerUp: boolean }>({
    queryKey: ['/api/settings/browser-status'],
    refetchInterval: 10000,
  });

  useImperativeHandle(ref, () => ({
    savePending: async () => {
      if (token.trim()) await handleSave();
    },
  }));

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/apify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      toast({ title: "Saved", description: token.trim() ? "Apify token saved and validated" : "Apify token removed" });
      setToken("");
      refetchToken();
    } catch (error) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveToken = async () => {
    setIsSaving(true);
    try {
      await fetch('/api/settings/apify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '' }),
      });
      toast({ title: "Removed", description: "Switched to local mode" });
      refetchToken();
    } catch {
      toast({ title: "Error", description: "Failed to remove token", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const { refetch: refetchStatus } = useQuery<any>({
    queryKey: ['/api/settings/browser-status'],
  });

  const switchMode = async (newMode: 'local' | 'cloud') => {
    try {
      await fetch('/api/settings/browser-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      refetchStatus();
      toast({ title: "Switched", description: `Browser mode set to ${newMode}` });
    } catch {
      toast({ title: "Error", description: "Failed to switch mode", variant: "destructive" });
    }
  };

  const mode = browserStatus?.mode || 'none';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Browser Analysis Mode
          {mode === 'cloud' && (
            <Badge className="bg-green-100 text-green-800 border-green-200">
              <CheckCircle className="h-3 w-3 mr-1" /> Cloud
            </Badge>
          )}
          {mode === 'local' && (
            <Badge className="bg-blue-100 text-blue-800 border-blue-200">
              <CheckCircle className="h-3 w-3 mr-1" /> Local
            </Badge>
          )}
          {mode === 'none' && (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
              <XCircle className="h-3 w-3 mr-1" /> Not Available
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-gray-600">
          Browser models (Perplexity, ChatGPT, Gemini) need a browser runtime to fetch responses.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Local option */}
          <div
            onClick={() => browserStatus?.localContainerUp && switchMode('local')}
            className={`p-4 rounded-lg border-2 transition-colors ${mode === 'local' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'} ${browserStatus?.localContainerUp ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">Local Container</span>
              {mode === 'local' && <Badge className="bg-blue-100 text-blue-700 text-xs">Active</Badge>}
            </div>
            <div className="text-xs text-gray-500 mb-2 space-y-0.5">
              <div>Cost: <span className="font-medium text-green-700">Free</span></div>
              <div>Speed: <span className="font-medium">~1 prompt/min</span></div>
              <div className="text-gray-400">May get blocked by anti-bot protections</div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {browserStatus?.localContainerUp ? (
                <Badge className="bg-green-100 text-green-700"><CheckCircle className="h-3 w-3 mr-1" /> Running</Badge>
              ) : (
                <Badge variant="outline" className="text-gray-500"><XCircle className="h-3 w-3 mr-1" /> Not running</Badge>
              )}
            </div>
            {!browserStatus?.localContainerUp && (
              <p className="text-xs text-gray-400 mt-2">
                Start with: <code className="bg-gray-100 px-1 rounded">docker compose up -d</code>
              </p>
            )}
          </div>

          {/* Cloud option */}
          <div
            onClick={() => tokenStatus?.hasToken && switchMode('cloud')}
            className={`p-4 rounded-lg border-2 transition-colors ${mode === 'cloud' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'} ${tokenStatus?.hasToken ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">Apify Cloud</span>
              {mode === 'cloud' && <Badge className="bg-green-100 text-green-700 text-xs">Active</Badge>}
            </div>
            <div className="text-xs text-gray-500 mb-2 space-y-0.5">
              <div>Cost: <span className="font-medium text-amber-700">~$0.05/prompt</span></div>
              <div>Speed: <span className="font-medium">~15 prompts/min</span></div>
              <div className="text-gray-400">Residential proxies, no anti-bot issues</div>
            </div>
            {tokenStatus?.hasToken ? (
              <div className="flex items-center gap-2">
                <Badge className="bg-green-100 text-green-700"><CheckCircle className="h-3 w-3 mr-1" /> Connected</Badge>
                <button onClick={handleRemoveToken} className="text-xs text-red-500 hover:text-red-700 underline" disabled={isSaving}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="space-y-2 mt-2">
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="apify_api_..."
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="flex-1 h-8 text-sm"
                  />
                  <Button size="sm" onClick={handleSave} disabled={isSaving || !token.trim()}>
                    {isSaving ? '...' : 'Connect'}
                  </Button>
                </div>
                <p className="text-xs text-gray-400">
                  Get token at{' '}
                  <a href="https://apify.com/?fpr=1lkb9a" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                    apify.com
                  </a>
                </p>
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">We receive a small commission if you use Apify Cloud.</p>
      </CardContent>
    </Card>
  );
});

function CompetitorSubdomainsCard() {
  const { toast } = useToast();
  const [newPrefix, setNewPrefix] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, refetch } = useQuery<{ prefixes: string[] }>({
    queryKey: ['/api/settings/competitor-subdomains'],
  });

  const prefixes = data?.prefixes || ['docs'];

  const addPrefix = () => {
    const cleaned = newPrefix.trim().toLowerCase();
    if (!cleaned || prefixes.includes(cleaned)) {
      setNewPrefix('');
      return;
    }
    savePrefixes([...prefixes, cleaned]);
    setNewPrefix('');
  };

  const removePrefix = (prefix: string) => {
    savePrefixes(prefixes.filter(p => p !== prefix));
  };

  const savePrefixes = async (updated: string[]) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/competitor-subdomains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: updated }),
      });
      if (!res.ok) throw new Error('Failed to save');
      refetch();
      toast({ title: "Saved", description: "Subdomain prefixes updated" });
    } catch {
      toast({ title: "Error", description: "Failed to save subdomain settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Competitor Subdomain Recognition
        </CardTitle>
        <p className="text-sm text-gray-600">
          Automatically recognize subdomains as competitor sources. Add a prefix like "docs" to match docs.paypal.com → paypal.com for any competitor, or a full domain like "techdocs.f5.com" to map that specific subdomain to f5.com.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {prefixes.map(prefix => (
            <Badge key={prefix} variant="secondary" className="text-sm gap-1 pl-3 pr-1 py-1">
              {prefix.includes('.') ? prefix : `${prefix}.*`}
              <button
                onClick={() => removePrefix(prefix)}
                className="hover:bg-gray-300 rounded-full p-0.5 ml-1"
                disabled={saving}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Add prefix (e.g. api, blog) or full domain (e.g. techdocs.f5.com)"
            value={newPrefix}
            onChange={(e) => setNewPrefix(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPrefix()}
            className="flex-1"
          />
          <Button variant="outline" onClick={addPrefix} disabled={!newPrefix.trim() || saving}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
        <p className="text-xs text-gray-500">
          Prefixes: docs, api, blog, support, developer, learn. Full domains: techdocs.f5.com, status.stripe.com
        </p>
      </CardContent>
    </Card>
  );
}

function CompetitorExclusionsCard() {
  const { toast } = useToast();
  const [newEntry, setNewEntry] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, refetch } = useQuery<{ entries: string[] }>({
    queryKey: ['/api/settings/competitor-blocklist'],
  });

  const entries = data?.entries || [];

  const addEntry = () => {
    const cleaned = newEntry.trim().toLowerCase();
    if (!cleaned || entries.includes(cleaned)) {
      setNewEntry('');
      return;
    }
    saveEntries([...entries, cleaned]);
    setNewEntry('');
  };

  const removeEntry = (entry: string) => {
    saveEntries(entries.filter(e => e !== entry));
  };

  const saveEntries = async (updated: string[]) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/competitor-blocklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: updated }),
      });
      if (!res.ok) throw new Error('Failed to save');
      refetch();
      toast({ title: "Saved", description: "Exclusion list updated" });
    } catch {
      toast({ title: "Error", description: "Failed to save exclusion list", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldX className="h-5 w-5" />
          Not Competitors
        </CardTitle>
        <p className="text-sm text-gray-600">
          Names and domains that should never be classified as competitors. These are review sites, social platforms, and other neutral sources that LLMs sometimes mention alongside products. You can also reclassify directly from the Competitors page.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {entries.map(entry => (
            <Badge key={entry} variant="secondary" className="text-sm gap-1 pl-3 pr-1 py-1">
              {entry}
              <button
                onClick={() => removeEntry(entry)}
                className="hover:bg-gray-300 rounded-full p-0.5 ml-1"
                disabled={saving}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Add name or domain (e.g. wikipedia.org, Forrester)"
            value={newEntry}
            onChange={(e) => setNewEntry(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            className="flex-1"
          />
          <Button variant="outline" onClick={addEntry} disabled={!newEntry.trim() || saving}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DangerZoneCard() {
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const handleClear = async (type: string, description: string) => {
    setIsDeleting(type);
    try {
      const res = await fetch('/api/data/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error('Failed to clear data');
      toast({ title: "Data cleared", description });
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      toast({ title: "Error", description: "Failed to clear data. Please try again.", variant: "destructive" });
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-700">
          <Trash2 className="h-5 w-5" />
          Danger Zone
        </CardTitle>
        <p className="text-sm text-gray-600">
          Irreversible actions that delete analysis data
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Delete results only */}
        <div className="flex items-center justify-between p-4 bg-amber-50 rounded-lg border border-amber-200">
          <div>
            <h4 className="font-medium text-amber-900">Delete results only</h4>
            <p className="text-sm text-amber-700 mt-1">
              Deletes responses, competitors, sources, analysis runs, and cost data.
              Keeps your prompts, topics, and settings so you can re-run analysis.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="ml-4 shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100" disabled={!!isDeleting}>
                <Trash2 className="h-4 w-4 mr-2" />
                {isDeleting === 'results' ? 'Deleting...' : 'Delete Results'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete analysis results?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete all responses, competitors, sources, analysis runs, and cost logs.
                  Your prompts and topics will be preserved. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleClear('results', 'Results cleared. Prompts and topics preserved.')}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  Yes, delete results
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Delete everything */}
        <div className="flex items-center justify-between p-4 bg-red-50 rounded-lg border border-red-200">
          <div>
            <h4 className="font-medium text-red-900">Delete everything</h4>
            <p className="text-sm text-red-700 mt-1">
              Deletes all prompts, topics, responses, competitors, sources, runs, and cost data.
              Only settings are preserved.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="ml-4 shrink-0" disabled={!!isDeleting}>
                <Trash2 className="h-4 w-4 mr-2" />
                {isDeleting === 'nuclear' ? 'Deleting...' : 'Delete All Data'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete ALL analysis data including prompts, topics,
                  responses, competitors, sources, analysis runs, and cost logs.
                  Only your settings will be preserved. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleClear('nuclear', 'All data cleared. Settings preserved.')}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Yes, delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

