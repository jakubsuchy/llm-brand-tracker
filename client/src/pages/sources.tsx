import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Search, ExternalLink, Download, MessageSquare, FileText, ChevronDown, ChevronUp, ArrowRightLeft } from "lucide-react";
import type { SourceAnalysis } from "@shared/schema";

interface AnalysisRun {
  id: number;
  startedAt: string;
  status: string;
  brandName: string | null;
  responseCount: number;
}

type CategoryType = 'all' | 'social' | 'business' | 'publisher' | 'other';

interface DomainData {
  id: number;
  domain: string;
  category: string;
  sourceType: string;
  impact: number;
  citations: number;
  pages: number;
  urls: string[];
}

export default function SourcesPage() {
  const [categoryFilter, setCategoryFilter] = useState<CategoryType>('all');
  const [showBrand, setShowBrand] = useState(true);
  const [showCompetitor, setShowCompetitor] = useState(true);
  const [showNeutral, setShowNeutral] = useState(true);
  const [domainSearch, setDomainSearch] = useState('');
  const [selectedRun, setSelectedRun] = useState<string>('all');
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [expandedView, setExpandedView] = useState<'prompts' | 'pages' | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const reclassifySource = async (domain: string, sourceType: 'competitor' | 'neutral') => {
    try {
      const res = await fetch('/api/sources/reclassify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, sourceType }),
      });
      if (!res.ok) throw new Error('Failed to reclassify');
      queryClient.invalidateQueries({ predicate: (q) => {
        const key = q.queryKey[0] as string;
        return typeof key === 'string' && (key.startsWith('/api/sources') || key.startsWith('/api/competitors'));
      }});
      toast({
        title: "Reclassified",
        description: sourceType === 'competitor'
          ? `${domain} is now a competitor source.`
          : `${domain} is now a neutral source.`,
      });
    } catch {
      toast({ title: "Error", description: "Failed to reclassify domain", variant: "destructive" });
    }
  };

  const { data: analysisRuns } = useQuery<AnalysisRun[]>({
    queryKey: ['/api/analysis/runs'],
  });

  const runParam = selectedRun !== 'all' ? `?runId=${selectedRun}` : '';
  const { data: sources, isLoading } = useQuery<SourceAnalysis[]>({
    queryKey: [`/api/sources/analysis${runParam}`],
  });


  // Total citations across all sources for percentage calculation
  const totalCitations = (sources || []).reduce((sum, s) => sum + (s.citationCount || 0), 0);

  // Transform source data into domain format
  const domains: DomainData[] = (sources || []).map(source => {
    const category = getDomainCategory(source.domain);
    return {
      id: source.sourceId,
      domain: source.domain,
      category,
      sourceType: source.sourceType || 'neutral',
      impact: totalCitations > 0 ? ((source.citationCount || 0) / totalCitations) * 100 : 0,
      citations: source.citationCount || 0,
      pages: source.urls.length,
      urls: source.urls
    };
  });

  // Filter domains by category, source type, and search
  const filteredDomains = domains.filter(domain => {
    if (categoryFilter !== 'all' && domain.category !== categoryFilter) return false;
    if (domainSearch && !domain.domain.toLowerCase().includes(domainSearch.toLowerCase())) return false;
    if (domain.sourceType === 'brand' && !showBrand) return false;
    if (domain.sourceType === 'competitor' && !showCompetitor) return false;
    if (domain.sourceType === 'neutral' && !showNeutral) return false;
    return true;
  }).sort((a, b) => b.impact - a.impact); // Sort by impact descending

  function getDomainCategory(domain: string): string {
    if (domain.includes('twitter') || domain.includes('linkedin') || domain.includes('reddit')) return 'social';
    if (domain.includes('business') || domain.includes('forbes') || domain.includes('bloomberg')) return 'business';
    if (domain.includes('medium') || domain.includes('dev.to') || domain.includes('blog')) return 'publisher';
    return 'other';
  }

  function getCategoryColor(category: string) {
    switch (category) {
      case 'social': return 'bg-blue-100 text-blue-800';
      case 'business': return 'bg-green-100 text-green-800';
      case 'publisher': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  function getFavicon(domain: string) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  }

  if (isLoading) {
    return (
      <div className="p-4 sm:p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-8">
      {/* Source Domains Section */}
      <div>
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Source Domains</h1>
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
          <p className="text-gray-600 mb-4">Which domains hold the most influence for your relevant queries</p>

          {/* Source type filter */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-6 mb-6 p-3 bg-gray-50 rounded-lg">
            <span className="text-sm font-medium text-gray-700 w-full sm:w-auto">Show citations from:</span>
            <div className="flex items-center gap-2">
              <Checkbox id="show-brand" checked={showBrand} onCheckedChange={(v) => setShowBrand(!!v)} />
              <Label htmlFor="show-brand" className="text-sm text-green-700 font-medium cursor-pointer">Your brand</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="show-competitor" checked={showCompetitor} onCheckedChange={(v) => setShowCompetitor(!!v)} />
              <Label htmlFor="show-competitor" className="text-sm text-red-700 font-medium cursor-pointer">Competitors</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="show-neutral" checked={showNeutral} onCheckedChange={(v) => setShowNeutral(!!v)} />
              <Label htmlFor="show-neutral" className="text-sm text-gray-700 font-medium cursor-pointer">Other</Label>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-6">
            <Button
              variant={categoryFilter === 'all' ? 'default' : 'outline'}
              onClick={() => setCategoryFilter('all')}
              className="h-8"
            >
              All Categories
            </Button>
            <Button
              variant={categoryFilter === 'social' ? 'default' : 'outline'}
              onClick={() => setCategoryFilter('social')}
              className="h-8"
            >
              Social media
            </Button>
            <Button
              variant={categoryFilter === 'business' ? 'default' : 'outline'}
              onClick={() => setCategoryFilter('business')}
              className="h-8"
            >
              Business
            </Button>
            <Button
              variant={categoryFilter === 'publisher' ? 'default' : 'outline'}
              onClick={() => setCategoryFilter('publisher')}
              className="h-8"
            >
              Publisher
            </Button>
            <Button
              variant={categoryFilter === 'other' ? 'default' : 'outline'}
              onClick={() => setCategoryFilter('other')}
              className="h-8"
            >
              Other
            </Button>
          </div>

          {/* Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search domains..."
                value={domainSearch}
                onChange={(e) => setDomainSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button variant="outline" className="flex items-center justify-center gap-2">
              <Download className="w-4 h-4" />
              Export Data
            </Button>
          </div>
        </div>

        {/* Mobile card view */}
        <div className="md:hidden space-y-3">
          {filteredDomains.length === 0 ? (
            <div className="text-center py-8 text-gray-500 bg-white rounded-lg border">
              No domains found matching your filters
            </div>
          ) : (
            filteredDomains.map((domain, index) => {
              const isExpanded = expandedDomain === domain.domain;
              const toggleExpand = () => {
                if (isExpanded) {
                  setExpandedDomain(null);
                  setExpandedView(null);
                } else {
                  setExpandedDomain(domain.domain);
                  setExpandedView('prompts');
                }
              };
              return (
                <div key={domain.domain} className="p-3 border rounded-lg bg-white">
                  <div className="cursor-pointer" onClick={toggleExpand}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-400 font-mono">{index + 1}</span>
                      <img
                        src={getFavicon(domain.domain)}
                        alt=""
                        className="w-4 h-4"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <span className="font-medium text-sm truncate">{domain.domain}</span>
                      {domain.sourceType === 'brand' && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 border-green-200">Brand</Badge>
                      )}
                      {domain.sourceType === 'competitor' && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 border-red-200">Competitor</Badge>
                      )}
                      {isExpanded
                        ? <ChevronUp className="h-4 w-4 text-gray-400 ml-auto shrink-0" />
                        : <ChevronDown className="h-4 w-4 text-gray-400 ml-auto shrink-0" />
                      }
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge className={`text-xs ${getCategoryColor(domain.category)}`}>
                        {domain.category}
                      </Badge>
                      <span className="text-xs text-gray-600">{domain.citations} citations</span>
                      <span className="text-xs text-gray-600">{domain.urls.length} pages</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${domain.impact}%` }} />
                      </div>
                      <span className="text-xs font-medium w-10 text-right">{domain.impact.toFixed(1)}%</span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex flex-wrap gap-2 items-center mb-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedView('prompts'); }}
                          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                            expandedView === 'prompts'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          <MessageSquare className="h-3 w-3 inline mr-1 -mt-0.5" />
                          Prompts
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedView('pages'); }}
                          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                            expandedView === 'pages'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          <FileText className="h-3 w-3 inline mr-1 -mt-0.5" />
                          Pages ({domain.urls.length})
                        </button>
                        {domain.sourceType !== 'competitor' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); reclassifySource(domain.domain, 'competitor'); }}
                            className="text-xs text-gray-400 hover:text-red-600 flex items-center gap-1 ml-auto"
                          >
                            <ArrowRightLeft className="h-3 w-3" />
                            Mark as competitor
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); reclassifySource(domain.domain, 'neutral'); }}
                            className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1 ml-auto"
                          >
                            <ArrowRightLeft className="h-3 w-3" />
                            Mark as neutral
                          </button>
                        )}
                      </div>
                      {expandedView === 'prompts' && (
                        <DomainResponses domain={domain.domain} runId={selectedRun !== 'all' ? selectedRun : undefined} />
                      )}
                      {expandedView === 'pages' && (
                        <DomainPages urls={domain.urls} domain={domain.domain} />
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
                <TableHead className="w-12">#</TableHead>
                <TableHead>ROOT DOMAIN</TableHead>
                <TableHead className="w-32">CATEGORY</TableHead>
                <TableHead className="w-48">% OF CITATIONS</TableHead>
                <TableHead className="w-24">CITATIONS</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDomains.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                    No domains found matching your filters
                  </TableCell>
                </TableRow>
              ) : (
                filteredDomains.map((domain, index) => {
                  const isExpanded = expandedDomain === domain.domain;
                  const toggleExpand = () => {
                    if (isExpanded) {
                      setExpandedDomain(null);
                      setExpandedView(null);
                    } else {
                      setExpandedDomain(domain.domain);
                      setExpandedView('prompts');
                    }
                  };
                  return (
                    <>
                      <TableRow key={domain.domain} className="cursor-pointer hover:bg-gray-50" onClick={toggleExpand}>
                        <TableCell className="font-medium">{index + 1}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <img
                              src={getFavicon(domain.domain)}
                              alt=""
                              className="w-4 h-4"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            <span className="font-medium">{domain.domain}</span>
                            {domain.sourceType === 'brand' && (
                              <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 border-green-200">Brand</Badge>
                            )}
                            {domain.sourceType === 'competitor' && (
                              <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 border-red-200">Competitor</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${getCategoryColor(domain.category)}`}>
                            {domain.category}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${domain.impact}%` }} />
                            </div>
                            <span className="text-sm font-medium w-12 text-right">{domain.impact.toFixed(1)}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-medium">{domain.citations}</span>
                        </TableCell>
                        <TableCell>
                          {isExpanded
                            ? <ChevronUp className="h-4 w-4 text-gray-400" />
                            : <ChevronDown className="h-4 w-4 text-gray-400" />
                          }
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${domain.domain}-detail`}>
                          <TableCell colSpan={6} className="bg-gray-50 p-0">
                            <div className="border-b">
                              <div className="flex gap-0 items-center">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setExpandedView('prompts'); }}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    expandedView === 'prompts'
                                      ? 'border-blue-600 text-blue-600'
                                      : 'border-transparent text-gray-500 hover:text-gray-700'
                                  }`}
                                >
                                  <MessageSquare className="h-3 w-3 inline mr-1.5 -mt-0.5" />
                                  Prompts & Responses
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setExpandedView('pages'); }}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    expandedView === 'pages'
                                      ? 'border-blue-600 text-blue-600'
                                      : 'border-transparent text-gray-500 hover:text-gray-700'
                                  }`}
                                >
                                  <FileText className="h-3 w-3 inline mr-1.5 -mt-0.5" />
                                  Pages ({domain.urls.length})
                                </button>
                                <div className="ml-auto pr-3">
                                  {domain.sourceType !== 'competitor' ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); reclassifySource(domain.domain, 'competitor'); }}
                                      className="text-xs text-gray-400 hover:text-red-600 flex items-center gap-1"
                                    >
                                      <ArrowRightLeft className="h-3 w-3" />
                                      Reclassify as competitor
                                    </button>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); reclassifySource(domain.domain, 'neutral'); }}
                                      className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1"
                                    >
                                      <ArrowRightLeft className="h-3 w-3" />
                                      Reclassify as neutral
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                            {expandedView === 'prompts' && (
                              <DomainResponses domain={domain.domain} runId={selectedRun !== 'all' ? selectedRun : undefined} />
                            )}
                            {expandedView === 'pages' && (
                              <DomainPages urls={domain.urls} domain={domain.domain} />
                            )}
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
      </div>
    </div>
  );
}

