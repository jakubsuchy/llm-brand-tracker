import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import {
  ResponsiveContainer,
  ComposedChart,
  Scatter,
  Line,
  BarChart,
  Bar,
  ScatterChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";
import type { RankedPrompt } from "@/components/prompt-ranking-table";

interface RankedResponse {
  total: number;
  prompts: RankedPrompt[];
}

const BIN_WIDTH = 5;
const BIN_COUNT = 100 / BIN_WIDTH;

// Deterministic jitter so the strip plot doesn't reshuffle on every re-render.
function hashJitter(id: number): number {
  // Simple integer hash → [-0.4, 0.4]
  const x = Math.sin(id * 9301 + 49297) * 10000;
  return ((x - Math.floor(x)) - 0.5) * 0.8;
}

export default function HistogramsPage() {
  const { data, isLoading } = useQuery<RankedResponse>({
    queryKey: ["/api/prompts/ranked?limit=10000"],
  });
  const prompts = data?.prompts || [];

  const totals = useMemo(() => {
    const totalMentions = prompts.reduce((s, p) => s + p.brandMentions, 0);
    const totalResponses = prompts.reduce((s, p) => s + p.totalResponses, 0);
    return {
      totalMentions,
      totalResponses,
      // Pooled mention rate — weighted by response count, not the unweighted
      // mean of per-prompt rates. This is the binomial null hypothesis.
      globalRate: totalResponses > 0 ? (totalMentions / totalResponses) * 100 : 0,
      promptCount: prompts.length,
    };
  }, [prompts]);

  const maxN = useMemo(
    () => Math.max(1, ...prompts.map((p) => p.totalResponses)),
    [prompts],
  );

  // ---- Funnel plot data ----
  const funnelDots = useMemo(
    () =>
      prompts.map((p) => ({
        n: p.totalResponses,
        rate: p.mentionRate,
        text: p.text,
        topic: p.topicName,
      })),
    [prompts],
  );

  // ±2σ binomial bands at the global rate. σ depends on n, so this is a curve,
  // not a constant. Sample log-spaced n values for a smooth line.
  const bandPoints = useMemo(() => {
    const p = totals.globalRate / 100;
    const points: { n: number; lower: number; upper: number; mean: number }[] = [];
    if (p <= 0 || p >= 1 || maxN < 1) return points;
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
      const n = Math.exp((i / steps) * Math.log(maxN));
      const sigma = Math.sqrt((p * (1 - p)) / n) * 100;
      points.push({
        n,
        mean: totals.globalRate,
        lower: Math.max(0, totals.globalRate - 2 * sigma),
        upper: Math.min(100, totals.globalRate + 2 * sigma),
      });
    }
    return points;
  }, [totals.globalRate, maxN]);

  // ---- Histogram data ----
  const [histMinN, setHistMinN] = useState(1);
  const histData = useMemo(() => {
    const filtered = prompts.filter((p) => p.totalResponses >= histMinN);
    const bins = Array.from({ length: BIN_COUNT }, (_, i) => ({
      label: `${i * BIN_WIDTH}-${(i + 1) * BIN_WIDTH}`,
      center: i * BIN_WIDTH + BIN_WIDTH / 2,
      count: 0,
    }));
    for (const p of filtered) {
      const idx = Math.min(BIN_COUNT - 1, Math.floor(p.mentionRate / BIN_WIDTH));
      bins[idx].count++;
    }
    return { bins, n: filtered.length };
  }, [prompts, histMinN]);

  // ---- Topic strip plot data ----
  const topics = useMemo(() => {
    const map = new Map<
      string,
      { rates: number[]; sumMentions: number; sumResponses: number }
    >();
    for (const p of prompts) {
      const key = p.topicName || "General";
      if (!map.has(key))
        map.set(key, { rates: [], sumMentions: 0, sumResponses: 0 });
      const t = map.get(key)!;
      t.rates.push(p.mentionRate);
      t.sumMentions += p.brandMentions;
      t.sumResponses += p.totalResponses;
    }
    return [...map.entries()]
      .map(([name, t]) => {
        const sorted = [...t.rates].sort((a, b) => a - b);
        const median =
          sorted.length === 0
            ? 0
            : sorted.length % 2 === 1
              ? sorted[(sorted.length - 1) / 2]
              : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        return {
          name,
          median,
          pooledRate:
            t.sumResponses > 0 ? (t.sumMentions / t.sumResponses) * 100 : 0,
          count: t.rates.length,
        };
      })
      .sort((a, b) => a.median - b.median);
  }, [prompts]);

  const stripData = useMemo(() => {
    const idxByName = new Map(topics.map((t, i) => [t.name, i]));
    return prompts.map((p) => ({
      x: (idxByName.get(p.topicName) ?? 0) + hashJitter(p.id),
      rate: p.mentionRate,
      text: p.text,
      topic: p.topicName,
    }));
  }, [prompts, topics]);

  const topicMeanLine = topics.map((t, i) => ({ x: i, mean: t.pooledRate }));

  if (isLoading) {
    return (
      <div className="p-4 sm:p-8 space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-[400px] w-full" />
        <Skeleton className="h-[400px] w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!prompts.length) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
          Histograms
        </h1>
        <p className="text-slate-600 mt-2">
          No prompt data yet — run an analysis first.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
          Histograms
        </h1>
        <p className="text-slate-600 mt-1">
          Diagnostic plots for the per-prompt mention-rate distribution. Used to
          decide which statistical model fits the strongest/weakest-prompts
          ranking.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
          <span>
            <strong className="text-slate-900">{totals.promptCount.toLocaleString()}</strong>{" "}
            prompts
          </span>
          <span>
            <strong className="text-slate-900">{totals.totalResponses.toLocaleString()}</strong>{" "}
            responses
          </span>
          <span>
            Pooled mention rate{" "}
            <strong className="text-slate-900">
              {totals.globalRate.toFixed(1)}%
            </strong>
          </span>
          <span>
            Max responses per prompt{" "}
            <strong className="text-slate-900">{maxN}</strong>
          </span>
        </div>
      </div>

      {/* ---- Funnel plot ---- */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            1. Funnel: mention rate vs sample size
          </CardTitle>
          <p className="text-xs text-slate-500 mt-1">
            One dot per prompt. The dashed line is the global pooled rate; the
            shaded band is the ±2σ envelope a binomial would predict at that
            rate. Dots inside the band = consistent with random binomial
            variation. Dots outside, especially at high <code>n</code>, =
            genuinely different true rates.
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart margin={{ top: 8, right: 24, bottom: 36, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="n"
                scale="log"
                domain={[1, maxN]}
                allowDataOverflow
                tick={{ fontSize: 11 }}
                label={{
                  value: "Total responses (log scale)",
                  position: "insideBottom",
                  offset: -20,
                  fontSize: 12,
                }}
              />
              <YAxis
                type="number"
                dataKey="rate"
                domain={[0, 100]}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `${v}%`}
                label={{
                  value: "Mention rate",
                  angle: -90,
                  position: "insideLeft",
                  fontSize: 12,
                }}
              />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  if (d.text) {
                    return (
                      <div className="bg-white border rounded p-2 shadow text-xs max-w-xs">
                        <div className="font-medium truncate">{d.text}</div>
                        <div className="text-slate-500 mt-1">
                          {d.topic} · {d.n} responses · {d.rate}%
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              {bandPoints.length > 0 && (
                <>
                  <Line
                    data={bandPoints}
                    dataKey="upper"
                    type="monotone"
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                    dot={false}
                    isAnimationActive={false}
                    legendType="none"
                  />
                  <Line
                    data={bandPoints}
                    dataKey="lower"
                    type="monotone"
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                    dot={false}
                    isAnimationActive={false}
                    legendType="none"
                  />
                </>
              )}
              <ReferenceLine
                y={totals.globalRate}
                stroke="#6366f1"
                strokeDasharray="6 3"
                label={{
                  value: `mean ${totals.globalRate.toFixed(1)}%`,
                  position: "right",
                  fontSize: 11,
                  fill: "#6366f1",
                }}
              />
              <Scatter
                data={funnelDots}
                fill="#6366f1"
                fillOpacity={0.4}
                shape="circle"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-xs text-slate-500 mt-2">
            Reading guide: if scatter outside the band grows as <code>n</code>{" "}
            grows (more dots break out at higher response counts), the data is
            <em> overdispersed</em> — prompts have genuinely different true
            rates and shrinkage is justified. If the scatter stays inside the
            band, plain pooling already works.
          </p>
        </CardContent>
      </Card>

      {/* ---- Histogram of rates ---- */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            2. Distribution of per-prompt mention rates
          </CardTitle>
          <p className="text-xs text-slate-500 mt-1">
            Shape of the prior. Bell ≈ Beta prior is appropriate. U-shape (mass
            at 0% and 100%, sparse middle) ≈ bimodal — single Beta is wrong,
            either two clusters or topic-conditioned shrinkage. Roughly uniform
            ≈ very weak signal.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-3 gap-4">
            <div className="flex-1 max-w-md">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-600">
                  Min responses per prompt
                </label>
                <span className="text-xs text-slate-500 tabular-nums">
                  ≥ {histMinN} ({histData.n} prompts)
                </span>
              </div>
              <Slider
                value={[histMinN]}
                min={1}
                max={Math.max(1, maxN)}
                step={1}
                onValueChange={(v) => setHistMinN(v[0])}
              />
            </div>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart
              data={histData.bins}
              margin={{ top: 8, right: 24, bottom: 24, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                interval={1}
                label={{
                  value: "Mention rate (%)",
                  position: "insideBottom",
                  offset: -10,
                  fontSize: 12,
                }}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                label={{
                  value: "# prompts",
                  angle: -90,
                  position: "insideLeft",
                  fontSize: 12,
                }}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border rounded p-2 shadow text-xs">
                      <div>
                        Rate {d.label}%: <strong>{d.count}</strong> prompts
                      </div>
                    </div>
                  );
                }}
              />
              <ReferenceLine
                x={`${Math.floor(totals.globalRate / BIN_WIDTH) * BIN_WIDTH}-${Math.floor(totals.globalRate / BIN_WIDTH) * BIN_WIDTH + BIN_WIDTH}`}
                stroke="#6366f1"
                strokeDasharray="4 3"
                label={{
                  value: "pooled mean",
                  position: "top",
                  fontSize: 10,
                  fill: "#6366f1",
                }}
              />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ---- Topic strip plot ---- */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            3. Mention rate by topic
          </CardTitle>
          <p className="text-xs text-slate-500 mt-1">
            One dot per prompt, jittered horizontally; orange marker is the
            topic's pooled rate. Topics ordered by median. Tightly clustered
            within-topic with separated topic means ⇒ topic is a real grouping
            variable, shrink toward topic mean (not global). Overlapping spread
            ⇒ topic isn't carrying much signal.
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer
            width="100%"
            height={Math.max(360, topics.length * 28)}
          >
            <ScatterChart margin={{ top: 8, right: 24, bottom: 80, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[-0.6, topics.length - 0.4]}
                ticks={topics.map((_, i) => i)}
                tickFormatter={(i) => topics[i]?.name || ""}
                interval={0}
                angle={-30}
                textAnchor="end"
                tick={{ fontSize: 10 }}
                height={70}
              />
              <YAxis
                type="number"
                dataKey="rate"
                domain={[0, 100]}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `${v}%`}
                label={{
                  value: "Mention rate",
                  angle: -90,
                  position: "insideLeft",
                  fontSize: 12,
                }}
              />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  if (d.text) {
                    return (
                      <div className="bg-white border rounded p-2 shadow text-xs max-w-xs">
                        <div className="font-medium truncate">{d.text}</div>
                        <div className="text-slate-500 mt-1">
                          {d.topic} · {d.rate}%
                        </div>
                      </div>
                    );
                  }
                  if (d.mean !== undefined) {
                    const t = topics[d.x];
                    return (
                      <div className="bg-white border rounded p-2 shadow text-xs">
                        <div className="font-medium">{t?.name}</div>
                        <div className="text-slate-500 mt-1">
                          pooled {t?.pooledRate.toFixed(1)}% · {t?.count} prompts
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <ReferenceLine
                y={totals.globalRate}
                stroke="#6366f1"
                strokeDasharray="4 3"
              />
              <Scatter
                data={stripData}
                fill="#6366f1"
                fillOpacity={0.35}
                shape="circle"
                isAnimationActive={false}
              />
              <Scatter
                data={topicMeanLine.map((p) => ({ ...p, rate: p.mean }))}
                fill="#f59e0b"
                shape="diamond"
                isAnimationActive={false}
              >
                {topicMeanLine.map((_, i) => (
                  <Cell key={i} fill="#f59e0b" />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
