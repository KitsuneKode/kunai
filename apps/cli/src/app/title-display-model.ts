import type { SearchResult, TitleInfo } from "@/domain/types";
import type { ResultEnrichment } from "@/services/catalog/ResultEnrichmentService";

export type TitleDisplayBadge = {
  readonly label: string;
  readonly tone: "success" | "info" | "warning" | "neutral";
};

export type TitleDisplayModel = {
  readonly id: string;
  readonly title: string;
  readonly type: TitleInfo["type"];
  readonly subtitle: string;
  readonly overview: string;
  readonly posterPath: string | null;
  readonly badges: readonly TitleDisplayBadge[];
};

export function buildTitleDisplayModel(
  result: SearchResult,
  enrichment?: ResultEnrichment | null,
): TitleDisplayModel {
  return {
    id: result.id,
    title: result.title,
    type: result.type,
    subtitle: [result.year, result.metadataSource].filter(Boolean).join("  ·  "),
    overview: result.overview,
    posterPath: result.posterPath,
    badges: enrichment?.badges ?? [],
  };
}
