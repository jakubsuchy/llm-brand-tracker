import type { QueryClient } from "@tanstack/react-query";
import type { RecommendationWithHint } from "@shared/schema";

// After a state change:
//   - Counts and detail invalidate (they're always wrong now).
//   - List queries that ALREADY hold the row get patched in place so it stays
//     visible (with the new pill) until the next reload — no UI yank.
//   - List queries that DON'T hold the row are dropped from cache. When the
//     user navigates to that tab, react-query has no cached data → it fetches
//     fresh, so the row appears in its new home immediately rather than the
//     user seeing a stale cached list missing the row.
//
// `updated` is the server's response — already decorated with the recomputed
// hint and `firingInLatest`, so spreading it gives the card the right shape.
export function applyStateUpdate(
  queryClient: QueryClient,
  id: number,
  updated: RecommendationWithHint,
) {
  queryClient.invalidateQueries({ queryKey: ['/api/recommendations/counts'] });
  queryClient.invalidateQueries({ queryKey: [`/api/recommendations/${id}`] });

  const isListQuery = (key: unknown) =>
    typeof key === 'string' && key.startsWith('/api/recommendations?');

  const lists = queryClient.getQueryCache().findAll({
    predicate: q => isListQuery(q.queryKey[0]),
  });

  for (const q of lists) {
    const data = queryClient.getQueryData<RecommendationWithHint[]>(q.queryKey);
    if (!data) continue;
    if (data.some(r => r.id === id)) {
      // Patch in place — keeps the row visible in the user's current tab.
      queryClient.setQueryData<RecommendationWithHint[]>(
        q.queryKey,
        data.map(r => r.id === id ? { ...r, ...updated } : r),
      );
    } else {
      // Row doesn't appear in this list, but its new state may belong here
      // (e.g. user just reopened a resolved → Open tab now needs it). Drop
      // the cache so the next visit fetches fresh.
      queryClient.removeQueries({ queryKey: q.queryKey, exact: true });
    }
  }
}
