import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle } from "lucide-react";
import { MODEL_META } from "@shared/models";

interface ModelConfig {
  [key: string]: {
    enabled: boolean;
    type: string;
    label?: string;
  };
}

const MODEL_INFO = MODEL_META;

export function AnalysisLlmCard() {
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
        method: 'PUT',
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
        method: 'PUT',
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
        method: 'PUT',
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
