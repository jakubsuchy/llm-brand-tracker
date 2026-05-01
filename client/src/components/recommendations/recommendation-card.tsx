import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HintBanner } from "./hint-banner";
import { StateMenu } from "./state-menu";
import { NarrativeView } from "./narrative-view";
import type { RecommendationWithHint, RecommendationState } from "@shared/schema";

const SEVERITY_STYLES: Record<string, string> = {
  red: 'bg-red-100 text-red-800 border-red-200',
  yellow: 'bg-amber-100 text-amber-800 border-amber-200',
  info: 'bg-sky-100 text-sky-800 border-sky-200',
};

const STATE_STYLES: Record<RecommendationState, string> = {
  open: 'bg-slate-100 text-slate-700 border-slate-200',
  actioned: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  resolved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  dismissed: 'bg-gray-100 text-gray-500 border-gray-200',
};

export function RecommendationCard({ rec }: { rec: RecommendationWithHint }) {
  return (
    <div className="rounded-lg border bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <Link href={`/recommendations/${rec.id}`} className="block">
            <h3 className="text-base font-semibold text-slate-900 hover:text-indigo-700">{rec.title}</h3>
          </Link>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge variant="outline" className={`text-[10px] ${SEVERITY_STYLES[rec.severity] || ''}`}>
              {rec.severity}
            </Badge>
            <Badge variant="outline" className={`text-[10px] ${STATE_STYLES[rec.state as RecommendationState] || ''}`}>
              {rec.state}
            </Badge>
            <span className="text-[11px] text-slate-500">
              Seen in {rec.totalOccurrences} run{rec.totalOccurrences === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <StateMenu id={rec.id} state={rec.state as RecommendationState} />
      </div>
      <NarrativeView narrative={(rec as any).narrative} dense />
      <HintBanner id={rec.id} hint={rec.hint} />
      <div className="pt-1">
        <Link
          href={`/recommendations/${rec.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
        >
          View details <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
