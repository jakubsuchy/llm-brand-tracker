import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Building2, ChevronDown, ChevronUp, Merge, X, ShieldX } from "lucide-react";
import type { CompetitorAnalysis, MergeSuggestion, MergeHistoryEntry } from "@shared/schema";

interface AnalysisRun {
  id: number;
  startedAt: string;
  status: string;
  brandName: string | null;
  responseCount: number;
}

export default function CompetitorsPage() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const urlRunId = params.get('runId');
  const urlCompetitor = params.get('competitor');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [expandedCompetitor, setExpandedCompetitor] = useState<string | null>(urlCompetitor);
  const [expandedResponses, setExpandedResponses] = useState<Set<number>>(new Set());
  const [selectedRun, setSelectedRun] = useState<string>(urlRunId || 'all');
  const [didAutoScroll, setDidAutoScroll] = useState(false);

  // Merge mode state
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<number>>(new Set());
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [primaryId, setPrimaryId] = useState<number | null>(null);
  const [merging, setMerging] = useState(false);

  const toggleResponse = useCallback((id: number) => {
    setExpandedResponses(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const { data: analysisRuns } = useQuery<AnalysisRun[]>({
    queryKey: ['/api/analysis/runs'],
  });

  const runParam = selectedRun !== 'all' ? `?runId=${selectedRun}` : '';
  const runAmpParam = selectedRun !== 'all' ? `&runId=${selectedRun}` : '';
  const { data: competitors, isLoading } = useQuery<CompetitorAnalysis[]>({
    queryKey: [`/api/competitors/analysis${runParam}`],
  });

  const { data: responses } = useQuery<any[]>({
    queryKey: [`/api/responses?limit=1000&full=true${runAmpParam}`],
  });

  const { data: mergeSuggestions } = useQuery<MergeSuggestion[]>({
    queryKey: ['/api/competitors/merge-suggestions'],
    enabled: mergeMode,
  });

  const { data: mergeHistory } = useQuery<MergeHistoryEntry[]>({
    queryKey: ['/api/competitors/merge-history'],
  });

  // Auto-scroll to linked competitor
  useEffect(() => {
    if (didAutoScroll || !urlCompetitor || !competitors) return;
    setDidAutoScroll(true);
    setTimeout(() => {
      document.getElementById(`competitor-${urlCompetitor}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }, [competitors, urlCompetitor, didAutoScroll]);

  const totalResponses = responses?.length || 0;

  // Build merged-names map from merge history
  const mergedNamesMap = new Map<number, { id: number; name: string }[]>();
  if (mergeHistory) {
    for (const entry of mergeHistory) {
      const existing = mergedNamesMap.get(entry.primaryCompetitorId) || [];
      existing.push({ id: entry.mergedCompetitorId, name: entry.mergedName });
      mergedNamesMap.set(entry.primaryCompetitorId, existing);
    }
  }

  const competitorsWithPromptPercentage = competitors?.map(competitor => {
    // Include merged names when matching responses
    const allNames = new Set([competitor.name.toLowerCase()]);
    const merged = mergedNamesMap.get(competitor.competitorId);
    if (merged) merged.forEach(m => allNames.add(m.name.toLowerCase()));

    const matchingResponses = responses?.filter(response =>
      response.competitorsMentioned?.some((c: string) => allNames.has(c.toLowerCase()))
    ) || [];

    return {
      ...competitor,
      promptPercentage: competitor.mentionRate,
      promptsAppeared: competitor.mentionCount,
      totalPrompts: totalResponses,
      matchingResponses,
      mergedNames: mergedNamesMap.get(competitor.competitorId) || [],
    };
  }) || [];

  const toggleMergeSelection = (id: number) => {
    setSelectedForMerge(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openMergeDialog = () => {
    if (selectedForMerge.size < 2) return;
    // Default primary = highest mention count
    const sorted = [...selectedForMerge]
      .map(id => competitorsWithPromptPercentage.find(c => c.competitorId === id))
      .filter(Boolean)
      .sort((a, b) => b!.mentionCount - a!.mentionCount);
    setPrimaryId(sorted[0]?.competitorId ?? null);
    setMergeDialogOpen(true);
  };

  const handleMerge = async () => {
    if (!primaryId) return;
    setMerging(true);
    try {
      const absorbedIds = [...selectedForMerge].filter(id => id !== primaryId);
      const res = await fetch('/api/competitors/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryId, absorbedIds }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Merge failed');
      }
      toast({ title: "Competitors merged", description: `${absorbedIds.length} competitor(s) merged successfully.` });
      setMergeDialogOpen(false);
      setMergeMode(false);
      setSelectedForMerge(new Set());
      invalidateAll();
    } catch (error) {
      toast({ title: "Merge failed", description: (error as Error).message, variant: "destructive" });
    } finally {
      setMerging(false);
    }
  };

  const handleUnmerge = async (competitorId: number) => {
    try {
      const res = await fetch('/api/competitors/unmerge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitorId }),
      });
      if (!res.ok) throw new Error('Unmerge failed');
      toast({ title: "Competitor unmerged", description: "Competitor has been separated." });
      invalidateAll();
    } catch (error) {
      toast({ title: "Unmerge failed", description: (error as Error).message, variant: "destructive" });
    }
  };

  const handleNotACompetitor = async (competitorId: number, name: string) => {
    if (!confirm(`Remove "${name}" from competitors? It will be reclassified as a neutral source and excluded from future analysis.`)) return;
    try {
      const res = await fetch('/api/competitors/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitorId }),
      });
      if (!res.ok) throw new Error('Failed to reclassify');
      toast({ title: "Reclassified", description: `"${name}" removed from competitors.` });
      invalidateAll();
    } catch (error) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    }
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/competitors/merge-history'] });
    queryClient.invalidateQueries({ queryKey: ['/api/competitors/merge-suggestions'] });
    // Invalidate all competitor analysis queries
    queryClient.invalidateQueries({ predicate: (q) => {
      const key = q.queryKey[0] as string;
      return typeof key === 'string' && (key.startsWith('/api/competitors') || key.startsWith('/api/metrics') || key.startsWith('/api/sources'));
    }});
  };

  const applySuggestion = (suggestion: MergeSuggestion) => {
    setSelectedForMerge(new Set(suggestion.competitors.map(c => c.id)));
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Competitor Analysis</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse space-y-3">
                  <div className="h-5 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  <div className="h-2 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const getCategoryColor = (category: string | null) => {
    switch (category?.toLowerCase()) {
      case 'cloud platform': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'hosting service': return 'bg-green-100 text-green-800 border-green-200';
      case 'deployment platform': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'containerization': return 'bg-orange-100 text-orange-800 border-orange-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const sortedCompetitors = competitorsWithPromptPercentage.sort((a, b) => b.promptPercentage - a.promptPercentage);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Competitor Analysis</h1>
          <p className="text-sm text-gray-600 mt-1">
            Percentage of prompts where each competitor is mentioned across LLM providers
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {mergeMode ? (
            <>
              <Button variant="outline" onClick={() => { setMergeMode(false); setSelectedForMerge(new Set()); }}>
                Cancel
              </Button>
              <Button
                disabled={selectedForMerge.size < 2}
                onClick={openMergeDialog}
              >
                Merge Selected ({selectedForMerge.size})
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setMergeMode(true)} disabled={sortedCompetitors.length < 2}>
              <Merge className="h-4 w-4 mr-2" />
              Merge Duplicates
            </Button>
          )}
          <Select value={selectedRun} onValueChange={setSelectedRun}>
            <SelectTrigger className="w-56">
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
      </div>

      {mergeMode && mergeSuggestions && mergeSuggestions.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="text-sm font-medium text-amber-800 mb-2">
              {mergeSuggestions.length} potential duplicate group{mergeSuggestions.length !== 1 ? 's' : ''} found
            </div>
            <div className="flex flex-wrap gap-2">
              {mergeSuggestions.map((suggestion, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  className="border-amber-300 text-amber-800 hover:bg-amber-100"
                  onClick={() => applySuggestion(suggestion)}
                >
                  {suggestion.competitors.map(c => c.name).join(' + ')}
                  <span className="ml-1 text-xs text-amber-600">({Math.round(suggestion.similarity * 100)}%)</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedCompetitors.length === 0 ? (
          <div className="col-span-full">
            <Card>
              <CardContent className="p-12 text-center">
                <Building2 className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-500">No competitor data available yet.</p>
              </CardContent>
            </Card>
          </div>
        ) : (
          sortedCompetitors.map((competitor) => (
            <Card
              key={competitor.competitorId}
              id={`competitor-${competitor.name}`}
              className={`hover:shadow-md transition-shadow ${
                expandedCompetitor === competitor.name && urlCompetitor ? 'ring-2 ring-blue-300' : ''
              } ${mergeMode && selectedForMerge.has(competitor.competitorId) ? 'ring-2 ring-purple-400 bg-purple-50/30' : ''}`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2">
                    {mergeMode && (
                      <Checkbox
                        checked={selectedForMerge.has(competitor.competitorId)}
                        onCheckedChange={() => toggleMergeSelection(competitor.competitorId)}
                        className="mt-1"
                      />
                    )}
                    <div>
                      <CardTitle className="text-lg">{competitor.name}</CardTitle>
                      {competitor.category && (
                        <Badge
                          variant="outline"
                          className={`mt-2 text-xs ${getCategoryColor(competitor.category)}`}
                        >
                          {competitor.category}
                        </Badge>
                      )}
                      {competitor.mergedNames.length > 0 && !mergeMode && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          <span className="text-xs text-gray-500">Also includes:</span>
                          {competitor.mergedNames.map(m => (
                            <Badge key={m.id} variant="secondary" className="text-xs gap-1 pl-2 pr-1">
                              {m.name}
                              <button
                                onClick={(e) => { e.stopPropagation(); handleUnmerge(m.id); }}
                                className="hover:bg-gray-300 rounded-full p-0.5"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-blue-600">
                      {competitor.promptPercentage.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500">of prompts</div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Prompt appearances</span>
                      <span className="font-medium">{competitor.promptsAppeared}/{competitor.totalPrompts} prompts</span>
                    </div>
                    <Progress
                      value={competitor.promptPercentage}
                      className="h-2"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2 border-t text-xs text-gray-500">
                    <div>
                      <div className="font-medium">Visibility</div>
                      <div>
                        {competitor.promptPercentage > 50 ? 'High' :
                         competitor.promptPercentage > 25 ? 'Medium' :
                         competitor.promptPercentage > 10 ? 'Low' : 'Rare'}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">Coverage</div>
                      <div>
                        {competitor.promptPercentage > 75 ? 'Dominant' :
                         competitor.promptPercentage > 50 ? 'Strong' :
                         competitor.promptPercentage > 25 ? 'Moderate' : 'Limited'}
                      </div>
                    </div>
                  </div>

                  {!mergeMode && competitor.matchingResponses.length > 0 && (
                    <button
                      onClick={() => setExpandedCompetitor(
                        expandedCompetitor === competitor.name ? null : competitor.name
                      )}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 pt-2 border-t w-full"
                    >
                      {expandedCompetitor === competitor.name ? (
                        <><ChevronUp className="h-3 w-3" /> Hide prompts</>
                      ) : (
                        <><ChevronDown className="h-3 w-3" /> Show {competitor.matchingResponses.length} prompt{competitor.matchingResponses.length !== 1 ? 's' : ''}</>
                      )}
                    </button>
                  )}

                  {!mergeMode && expandedCompetitor === competitor.name && (
                    <div className="space-y-2 pt-1">
                      {competitor.matchingResponses.map((response: any) => {
                        const isExpanded = expandedResponses.has(response.id);
                        return (
                          <div key={response.id} className="text-xs p-2 bg-gray-50 rounded border">
                            <div className="font-medium text-gray-700 mb-1">
                              {response.prompt?.text || `Prompt #${response.promptId}`}
                            </div>
                            <div className="text-gray-500 whitespace-pre-wrap">
                              {isExpanded ? response.text : `${response.text?.substring(0, 200)}...`}
                            </div>
                            <button
                              onClick={() => toggleResponse(response.id)}
                              className="text-blue-600 hover:text-blue-800 mt-1"
                            >
                              {isExpanded ? 'Show less' : 'Show full response'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!mergeMode && (
                    <button
                      onClick={() => handleNotACompetitor(competitor.competitorId, competitor.name)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 pt-2 border-t w-full"
                      title="Mark as not a competitor — reclassify as neutral"
                    >
                      <ShieldX className="h-3 w-3" />
                      Mark as not a competitor
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {sortedCompetitors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Key Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="font-semibold text-blue-600">
                  {sortedCompetitors[0]?.name || 'N/A'}
                </div>
                <div className="text-blue-800">Top Competitor</div>
                <div className="text-xs text-blue-600 mt-1">
                  {sortedCompetitors[0]?.mentionRate.toFixed(1)}% mention rate
                </div>
              </div>

              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="font-semibold text-green-600">
                  {sortedCompetitors.length}
                </div>
                <div className="text-green-800">Total Competitors</div>
                <div className="text-xs text-green-600 mt-1">
                  discovered across all prompts
                </div>
              </div>

              <div className="text-center p-4 bg-purple-50 rounded-lg">
                <div className="font-semibold text-purple-600">
                  {sortedCompetitors.filter(c => c.promptPercentage > 25).length}
                </div>
                <div className="text-purple-800">High Visibility</div>
                <div className="text-xs text-purple-600 mt-1">
                  competitors mentioned in &gt;25% of prompts
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Merge Dialog */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Competitors</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Select the primary competitor. Others will be merged into it and their mentions will be combined.
            </p>
            <RadioGroup value={primaryId?.toString() || ''} onValueChange={(v) => setPrimaryId(Number(v))}>
              {[...selectedForMerge].map(id => {
                const comp = competitorsWithPromptPercentage.find(c => c.competitorId === id);
                if (!comp) return null;
                return (
                  <div key={id} className="flex items-center space-x-3 p-2 rounded border hover:bg-gray-50">
                    <RadioGroupItem value={id.toString()} id={`merge-${id}`} />
                    <Label htmlFor={`merge-${id}`} className="flex-1 cursor-pointer">
                      <span className="font-medium">{comp.name}</span>
                      <span className="text-sm text-gray-500 ml-2">{comp.mentionCount} mentions</span>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleMerge} disabled={!primaryId || merging}>
              {merging ? 'Merging...' : 'Confirm Merge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
