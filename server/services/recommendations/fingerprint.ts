import { createHash } from "crypto";

// Bump when the hash logic changes (e.g. canonicalization rules update).
// Old fingerprints orphan rather than colliding with new ones — fine,
// recommendations age out via lastSeenRunId.
export const FINGERPRINT_VERSION = 1;

// Stable, short hash for identifying a recommendation across runs.
// `entityKey` is the detector's canonical entity descriptor —
// e.g. "topic:bug-tracking", "competitor:jira", "model:gemini|topic:sprint".
// Examples in ANALYSIS_PLAN.md Part 2 § "Fingerprint logic".
export function fingerprint(detectorKey: string, entityKey: string): string {
  return createHash('sha1')
    .update(`${FINGERPRINT_VERSION}|${detectorKey}|${entityKey}`)
    .digest('hex')
    .slice(0, 16);
}

// Slugify an entity name into a stable, lowercase, hyphenated form.
// Renames upstream don't fork the fingerprint unless the rename is semantic.
export function slug(name: string | null | undefined): string {
  if (!name) return 'unknown';
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'unknown';
}
