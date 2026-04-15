import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, Cell } from "recharts";
import { getModelColor } from "@shared/models";

interface ModelMetric {
  model: string;
  label: string;
  total: number;
  mentioned: number;
  rate: number;
}

interface Props {
  runId?: string;
  brandMentionRate?: number;
}

export default function ModelComparisonChart({ runId, brandMentionRate }: Props) {
  const params = new URLSearchParams();
  if (runId) params.set("runId", runId);
  const paramStr = params.toString() ? `?${params.toString()}` : "";

  const { data, isLoading } = useQuery<ModelMetric[]>({
    queryKey: [`/api/metrics/by-model${paramStr}`],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Model Comparison</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-[240px] w-full" /></CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Model Comparison</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[240px] flex items-center justify-center text-sm text-slate-400">
            No model data available
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map(m => ({
    name: m.label,
    model: m.model,
    rate: m.rate,
  }));

  const chartConfig: ChartConfig = {
    rate: { label: "Mention Rate", color: "hsl(220, 70%, 50%)" },
  };
  for (const m of data) {
    chartConfig[m.label] = {
      label: m.label,
      color: getModelColor(m.model),
    };
  }

  const barHeight = 36;
  const chartHeight = Math.max(160, chartData.length * barHeight + 40);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Model Comparison</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="w-full" style={{ height: chartHeight }}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={110} axisLine={false} tickLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="rate" radius={[0, 4, 4, 0]} barSize={20}>
              {chartData.map((d) => (
                <Cell key={d.model} fill={getModelColor(d.model)} />
              ))}
            </Bar>
            {brandMentionRate !== undefined && (
              <ReferenceLine x={brandMentionRate} stroke="hsl(220, 70%, 45%)" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: `Avg ${brandMentionRate.toFixed(1)}%`, position: "top", fontSize: 10, fill: "hsl(220, 70%, 45%)" }} />
            )}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
