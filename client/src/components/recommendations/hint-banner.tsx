import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ArrowUpCircle, CheckCircle2 } from "lucide-react";
import { applyStateUpdate } from "./query-cache";
import type { RecommendationHint, RecommendationState } from "@shared/schema";

// Renders the inline UI hint when latest analysis disagrees with user state.
// Click flips the state. See ANALYSIS_PLAN.md Part 2 § "UI hints".
export function HintBanner({ id, hint }: { id: number; hint: RecommendationHint }) {
  const queryClient = useQueryClient();
  const target: RecommendationState | null = hint === 'resolved' ? 'resolved' : hint === 'back' ? 'open' : null;
  const mutation = useMutation({
    mutationFn: async () => {
      if (!target) return null;
      const r = await apiRequest('PUT', `/api/recommendations/${id}/state`, { state: target });
      return r.json();
    },
    onSuccess: (updated) => {
      if (updated) applyStateUpdate(queryClient, id, updated);
    },
  });

  if (!hint) return null;
  if (hint === 'resolved') {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-sm">
        <div className="flex items-center gap-2 text-emerald-900">
          <CheckCircle2 className="h-4 w-4" />
          Latest analysis suggests this recommendation is resolved.
        </div>
        <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          Mark as resolved
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-sm">
      <div className="flex items-center gap-2 text-amber-900">
        <ArrowUpCircle className="h-4 w-4" />
        Latest analysis suggests this recommendation is back.
      </div>
      <Button size="sm" variant="outline" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        Reopen
      </Button>
    </div>
  );
}
