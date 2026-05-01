import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { HintBanner } from "@/components/recommendations/hint-banner";
import { StateMenu } from "@/components/recommendations/state-menu";
import { NarrativeView } from "@/components/recommendations/narrative-view";
import { OccurrencesTimeline } from "@/components/recommendations/occurrences-timeline";
import type { RecommendationOccurrence, RecommendationState, RecommendationWithHint } from "@shared/schema";

type DetailResponse = RecommendationWithHint & { occurrences: RecommendationOccurrence[] };

export default function RecommendationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id);

  const { data, isLoading, error } = useQuery<DetailResponse>({
    queryKey: [`/api/recommendations/${id}`],
    enabled: Number.isFinite(id),
  });

  if (isLoading) {
    return <div className="text-sm text-slate-500">Loading…</div>;
  }
  if (error || !data) {
    return (
      <div className="text-sm text-slate-600">
        Recommendation not found.{' '}
        <Link href="/recommendations" className="text-indigo-600 hover:underline">Back to list</Link>
      </div>
    );
  }

  const numbers = (data.evidenceJson && typeof data.evidenceJson === 'object' && 'numbers' in (data.evidenceJson as any))
    ? (data.evidenceJson as any).numbers as Record<string, number | string>
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/recommendations">
          <Button variant="ghost" size="sm" className="-ml-2 mb-2">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{data.title}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge variant="outline" className="text-[11px]">{data.severity}</Badge>
              <Badge variant="outline" className="text-[11px] capitalize">{data.state}</Badge>
              <Badge variant="outline" className="text-[11px] bg-slate-50">
                Detector: {data.detectorKey}
              </Badge>
              <span className="text-xs text-slate-500">
                Seen in {data.totalOccurrences} run{data.totalOccurrences === 1 ? '' : 's'} ·
                first run #{data.firstSeenRunId} · last run #{data.lastSeenRunId}
              </span>
            </div>
          </div>
          <StateMenu id={data.id} state={data.state as RecommendationState} />
        </div>
      </div>

      <HintBanner id={data.id} hint={data.hint} />

      <div className="rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">Latest snapshot</h2>
        <NarrativeView narrative={(data as any).narrative} />
        {numbers && (
          <details className="mt-4 pt-3 border-t border-slate-100">
            <summary className="text-[11px] text-slate-500 cursor-pointer">
              Raw evidence numbers (developer view)
            </summary>
            <pre className="text-[11px] bg-slate-50 p-2 rounded mt-2 overflow-x-auto">
              {JSON.stringify(numbers, null, 2)}
            </pre>
          </details>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">Occurrences</h2>
        <OccurrencesTimeline occurrences={data.occurrences || []} />
      </div>
    </div>
  );
}
