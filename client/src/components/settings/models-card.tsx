import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { MODEL_META } from "@shared/models";
import { ModelLogo } from "@/components/model-logos";
import { Lightbulb } from "lucide-react";

interface ModelConfig {
  [key: string]: {
    enabled: boolean;
    type: string;
    label?: string;
    keyAvailable?: boolean;
  };
}

// Model key → setting key needed to unlock it. Kept in the component so the
// "Add API key" hint can point the user to the right field; matches the
// server-side gate in /api/settings/models.
const API_KEY_REQUIREMENT: Record<string, { label: string; settingPath: string }> = {
  'openai-api': { label: 'OpenAI API key', settingPath: 'Settings → Credentials' },
  'anthropic-api': { label: 'Anthropic API key', settingPath: 'Settings → Credentials' },
};

const MODEL_INFO = MODEL_META;

export function ModelsCard({ wizardMode = false }: { wizardMode?: boolean }) {
  const { toast } = useToast();
  const { data: config, refetch } = useQuery<ModelConfig>({
    queryKey: ['/api/settings/models'],
  });

  const saveConfig = async (updated: ModelConfig) => {
    const res = await fetch('/api/settings/models', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed');
    }
  };

  const toggleModel = async (name: string) => {
    if (!config) return;
    const current = config[name];
    // Guard against enabling an api model whose key isn't configured — the
    // server rejects it too, but a toast here saves a round-trip and explains why.
    if (!current.enabled && current.keyAvailable === false) {
      const req = API_KEY_REQUIREMENT[name];
      toast({
        title: 'API key required',
        description: req ? `Add your ${req.label} in ${req.settingPath} before enabling this model.` : 'Add it in Settings → Credentials.',
        variant: 'destructive',
      });
      return;
    }
    const updated = { ...config, [name]: { ...current, enabled: !current.enabled } };
    try {
      await saveConfig(updated);
      refetch();
      const model = MODEL_INFO[name]?.label || name;
      const enabled = updated[name].enabled;
      toast({ title: enabled ? 'Enabled' : 'Disabled', description: `${model} ${enabled ? 'will be included' : 'will be skipped'} in analysis runs` });
    } catch (error) {
      toast({ title: 'Error', description: (error as Error).message || 'Failed to update model', variant: 'destructive' });
    }
  };

  const setAllBrowser = async (enable: boolean) => {
    if (!config) return;
    const updated: ModelConfig = { ...config };
    for (const [name, s] of Object.entries(config)) {
      if (s.type === 'browser') updated[name] = { ...s, enabled: enable };
    }
    try {
      await saveConfig(updated);
      refetch();
      toast({ title: enable ? 'Enabled' : 'Disabled', description: `All browser models ${enable ? 'enabled' : 'disabled'}` });
    } catch (error) {
      toast({ title: 'Error', description: (error as Error).message || 'Failed to update models', variant: 'destructive' });
    }
  };

  const renderFullRow = ([name, settings]: [string, ModelConfig[string]]) => {
    const info = MODEL_INFO[name] || { label: name, description: '', icon: '🤖' };
    const keyMissing = settings.type === 'api' && settings.keyAvailable === false;
    const requirement = API_KEY_REQUIREMENT[name];
    const rowClass = keyMissing
      ? 'border-gray-200 bg-gray-50 opacity-70'
      : settings.enabled
        ? 'border-blue-200 bg-blue-50/50'
        : 'border-gray-200 bg-gray-50';
    return (
      <div key={name} className={`flex items-center justify-between p-4 rounded-lg border ${rowClass}`}>
        <div className="flex items-center gap-3">
          <ModelLogo
            model={name}
            size={28}
            fallback={<span className="text-2xl">{info.icon}</span>}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{info.label}</span>
              <Badge
                variant="outline"
                className={`text-xs ${settings.type === 'api' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-sky-300 text-sky-700 bg-sky-50'}`}
              >
                {settings.type === 'api' ? 'API based' : 'Browser based'}
              </Badge>
              {keyMissing && (
                <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">
                  Key required
                </Badge>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{info.description}</p>
            {keyMissing && requirement && (
              <p className="text-xs text-amber-700 mt-1">
                Add your {requirement.label} in <span className="font-medium">{requirement.settingPath}</span> to enable.
              </p>
            )}
          </div>
        </div>
        <Switch
          checked={settings.enabled}
          disabled={keyMissing}
          onCheckedChange={() => toggleModel(name)}
        />
      </div>
    );
  };

  const renderCompactChip = ([name, settings]: [string, ModelConfig[string]]) => {
    const info = MODEL_INFO[name] || { label: name, description: '', icon: '🤖' };
    const chipClass = settings.enabled
      ? 'border-blue-200 bg-blue-50/50 text-slate-700'
      : 'border-gray-200 bg-gray-50 text-gray-500';
    return (
      <div key={name} className={`flex items-center gap-2 px-3 py-2 rounded-md border ${chipClass}`}>
        <ModelLogo
          model={name}
          size={18}
          fallback={<span className="text-base">{info.icon}</span>}
        />
        <span className="text-sm">{info.label}</span>
      </div>
    );
  };

  const entries = config ? Object.entries(config) : [];
  const apiEntries = entries.filter(([, s]) => s.type === 'api');
  const browserEntries = entries.filter(([, s]) => s.type === 'browser');
  const allBrowserOn = browserEntries.length > 0 && browserEntries.every(([, s]) => s.enabled);

  if (wizardMode) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Analysis Models</CardTitle>
          <p className="text-sm text-gray-600">
            Choose which models to query during analysis. You can fine-tune individual models later in Settings → Models.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* API section */}
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-sm">API Models</h3>
              <p className="text-xs text-gray-500">
                Fastest to set up — just needs an API key. Auto-enabled when a key is present.
              </p>
            </div>
            {apiEntries.map(renderFullRow)}
          </div>

          {/* Browser section */}
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-sm">Browser Models</h3>
              <p className="text-xs text-gray-500">
                Slower but more accurate — replays what a real user sees in the chat UI. Requires an Apify token.
              </p>
            </div>
            <div className={`flex items-center justify-between p-4 rounded-lg border ${allBrowserOn ? 'border-blue-200 bg-blue-50/50' : 'border-gray-200 bg-gray-50'}`}>
              <div>
                <div className="font-medium">Enable all browser models</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Toggles {browserEntries.length} model{browserEntries.length === 1 ? '' : 's'} at once. You can fine-tune individually later.
                </div>
              </div>
              <Switch
                checked={allBrowserOn}
                onCheckedChange={(checked) => setAllBrowser(!!checked)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {browserEntries.map(renderCompactChip)}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis Models</CardTitle>
        <p className="text-sm text-gray-600">
          Choose which models to query during analysis. Each enabled model generates one response per prompt.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-3 border-l-[3px] border-amber-400 bg-amber-50/60 px-3 py-2.5 rounded-r-sm">
          <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-slate-700 leading-relaxed">
            <span className="font-semibold text-slate-900">Browser vs API — which to pick?</span>{' '}
            <span className="font-semibold text-emerald-700">API</span> is faster to set up (just a key) and great for first-run testing.{' '}
            <span className="font-semibold text-sky-700">Browser</span> is slower but more accurate — it replays what a real user sees in the chat UI. Enabling both gives you quick signal plus ground truth.
          </div>
        </div>
        {config && entries
          // API-based models come first — they're the fastest to set up
          // (just an API key, no browser actor) and we default-enable them
          // when the key is present, so they're effectively the primary path.
          .sort(([, a], [, b]) => {
            const rank = (t: string) => t === 'api' ? 0 : 1;
            return rank(a.type) - rank(b.type);
          })
          .map(renderFullRow)}
      </CardContent>
    </Card>
  );
}
