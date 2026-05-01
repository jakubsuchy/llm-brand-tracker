// Renders a structured RecommendationNarrative as proper sections rather
// than a markdown blob. Used by the card, the detail page, and the
// per-occurrence timeline.

import type { RecommendationNarrative } from "@shared/schema";

// `narrative` arrives untyped from JSONB — the API doesn't enforce shape on
// the wire. Coerce defensively so a missing field renders as nothing rather
// than crashing the page.
function asNarrative(value: unknown): RecommendationNarrative | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as any;
  if (typeof v.analysis !== 'string' || typeof v.suggestedAction !== 'string') return null;
  return {
    analysis: v.analysis,
    suggestedAction: v.suggestedAction,
    metrics: Array.isArray(v.metrics) ? v.metrics : undefined,
    groups: Array.isArray(v.groups) ? v.groups : undefined,
    suggestedSteps: Array.isArray(v.suggestedSteps)
      ? v.suggestedSteps.filter((s: unknown): s is string => typeof s === 'string')
      : undefined,
  };
}

// `dense` (used by the list card): analysis prose + a compact one-line chip
// strip of headline metrics + suggested-action callout. Groups are hidden —
// users click "View details" for the breakdown.
//
// Default (used by the detail page): full metric grid + grouped sub-grids.
export function NarrativeView({ narrative, dense = false }: { narrative: unknown; dense?: boolean }) {
  const n = asNarrative(narrative);
  if (!n) {
    return <p className="text-sm text-slate-500 italic">No narrative recorded for this entry.</p>;
  }

  if (dense) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-700">{n.analysis}</p>
        {n.metrics && n.metrics.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {n.metrics.map((m, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded"
              >
                <span className="text-slate-500">{m.label}</span>
                <span className="font-medium text-slate-900 tabular-nums">{m.value}</span>
              </span>
            ))}
          </div>
        )}
        <SuggestedAction text={n.suggestedAction} steps={n.suggestedSteps} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-800">{n.analysis}</p>

      {n.metrics && n.metrics.length > 0 && (
        <MetricGrid items={n.metrics} />
      )}

      {n.groups && n.groups.length > 0 && (
        <div className="space-y-2">
          {n.groups.map((g, i) => (
            <div key={i}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                {g.label}
              </div>
              <MetricGrid items={g.items} />
            </div>
          ))}
        </div>
      )}

      <SuggestedAction text={n.suggestedAction} steps={n.suggestedSteps} />
    </div>
  );
}

function SuggestedAction({ text, steps }: { text: string; steps?: string[] }) {
  return (
    <div className="rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700 mb-0.5">
        Suggested action
      </div>
      <p className="text-sm text-indigo-900">{text}</p>
      {steps && steps.length > 0 && (
        <ol className="mt-2 space-y-1 list-decimal list-inside text-sm text-indigo-900 marker:text-indigo-500 marker:font-medium">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MetricGrid({ items }: { items: { label: string; value: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-sm">
      {items.map((m, i) => (
        <div key={i} className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded">
          <div className="text-[11px] text-slate-500 truncate" title={m.label}>{m.label}</div>
          <div className="font-medium text-slate-900 tabular-nums truncate" title={m.value}>{m.value}</div>
        </div>
      ))}
    </div>
  );
}
