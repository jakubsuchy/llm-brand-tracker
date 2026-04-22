import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, ExternalLink, Eye, ChevronDown, ChevronUp } from "lucide-react";

interface AnalysisRun {
  id: number;
  startedAt: string;
  brandName: string | null;
}

interface WatchedUrlCitation {
  responseId: number;
  runId: number | null;
  model: string | null;
  url: string;
  citedAt: string | null;
  promptText: string;
  brandMentioned: boolean;
}

interface WatchedUrlEntry {
  id: number;
  url: string;
  title: string | null;
  notes: string | null;
  addedAt: string;
  citationCount: number;
  firstCitedAt: string | null;
  firstCitedRunId: number | null;
  citationsByModel: Record<string, number>;
  citations: WatchedUrlCitation[];
}

export function WatchlistTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedRun, setSelectedRun] = useState("all");
  const [selectedModel, setSelectedModel] = useState("all");
  const [adding, setAdding] = useState(false);

  const { data: runs } = useQuery<AnalysisRun[]>({ queryKey: ['/api/analysis/runs'] });
  const { data: modelsConfig } = useQuery<Record<string, { enabled: boolean; label?: string }>>({
    queryKey: ['/api/settings/models'],
  });

  const params = new URLSearchParams({ citations: 'true' });
  if (selectedRun !== 'all') params.set('runId', selectedRun);
  if (selectedModel !== 'all') params.set('model', selectedModel);

  const { data: watched, isLoading } = useQuery<WatchedUrlEntry[]>({
    queryKey: [`/api/watched-urls?${params.toString()}`],
  });

  const invalidate = () => queryClient.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/watched-urls'),
  });

  const addUrl = async () => {
    if (!newUrl.trim()) return;
    if (!/^https?:\/\/.+/.test(newUrl.trim())) {
      toast({ title: "Invalid URL", description: "URL must start with http:// or https://", variant: "destructive" });
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/watched-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim(), title: newTitle.trim() || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add');
      }
      setNewUrl("");
      setNewTitle("");
      invalidate();
      toast({ title: "Added", description: "URL added to watchlist" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const removeUrl = async (id: number) => {
    try {
      const res = await fetch(`/api/watched-urls/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      invalidate();
      toast({ title: "Removed", description: "URL removed from watchlist" });
    } catch {
      toast({ title: "Error", description: "Failed to remove URL", variant: "destructive" });
    }
  };

  const modelLabel = (m: string | null) => {
    if (!m) return 'Unknown';
    return modelsConfig?.[m]?.label || m;
  };

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Eye className="h-6 w-6 text-blue-600" />
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Source Watchlist</h1>
        </div>
        <p className="text-gray-600">
          Track specific URLs you publish and see when LLMs start citing them. Add a URL below, then run a new analysis.
        </p>
      </div>

      <div className="bg-white rounded-lg border p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="https://yourbrand.com/blog/new-post"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') addUrl(); }}
          />
          <Input
            placeholder="Title (optional)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="sm:w-64"
            onKeyDown={(e) => { if (e.key === 'Enter') addUrl(); }}
          />
          <Button onClick={addUrl} disabled={adding || !newUrl.trim()}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Select value={selectedRun} onValueChange={setSelectedRun}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Filter by run" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Runs</SelectItem>
            {runs?.map((r) => (
              <SelectItem key={r.id} value={r.id.toString()}>
                {new Date(r.startedAt).toLocaleDateString()} {new Date(r.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {r.brandName ? ` — ${r.brandName}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedModel} onValueChange={setSelectedModel}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="All Models" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Models</SelectItem>
            {modelsConfig && Object.entries(modelsConfig).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>{cfg.label || key}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded" />)}
        </div>
      ) : !watched || watched.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-lg border">
          <Eye className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium mb-1">No watched URLs yet</p>
          <p className="text-sm">Add a URL above to start tracking when LLMs cite your content.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {watched.map((w) => {
            const isExpanded = expandedId === w.id;
            return (
              <div key={w.id} className="bg-white rounded-lg border">
                <div
                  className="p-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpandedId(isExpanded ? null : w.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium truncate">{w.title || w.url}</span>
                      {w.citationCount > 0 ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] px-1.5 py-0">
                          Cited {w.citationCount}×
                        </Badge>
                      ) : (
                        <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px] px-1.5 py-0">
                          Not yet cited
                        </Badge>
                      )}
                    </div>
                    {w.title && <div className="text-xs text-gray-500 truncate">{w.url}</div>}
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500 mt-1">
                      <span>Added {new Date(w.addedAt).toLocaleDateString()}</span>
                      {w.firstCitedAt && (
                        <span>First cited {new Date(w.firstCitedAt).toLocaleDateString()}</span>
                      )}
                      {Object.entries(w.citationsByModel).map(([m, n]) => (
                        <span key={m} className="capitalize">{modelLabel(m)}: {n}</span>
                      ))}
                    </div>
                  </div>
                  <a
                    href={w.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-gray-400 hover:text-blue-600"
                    aria-label="Open URL"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (confirm('Remove this URL from the watchlist?')) removeUrl(w.id); }}
                    className="text-gray-400 hover:text-red-600"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  {isExpanded
                    ? <ChevronUp className="h-4 w-4 text-gray-400" />
                    : <ChevronDown className="h-4 w-4 text-gray-400" />}
                </div>
                {isExpanded && (
                  <div className="border-t bg-gray-50 p-3">
                    {w.citations.length === 0 ? (
                      <p className="text-sm text-gray-500">No citations yet for the current filters.</p>
                    ) : (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {w.citations.map((c) => (
                          <div key={c.responseId} className="bg-white border rounded p-3 text-sm">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{modelLabel(c.model)}</Badge>
                              {c.runId && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">Run #{c.runId}</Badge>
                              )}
                              {c.brandMentioned && (
                                <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700">Brand mentioned</Badge>
                              )}
                              {c.citedAt && (
                                <span className="text-xs text-gray-500">{new Date(c.citedAt).toLocaleString()}</span>
                              )}
                              <span className="text-xs text-gray-400 ml-auto">Response #{c.responseId}</span>
                            </div>
                            <div className="text-gray-800 font-medium">{c.promptText || '(no prompt text)'}</div>
                            <div className="text-xs text-gray-500 mt-1 break-all">Cited URL: {c.url}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
