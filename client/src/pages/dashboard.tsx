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
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const urlRunId = new URLSearchParams(searchString).get('runId');

  const { data: analysisRuns } = useQuery<AnalysisRun[]>({
    queryKey: ['/api/analysis/runs'],
  });

  const selectedRunId = urlRunId || 'all';

  const setSelectedRunId = (id: string) => {
    setLocation(`/?runId=${id}`);
  };

  const providerValue = selectedProvider !== 'all' ? selectedProvider : undefined;

  // Load brand name from DB
  useEffect(() => {
    fetch('/api/settings/brand').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.brandName) setBrandName(data.brandName);
    }).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Brand Analytics {brandName && <span className="text-blue-600">({brandName})</span>}
          </h1>
          <p className="text-gray-600">
            Track your brand mentions across AI responses
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={selectedProvider} onValueChange={setSelectedProvider}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Providers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Providers</SelectItem>
              <SelectItem value="perplexity">Perplexity</SelectItem>
              <SelectItem value="chatgpt">ChatGPT</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
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

      <MetricsOverview runId={selectedRunId !== 'all' ? selectedRunId : undefined} provider={providerValue} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopicAnalysis runId={selectedRunId !== 'all' ? selectedRunId : undefined} provider={providerValue} />
        <CompetitorAnalysis runId={selectedRunId !== 'all' ? selectedRunId : undefined} provider={providerValue} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentResults runId={selectedRunId !== 'all' ? selectedRunId : undefined} provider={providerValue} />
        <TopSources runId={selectedRunId !== 'all' ? selectedRunId : undefined} provider={providerValue} />
      </div>
    </div>
  );
}
