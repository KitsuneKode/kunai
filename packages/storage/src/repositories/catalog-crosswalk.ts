import type { CatalogIdGraph } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";
import { getExpiresAt, isExpired } from "../ttl";

/**
 * Durable cache for the AniList/MAL ↔ TMDB/IMDB crosswalk (ARM-backed).
 * Lives in the cache DB: disposable, long-TTL (`catalog-static`). Definitive
 * misses are cached as empty graphs so unknown titles do not re-query ARM.
 */
export type CatalogCrosswalkSourceNs = "anilist" | "mal" | "tmdb" | "imdb";

interface CatalogCrosswalkRow {
  readonly graph_json: string;
  readonly expires_at: string;
}

export class CatalogCrosswalkRepository {
  constructor(private readonly db: KunaiDatabase) {}

  get(sourceNs: CatalogCrosswalkSourceNs, sourceId: string): CatalogIdGraph | undefined {
    const row = this.db
      .query<CatalogCrosswalkRow, [string, string]>(
        "SELECT graph_json, expires_at FROM catalog_id_crosswalk WHERE source_ns = ? AND source_id = ?",
      )
      .get(sourceNs, sourceId);
    if (!row || isExpired(row.expires_at)) return undefined;
    try {
      return JSON.parse(row.graph_json) as CatalogIdGraph;
    } catch {
      return undefined;
    }
  }

  put(
    sourceNs: CatalogCrosswalkSourceNs,
    sourceId: string,
    graph: CatalogIdGraph,
    now = new Date(),
  ): void {
    this.db
      .query(
        `
          INSERT INTO catalog_id_crosswalk (source_ns, source_id, graph_json, confidence, fetched_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_ns, source_id) DO UPDATE SET
            graph_json = excluded.graph_json,
            confidence = excluded.confidence,
            fetched_at = excluded.fetched_at,
            expires_at = excluded.expires_at
        `,
      )
      .run(
        sourceNs,
        sourceId,
        JSON.stringify(graph),
        graph.confidence,
        now.toISOString(),
        getExpiresAt("catalog-static", now),
      );
  }

  deleteExpired(now = new Date()): number {
    return this.db
      .query("DELETE FROM catalog_id_crosswalk WHERE expires_at <= ?")
      .run(now.toISOString()).changes;
  }
}
