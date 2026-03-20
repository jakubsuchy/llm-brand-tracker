import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Settings, Key, Save, CheckCircle, XCircle, BarChart3, Globe, X, Plus, ShieldX } from "lucide-react";

interface UsageData {
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    calls: number;
  };
  perRun: Array<{
    analysisRunId: number | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    calls: number;
    run: { id: number; startedAt: string; brandName: string | null; status: string } | null;
  }>;
}

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'none' | 'valid' | 'invalid'>('none');
  const [promptsPerTopic, setPromptsPerTopic] = useState("5");
  const [analysisFrequency, setAnalysisFrequency] = useState("manual");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const { toast } = useToast();

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      toast({
        title: "Error",
        description: "Please enter an OpenAI API key",
        variant: "destructive",
      });
      return;
    }

    setIsChecking(true);
    try {
      const response = await fetch('/api/settings/openai-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      if (response.ok) {
        setKeyStatus('valid');
        toast({
          title: "Success",
          description: "OpenAI API key saved and validated successfully",
        });
        setApiKey(""); // Clear the input for security
      } else {
        setKeyStatus('invalid');
        toast({
          title: "Error",
          description: "Invalid OpenAI API key or connection failed",
          variant: "destructive",
        });
      }
    } catch (error) {
      setKeyStatus('invalid');
      toast({
        title: "Error",
        description: "Failed to save API key. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleSaveAnalysisConfig = async () => {
    setIsSavingConfig(true);
    try {
      const response = await fetch('/api/settings/analysis-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          promptsPerTopic: parseInt(promptsPerTopic),
          analysisFrequency 
        }),
      });

      if (response.ok) {
        toast({
          title: "Success",
          description: "Analysis configuration saved successfully",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to save analysis configuration",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save analysis configuration",
        variant: "destructive",
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const getKeyStatusDisplay = () => {
    switch (keyStatus) {
      case 'valid':
        return (
          <Badge className="bg-green-100 text-green-800 border-green-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            Valid Key
          </Badge>
        );
      case 'invalid':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            <XCircle className="h-3 w-3 mr-1" />
            Invalid Key
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-gray-600">Configure your brand tracker</p>
        </div>
      </div>

      <div className="grid gap-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              OpenAI API Configuration
            </CardTitle>
            <p className="text-sm text-gray-600">
              Enter your OpenAI API key to enable real-time ChatGPT analysis
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">OpenAI API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="flex-1"
                />
                <Button 
                  onClick={handleSaveApiKey}
                  disabled={isChecking || !apiKey.trim()}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isChecking ? 'Checking...' : 'Save'}
                </Button>
              </div>
              {getKeyStatusDisplay()}
            </div>

            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h4 className="font-medium text-blue-900 mb-2">How to get your API key:</h4>
              <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                <li>Visit <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="underline">OpenAI API Keys</a></li>
                <li>Sign in to your OpenAI account</li>
                <li>Click "Create new secret key"</li>
                <li>Copy the key and paste it above</li>
              </ol>
            </div>

            <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
              <h4 className="font-medium text-yellow-900 mb-2">Important Notes:</h4>
              <ul className="text-sm text-yellow-800 space-y-1 list-disc list-inside">
                <li>Your API key is stored securely and only used for analysis</li>
                <li>Analysis requires OpenAI credits in your account</li>
                <li>Each prompt analysis costs approximately $0.01-0.03</li>
                <li>You can monitor usage in your OpenAI dashboard</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <CompetitorSubdomainsCard />

        <CompetitorExclusionsCard />

        <ApiUsageCard />

        <Card>
          <CardHeader>
            <CardTitle>Analysis Configuration</CardTitle>
            <p className="text-sm text-gray-600">
              Control how the brand tracking analysis runs
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Prompts per Topic</Label>
                <Input 
                  type="number" 
                  value={promptsPerTopic}
                  onChange={(e) => setPromptsPerTopic(e.target.value)}
                  min="1" 
                  max="20" 
                />
                <p className="text-xs text-gray-500">Number of test prompts to generate per topic</p>
              </div>
              
              <div className="space-y-2">
                <Label>Analysis Frequency</Label>
                <Select value={analysisFrequency} onValueChange={setAnalysisFrequency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual only</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">How often to run automatic analysis</p>
              </div>
            </div>

            <div className="pt-4 border-t">
              <Button 
                onClick={handleSaveAnalysisConfig}
                disabled={isSavingConfig}
                className="w-full"
              >
                <Save className="h-4 w-4 mr-2" />
                {isSavingConfig ? 'Saving...' : 'Save Analysis Settings'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

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

function ApiUsageCard() {
  const { data: usage, isLoading } = useQuery<UsageData>({
    queryKey: ['/api/usage'],
  });

  const formatNumber = (n: number) => n.toLocaleString();

  // Rough cost estimate: GPT-4o pricing ($2.50/1M input, $10/1M output)
  const estimateCost = (input: number, output: number) => {
    const cost = (input / 1_000_000) * 2.50 + (output / 1_000_000) * 10;
    return cost < 0.01 ? '< $0.01' : `$${cost.toFixed(2)}`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-gray-200 rounded w-1/3"></div>
            <div className="h-20 bg-gray-200 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!usage) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          API Usage
        </CardTitle>
        <p className="text-sm text-gray-600">
          OpenAI token usage across all analysis runs
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Totals */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 p-3 rounded-lg text-center">
            <div className="text-xl font-bold text-blue-700">{formatNumber(usage.totals.totalTokens)}</div>
            <div className="text-xs text-blue-600">Total Tokens</div>
          </div>
          <div className="bg-green-50 p-3 rounded-lg text-center">
            <div className="text-xl font-bold text-green-700">{formatNumber(usage.totals.inputTokens)}</div>
            <div className="text-xs text-green-600">Input Tokens</div>
          </div>
          <div className="bg-purple-50 p-3 rounded-lg text-center">
            <div className="text-xl font-bold text-purple-700">{formatNumber(usage.totals.outputTokens)}</div>
            <div className="text-xs text-purple-600">Output Tokens</div>
          </div>
          <div className="bg-amber-50 p-3 rounded-lg text-center">
            <div className="text-xl font-bold text-amber-700">{estimateCost(usage.totals.inputTokens, usage.totals.outputTokens)}</div>
            <div className="text-xs text-amber-600">Est. Cost (GPT-4o)</div>
          </div>
        </div>

        <div className="text-xs text-gray-500 text-right">
          {formatNumber(usage.totals.calls)} API calls total
        </div>

        {/* Per-run breakdown */}
        {usage.perRun.length > 0 && (
          <div className="pt-4 border-t">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Per-run breakdown</h4>
            <div className="bg-white rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Input</TableHead>
                    <TableHead className="text-right">Output</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Est. Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.perRun.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">
                        {row.run ? (
                          <span>
                            {new Date(row.run.startedAt).toLocaleDateString()}{' '}
                            {new Date(row.run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {row.run.brandName && <span className="text-gray-500 ml-1">({row.run.brandName})</span>}
                          </span>
                        ) : (
                          <span className="text-gray-400">Outside run</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{row.model}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">{formatNumber(row.inputTokens)}</TableCell>
                      <TableCell className="text-right text-sm">{formatNumber(row.outputTokens)}</TableCell>
                      <TableCell className="text-right text-sm">{row.calls}</TableCell>
                      <TableCell className="text-right text-sm text-amber-600">
                        {estimateCost(row.inputTokens, row.outputTokens)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}