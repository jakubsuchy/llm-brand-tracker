import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { ChevronDown, ChevronUp, CheckCircle, XCircle, Scale, ExternalLink } from "lucide-react";
import { ResponseFilters, type ResponseFilterValues } from "@/components/response-filters";
import type { CompetitorAnalysis, ResponseWithPrompt, Topic, MergeHistoryEntry } from "@shared/schema";

interface AnalysisRun {
  id: number;
  startedAt: string;
  status: string;
  brandName: string | null;
  responseCount: number;
}

const PAGE_SIZE = 20;

export default function ComparePage() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const urlParams = new URLSearchParams(searchString);
  const urlCompetitor = urlParams.get('competitor') || '';
  const urlRun = urlParams.get('runId') || 'all';

  const [selectedCompetitor, setSelectedCompetitor] = useState<string>(urlCompetitor);
  const [selectedRun, setSelectedRun] = useState<string>(urlRun);
  const [expandedPrompt, setExpandedPrompt] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<ResponseFilterValues>({ search: '', run: 'all', topic: 'all', model: 'all' });

  // Sync selection to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedCompetitor) params.set('competitor', selectedCompetitor);
    if (selectedRun !== 'all') params.set('runId', selectedRun);
    const qs = params.toString();
    setLocation(`/compare${qs ? `?${qs}` : ''}`, { replace: true });
  }, [selectedCompetitor, selectedRun, setLocation]);

  const { data: analysisRuns } = useQuery<AnalysisRun[]>({
    queryKey: ['/api/analysis/runs'],
  });

  const runParam = selectedRun !== 'all' ? `?runId=${selectedRun}` : '';
  const runAmpParam = selectedRun !== 'all' ? `&runId=${selectedRun}` : '';

  const { data: competitors } = useQuery<CompetitorAnalysis[]>({
    queryKey: [`/api/competitors/analysis${runParam}`],
  });

  const { data: responses } = useQuery<ResponseWithPrompt[]>({
    queryKey: [`/api/responses?limit=1000&full=true${runAmpParam}`],
  });

  const { data: topics } = useQuery<Topic[]>({
    queryKey: ['/api/topics'],
  });

  const { data: mergeHistory } = useQuery<MergeHistoryEntry[]>({
    queryKey: ['/api/competitors/merge-history'],
  });

  // Build a set of all names for a given primary competitor (includes merged names)
  const getNamesForCompetitor = (name: string): Set<string> => {
    const names = new Set([name.toLowerCase()]);
    if (mergeHistory) {
      for (const entry of mergeHistory) {
        if (entry.primaryName.toLowerCase() === name.toLowerCase()) {
          names.add(entry.mergedName.toLowerCase());
        }
      }
    }
    return names;
  };

  const totalResponses = responses?.length || 0;
  const brandMentionCount = responses?.filter(r => r.brandMentioned).length || 0;
  const brandMentionRate = totalResponses > 0 ? (brandMentionCount / totalResponses) * 100 : 0;

  const competitor = competitors?.find(c => c.competitorId.toString() === selectedCompetitor);
  const competitorNames = competitor ? getNamesForCompetitor(competitor.name) : new Set<string>();

  const isCompMentioned = (r: ResponseWithPrompt) =>
    r.competitorsMentioned?.some((c: string) => competitorNames.has(c.toLowerCase())) || false;

  // Responses where either brand or competitor is mentioned, with filters applied
  const relevantResponses = responses?.filter(r => {
    if (!competitor) return false;
    if (!r.brandMentioned && !isCompMentioned(r)) return false;
    if (filters.topic !== 'all' && r.prompt?.topicId !== parseInt(filters.topic)) return false;
    if (filters.model !== 'all' && r.model !== filters.model) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!r.prompt.text.toLowerCase().includes(q) && !r.text.toLowerCase().includes(q)) return false;
    }
    return true;
  }) || [];

  const sortedResponses = [...relevantResponses].sort((a, b) =>
    a.prompt.text.localeCompare(b.prompt.text)
  );

  const totalPages = Math.ceil(sortedResponses.length / PAGE_SIZE);
  const paginatedResponses = sortedResponses.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const updateFilters = (f: ResponseFilterValues) => { setFilters(f); setPage(0); };

  const getTopicName = (topicId: number | null) => {
    if (!topicId) return 'General';
    return topics?.find(t => t.id === topicId)?.name || 'Unknown';
  };

  const updateRun = (r: string) => { setSelectedRun(r); setPage(0); };
  const updateCompetitor = (c: string) => { setSelectedCompetitor(c); setPage(0); };

  const runMap = new Map(analysisRuns?.map(r => [r.id, r]) || []);
  const getRunLabel = (runId: number | null | undefined) => {
    if (!runId) return null;
    const run = runMap.get(runId);
    if (!run) return null;
    return new Date(run.startedAt).toLocaleDateString() + ' ' +
      new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Topic breakdown: brand vs competitor mention rate per topic
  const topicBreakdown = (() => {
    if (!responses || !competitor) return [];
    const topicMap = new Map<number, { name: string; total: number; brandHits: number; compHits: number }>();
    for (const r of responses) {
      const tid = r.prompt.topicId || 0;
      const name = getTopicName(r.prompt.topicId);
      if (!topicMap.has(tid)) topicMap.set(tid, { name, total: 0, brandHits: 0, compHits: 0 });
      const t = topicMap.get(tid)!;
      t.total++;
      if (r.brandMentioned) t.brandHits++;
      if (r.competitorsMentioned?.some((c: string) => competitorNames.has(c.toLowerCase()))) t.compHits++;
    }
    return [...topicMap.values()]
      .filter(t => t.brandHits > 0 || t.compHits > 0)
      .sort((a, b) => {
        const aDelta = (a.brandHits / a.total) - (a.compHits / a.total);
        const bDelta = (b.brandHits / b.total) - (b.compHits / b.total);
        return bDelta - aDelta; // brand-winning topics first
      });
  })();

  // Source overlap: which source domains are cited when brand is mentioned vs when competitor is mentioned
  // "Brand sources" = domains cited in responses where brand is mentioned
  // "Competitor sources" = domains cited in responses where competitor is mentioned
  // Then classify each domain: appears in brand-only responses, competitor-only responses, or both
  const sourceOverlap = (() => {
    if (!responses || !competitor) return { brandOnly: [] as string[], compOnly: [] as string[], shared: [] as string[] };
    // Track which domains appear in brand-mentioning vs competitor-mentioning responses
    const brandResponseDomains = new Set<string>();
    const compResponseDomains = new Set<string>();
    for (const r of responses) {
      if (!r.sources || r.sources.length === 0) continue;
      const domains = r.sources.map(s => { try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return s; } });
      const compHit = isCompMentioned(r);
      if (r.brandMentioned && !compHit) domains.forEach(d => brandResponseDomains.add(d));
      else if (!r.brandMentioned && compHit) domains.forEach(d => compResponseDomains.add(d));
      else if (r.brandMentioned && compHit) {
        // Both mentioned in same response — these sources are truly shared context
        domains.forEach(d => { brandResponseDomains.add(d); compResponseDomains.add(d); });
      }
    }
    const shared = [...brandResponseDomains].filter(d => compResponseDomains.has(d));
    const brandOnly = [...brandResponseDomains].filter(d => !compResponseDomains.has(d));
    const compOnly = [...compResponseDomains].filter(d => !brandResponseDomains.has(d));
    return { brandOnly, compOnly, shared };
  })();

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Compare</h1>
          <p className="text-gray-600 mt-1">Compare your brand mentions against a competitor</p>
        </div>
        <Select value={selectedRun} onValueChange={updateRun}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Filter by run" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Runs</SelectItem>
            {analysisRuns?.map(run => (
              <SelectItem key={run.id} value={run.id.toString()}>
                {new Date(run.startedAt).toLocaleDateString()} {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {run.brandName ? ` \u2014 ${run.brandName}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Competitor selector */}
      <div>
        <Select value={selectedCompetitor} onValueChange={updateCompetitor}>
          <SelectTrigger className="w-full sm:w-80">
            <SelectValue placeholder="Select a competitor to compare..." />
          </SelectTrigger>
          <SelectContent>
            {competitors?.sort((a, b) => b.mentionCount - a.mentionCount).map(c => (
              <SelectItem key={c.competitorId} value={c.competitorId.toString()}>
                {c.name} ({c.mentionRate.toFixed(1)}%)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedCompetitor && (
        <Card>
          <CardContent className="p-12 text-center">
            <Scale className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-500">Select a competitor above to start comparing</p>
          </CardContent>
        </Card>
      )}

      {selectedCompetitor && competitor && (
        <>
          {/* Mention comparison */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-gray-600">Your Brand</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-indigo-600 mb-1">{brandMentionRate.toFixed(1)}%</div>
                <div className="text-sm text-gray-500 mb-3">{brandMentionCount} of {totalResponses} prompts</div>
                <Progress value={brandMentionRate} className="h-2" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-gray-600">{competitor.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600 mb-1">{competitor.mentionRate.toFixed(1)}%</div>
                <div className="text-sm text-gray-500 mb-3">{competitor.mentionCount} of {totalResponses} prompts</div>
                <Progress value={competitor.mentionRate} className="h-2" />
              </CardContent>
            </Card>
          </div>

          {/* Delta summary */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-center text-sm">
                <div>
                  <div className="text-xs text-gray-500 uppercase font-medium mb-1">Both mentioned</div>
                  <div className="text-lg font-bold text-purple-600">
                    {responses?.filter(r => r.brandMentioned && isCompMentioned(r)).length || 0}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase font-medium mb-1">Only your brand</div>
                  <div className="text-lg font-bold text-indigo-600">
                    {responses?.filter(r => r.brandMentioned && !isCompMentioned(r)).length || 0}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase font-medium mb-1">Only {competitor.name}</div>
                  <div className="text-lg font-bold text-blue-600">
                    {responses?.filter(r => !r.brandMentioned && isCompMentioned(r)).length || 0}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Topic breakdown */}
          {topicBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Topic Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {/* Mobile card view */}
                <div className="md:hidden p-3 space-y-3">
                  {topicBreakdown.map((t) => {
                    const brandRate = t.total > 0 ? (t.brandHits / t.total) * 100 : 0;
                    const compRate = t.total > 0 ? (t.compHits / t.total) * 100 : 0;
                    const delta = brandRate - compRate;
                    return (
                      <div key={t.name} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{t.name}</span>
                          <span className={`text-sm font-bold ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                            {delta > 0 ? '+' : ''}{delta.toFixed(0)}%
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mb-2">{t.total} prompts</div>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-indigo-600 w-16">Brand</span>
                            <Progress value={brandRate} className="h-2 flex-1" />
                            <span className="text-xs font-medium w-8 text-right text-indigo-600">{brandRate.toFixed(0)}%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-blue-600 w-16 truncate">{competitor.name}</span>
                            <Progress value={compRate} className="h-2 flex-1" />
                            <span className="text-xs font-medium w-8 text-right text-blue-600">{compRate.toFixed(0)}%</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Desktop table view */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>TOPIC</TableHead>
                        <TableHead className="w-28 text-center">PROMPTS</TableHead>
                        <TableHead className="w-44 text-center">YOUR BRAND</TableHead>
                        <TableHead className="w-44 text-center">{competitor.name.toUpperCase()}</TableHead>
                        <TableHead className="w-28 text-center">DELTA</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topicBreakdown.map((t) => {
                        const brandRate = t.total > 0 ? (t.brandHits / t.total) * 100 : 0;
                        const compRate = t.total > 0 ? (t.compHits / t.total) * 100 : 0;
                        const delta = brandRate - compRate;
                        return (
                          <TableRow key={t.name}>
                            <TableCell className="font-medium">{t.name}</TableCell>
                            <TableCell className="text-center text-sm text-gray-500">{t.total}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Progress value={brandRate} className="h-2 flex-1" />
                                <span className="text-sm font-medium w-12 text-right text-indigo-600">{brandRate.toFixed(0)}%</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Progress value={compRate} className="h-2 flex-1" />
                                <span className="text-sm font-medium w-12 text-right text-blue-600">{compRate.toFixed(0)}%</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className={`text-sm font-bold ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                {delta > 0 ? '+' : ''}{delta.toFixed(0)}%
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Source overlap */}
          {(sourceOverlap.shared.length > 0 || sourceOverlap.brandOnly.length > 0 || sourceOverlap.compOnly.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Sources Cited</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <SourceList
                    label="Only your brand"
                    items={sourceOverlap.brandOnly}
                    dotColor="bg-indigo-500"
                    textColor="text-gray-700"
                    iconColor="text-gray-400"
                  />
                  <SourceList
                    label="Shared"
                    items={sourceOverlap.shared}
                    dotColor="bg-purple-500"
                    textColor="text-purple-700"
                    iconColor="text-purple-400"
                  />
                  <SourceList
                    label={`Only ${competitor.name}`}
                    items={sourceOverlap.compOnly}
                    dotColor="bg-blue-500"
                    textColor="text-gray-700"
                    iconColor="text-gray-400"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Prompt-level comparison table */}
          <div>
            <h2 className="text-lg font-semibold mb-3">
              Prompts mentioning either ({sortedResponses.length})
            </h2>
            <div className="mb-4">
              <ResponseFilters values={filters} onChange={updateFilters} />
            </div>

            {/* Mobile card view */}
            <div className="md:hidden space-y-3">
              {paginatedResponses.length === 0 ? (
                <div className="text-center py-8 text-gray-500 bg-white rounded-lg border">
                  Neither brand nor competitor mentioned in any prompt
                </div>
              ) : (
                paginatedResponses.map((response) => {
                  const compHit = isCompMentioned(response);
                  return (
                    <div
                      key={response.id}
                      className={`p-3 border rounded-lg bg-white cursor-pointer ${expandedPrompt === response.id ? 'ring-2 ring-blue-200' : ''}`}
                      onClick={() => setExpandedPrompt(expandedPrompt === response.id ? null : response.id)}
                    >
                      <p className="text-sm font-medium text-gray-900 leading-relaxed mb-2">
                        {response.prompt.text}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-gray-500">Brand:</span>
                          {response.brandMentioned ? (
                            <CheckCircle className="w-4 h-4 text-green-600" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400" />
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-gray-500">{competitor.name}:</span>
                          {compHit ? (
                            <CheckCircle className="w-4 h-4 text-green-600" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400" />
                          )}
                        </div>
                        <Badge variant="outline" className="text-xs capitalize">
                          {response.model || 'unknown'}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {getTopicName(response.prompt.topicId)}
                        </Badge>
                      </div>
                      {selectedRun === 'all' && getRunLabel(response.analysisRunId) && (
                        <div className="text-xs text-gray-500 mt-1">
                          {getRunLabel(response.analysisRunId)}
                        </div>
                      )}
                      {expandedPrompt === response.id && (
                        <div className="mt-3 pt-3 border-t space-y-3">
                          <div>
                            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Response</h4>
                            <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 p-3 rounded border max-h-96 overflow-y-auto leading-relaxed">
                              {response.text}
                            </div>
                          </div>
                          {response.competitorsMentioned && response.competitorsMentioned.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Competitors Mentioned</h4>
                              <div className="flex flex-wrap gap-1">
                                {response.competitorsMentioned.map((c, i) => (
                                  <Badge
                                    key={i}
                                    variant="outline"
                                    className={`text-xs ${competitorNames.has(c.toLowerCase()) ? 'border-blue-400 text-blue-700 bg-blue-50' : ''}`}
                                  >
                                    {c}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {response.sources && response.sources.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Sources Cited</h4>
                              <div className="flex flex-wrap gap-1">
                                {response.sources.map((s, i) => (
                                  <a key={i} href={s} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800 underline break-all">{s}</a>
                                ))}
                              </div>
                            </div>
                          )}
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
                    <TableHead>USER QUERY</TableHead>
                    <TableHead className="w-28">MODEL</TableHead>
                    <TableHead className="w-36 text-center">YOUR BRAND</TableHead>
                    <TableHead className="w-36 text-center">{competitor.name.toUpperCase()}</TableHead>
                    <TableHead className="w-32">TOPIC</TableHead>
                    {selectedRun === 'all' && <TableHead className="w-36">RUN</TableHead>}
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedResponses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={selectedRun === 'all' ? 7 : 6} className="text-center py-8 text-gray-500">
                        Neither brand nor competitor mentioned in any prompt
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedResponses.map((response) => {
                      const compHit = isCompMentioned(response);
                      return (
                        <>
                          <TableRow key={response.id} className="hover:bg-gray-50">
                            <TableCell className="font-medium">
                              <p className="text-sm text-gray-900 leading-relaxed">
                                {response.prompt.text}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs capitalize">
                                {response.model || 'unknown'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              {response.brandMentioned ? (
                                <CheckCircle className="w-5 h-5 text-green-600 mx-auto" />
                              ) : (
                                <XCircle className="w-5 h-5 text-red-400 mx-auto" />
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {compHit ? (
                                <CheckCircle className="w-5 h-5 text-green-600 mx-auto" />
                              ) : (
                                <XCircle className="w-5 h-5 text-red-400 mx-auto" />
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs">
                                {getTopicName(response.prompt.topicId)}
                              </Badge>
                            </TableCell>
                            {selectedRun === 'all' && (
                              <TableCell>
                                <span className="text-xs text-gray-500">
                                  {getRunLabel(response.analysisRunId) || '\u2014'}
                                </span>
                              </TableCell>
                            )}
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setExpandedPrompt(expandedPrompt === response.id ? null : response.id)}
                                className="text-blue-600 hover:text-blue-800"
                              >
                                {expandedPrompt === response.id ? (
                                  <><ChevronUp className="h-4 w-4 mr-1" /> Hide</>
                                ) : (
                                  <><ChevronDown className="h-4 w-4 mr-1" /> Details</>
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                          {expandedPrompt === response.id && (
                            <TableRow key={`${response.id}-detail`}>
                              <TableCell colSpan={selectedRun === 'all' ? 7 : 6} className="bg-gray-50 p-0">
                                <div className="p-4 space-y-3">
                                  <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">{response.model ? `${response.model} Response` : 'Response'}</h4>
                                    <div className="text-sm text-gray-800 whitespace-pre-wrap bg-white p-4 rounded border max-h-96 overflow-y-auto leading-relaxed">
                                      {response.text}
                                    </div>
                                  </div>
                                  {response.competitorsMentioned && response.competitorsMentioned.length > 0 && (
                                    <div>
                                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Competitors Mentioned</h4>
                                      <div className="flex flex-wrap gap-1">
                                        {response.competitorsMentioned.map((c, i) => (
                                          <Badge
                                            key={i}
                                            variant="outline"
                                            className={`text-xs ${competitorNames.has(c.toLowerCase()) ? 'border-blue-400 text-blue-700 bg-blue-50' : ''}`}
                                          >
                                            {c}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {response.sources && response.sources.length > 0 && (
                                    <div>
                                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Sources Cited</h4>
                                      <div className="flex flex-wrap gap-1">
                                        {response.sources.map((s, i) => (
                                          <a key={i} href={s} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800 underline">{s}</a>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, sortedResponses.length)} of {sortedResponses.length}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
                    Previous
                  </Button>
                  <span className="flex items-center text-sm text-gray-600 px-2">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const SOURCES_LIMIT = 10;

function SourceList({ label, items, dotColor, textColor, iconColor }: {
  label: string;
  items: string[];
  dotColor: string;
  textColor: string;
  iconColor: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? items : items.slice(0, SOURCES_LIMIT);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${dotColor}`}></div>
        <h4 className="text-sm font-semibold text-gray-700">{label} ({items.length})</h4>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">None</p>
      ) : (
        <div className="space-y-1">
          {displayed.map(d => (
            <div key={d} className={`flex items-center gap-1 text-sm ${textColor}`}>
              <ExternalLink className={`w-3 h-3 ${iconColor} shrink-0`} />
              <span className="truncate">{d}</span>
            </div>
          ))}
          {items.length > SOURCES_LIMIT && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs text-indigo-600 hover:text-indigo-800 mt-1"
            >
              View {items.length - SOURCES_LIMIT} more...
            </button>
          )}
          {showAll && items.length > SOURCES_LIMIT && (
            <button
              onClick={() => setShowAll(false)}
              className="text-xs text-indigo-600 hover:text-indigo-800 mt-1"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
