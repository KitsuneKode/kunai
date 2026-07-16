import type { ShellMode, TitleInfo } from "@/domain/types";
import { resolveHistoryLookupTitleId } from "@kunai/core";

/** Map TitleInfo + shell mode to the canonical history lookup id. */
export function resolveTitleHistoryLookupId(
  title: Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">,
  mode?: ShellMode,
): string {
  if (mode === "youtube") {
    return resolveHistoryLookupTitleId({
      id: title.id,
      kind: "video",
      externalIds: title.externalIds,
    });
  }
  const kind =
    mode === "anime" || title.isAnime
      ? ("anime" as const)
      : title.type === "movie"
        ? ("movie" as const)
        : ("series" as const);
  return resolveHistoryLookupTitleId({
    id: title.id,
    kind,
    externalIds: title.externalIds,
  });
}
