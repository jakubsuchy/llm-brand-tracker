import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useSearch, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { ArrowLeft, CheckCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { RunSelector } from "@/components/response-filters";
import { DateRangePicker, type DateRangeValue } from "@/components/date-range-picker";
import { safeHttpHref } from "@/lib/safe-url";
import ModelComparisonChart from "@/components/model-comparison-chart";
import { getModelColor, getModelLabel } from "@shared/models";

interface PromptAnalytics {
  prompt: { id: number; text: string; topicId: number | null; topicName: string };
  totals: { runs: number; responses: number; brandMentions: number; brandMentionRate: number };
  byModel: { model: string; label: string; total: number; mentioned: number; rate: number }[];
  trend: { runId: number; runStartedAt: string | null; perModel: Record<string, number>; anyMentioned: boolean }[];
  topCompetitors: { id: number; name: string; count: number; rate: number }[];
  topSources: { id: number | null; domain: string; count: number; classification: 'brand' | 'competitor' | 'neutral' }[];
}

function classificationBadgeClass(c: 'brand' | 'competitor' | 'neutral') {
  if (c === 'brand') return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  if (c === 'competitor') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

export default function PromptAnalyticsPage() {
  const [, params] = useRoute<{ id: string }>('/prompts/:id');
  const promptId = params?.id;
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const urlParams = new URLSearchParams(searchString);
  const selectedRunId = urlParams.get('runId') || 'all';
  const rawFrom = urlParams.get('from');
  const rawTo = urlParams.get('to');
  const fromIso = rawFrom && !isNaN(new Date(rawFrom).getTime()) ? rawFrom : undefined;
  const toIso = rawTo && !isNaN(new Date(rawTo).getTime()) ? rawTo : undefined;

  const setUrlParam = useCallback((key: string, value: string | undefined) => {
    const p = new URLSearchParams(searchString);
    if (value && value !== 'all') p.set(key, value);
    else p.delete(key);
    const s = p.toString();
    setLocation(s ? `/prompts/${promptId}?${s}` : `/prompts/${promptId}`);
  }, [searchString, setLocation, promptId]);

  const handleDateRange = (range: DateRangeValue) => {
    const p = new URLSearchParams(searchString);
    if (range.from) p.set('from', range.from.toISOString()); else p.delete('from');
    if (range.to) p.set('to', range.to.toISOString()); else p.delete('to');
    const s = p.toString();
    setLocation(s ? `/prompts/${promptId}?${s}` : `/prompts/${promptId}`);
  };

  const queryParams = new URLSearchParams();
  if (selectedRunId !== 'all') queryParams.set('runId', selectedRunId);
  if (fromIso) queryParams.set('from', fromIso);
  if (toIso) queryParams.set('to', toIso);
  const qs = queryParams.toString();
  const queryUrl = `/api/prompts/${promptId}/analytics${qs ? `?${qs}` : ''}`;

  const { data, isLoading, error } = useQuery<PromptAnalytics>({
    queryKey: [queryUrl],
    enabled: !!promptId,
  });

  if (!promptId) {
    return <div className="p-8 text-slate-500">No prompt selected.</div>;
  }
  if (isLoading) {
    return (
      <div className="p-4 sm:p-8 space-y-6">
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-8">
        <p className="text-red-600">Failed to load prompt analytics.</p>
        <Link href="/prompts" className="text-indigo-600 hover:underline text-sm mt-2 inline-block">
          ← Back to all prompts
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* Back link + filters */}
      <div className="flex items-center justify-between gap-3">
        <Link href="/prompts" className="text-sm text-indigo-600 hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> All prompts
        </Link>
        <div className="flex gap-2 items-center flex-wrap">
          <DateRangePicker
            value={{ from: fromIso ? new Date(fromIso) : undefined, to: toIso ? new Date(toIso) : undefined }}
            onChange={() => { /* immediate apply on Apply */ }}
            onApply={handleDateRange}
          />
          <RunSelector value={selectedRunId} onChange={(r) => setUrlParam('runId', r)} />
        </div>
      </div>

      {/* Header card */}
      <Card>
        <CardContent className="p-6">
          <Badge variant="secondary" className="text-xs mb-3">
            <Link href={`/prompts?topicId=${data.prompt.topicId ?? ''}`} className="hover:underline">
              {data.prompt.topicName}
            </Link>
          </Badge>
          <p className="text-lg sm:text-xl font-medium text-slate-900 leading-relaxed">
            {data.prompt.text}
          </p>
        </CardContent>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Brand Mention Rate" value={`${data.totals.brandMentionRate.toFixed(0)}%`} />
        <KpiCard label="Total Responses" value={data.totals.responses.toString()} />
        <KpiCard label="Runs Covered" value={data.totals.runs.toString()} />
        <KpiCard label="Competitors Seen" value={data.topCompetitors.length.toString()} />
      </div>

      {/* Per-model breakdown + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ModelComparisonChart
          data={data.byModel}
          title="Per-Model Mention Rate"
          brandMentionRate={data.totals.brandMentionRate}
        />
        <PromptTrendChart trend={data.trend} byModel={data.byModel} />
      </div>

      {/* Competitors + Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CompetitorLeaderboard items={data.topCompetitors} />
        <SourcesTable items={data.topSources} />
      </div>

      {/* Responses list */}
      <ResponsesPanel promptId={data.prompt.id} runId={selectedRunId !== 'all' ? selectedRunId : undefined} />
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">{label}</p>
        <p className="text-2xl font-semibold text-slate-900">{value}</p>
      </CardContent>
    </Card>
  );
}

function PromptTrendChart({
  trend,
  byModel,
}: {
  trend: PromptAnalytics['trend'];
  byModel: PromptAnalytics['byModel'];
}) {
  const modelKeys = byModel.map(m => m.model);
  const chartData = trend.map(t => {
    const row: Record<string, any> = {
      date: t.runStartedAt
        ? new Date(t.runStartedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : `Run ${t.runId}`,
      runId: t.runId,
      overall: t.anyMentioned ? 100 : 0,
    };
    for (const m of modelKeys) {
      const v = t.perModel[m];
      row[m] = v === undefined ? null : v * 100;
    }
    return row;
  });

  const overallColor = 'hsl(250, 50%, 40%)';
  const chartConfig: ChartConfig = {
    overall: { label: 'Any model', color: overallColor },
  };
  for (const m of modelKeys) {
    chartConfig[m] = { label: getModelLabel(m), color: getModelColor(m) };
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Trend Across Runs</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="h-[240px] flex items-center justify-center text-sm text-slate-400">
            Run multiple analyses to see this prompt's trend
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[240px] w-full">
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {modelKeys.length > 1 && modelKeys.map(m => (
                <Area
                  key={m}
                  type="linear"
                  dataKey={m}
                  stroke={`var(--color-${m})`}
                  fill={`var(--color-${m})`}
                  fillOpacity={0.05}
                  strokeWidth={1.5}
                  dot={chartData.length <= 10}
                  connectNulls
                />
              ))}
              <Area
                type="linear"
                dataKey="overall"
                stroke="var(--color-overall)"
                fill="var(--color-overall)"
                fillOpacity={0.1}
                strokeWidth={2.5}
                dot={chartData.length <= 10}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function CompetitorLeaderboard({ items }: { items: PromptAnalytics['topCompetitors'] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Competitors For This Prompt</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-sm text-slate-400 py-6 text-center">No competitors mentioned for this prompt yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>COMPETITOR</TableHead>
                <TableHead className="w-24 text-right">MENTIONS</TableHead>
                <TableHead className="w-20 text-right">RATE</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c, i) => (
                <TableRow key={c.id}>
                  <TableCell className="text-slate-500 text-sm">{i + 1}</TableCell>
                  <TableCell className="text-sm font-medium text-slate-900">{c.name}</TableCell>
                  <TableCell className="text-right text-sm text-slate-700">{c.count}</TableCell>
                  <TableCell className="text-right text-sm text-slate-700">{c.rate.toFixed(0)}%</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/compare?competitor=${c.id}`} className="text-xs text-indigo-600 hover:underline">
                      View details
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SourcesTable({ items }: { items: PromptAnalytics['topSources'] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sources Cited For This Prompt</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-sm text-slate-400 py-6 text-center">No sources cited for this prompt yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>DOMAIN</TableHead>
                <TableHead className="w-28">TYPE</TableHead>
                <TableHead className="w-24 text-right">CITATIONS</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(s => (
                <TableRow key={s.domain}>
                  <TableCell className="text-sm font-medium text-slate-900">{s.domain}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${classificationBadgeClass(s.classification)}`}>
                      {s.classification}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-700">{s.count}</TableCell>
                  <TableCell className="text-right">
                    {s.id != null ? (
                      <Link href={`/sources?sourceId=${s.id}`} className="text-xs text-indigo-600 hover:underline">
                        View details
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface ResponseRow {
  id: number;
  promptId: number;
  analysisRunId: number | null;
  model: string | null;
  text: string;
  brandMentioned: boolean;
  competitorsMentioned: string[] | null;
  sources: string[] | null;
  createdAt: string | null;
}

function ResponsesPanel({ promptId, runId }: { promptId: number; runId?: string }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const params = new URLSearchParams();
  // Server-side promptId filter — was previously fetching limit=1000 and
  // filtering client-side, which silently dropped responses when total
  // responses exceeded 1000 (the slice in /api/responses kept an arbitrary
  // 1000, sometimes excluding rows for the requested prompt).
  params.set('promptId', promptId.toString());
  params.set('limit', '1000');
  params.set('full', 'true');
  if (runId) params.set('runId', runId);
  const queryUrl = `/api/responses?${params.toString()}`;

  const { data: responses = [], isLoading } = useQuery<(ResponseRow & { prompt: { id: number } })[]>({
    queryKey: [queryUrl],
    enabled: open,
  });

  return (
    <Card>
      <CardHeader
        className="pb-2 flex flex-row items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <CardTitle className="text-base">All Responses</CardTitle>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </CardHeader>
      {open && (
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : responses.length === 0 ? (
            <div className="text-sm text-slate-400 py-6 text-center">No responses for this prompt in the selected range.</div>
          ) : (
            <div className="space-y-2">
              {responses.map(r => (
                <div key={r.id} className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedId(id => (id === r.id ? null : r.id))}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 text-left"
                  >
                    <div className="flex items-center gap-2">
                      {r.brandMentioned ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-600" />
                      )}
                      <Badge variant="outline" className="text-xs" style={{ borderColor: getModelColor(r.model || 'unknown') }}>
                        {getModelLabel(r.model || 'unknown')}
                      </Badge>
                      {r.analysisRunId && (
                        <span className="text-xs text-slate-500">Run #{r.analysisRunId}</span>
                      )}
                      {r.createdAt && (
                        <span className="text-xs text-slate-400">{new Date(r.createdAt).toLocaleString()}</span>
                      )}
                    </div>
                    {expandedId === r.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>
                  {expandedId === r.id && (
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t bg-slate-50">
                      <div className="text-sm text-slate-800 whitespace-pre-wrap bg-white p-3 rounded border max-h-96 overflow-y-auto leading-relaxed">
                        {r.text}
                      </div>
                      {r.competitorsMentioned && r.competitorsMentioned.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Competitors</p>
                          <div className="flex flex-wrap gap-1">
                            {r.competitorsMentioned.map((c, i) => (
                              <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {r.sources && r.sources.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Sources</p>
                          <div className="flex flex-wrap gap-2">
                            {r.sources.map((s, i) => {
                              const href = safeHttpHref(s);
                              return href ? (
                                <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline">{s}</a>
                              ) : (
                                <span key={i} className="text-xs text-slate-500" title="Non-http(s) URL — link disabled">{s}</span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div className="pt-2">
                <Link
                  href={`/responses?promptId=${promptId}${runId ? `&runId=${runId}` : ''}`}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Open in Responses →
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
