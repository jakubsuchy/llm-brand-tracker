import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { RecommendationCard } from "@/components/recommendations/recommendation-card";
import type { RecommendationState, RecommendationWithHint } from "@shared/schema";

const STATES: RecommendationState[] = ['open', 'actioned', 'resolved', 'dismissed'];

interface Counts {
  open: number;
  actioned: number;
  resolved: number;
  dismissed: number;
  hintResolved: number;
  hintBack: number;
}

export default function RecommendationsPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasRole } = useAuth();
  const canRecompute = hasRole('admin') || hasRole('analyst');
  const isAdmin = hasRole('admin');
  const [confirmClear, setConfirmClear] = useState(false);
  // Tab + filters all live in the URL so views are shareable.
  const stateTab = (params.get('state') as RecommendationState) || 'open';
  const severity = params.get('severity') || 'all';
  const detectorKey = params.get('detector') || 'all';
  const hint = params.get('hint') || 'any';

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(search);
    if (value === null || value === 'all' || value === 'any') next.delete(key);
    else next.set(key, value);
    const s = next.toString();
    setLocation(`/recommendations${s ? `?${s}` : ''}`);
  };

  const queryParams = new URLSearchParams();
  queryParams.set('state', stateTab);
  if (severity !== 'all') queryParams.set('severity', severity);
  if (detectorKey !== 'all') queryParams.set('detectorKey', detectorKey);
  if (hint === 'resolved' || hint === 'back') queryParams.set('hint', hint);

  const { data: recs, isLoading } = useQuery<RecommendationWithHint[]>({
    queryKey: [`/api/recommendations?${queryParams.toString()}`],
  });

  const { data: counts } = useQuery<Counts>({
    queryKey: ['/api/recommendations/counts'],
  });

  // Static registry from the server — the dropdown shows ALL detectors,
  // not just the ones that survive the current filters.
  const { data: detectorRegistry } = useQuery<Array<{ key: string; label: string; description?: string }>>({
    queryKey: ['/api/recommendations/detectors'],
    staleTime: Infinity,  // detector list rarely changes; cache for the session
  });

  // Per-detector counts for the dropdown, respecting current state/severity/
  // hint filters but NOT the detector filter itself. Refetches when those
  // surrounding filters change.
  const detectorCountsParams = new URLSearchParams();
  detectorCountsParams.set('state', stateTab);
  if (severity !== 'all') detectorCountsParams.set('severity', severity);
  if (hint === 'resolved' || hint === 'back') detectorCountsParams.set('hint', hint);
  const { data: detectorCounts } = useQuery<Record<string, number>>({
    queryKey: [`/api/recommendations/by-detector?${detectorCountsParams.toString()}`],
  });
  const totalForDropdown = detectorCounts
    ? Object.values(detectorCounts).reduce((a, b) => a + b, 0)
    : null;

  const recompute = useMutation({
    mutationFn: async () => {
      const r = await apiRequest('POST', '/api/recommendations/recompute', {});
      return r.json() as Promise<{ runId: number; count: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: 'Recommendations regenerated',
        description: `${data.count} recommendations from run #${data.runId}.`,
      });
      queryClient.invalidateQueries({ predicate: q => {
        const k = q.queryKey[0];
        return typeof k === 'string' && k.startsWith('/api/recommendations');
      }});
    },
    onError: (err: any) => {
      toast({
        title: 'Recompute failed',
        description: err?.message || 'Try again or check the server logs.',
        variant: 'destructive',
      });
    },
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      const r = await apiRequest('DELETE', '/api/recommendations');
      return r.json() as Promise<{ deleted: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: 'Recommendations cleared',
        description: `${data.deleted} recommendations removed.`,
      });
      queryClient.invalidateQueries({ predicate: q => {
        const k = q.queryKey[0];
        return typeof k === 'string' && k.startsWith('/api/recommendations');
      }});
    },
    onError: (err: any) => {
      toast({
        title: 'Clear failed',
        description: err?.message || 'Try again or check the server logs.',
        variant: 'destructive',
      });
    },
  });

  // Dropdown options come straight from the server's static registry, so
  // they don't disappear when the user narrows the filter. Falls back to
  // the keys present in the current data if the registry hasn't loaded.
  const detectorOptions = detectorRegistry
    ?? Array.from(new Set((recs || []).map(r => r.detectorKey))).sort().map(k => ({ key: k, label: k }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Recommendations</h1>
          <p className="text-slate-600 text-sm mt-1">
            What's wrong with your brand visibility right now, ranked. Pure deterministic detection — no LLM in the analysis path.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => setConfirmClear(true)}
              disabled={clearAll.isPending}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              {clearAll.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Clearing…</>
              ) : (
                <><Trash2 className="h-4 w-4 mr-2" /> Clear all</>
              )}
            </Button>
          )}
          {canRecompute && (
            <Button
              variant="outline"
              onClick={() => recompute.mutate()}
              disabled={recompute.isPending}
            >
              {recompute.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Regenerating…</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-2" /> Re-generate recommendations</>
              )}
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all recommendations?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletes every recommendation and its per-run history. User states (actioned / resolved / dismissed) are lost. The next run completion (or a manual recompute) will repopulate from current data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clearAll.mutate()}
              className="bg-red-600 hover:bg-red-700"
            >
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Summary chips */}
      {counts && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="bg-slate-50">
            {counts.open} open
          </Badge>
          <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
            {counts.actioned} actioned
          </Badge>
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
            {counts.resolved} resolved
          </Badge>
          {counts.hintResolved > 0 && (
            <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-300">
              {counts.hintResolved} suggest resolved
            </Badge>
          )}
          {counts.hintBack > 0 && (
            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">
              {counts.hintBack} suggest back
            </Badge>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={stateTab} onValueChange={v => setParam('state', v)}>
        <TabsList>
          {STATES.map(s => (
            <TabsTrigger key={s} value={s} className="capitalize">
              {s}
              {counts && (
                <span className="ml-2 text-[10px] text-slate-500">{counts[s]}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
        <Select value={severity} onValueChange={v => setParam('severity', v)}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All severities" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="red">Red</SelectItem>
            <SelectItem value="yellow">Yellow</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={detectorKey} onValueChange={v => setParam('detector', v)}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All detectors" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              All detectors{totalForDropdown != null ? ` (${totalForDropdown})` : ''}
            </SelectItem>
            {detectorOptions.map(d => {
              const n = detectorCounts?.[d.key];
              return (
                <SelectItem key={d.key} value={d.key}>
                  {d.label}{n != null ? ` (${n})` : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Select value={hint} onValueChange={v => setParam('hint', v)}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All hints" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All hints</SelectItem>
            <SelectItem value="resolved">Suggests resolved</SelectItem>
            <SelectItem value="back">Suggests back</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : !recs || recs.length === 0 ? (
        <div className="text-sm text-slate-500 p-8 text-center bg-white border rounded-lg">
          No recommendations matching this view.
        </div>
      ) : (
        <div className="space-y-3">
          {recs.map(r => (
            <RecommendationCard key={r.id} rec={r} />
          ))}
        </div>
      )}
    </div>
  );
}
