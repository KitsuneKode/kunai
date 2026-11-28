import { dbg } from "@/logger";

/**
 * An episode count is a whole number of episodes.
 *
 * `Number(...)` and a bare `typeof === "number"` both let a fractional or
 * absurd upstream value through, and it rendered verbatim in the details rail —
 * "episodes 448.2" is never a thing a catalog can truthfully say. Anything that
 * is not a positive integer is dropped so the row is omitted, which reads as
 * "unknown" rather than as a wrong fact.
 */
export function readEpisodeCount(
  value: unknown,
  provenance?: { readonly site: "tmdb-season" | "anilist-media"; readonly titleId: string },
): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    // A present-but-invalid count is upstream corruption — log the provenance
    // (site + raw value + title) so the producer can be named. #273 rendered
    // "episodes 448.2"; this record is how the next one gets traced.
    if (value !== undefined && value !== null && value !== "") {
      dbg("title-detail", "episodeCount rejected: non-integer upstream value", {
        site: provenance?.site,
        titleId: provenance?.titleId,
        valueType: typeof value,
        value: String(value).slice(0, 64),
      });
    }
    return undefined;
  }
  return parsed;
}

export function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  // SAFETY: the check above is the object-and-not-array narrow this catalog payload needs.
  return value as Record<string, unknown>;
}

export function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
