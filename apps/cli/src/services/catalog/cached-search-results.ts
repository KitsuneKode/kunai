import type { SearchResult } from "@/domain/types";
import { isJsonObject, isJsonString, type JsonValue } from "@kunai/types";

/** An entry with the fields every rail renders; optional fields were written by this app. */
function isCachedSearchResult(entry: JsonValue): entry is JsonValue & SearchResult {
  return (
    isJsonObject(entry) &&
    isJsonString(entry.id) &&
    entry.id.length > 0 &&
    isJsonString(entry.title) &&
    entry.title.length > 0 &&
    (entry.type === "movie" || entry.type === "series")
  );
}

/**
 * Items read back from a cache row, keeping only entries that can render.
 *
 * Rows are long-lived (they are the outage fallback) and can be damaged or
 * written by an older build. A `null` or half-shaped item reaching a rail
 * throws during render, which is the worst possible moment: the upstream is
 * already down. Invalid entries are dropped; an all-invalid list reads as
 * "no last good answer".
 */
export function parseCachedSearchResults(value: JsonValue | undefined): SearchResult[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter(isCachedSearchResult);
  return items.length > 0 ? items : null;
}
