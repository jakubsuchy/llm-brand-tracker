import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { DateRangePicker, type DateRangeValue } from "@/components/date-range-picker";
import { TrendingUp } from "lucide-react";
import { getModelColor } from "@shared/models";

interface TrendsData {
  runs: {
    runId: number;
    date: string;
    overallRate: number;
    modelRates: Record<string, number>;
  }[];
  modelLabels: Record<string, string>;
}

interface Props {
  model?: string;
  selectedRunId?: string;
  onSelectRun?: (runId: string) => void;
  trendFrom?: string;
  trendTo?: string;
  onTrendRangeChange?: (from?: Date, to?: Date) => void;
}

export default function VisibilityTrendChart({ model, selectedRunId, onSelectRun, trendFrom, trendTo, onTrendRangeChange }: Props) {
  const appliedFrom = trendFrom ? new Date(trendFrom) : undefined;
  const appliedTo = trendTo ? new Date(trendTo) : undefined;
  const [draft, setDraft] = useState<DateRangeValue>({ from: appliedFrom, to: appliedTo });

  const params = new URLSearchParams();
  if (model) params.set("model", model);
  if (trendFrom) params.set("from", trendFrom);
  if (trendTo) params.set("to", trendTo);
  const paramStr = params.toString() ? `?${params.toString()}` : "";

  const { data, isLoading } = useQuery<TrendsData>({
    queryKey: [`/api/metrics/trends${paramStr}`],
    enabled: !selectedRunId,
  });

  const handleApply = (range: DateRangeValue) => {
    onTrendRangeChange?.(range.from, range.to);
  };

  const collapsed = !!selectedRunId;

  // Build chart pieces (always, to avoid hook ordering issues)
  const allModelKeys = new Set<string>();
  if (data) {
    for (const run of data.runs) {
      for (const m of Object.keys(run.modelRates)) allModelKeys.add(m);
    }
  }
  const modelKeys = Array.from(allModelKeys);

  const chartData = data?.runs.map(run => ({
    date: new Date(run.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    runId: run.runId,
    overall: run.overallRate,
    ...run.modelRates,
  })) || [];

  const overallColor = "hsl(250, 50%, 40%)";
  const chartConfig: ChartConfig = {
    overall: { label: "Overall", color: overallColor },
  };
  for (const m of modelKeys) {
    chartConfig[m] = {
      label: data?.modelLabels[m] || m,
      color: getModelColor(m),
    };
  }

  const handleChartClick = (state: any) => {
    if (state?.activePayload?.[0]?.payload?.runId && onSelectRun) {
      onSelectRun(state.activePayload[0].payload.runId.toString());
    }
  };

  // Collapsed state: thin bar with link
  const collapsedContent = (
    <div
      className="flex items-center gap-2 text-sm text-slate-400 px-6 py-3"
    >
      <TrendingUp className="w-4 h-4 shrink-0" />
      <span>Viewing a single run.</span>
      <button
        onClick={() => onSelectRun?.("all")}
        className="text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
      >
        View all runs
      </button>
      <span>to see trends over time.</span>
    </div>
  );

  // Expanded chart content
  const chartContent = (
    <>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Visibility Trend</CardTitle>
        <DateRangePicker value={draft} onChange={setDraft} onApply={handleApply} />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : !data || data.runs.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-sm text-slate-400">
            Run multiple analyses to see trends
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              onClick={handleChartClick}
              style={{ cursor: "pointer" }}
            >
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
                  dot={false}
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
    </>
  );

  return (
    <Card className="border-slate-200 overflow-hidden">
      {/* Animated container using grid row transition */}
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="overflow-hidden">
          {chartContent}
        </div>
      </div>
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: collapsed ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {collapsedContent}
        </div>
      </div>
    </Card>
  );
}
