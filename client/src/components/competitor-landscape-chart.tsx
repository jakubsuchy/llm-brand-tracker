import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight } from "lucide-react";

interface CompetitorAnalysis {
  competitorId: number;
  name: string;
  domain: string | null;
  category: string | null;
  mentionCount: number;
  mentionRate: number;
  changeRate: number;
}

interface Props {
  runId?: string;
  model?: string;
  brandMentionRate?: number;
}

export default function CompetitorLandscapeChart({ runId, model, brandMentionRate }: Props) {
  const [, setLocation] = useLocation();
  const params = new URLSearchParams();
  if (runId) params.set("runId", runId);
  if (model) params.set("model", model);
  const paramStr = params.toString() ? `?${params.toString()}` : "";

  const { data, isLoading } = useQuery<CompetitorAnalysis[]>({
    queryKey: [`/api/competitors/analysis${paramStr}`],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Competitor Landscape</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-[240px] w-full" /></CardContent>
      </Card>
    );
  }

  const all = data || [];
  const top = all.slice(0, 5);
  const hasMore = all.length > 5;
  const maxRate = Math.max(...top.map(c => c.mentionRate), brandMentionRate || 0, 1);

  if (top.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Competitor Landscape</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[240px] flex items-center justify-center text-sm text-slate-400">
            No competitor data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Competitor Landscape</CardTitle>
        {hasMore && (
          <button
            onClick={() => setLocation('/competitors')}
            className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
          >
            View all {all.length} <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {top.map(c => {
            const pct = maxRate > 0 ? (c.mentionRate / maxRate) * 100 : 0;
            const rate = Math.round(c.mentionRate * 10) / 10;
            return (
              <button
                key={c.competitorId}
                className="w-full text-left group"
                onClick={() => setLocation(`/compare?competitor=${encodeURIComponent(c.name)}`)}
              >
                <div className="flex items-center gap-2 mb-1">
                  {c.domain ? (
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${c.domain}&sz=16`}
                      alt=""
                      className="w-4 h-4"
                    />
                  ) : (
                    <div className="w-4 h-4 rounded bg-slate-200 flex items-center justify-center text-[8px] font-bold text-slate-500">
                      {c.name.charAt(0)}
                    </div>
                  )}
                  <span className="text-sm text-slate-700 group-hover:text-indigo-600 truncate flex-1">{c.name}</span>
                  <span className="text-xs font-medium text-slate-500 tabular-nums">{rate}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            );
          })}
          {brandMentionRate !== undefined && brandMentionRate > 0 && (
            <div className="pt-1 border-t border-dashed border-slate-200">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-4 h-4 rounded bg-emerald-100 flex items-center justify-center text-[8px] font-bold text-emerald-600">Y</div>
                <span className="text-sm text-emerald-700 flex-1">Your brand</span>
                <span className="text-xs font-medium text-emerald-600 tabular-nums">{Math.round(brandMentionRate * 10) / 10}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${maxRate > 0 ? (brandMentionRate / maxRate) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
