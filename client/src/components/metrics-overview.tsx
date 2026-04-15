import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Megaphone, Trophy, Globe, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface CompetitorAnalysis {
  competitorId: number;
  name: string;
  category: string | null;
  mentionCount: number;
  mentionRate: number;
  changeRate: number;
}

interface Metrics {
  brandMentionRate: number;
  totalPrompts: number;
  topCompetitor: string;
  totalSources: number;
  totalDomains: number;
}

interface AnalysisRun {
  id: number;
  startedAt: string;
  status: string;
  totalPrompts: number;
  responseCount?: number;
}

const MIN_PROMPTS = 5;

export default function MetricsOverview({ runId, model }: { runId?: string; model?: string }) {
  const params = new URLSearchParams();
  if (runId) params.set('runId', runId);
  if (model) params.set('model', model);
  const paramStr = params.toString() ? `?${params.toString()}` : '';

  const { data: metrics, isLoading, error } = useQuery<Metrics>({
    queryKey: [`/api/metrics${paramStr}`],
  });

  const { data: competitorAnalysis } = useQuery<CompetitorAnalysis[]>({
    queryKey: [`/api/competitors/analysis${paramStr}`],
  });

  const runOnlyParams = new URLSearchParams();
  if (runId) runOnlyParams.set('runId', runId);
  const runOnlyParamStr = runOnlyParams.toString() ? `?${runOnlyParams.toString()}` : '';

  const { data: visibilityData } = useQuery<{ score: number; runCount: number; modelCount: number }>({
    queryKey: [`/api/metrics/visibility-score${runOnlyParamStr}`],
  });

  const { data: analysisRuns } = useQuery<AnalysisRun[]>({
    queryKey: ['/api/analysis/runs'],
  });

  // Determine previous run for comparison
  const completedRuns = (analysisRuns || []).filter(r => r.status === 'complete');
  let prevRunId: string | undefined;
  if (runId) {
    const idx = completedRuns.findIndex(r => r.id.toString() === runId);
    if (idx >= 0 && idx + 1 < completedRuns.length) {
      prevRunId = completedRuns[idx + 1].id.toString();
    }
  }

  const prevParams = new URLSearchParams();
  if (prevRunId) prevParams.set('runId', prevRunId);
  if (model) prevParams.set('model', model);
  const prevParamStr = prevParams.toString() ? `?${prevParams.toString()}` : '';

  const { data: prevMetrics } = useQuery<Metrics>({
    queryKey: [`/api/metrics${prevParamStr}`],
    enabled: !!prevRunId,
  });

  const { data: prevCompetitorAnalysis } = useQuery<CompetitorAnalysis[]>({
    queryKey: [`/api/competitors/analysis${prevParamStr}`],
    enabled: !!prevRunId,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="border-slate-200">
            <CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-6"><p className="text-red-600">Failed to load metrics</p></CardContent>
        </Card>
      </div>
    );
  }

  const visibilityScore = visibilityData?.score ?? (metrics?.brandMentionRate || 0);
  const topCompetitorData = competitorAnalysis?.find((comp: CompetitorAnalysis) => comp.name === metrics?.topCompetitor);
  const competitorMentionRate = topCompetitorData?.mentionRate || 0;

  const canCompare = prevMetrics && (prevMetrics.totalPrompts || 0) >= MIN_PROMPTS && (metrics?.totalPrompts || 0) >= MIN_PROMPTS;
  const prevTopCompData = prevCompetitorAnalysis?.find((c: CompetitorAnalysis) => c.name === metrics?.topCompetitor);
  const competitorDelta = canCompare && prevTopCompData ? competitorMentionRate - (prevTopCompData.mentionRate || 0) : null;
  const sourceDelta = canCompare ? (metrics?.totalSources || 0) - (prevMetrics?.totalSources || 0) : null;

  function TrendIndicator({ delta, suffix = "%" }: { delta: number | null; suffix?: string }) {
    if (delta === null) return null;
    const abs = Math.abs(delta);
    const display = suffix === "%" ? abs.toFixed(1) : Math.round(abs).toString();
    if (abs < 0.1 && suffix === "%") {
      return (
        <span className="flex items-center text-xs text-slate-400">
          <Minus className="w-3 h-3 mr-0.5" />unchanged
        </span>
      );
    }
    const isUp = delta > 0;
    return (
      <span className={`flex items-center text-xs font-medium ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
        {isUp ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
        {isUp ? '+' : '-'}{display}{suffix} vs prev run
      </span>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Brand Visibility Score */}
      <Card className="bg-white border-slate-200">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Brand Visibility Score</p>
              <p className="text-2xl font-semibold text-slate-900 mt-1">{visibilityScore.toFixed(1)}%</p>
            </div>
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <Megaphone className="w-5 h-5 text-indigo-600" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-xs text-slate-500">
              {runId
                ? `this run, ${visibilityData?.modelCount || 1} model${(visibilityData?.modelCount || 1) !== 1 ? 's' : ''}`
                : `avg across ${visibilityData?.runCount || 1} run${(visibilityData?.runCount || 1) !== 1 ? 's' : ''}, ${visibilityData?.modelCount || 1} model${(visibilityData?.modelCount || 1) !== 1 ? 's' : ''}`}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Top Competitor */}
      <Card className="bg-white border-slate-200">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Top Competitor</p>
              <p className="text-2xl font-semibold text-slate-900 mt-1">{metrics?.topCompetitor || "N/A"}</p>
            </div>
            <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
              <Trophy className="w-5 h-5 text-amber-600" />
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-amber-600 font-medium">
              {competitorMentionRate.toFixed(1)}% mention rate
            </span>
            <TrendIndicator delta={competitorDelta} />
          </div>
        </CardContent>
      </Card>

      {/* Sources Found */}
      <Card className="bg-white border-slate-200">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Sources Found</p>
              <p className="text-2xl font-semibold text-slate-900 mt-1">{metrics?.totalSources?.toString() || "0"}</p>
            </div>
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Globe className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-slate-500">
              Across {metrics?.totalDomains || 0} domains
            </span>
            <TrendIndicator delta={sourceDelta} suffix="" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
