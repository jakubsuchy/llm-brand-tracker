import { useQuery } from "@tanstack/react-query";
import MetricsOverview from "@/components/metrics-overview";
import VisibilityTrendChart from "@/components/visibility-trend-chart";
import ModelComparisonChart from "@/components/model-comparison-chart";
import CompetitorLandscapeChart from "@/components/competitor-landscape-chart";
import TopicAnalysis from "@/components/topic-analysis";
import RecentResults from "@/components/recent-results";
import TopSources from "@/components/top-sources";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect, useCallback } from "react";
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

// Build URL search string from params, omitting defaults
function buildSearch(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && v !== 'all') p.set(k, v);
  }
  const s = p.toString();
  return s ? `/?${s}` : '/';
}

export default function Dashboard() {
  const [brandName, setBrandName] = useState('');
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  // Read all filter state from URL (validate dates)
  const urlParams = new URLSearchParams(searchString);
  const selectedRunId = urlParams.get('runId') || 'all';
  const selectedModel = urlParams.get('model') || 'all';
  const rawFrom = urlParams.get('trendFrom');
  const rawTo = urlParams.get('trendTo');
  const trendFrom = rawFrom && !isNaN(new Date(rawFrom).getTime()) ? rawFrom : undefined;
  const trendTo = rawTo && !isNaN(new Date(rawTo).getTime()) ? rawTo : undefined;

  // Helpers to update URL preserving other params
  const setParam = useCallback((key: string, value: string) => {
    const p = new URLSearchParams(searchString);
    if (value && value !== 'all') {
      p.set(key, value);
    } else {
      p.delete(key);
    }
    const s = p.toString();
    setLocation(s ? `/?${s}` : '/');
  }, [searchString, setLocation]);

  const setSelectedRunId = useCallback((id: string) => setParam('runId', id), [setParam]);
  const setSelectedModel = useCallback((m: string) => setParam('model', m), [setParam]);

  const setTrendRange = useCallback((from?: Date, to?: Date) => {
    const p = new URLSearchParams(searchString);
    if (from) p.set('trendFrom', from.toISOString()); else p.delete('trendFrom');
    if (to) p.set('trendTo', to.toISOString()); else p.delete('trendTo');
    const s = p.toString();
    setLocation(s ? `/?${s}` : '/');
  }, [searchString, setLocation]);

  const { data: analysisRuns } = useQuery<AnalysisRun[]>({
    queryKey: ['/api/analysis/runs'],
  });

  const { data: modelsConfig } = useQuery<Record<string, { enabled: boolean; label?: string }>>({
    queryKey: ['/api/settings/models'],
  });
  const enabledModels = modelsConfig
    ? Object.entries(modelsConfig).filter(([, v]) => v.enabled)
    : [];

  const modelValue = selectedModel !== 'all' ? selectedModel : undefined;
  const runIdValue = selectedRunId !== 'all' ? selectedRunId : undefined;

  // Fetch brand mention rate for reference lines on charts
  const metricsParams = new URLSearchParams();
  if (runIdValue) metricsParams.set('runId', runIdValue);
  if (modelValue) metricsParams.set('model', modelValue);
  const metricsParamStr = metricsParams.toString() ? `?${metricsParams.toString()}` : '';

  const { data: metrics } = useQuery<{ brandMentionRate: number }>({
    queryKey: [`/api/metrics${metricsParamStr}`],
  });

  useEffect(() => {
    fetch('/api/settings/brand').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.brandName) setBrandName(data.brandName);
    }).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      {/* Header + Filters */}
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

      {/* KPI Cards (3) */}
      <MetricsOverview runId={runIdValue} model={modelValue} />

      {/* Hero Chart: Visibility Trend (only for All Runs) */}
      <VisibilityTrendChart
        model={modelValue}
        selectedRunId={runIdValue}
        onSelectRun={setSelectedRunId}
        trendFrom={trendFrom}
        trendTo={trendTo}
        onTrendRangeChange={setTrendRange}
      />

      {/* Charts Row: Model Comparison + Competitor Landscape */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ModelComparisonChart runId={runIdValue} brandMentionRate={metrics?.brandMentionRate} />
        <CompetitorLandscapeChart runId={runIdValue} model={modelValue} brandMentionRate={metrics?.brandMentionRate} />
      </div>

      {/* Detail Tables: Topic Analysis + Recent Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopicAnalysis runId={runIdValue} model={modelValue} />
        <RecentResults runId={runIdValue} model={modelValue} />
      </div>

      {/* Sources */}
      <TopSources runId={runIdValue} model={modelValue} />
    </div>
  );
}
