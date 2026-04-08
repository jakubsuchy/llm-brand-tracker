import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle, XCircle, Search } from "lucide-react";
import type { ResponseWithPrompt, Topic } from "@shared/schema";

interface AnalysisRun {
  id: number;
  startedAt: string;
  status: string;
  brandName: string | null;
  responseCount: number;
}

type FilterType = 'all' | 'mentioned' | 'not-mentioned';
const PAGE_SIZE = 20;

export default function PromptResultsPage() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const urlRunId = params.get('runId');
  const urlPromptId = params.get('promptId');

  const [filter, setFilter] = useState<FilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [selectedModel, setSelectedModel] = useState<string>('all');
  const [selectedRun, setSelectedRun] = useState<string>(urlRunId || 'all');
  const [expandedPrompt, setExpandedPrompt] = useState<number | null>(urlPromptId ? parseInt(urlPromptId) : null);
  const [page, setPage] = useState(0);
  const [didAutoScroll, setDidAutoScroll] = useState(false);

  const { data: analysisRuns } = useQuery<AnalysisRun[]>({
    queryKey: ['/api/analysis/runs'],
  });

  const runParam = selectedRun !== 'all' ? `&runId=${selectedRun}` : '';
  const { data: responses, isLoading } = useQuery<ResponseWithPrompt[]>({
    queryKey: [`/api/responses?limit=1000&full=true${runParam}`],
  });

  // Auto-scroll to the linked prompt and set the right page
  useEffect(() => {
    if (didAutoScroll || !urlPromptId || !responses) return;
    const targetId = parseInt(urlPromptId);
    const idx = filteredPromptsRef.current.findIndex(p => p.id === targetId);
    if (idx >= 0) {
      setPage(Math.floor(idx / PAGE_SIZE));
      setDidAutoScroll(true);
      // Scroll after render
      setTimeout(() => {
        document.getElementById(`prompt-${targetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [responses, urlPromptId, didAutoScroll]);

  const { data: topics } = useQuery<Topic[]>({
    queryKey: ['/api/topics'],
  });

  const allPrompts = responses || [];
  const mentionedCount = allPrompts.filter(p => p.brandMentioned).length;
  const notMentionedCount = allPrompts.filter(p => !p.brandMentioned).length;

  // Get unique models for filter
  const models = [...new Set(allPrompts.map(p => p.model).filter(Boolean))];

  const filteredPrompts = allPrompts.filter(prompt => {
    if (filter === 'mentioned' && !prompt.brandMentioned) return false;
    if (filter === 'not-mentioned' && prompt.brandMentioned) return false;
    if (selectedTopic !== 'all' && prompt.prompt.topicId !== parseInt(selectedTopic)) return false;
    if (selectedModel !== 'all' && prompt.model !== selectedModel) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchesPrompt = prompt.prompt.text.toLowerCase().includes(q);
      const matchesResponse = prompt.text.toLowerCase().includes(q);
      if (!matchesPrompt && !matchesResponse) return false;
    }
    return true;
  });
  const filteredPromptsRef = useRef(filteredPrompts);
  filteredPromptsRef.current = filteredPrompts;

  const totalPages = Math.ceil(filteredPrompts.length / PAGE_SIZE);
  const paginatedPrompts = filteredPrompts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when filters change
  const updateFilter = (f: FilterType) => { setFilter(f); setPage(0); };
  const updateTopic = (t: string) => { setSelectedTopic(t); setPage(0); };
  const updateSearch = (s: string) => { setSearchTerm(s); setPage(0); };
  const updateRun = (r: string) => { setSelectedRun(r); setPage(0); };
  const updateModel = (p: string) => { setSelectedModel(p); setPage(0); };

  const getTopicName = (topicId: number | null) => {
    if (!topicId) return 'General';
    const topic = topics?.find(t => t.id === topicId);
    return topic?.name || 'Unknown';
  };

  const runMap = new Map(analysisRuns?.map(r => [r.id, r]) || []);
  const getRunLabel = (runId: number | null | undefined) => {
    if (!runId) return null;
    const run = runMap.get(runId);
    if (!run) return null;
    return new Date(run.startedAt).toLocaleDateString() + ' ' +
      new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

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
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Prompt Results</h1>
            <p className="text-gray-600 mt-1">Results from prompts where your brand should be mentioned</p>
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
                  {run.brandName ? ` — ${run.brandName}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-6">
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => updateFilter('all')}
            className="h-8"
          >
            All ({allPrompts.length})
          </Button>
          <Button
            variant={filter === 'mentioned' ? 'default' : 'outline'}
            onClick={() => updateFilter('mentioned')}
            className={`h-8 ${filter === 'mentioned' ? 'bg-green-600 hover:bg-green-700' : 'border-green-600 text-green-600 hover:bg-green-50'}`}
          >
            Mentioned ({mentionedCount})
          </Button>
          <Button
            variant={filter === 'not-mentioned' ? 'default' : 'outline'}
            onClick={() => updateFilter('not-mentioned')}
            className={`h-8 ${filter === 'not-mentioned' ? 'bg-red-600 hover:bg-red-700' : 'border-red-600 text-red-600 hover:bg-red-50'}`}
          >
            Not mentioned ({notMentionedCount})
          </Button>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search prompts and responses..."
              value={searchTerm}
              onChange={(e) => updateSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2 sm:gap-4">
            <Select value={selectedTopic} onValueChange={updateTopic}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Filter by topic" />
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
            <Select value={selectedModel} onValueChange={updateModel}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Models</SelectItem>
                {models.map(p => (
                  <SelectItem key={p} value={p!}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {paginatedPrompts.length === 0 ? (
          <div className="text-center py-8 text-gray-500 bg-white rounded-lg border">
            No queries found matching your filters
          </div>
        ) : (
          paginatedPrompts.map((prompt) => (
            <div
              key={prompt.id}
              id={`prompt-mobile-${prompt.id}`}
              className={`p-3 border rounded-lg bg-white cursor-pointer ${expandedPrompt === prompt.id ? 'ring-2 ring-blue-200' : ''}`}
              onClick={() => setExpandedPrompt(expandedPrompt === prompt.id ? null : prompt.id)}
            >
              <p className="text-sm font-medium text-gray-900 leading-relaxed mb-2">
                {prompt.prompt.text}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-xs">{prompt.model || 'api'}</Badge>
                {prompt.brandMentioned ? (
                  <Badge className="text-xs bg-green-100 text-green-700 border-green-200">
                    <CheckCircle className="w-3 h-3 mr-1" />Yes
                  </Badge>
                ) : (
                  <Badge className="text-xs bg-red-100 text-red-700 border-red-200">
                    <XCircle className="w-3 h-3 mr-1" />No
                  </Badge>
                )}
                <Badge variant="secondary" className="text-xs">
                  {getTopicName(prompt.prompt.topicId)}
                </Badge>
              </div>
              {selectedRun === 'all' && getRunLabel(prompt.analysisRunId) && (
                <div className="text-xs text-gray-500 mt-2">
                  {getRunLabel(prompt.analysisRunId)}
                </div>
              )}
              {expandedPrompt === prompt.id && (
                <div className="mt-3 pt-3 border-t space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">{prompt.model || 'API'} Response</h4>
                    <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 p-3 rounded border max-h-96 overflow-y-auto leading-relaxed">
                      {prompt.text}
                    </div>
                  </div>
                  {prompt.competitorsMentioned && prompt.competitorsMentioned.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Competitors Mentioned</h4>
                      <div className="flex flex-wrap gap-1">
                        {prompt.competitorsMentioned.map((c, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {prompt.sources && prompt.sources.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Sources Cited</h4>
                      <div className="flex flex-wrap gap-1">
                        {prompt.sources.map((s, i) => (
                          <a key={i} href={s} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800 underline break-all">{s}</a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block bg-white rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>USER QUERY</TableHead>
              <TableHead className="w-28">MODEL</TableHead>
              <TableHead className="w-48">IS BRAND MENTIONED?</TableHead>
              <TableHead className="w-32">TOPIC</TableHead>
              {selectedRun === 'all' && <TableHead className="w-36">RUN</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedPrompts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={selectedRun === 'all' ? 5 : 4} className="text-center py-8 text-gray-500">
                  No queries found matching your filters
                </TableCell>
              </TableRow>
            ) : (
              paginatedPrompts.map((prompt) => (
                <>
                  <TableRow
                    key={prompt.id}
                    id={`prompt-${prompt.id}`}
                    className={`hover:bg-gray-50 cursor-pointer ${expandedPrompt === prompt.id ? 'bg-blue-50' : ''}`}
                    onClick={() => setExpandedPrompt(expandedPrompt === prompt.id ? null : prompt.id)}
                  >
                    <TableCell className="font-medium">
                      <p className="text-sm text-gray-900 leading-relaxed">
                        {prompt.prompt.text}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{prompt.model || 'api'}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {prompt.brandMentioned ? (
                          <>
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <span className="text-green-600 font-medium">Yes</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-5 h-5 text-red-600" />
                            <span className="text-red-600 font-medium">No</span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {getTopicName(prompt.prompt.topicId)}
                      </Badge>
                    </TableCell>
                    {selectedRun === 'all' && (
                      <TableCell>
                        <span className="text-xs text-gray-500">
                          {getRunLabel(prompt.analysisRunId) || '—'}
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                  {expandedPrompt === prompt.id && (
                    <TableRow key={`${prompt.id}-detail`}>
                      <TableCell colSpan={selectedRun === 'all' ? 5 : 4} className="bg-gray-50 p-0">
                        <div className="p-4 space-y-3">
                          <div>
                            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">{prompt.model || 'API'} Response</h4>
                            <div className="text-sm text-gray-800 whitespace-pre-wrap bg-white p-4 rounded border max-h-96 overflow-y-auto leading-relaxed">
                              {prompt.text}
                            </div>
                          </div>
                          {prompt.competitorsMentioned && prompt.competitorsMentioned.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Competitors Mentioned</h4>
                              <div className="flex flex-wrap gap-1">
                                {prompt.competitorsMentioned.map((c, i) => (
                                  <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {prompt.sources && prompt.sources.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Sources Cited</h4>
                              <div className="flex flex-wrap gap-1">
                                {prompt.sources.map((s, i) => (
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-gray-600">
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filteredPrompts.length)} of {filteredPrompts.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
            >
              Previous
            </Button>
            <span className="flex items-center text-sm text-gray-600 px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
