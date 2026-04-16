import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { MODEL_META } from "@shared/models";

interface ModelConfig {
  [key: string]: {
    enabled: boolean;
    type: string;
    label?: string;
  };
}

const MODEL_INFO = MODEL_META;

export function ModelsCard() {
  const { toast } = useToast();
  const { data: config, refetch } = useQuery<ModelConfig>({
    queryKey: ['/api/settings/models'],
  });

  const toggleModel = async (name: string) => {
    if (!config) return;
    const updated = { ...config, [name]: { ...config[name], enabled: !config[name].enabled } };
    try {
      const res = await fetch('/api/settings/models', {
        method: 'PUT',
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
