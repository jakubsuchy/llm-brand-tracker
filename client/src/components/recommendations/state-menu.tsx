import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { applyStateUpdate } from "./query-cache";
import type { RecommendationState } from "@shared/schema";

const NEXT_STATES: Record<RecommendationState, { label: string; state: RecommendationState }[]> = {
  open:      [{ label: 'Mark actioned', state: 'actioned' }, { label: 'Mark resolved', state: 'resolved' }, { label: 'Dismiss', state: 'dismissed' }],
  actioned:  [{ label: 'Mark resolved', state: 'resolved' }, { label: 'Reopen', state: 'open' }, { label: 'Dismiss', state: 'dismissed' }],
  resolved:  [{ label: 'Reopen', state: 'open' }, { label: 'Dismiss', state: 'dismissed' }],
  dismissed: [{ label: 'Reopen', state: 'open' }],
};

export function StateMenu({ id, state }: { id: number; state: RecommendationState }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async (next: RecommendationState) => {
      const r = await apiRequest('PUT', `/api/recommendations/${id}/state`, { state: next });
      return r.json();
    },
    onSuccess: (updated) => {
      applyStateUpdate(queryClient, id, updated);
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  });

  const choices = NEXT_STATES[state] || [];
  if (choices.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Change state <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {choices.map(c => (
          <DropdownMenuItem key={c.state} onClick={() => mutation.mutate(c.state)}>
            {c.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
