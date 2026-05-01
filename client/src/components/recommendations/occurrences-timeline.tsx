import { Badge } from "@/components/ui/badge";
import { NarrativeView } from "./narrative-view";
import type { RecommendationOccurrence } from "@shared/schema";

const SEVERITY_COLORS: Record<string, string> = {
  red: 'bg-red-100 text-red-800 border-red-200',
  yellow: 'bg-amber-100 text-amber-800 border-amber-200',
  info: 'bg-sky-100 text-sky-800 border-sky-200',
};

export function OccurrencesTimeline({ occurrences }: { occurrences: RecommendationOccurrence[] }) {
  if (!occurrences || occurrences.length === 0) {
    return <p className="text-sm text-slate-500">No occurrences recorded.</p>;
  }
  return (
    <div className="space-y-2">
      {occurrences.map(occ => {
        const numbers = (occ.evidenceJson && typeof occ.evidenceJson === 'object' && 'numbers' in (occ.evidenceJson as any))
          ? (occ.evidenceJson as any).numbers as Record<string, unknown>
          : null;
        return (
          <div key={occ.id} className="flex items-start gap-3 p-3 border rounded-md bg-white">
            <div className="text-xs font-mono text-slate-500 w-24 shrink-0">
              Run #{occ.analysisRunId}
            </div>
            <div className="flex-1">
              <Badge variant="outline" className={`text-[10px] ${SEVERITY_COLORS[occ.severity] || ''}`}>
                {occ.severity}
              </Badge>
              <span className="ml-2 text-xs text-slate-500">
                impact {occ.impactScore.toFixed(1)}
              </span>
              <div className="mt-2">
                <NarrativeView narrative={(occ as any).narrative} dense />
              </div>
              {numbers ? (
                <details className="mt-2">
                  <summary className="text-[11px] text-slate-500 cursor-pointer">raw evidence numbers</summary>
                  <pre className="text-[11px] bg-slate-50 p-2 rounded mt-1 overflow-x-auto">
                    {JSON.stringify(numbers, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
