import { useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUp, ArrowDown, ArrowUpDown, BarChart3 } from "lucide-react";
import { getModelColor, getModelLabel } from "@shared/models";

export interface RankedPrompt {
  id: number;
  text: string;
  topicId: number | null;
  topicName: string;
  totalResponses: number;
  brandMentions: number;
  mentionRate: number;
  byModel: { model: string; total: number; mentioned: number; rate: number }[];
}

type SortKey = 'mentionRate' | 'totalResponses' | 'topic';
type SortDir = 'asc' | 'desc';

interface Props {
  prompts: RankedPrompt[];
  showTopic?: boolean;
  showModelBreakdown?: boolean;
  showPagination?: boolean;
  pageSize?: number;
  emptyState?: string;
}

const DEFAULT_PAGE_SIZE = 20;

function rateColor(rate: number): string {
  if (rate >= 70) return 'bg-green-100 text-green-700 border-green-200';
  if (rate >= 40) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

export default function PromptRankingTable({
  prompts,
  showTopic = true,
  showModelBreakdown = true,
  showPagination = true,
  pageSize = DEFAULT_PAGE_SIZE,
  emptyState = 'No prompts to display',
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('mentionRate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);

  const sorted = [...prompts].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'mentionRate') cmp = a.mentionRate - b.mentionRate;
    else if (sortKey === 'totalResponses') cmp = a.totalResponses - b.totalResponses;
    else if (sortKey === 'topic') cmp = a.topicName.localeCompare(b.topicName);
    if (cmp === 0) cmp = a.id - b.id;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = showPagination ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const visible = showPagination ? sorted.slice(page * pageSize, (page + 1) * pageSize) : sorted;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'mentionRate' ? 'desc' : 'asc');
    }
    setPage(0);
  };

  const SortIcon = ({ active }: { active: boolean }) => {
    if (!active) return <ArrowUpDown className="w-3 h-3 text-slate-400 inline ml-1" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 inline ml-1" />
      : <ArrowDown className="w-3 h-3 inline ml-1" />;
  };

  if (prompts.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-slate-500 bg-white rounded-lg border">
        {emptyState}
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[55%]">PROMPT</TableHead>
              {showTopic && (
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('topic')}>
                  TOPIC<SortIcon active={sortKey === 'topic'} />
                </TableHead>
              )}
              <TableHead className="cursor-pointer select-none w-32" onClick={() => toggleSort('totalResponses')}>
                RESPONSES<SortIcon active={sortKey === 'totalResponses'} />
              </TableHead>
              <TableHead className="cursor-pointer select-none w-40" onClick={() => toggleSort('mentionRate')}>
                MENTION RATE<SortIcon active={sortKey === 'mentionRate'} />
              </TableHead>
              {showModelBreakdown && <TableHead className="w-44">PER MODEL</TableHead>}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map(p => (
              <TableRow key={p.id} className="hover:bg-slate-50">
                <TableCell className="font-medium">
                  <Link href={`/prompts/${p.id}`} className="text-sm text-slate-900 hover:text-indigo-700">
                    {p.text}
                  </Link>
                </TableCell>
                {showTopic && (
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">{p.topicName}</Badge>
                  </TableCell>
                )}
                <TableCell className="text-sm text-slate-700">
                  {p.brandMentions}/{p.totalResponses}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-xs border ${rateColor(p.mentionRate)}`}>
                      {p.mentionRate.toFixed(0)}%
                    </Badge>
                    <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500"
                        style={{ width: `${Math.min(p.mentionRate, 100)}%` }}
                      />
                    </div>
                  </div>
                </TableCell>
                {showModelBreakdown && (
                  <TableCell>
                    <div className="flex gap-1">
                      {p.byModel.slice(0, 6).map(m => (
                        <div
                          key={m.model}
                          title={`${getModelLabel(m.model)}: ${m.rate.toFixed(0)}%`}
                          className="w-5 h-6 rounded-md overflow-hidden bg-slate-100 relative border border-slate-300"
                        >
                          <div
                            className="absolute bottom-0 w-full"
                            style={{
                              height: `${Math.max(m.rate, m.rate > 0 ? 6 : 0)}%`,
                              backgroundColor: getModelColor(m.model),
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </TableCell>
                )}
                <TableCell>
                  <Link href={`/prompts/${p.id}`}>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="View analytics">
                      <BarChart3 className="w-4 h-4" />
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {showPagination && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-slate-600">
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
              Previous
            </Button>
            <span className="flex items-center text-sm text-slate-600 px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