function DomainResponses({ domain, runId }: { domain: string; runId?: string }) {
  const runParam = runId ? `?runId=${runId}` : '';
  const { data: responses, isLoading } = useQuery<any[]>({
    queryKey: [`/api/sources/${encodeURIComponent(domain)}/responses${runParam}`],
  });
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-500">Loading responses...</div>;
  }

  if (!responses || responses.length === 0) {
    return <div className="p-4 text-sm text-gray-500">No responses found citing this domain.</div>;
  }

  return (
    <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
      <p className="text-xs text-gray-500 mb-2">{responses.length} response{responses.length !== 1 ? 's' : ''} citing {domain}</p>
      {responses.map((r: any) => (
        <div key={r.id} className="border rounded bg-white p-3 text-sm">
          <div className="font-medium text-gray-800 mb-1">
            {r.prompt?.text || `Prompt #${r.promptId}`}
          </div>
          <div className="flex items-center gap-2 mb-2">
            {r.brandMentioned && <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700">Brand mentioned</Badge>}
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

function DomainPages({ urls, domain }: { urls: string[]; domain: string }) {
  if (!urls || urls.length === 0) {
    return <div className="p-4 text-sm text-gray-500">No pages found for this domain.</div>;
  }

  return (
    <div className="p-4 space-y-1 max-h-96 overflow-y-auto">
      <p className="text-xs text-gray-500 mb-2">{urls.length} page{urls.length !== 1 ? 's' : ''} from {domain}</p>
      {urls.map((url, i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <span className="text-xs text-gray-400 w-6">{i + 1}.</span>
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-800 break-all">
            {url}
          </a>
          <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
        </div>
      ))}
    </div>
  );
}