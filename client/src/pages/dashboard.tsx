import { useQuery } from "@tanstack/react-query";
import MetricsOverview from "@/components/metrics-overview";
import TopicAnalysis from "@/components/topic-analysis";
import CompetitorAnalysis from "@/components/competitor-analysis";
import RecentResults from "@/components/recent-results";
import TopSources from "@/components/top-sources";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";

interface AnalysisRun {
  id: number;
  startedAt: string;
  completedAt: string | null;
  status: string;
  brandName: string | null;
  totalPrompts: number;
  completedPrompts: number;
}

export default function Dashboard() {
  const [brandName, setBrandName] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>('all');
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const urlRunId = new URLSearchParams(searchString).get('runId');

  const { data: analysisRuns } = useQuery<AnalysisRun[]>({
    queryKey: ['/api/analysis/runs'],
  });

  const { data: modelsConfig } = useQuery<Record<string, { enabled: boolean; label?: string }>>({
    queryKey: ['/api/settings/models'],
  });
  const enabledModels = modelsConfig
    ? Object.entries(modelsConfig).filter(([, v]) => v.enabled)
    : [];

  const selectedRunId = urlRunId || 'all';

  const setSelectedRunId = (id: string) => {
    setLocation(`/?runId=${id}`);
  };

  const modelValue = selectedModel !== 'all' ? selectedModel : undefined;

  // Load brand name from DB
  useEffect(() => {
    fetch('/api/settings/brand').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.brandName) setBrandName(data.brandName);
    }).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            Brand Analytics {brandName && <span className="text-blue-600">({brandName})</span>}
          </h1>
          <p className="text-sm text-gray-600">
            Track your brand mentions across AI responses
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Models" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Models</SelectItem>
              {enabledModels.map(([key, config]) => (
                <SelectItem key={key} value={key}>{config.label || key}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {analysisRuns && analysisRuns.length > 0 && (
            <Select value={selectedRunId} onValueChange={setSelectedRunId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select analysis run" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Runs</SelectItem>
                {analysisRuns
                  .filter(r => r.status === 'complete')
                  .map(run => (
                    <SelectItem key={run.id} value={run.id.toString()}>
                      {new Date(run.startedAt).toLocaleDateString()} {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {run.brandName ? ` — ${run.brandName}` : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <MetricsOverview runId={selectedRunId !== 'all' ? selectedRunId : undefined} model={modelValue} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopicAnalysis runId={selectedRunId !== 'all' ? selectedRunId : undefined} model={modelValue} />
        <CompetitorAnalysis runId={selectedRunId !== 'all' ? selectedRunId : undefined} model={modelValue} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentResults runId={selectedRunId !== 'all' ? selectedRunId : undefined} model={modelValue} />
        <TopSources runId={selectedRunId !== 'all' ? selectedRunId : undefined} model={modelValue} />
      </div>
    </div>
  );
}
