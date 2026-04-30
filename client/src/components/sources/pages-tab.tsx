import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Search, ExternalLink, ChevronDown, ChevronUp, ArrowRightLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { safeHttpHref } from "@/lib/safe-url";
import type { PageAnalysis, Topic } from "@shared/schema";

const PAGE_SIZE = 50;

interface PageAnalysisResponse {
  rows: PageAnalysis[];
  page: number;
  pageSize: number;
  total: number;
}

interface AnalysisRun {
  id: number;
  startedAt: string;
  status: string;
  brandName: string | null;
  responseCount: number;
}

export function PagesTab() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const urlParams = new URLSearchParams(searchString);
  const selectedPage = urlParams.get('page') || null;
  // ?p is only set after the user explicitly paginates. If absent and a
  // selectedPage exists, we let the server resolve which page it falls on.
  const explicitPageNum = urlParams.has('p') ? Math.max(1, parseInt(urlParams.get('p') || '1') || 1) : null;

  const setSelectedPage = (url: string | null) => {
    const p = new URLSearchParams(searchString);
    if (url) p.set('page', url);
    else p.delete('page');
    const s = p.toString();
    setLocation(`/sources${s ? `?${s}` : ''}#pages`);
  };

  const setPageNum = (n: number) => {
    const p = new URLSearchParams(searchString);
    if (n > 1) p.set('p', n.toString());
    else p.delete('p');
    const s = p.toString();
    setLocation(`/sources${s ? `?${s}` : ''}#pages`);
  };

  const [showBrand, setShowBrand] = useState(true);
  const [showCompetitor, setShowCompetitor] = useState(true);
  const [showNeutral, setShowNeutral] = useState(true);
  const [pageSearch, setPageSearch] = useState('');
  const [debouncedPageSearch, setDebouncedPageSearch] = useState('');
  const [selectedRun, setSelectedRun] = useState<string>('all');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [selectedModel, setSelectedModel] = useState<string>('all');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const reclassifySource = async (domain: string, sourceType: 'competitor' | 'neutral' | 'brand') => {
    try {
      const res = await fetch('/api/sources/reclassify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, sourceType }),
      });
      if (!res.ok) throw new Error('Failed to reclassify');
      queryClient.invalidateQueries({ predicate: (q) => {
        const key = q.queryKey[0] as string;
        return typeof key === 'string' && (key.startsWith('/api/sources') || key.startsWith('/api/competitors') || key.startsWith('/api/settings'));
      }});
      toast({ title: "Reclassified", description: `${domain} is now a ${sourceType} source.` });
    } catch {
      toast({ title: "Error", description: "Failed to reclassify domain", variant: "destructive" });
    }
  };

  const { data: analysisRuns } = useQuery<AnalysisRun[]>({ queryKey: ['/api/analysis/runs'] });
  const { data: topics } = useQuery<Topic[]>({ queryKey: ['/api/topics'] });
  const { data: modelsConfig } = useQuery<Record<string, { enabled: boolean; label?: string }>>({
    queryKey: ['/api/settings/models'],
  });

  const selectedTypes = [
    showBrand ? 'brand' : null,
    showCompetitor ? 'competitor' : null,
    showNeutral ? 'neutral' : null,
  ].filter(Boolean) as string[];

  const params = new URLSearchParams();
  if (selectedRun !== 'all') params.set('runId', selectedRun);
  if (selectedModel !== 'all') params.set('model', selectedModel);
  if (selectedTopic !== 'all') params.set('topicId', selectedTopic);
  if (debouncedPageSearch.trim()) params.set('q', debouncedPageSearch.trim());
  // Only send types when the user has narrowed below the default (all 3).
  // Empty string = none — server returns zero rows.
  if (selectedTypes.length < 3) params.set('types', selectedTypes.join(','));
  if (explicitPageNum !== null) {
    params.set('page', explicitPageNum.toString());
  } else if (selectedPage) {
    // Deep-link arrived; server resolves which page contains the URL.
    params.set('seekUrl', selectedPage);
  }
  params.set('pageSize', PAGE_SIZE.toString());
  const queryStr = `?${params.toString()}`;

  const { data, isLoading } = useQuery<PageAnalysisResponse>({
    queryKey: [`/api/sources/pages/analysis${queryStr}`],
  });

  const pages = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // The displayed page is whatever the server returned — for explicit page
  // requests this echoes the input; for seekUrl requests it's the resolved page.
  const pageNum = data?.page ?? explicitPageNum ?? 1;

  // Server returns rows already sorted by citationCount desc, filtered by q
  // and types, and paginated.
  const totalCitationsOnPage = pages.reduce((sum, p) => sum + (p.citationCount || 0), 0);
  const filteredPages = pages.map(p => ({
    ...p,
    impact: totalCitationsOnPage > 0 ? (p.citationCount / totalCitationsOnPage) * 100 : 0,
  }));

  const resetPageNum = () => {
    if (!urlParams.has('p')) return;
    const p = new URLSearchParams(searchString);
    p.delete('p');
    const s = p.toString();
    setLocation(`/sources${s ? `?${s}` : ''}#pages`);
  };

  // Debounce the search input so we don't re-query on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedPageSearch(pageSearch), 300);
    return () => clearTimeout(id);
  }, [pageSearch]);

  // Auto-scroll the deep-linked page into view when arriving via shared URL.
  useEffect(() => {
    if (!selectedPage || !pages.length) return;
    const el = document.getElementById(`page-row-${encodeURIComponent(selectedPage)}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedPage, pages]);

  function getFavicon(domain: string) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  }

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-4" />
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Source Pages</h1>
          <Select value={selectedRun} onValueChange={setSelectedRun}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="Filter by run" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Runs</SelectItem>
              {analysisRuns?.map(run => (
                <SelectItem key={run.id} value={run.id.toString()}>
                  {new Date(run.startedAt).toLocaleDateString()} {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {run.brandName ? ` — ${run.brandName}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-gray-600 mb-4">Which individual pages are most cited in LLM responses</p>

        <div className="flex flex-wrap items-center gap-3 sm:gap-6 mb-6 p-3 bg-gray-50 rounded-lg">
          <span className="text-sm font-medium text-gray-700 w-full sm:w-auto">Show citations from:</span>
          <div className="flex items-center gap-2">
            <Checkbox id="page-show-brand" checked={showBrand} onCheckedChange={(v) => { setShowBrand(!!v); resetPageNum(); }} />
            <Label htmlFor="page-show-brand" className="text-sm text-green-700 font-medium cursor-pointer">Your brand</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="page-show-competitor" checked={showCompetitor} onCheckedChange={(v) => { setShowCompetitor(!!v); resetPageNum(); }} />
            <Label htmlFor="page-show-competitor" className="text-sm text-red-700 font-medium cursor-pointer">Competitors</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="page-show-neutral" checked={showNeutral} onCheckedChange={(v) => { setShowNeutral(!!v); resetPageNum(); }} />
            <Label htmlFor="page-show-neutral" className="text-sm text-gray-700 font-medium cursor-pointer">Other</Label>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search page URLs..."
              value={pageSearch}
              onChange={(e) => { setPageSearch(e.target.value); resetPageNum(); }}
              className="pl-10"
            />
          </div>
          <Select value={selectedTopic} onValueChange={setSelectedTopic}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="All Topics" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Topics</SelectItem>
              {topics?.map(t => (
                <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
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
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {filteredPages.length === 0 ? (
          <div className="text-center py-8 text-gray-500 bg-white rounded-lg border">
            No pages found matching your filters
          </div>
        ) : (
          filteredPages.map((page, index) => {
            const isExpanded = selectedPage === page.url;
            const toggleExpand = () => setSelectedPage(isExpanded ? null : page.url);
            return (
              <div
                key={page.url}
                id={`page-row-${encodeURIComponent(page.url)}`}
                className="p-3 border rounded-lg bg-white"
              >
                <div className="cursor-pointer" onClick={toggleExpand}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-400 font-mono">{index + 1}</span>
                    <img
                      src={getFavicon(page.domain)}
                      alt=""
                      className="w-4 h-4"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <span className="font-medium text-sm truncate flex-1">{page.url}</span>
                    {page.sourceType === 'brand' && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 border-green-200">Brand</Badge>
                    )}
                    {page.sourceType === 'competitor' && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 border-red-200">Competitor</Badge>
                    )}
                    {isExpanded
                      ? <ChevronUp className="h-4 w-4 text-gray-400 shrink-0" />
                      : <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                    }
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs text-gray-500">{page.domain}</span>
                    <span className="text-xs text-gray-600">{page.citationCount} citations</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${page.impact}%` }} />
                    </div>
                    <span className="text-xs font-medium w-10 text-right">{page.impact.toFixed(1)}%</span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      {(() => {
                        const href = safeHttpHref(page.url);
                        return href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-1">
                            Open page <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-gray-500" title="Non-http(s) URL — link disabled">Open page (disabled)</span>
                        );
                      })()}
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="text-xs text-gray-400">Mark domain {page.domain} as:</span>
                        {page.sourceType !== 'brand' && (
                          <button onClick={() => reclassifySource(page.domain, 'brand')} className="text-xs text-gray-400 hover:text-green-600 flex items-center gap-1">
                            <ArrowRightLeft className="h-3 w-3" />Brand
                          </button>
                        )}
                        {page.sourceType !== 'competitor' && (
                          <button onClick={() => reclassifySource(page.domain, 'competitor')} className="text-xs text-gray-400 hover:text-red-600 flex items-center gap-1">
                            <ArrowRightLeft className="h-3 w-3" />Competitor
                          </button>
                        )}
                        {page.sourceType !== 'neutral' && (
                          <button onClick={() => reclassifySource(page.domain, 'neutral')} className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1">
                            <ArrowRightLeft className="h-3 w-3" />Neutral
                          </button>
                        )}
                      </div>
                    </div>
                    <PageResponses url={page.url} runId={selectedRun !== 'all' ? selectedRun : undefined} model={selectedModel !== 'all' ? selectedModel : undefined} topicId={selectedTopic !== 'all' ? selectedTopic : undefined} onFilterByRun={(id) => setSelectedRun(id.toString())} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block bg-white rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>PAGE URL</TableHead>
              <TableHead className="w-48">ROOT DOMAIN</TableHead>
              <TableHead className="w-48">% OF CITATIONS</TableHead>
              <TableHead className="w-24">CITATIONS</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  No pages found matching your filters
                </TableCell>
              </TableRow>
            ) : (
              filteredPages.map((page, index) => {
                const isExpanded = selectedPage === page.url;
                const toggleExpand = () => setSelectedPage(isExpanded ? null : page.url);
                return (
                  <>
                    <TableRow
                      key={page.url}
                      id={`page-row-${encodeURIComponent(page.url)}`}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={toggleExpand}
                    >
                      <TableCell className="font-medium">{index + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3 max-w-2xl">
                          <img
                            src={getFavicon(page.domain)}
                            alt=""
                            className="w-4 h-4 shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <span className="font-medium truncate" title={page.url}>{page.url}</span>
                          {page.sourceType === 'brand' && (
                            <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 border-green-200 shrink-0">Brand</Badge>
                          )}
                          {page.sourceType === 'competitor' && (
                            <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 border-red-200 shrink-0">Competitor</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-600">{page.domain}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-gray-200 rounded-full h-2">
                            <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${page.impact}%` }} />
                          </div>
                          <span className="text-sm font-medium w-12 text-right">{page.impact.toFixed(1)}%</span>
                        </div>
                      </TableCell>
                      <TableCell><span className="text-sm font-medium">{page.citationCount}</span></TableCell>
                      <TableCell>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${page.url}-detail`}>
                        <TableCell colSpan={6} className="bg-gray-50 p-0">
                          <div className="border-b px-4 py-2 flex items-center gap-2 flex-wrap">
                            {(() => {
                              const href = safeHttpHref(page.url);
                              return href ? (
                                <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                  Open page <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-xs text-gray-500" title="Non-http(s) URL — link disabled">Open page (disabled)</span>
                              );
                            })()}
                            <div className="ml-auto flex items-center gap-2">
                              <span className="text-xs text-gray-400">Mark domain {page.domain} as:</span>
                              {page.sourceType !== 'brand' && (
                                <button onClick={(e) => { e.stopPropagation(); reclassifySource(page.domain, 'brand'); }} className="text-xs text-gray-400 hover:text-green-600 flex items-center gap-1">
                                  <ArrowRightLeft className="h-3 w-3" />Brand
                                </button>
                              )}
                              {page.sourceType !== 'competitor' && (
                                <button onClick={(e) => { e.stopPropagation(); reclassifySource(page.domain, 'competitor'); }} className="text-xs text-gray-400 hover:text-red-600 flex items-center gap-1">
                                  <ArrowRightLeft className="h-3 w-3" />Competitor
                                </button>
                              )}
                              {page.sourceType !== 'neutral' && (
                                <button onClick={(e) => { e.stopPropagation(); reclassifySource(page.domain, 'neutral'); }} className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1">
                                  <ArrowRightLeft className="h-3 w-3" />Neutral
                                </button>
                              )}
                            </div>
                          </div>
                          <PageResponses url={page.url} runId={selectedRun !== 'all' ? selectedRun : undefined} model={selectedModel !== 'all' ? selectedModel : undefined} topicId={selectedTopic !== 'all' ? selectedTopic : undefined} onFilterByRun={(id) => setSelectedRun(id.toString())} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination controls */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-gray-600">
            Showing {(pageNum - 1) * PAGE_SIZE + 1}–{Math.min(pageNum * PAGE_SIZE, total)} of {total.toLocaleString()} pages
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageNum(pageNum - 1)}
              disabled={pageNum <= 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Prev
            </Button>
            <span className="text-sm text-gray-600 min-w-[80px] text-center">
              Page {pageNum} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageNum(pageNum + 1)}
              disabled={pageNum >= totalPages}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatRunStamp(r: { analysisRunId?: number | null; createdAt?: string | null }): string {
  const parts: string[] = [];
  if (r.analysisRunId != null) parts.push(`Run #${r.analysisRunId}`);
  if (r.createdAt) {
    const d = new Date(r.createdAt);
    if (!isNaN(d.getTime())) {
      parts.push(`${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    }
  }
  return parts.join(' • ');
}

function PageResponses({ url, runId, model, topicId, onFilterByRun }: { url: string; runId?: string; model?: string; topicId?: string; onFilterByRun: (runId: number) => void }) {
  const params = new URLSearchParams();
  params.set('url', url);
  if (runId) params.set('runId', runId);
  if (model) params.set('model', model);
  const { data: rawResponses, isLoading } = useQuery<any[]>({
    queryKey: [`/api/sources/page/responses?${params.toString()}`],
  });
  const responses = topicId
    ? rawResponses?.filter((r: any) => r.prompt?.topicId?.toString() === topicId)
    : rawResponses;
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) return <div className="p-4 text-sm text-gray-500">Loading responses...</div>;
  if (!responses || responses.length === 0) return <div className="p-4 text-sm text-gray-500">No responses found citing this page.</div>;

  return (
    <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
      <p className="text-xs text-gray-500 mb-2">{responses.length} response{responses.length !== 1 ? 's' : ''} citing this page</p>
      {responses.map((r: any) => (
        <div key={r.id} className="border rounded bg-white p-3 text-sm">
          <div className="font-medium text-gray-800 mb-1">
            {r.prompt?.text || `Prompt #${r.promptId}`}
          </div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {r.model && <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{r.model}</Badge>}
            {r.brandMentioned && <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700">Brand mentioned</Badge>}
            {r.analysisRunId != null && (
              <button
                onClick={() => onFilterByRun(r.analysisRunId)}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                title="Filter this view by this run"
              >
                {formatRunStamp(r)}
              </button>
            )}
            {r.competitorsMentioned?.length > 0 && (
              <span className="text-xs text-gray-500">
                Competitors: {r.competitorsMentioned.join(', ')}
              </span>
            )}
          </div>
          <div className="text-gray-600">
            {expandedId === r.id ? (
              <div className="whitespace-pre-wrap">{r.text}</div>
            ) : (
              <div>{r.text?.substring(0, 200)}...</div>
            )}
          </div>
          <button
            onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
            className="text-xs text-blue-600 hover:text-blue-800 mt-1"
          >
            {expandedId === r.id ? 'Show less' : 'Show full response'}
          </button>
        </div>
      ))}
    </div>
  );
}
