import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import type { Topic } from "@shared/schema";

interface AnalysisRun {
  id: number;
  startedAt: string;
  status: string;
  brandName: string | null;
}

export interface ResponseFilterValues {
  search: string;
  run: string;
  topic: string;
  model: string;
}

interface ResponseFiltersProps {
  values: ResponseFilterValues;
  onChange: (values: ResponseFilterValues) => void;
  /** Models extracted from response data (fallback when modelsConfig unavailable) */
  models?: string[];
  /** Hide the search bar */
  hideSearch?: boolean;
  /** Search placeholder text */
  searchPlaceholder?: string;
}

/**
 * Shared filter bar for response-based pages.
 * Provides search, run, topic, and model dropdowns in a consistent layout.
 */
export function ResponseFilters({
  values,
  onChange,
  models: modelsProp,
  hideSearch,
  searchPlaceholder = "Search prompts and responses...",
}: ResponseFiltersProps) {
  const { data: analysisRuns } = useQuery<AnalysisRun[]>({
    queryKey: ['/api/analysis/runs'],
  });

  const { data: topics } = useQuery<Topic[]>({
    queryKey: ['/api/topics'],
  });

  const { data: modelsConfig } = useQuery<Record<string, { enabled: boolean; label?: string }>>({
    queryKey: ['/api/settings/models'],
  });

  const update = (partial: Partial<ResponseFilterValues>) => {
    onChange({ ...values, ...partial });
  };

  // Use modelsConfig for labels when available, fall back to modelsProp
  const modelEntries: { key: string; label: string }[] = modelsConfig
    ? Object.entries(modelsConfig).map(([key, cfg]) => ({ key, label: cfg.label || key }))
    : (modelsProp || []).map(m => ({ key: m, label: m }));

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
      {!hideSearch && (
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder={searchPlaceholder}
            value={values.search}
            onChange={(e) => update({ search: e.target.value })}
            className="pl-10"
          />
        </div>
      )}
      <div className="flex gap-2 sm:gap-4">
        <Select value={values.topic} onValueChange={(v) => update({ topic: v })}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="All Topics" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Topics</SelectItem>
            {topics?.map(topic => (
              <SelectItem key={topic.id} value={topic.id.toString()}>
                {topic.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={values.model} onValueChange={(v) => update({ model: v })}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="All Models" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Models</SelectItem>
            {modelEntries.map(({ key, label }) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * The standard "All Runs" dropdown used in page headers.
 */
export function RunSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: analysisRuns } = useQuery<AnalysisRun[]>({
    queryKey: ['/api/analysis/runs'],
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-56">
        <SelectValue placeholder="Filter by run" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Runs</SelectItem>
        {analysisRuns
          ?.filter(r => r.status === 'complete')
          .map(run => (
            <SelectItem key={run.id} value={run.id.toString()}>
              {new Date(run.startedAt).toLocaleDateString()} {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {run.brandName ? ` — ${run.brandName}` : ''}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
