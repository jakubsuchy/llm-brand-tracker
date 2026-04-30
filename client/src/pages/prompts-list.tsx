import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { ResponseFilters, RunSelector, type ResponseFilterValues } from "@/components/response-filters";
import PromptRankingTable, { type RankedPrompt } from "@/components/prompt-ranking-table";
import { Slider } from "@/components/ui/slider";

interface RankedResponse {
  total: number;
  prompts: RankedPrompt[];
}

// Parse a comma-separated "min,max" param into [min, max], clamped to bounds.
function parseRange(raw: string | null, lo: number, hi: number): [number, number] {
  if (!raw) return [lo, hi];
  const parts = raw.split(',').map(s => parseFloat(s));
  const a = Number.isFinite(parts[0]) ? parts[0] : lo;
  const b = Number.isFinite(parts[1]) ? parts[1] : hi;
  return [Math.max(lo, Math.min(hi, a)), Math.max(lo, Math.min(hi, b))];
}

export default function PromptsListPage() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(searchString);

  const filters: ResponseFilterValues = {
    search: params.get('search') || '',
    run: params.get('runId') || 'all',
    topic: params.get('topicId') || 'all',
    model: params.get('model') || 'all',
  };

  const buildUrl = useCallback((mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(searchString);
    mutate(p);
    const s = p.toString();
    return s ? `/prompts?${s}` : '/prompts';
  }, [searchString]);

  const updateFilters = useCallback((next: ResponseFilterValues) => {
    setLocation(buildUrl(p => {
      // Reset all four keys this filter bar owns. Other params (slider state,
      // sort) are preserved by the buildUrl seed.
      p.delete('search');
      p.delete('runId');
      p.delete('topicId');
      p.delete('model');
      if (next.search) p.set('search', next.search);
      if (next.run && next.run !== 'all') p.set('runId', next.run);
      if (next.topic && next.topic !== 'all') p.set('topicId', next.topic);
      if (next.model && next.model !== 'all') p.set('model', next.model);
    }));
  }, [setLocation, buildUrl]);

  const queryParams = new URLSearchParams();
  if (filters.run !== 'all') queryParams.set('runId', filters.run);
  if (filters.topic !== 'all') queryParams.set('topicId', filters.topic);
  if (filters.model !== 'all') queryParams.set('model', filters.model);
  const qs = queryParams.toString();
  const queryUrl = `/api/prompts/ranked${qs ? `?${qs}` : ''}`;

  const { data, isLoading } = useQuery<RankedResponse>({
    queryKey: [queryUrl],
  });

  const allPrompts = data?.prompts || [];
  // Slider bounds derived from the current data slice — max responses is the
  // largest response count observed, so the slider always reaches the busiest
  // prompt regardless of run/model filters.
  const maxResponses = useMemo(
    () => Math.max(1, ...allPrompts.map(p => p.totalResponses)),
    [allPrompts],
  );

  const minResponsesUrl = parseInt(params.get('minResponses') || '1');
  const minResponses = Math.max(1, Math.min(maxResponses, Number.isFinite(minResponsesUrl) ? minResponsesUrl : 1));
  const [rateMin, rateMax] = parseRange(params.get('rate'), 0, 100);

  const setMinResponses = useCallback((v: number) => {
    setLocation(buildUrl(p => {
      if (v <= 1) p.delete('minResponses');
      else p.set('minResponses', String(v));
    }));
  }, [setLocation, buildUrl]);

  const setRateRange = useCallback((lo: number, hi: number) => {
    setLocation(buildUrl(p => {
      if (lo <= 0 && hi >= 100) p.delete('rate');
      else p.set('rate', `${lo},${hi}`);
    }));
  }, [setLocation, buildUrl]);

  const search = filters.search.trim().toLowerCase();
  const filtered = allPrompts.filter(p => {
    if (search && !p.text.toLowerCase().includes(search) && !p.topicName.toLowerCase().includes(search)) return false;
    if (p.totalResponses < minResponses) return false;
    if (p.mentionRate < rateMin || p.mentionRate > rateMax) return false;
    return true;
  });

  const slidersDirty = minResponses > 1 || rateMin > 0 || rateMax < 100;

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Prompts</h1>
            <p className="text-slate-600 mt-1">Brand mention performance for every prompt — click a row to drill in.</p>
          </div>
          <RunSelector value={filters.run} onChange={(r) => updateFilters({ ...filters, run: r })} />
        </div>

        <div className="mb-4">
          <ResponseFilters
            values={filters}
            onChange={updateFilters}
            searchPlaceholder="Search prompts and topics..."
          />
        </div>

        <div className="rounded-lg border bg-white p-4 mb-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700">Minimum responses</label>
              <span className="text-xs text-slate-500 tabular-nums">≥ {minResponses}</span>
            </div>
            <Slider
              value={[minResponses]}
              min={1}
              max={maxResponses}
              step={1}
              onValueChange={(v) => setMinResponses(v[0])}
              aria-label="Minimum response count"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1 tabular-nums">
              <span>1</span>
              <span>{maxResponses}</span>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700">Mention rate</label>
              <span className="text-xs text-slate-500 tabular-nums">{rateMin}% – {rateMax}%</span>
            </div>
            <Slider
              value={[rateMin, rateMax]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => setRateRange(v[0], v[1])}
              aria-label="Mention rate range"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1 tabular-nums">
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>
          {slidersDirty && (
            <div className="md:col-span-2 -mt-2">
              <button
                onClick={() => setLocation(buildUrl(p => { p.delete('minResponses'); p.delete('rate'); }))}
                className="text-xs text-indigo-600 hover:underline"
              >
                Reset sliders
              </button>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400 bg-white rounded-lg border">Loading prompts...</div>
      ) : (
        <PromptRankingTable
          prompts={filtered}
          emptyState={
            search || slidersDirty
              ? 'No prompts match the current filters'
              : 'No prompts have been run yet'
          }
        />
      )}
    </div>
  );
}
