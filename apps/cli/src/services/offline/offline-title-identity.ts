import { resolveTitleHistoryLookupId } from "@/domain/catalog/title-history-lookup";
import type { ShellMode, TitleInfo } from "@/domain/types";
import { downloadJobShellMode } from "@/services/download/download-job-mode";
import type { DownloadJobRecord, HistoryTitleAliasRepository } from "@kunai/storage";

export type OfflineIdentityTitle = Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">;

/** The one answer to "which id are this title's offline assets filed under?". */
export interface OfflineTitleIdentity {
  resolveForTitle(title: OfflineIdentityTitle, mode?: ShellMode): string;
  resolveForJob(
    job: Pick<DownloadJobRecord, "titleId" | "mediaKind" | "mode" | "externalIds">,
  ): string;
}

/**
 * Resolves offline title identity through the shared alias index.
 *
 * Writes and reads used to canonicalise from different starting material — a
 * download knew only what the browse row carried, playback usually knew more —
 * so the same title was stored under `1339713` and looked up as
 * `tmdb:1339713`, and a healthy file reported "Downloaded file unavailable".
 * Both sides now call this, which prefers what the title can prove about
 * itself and otherwise takes what the alias index has learned from history and
 * from earlier downloads.
 */
export class OfflineTitleIdentityService implements OfflineTitleIdentity {
  constructor(
    private readonly aliases: Pick<HistoryTitleAliasRepository, "lookupTitleIdByAliasId">,
  ) {}

  resolveForTitle(title: OfflineIdentityTitle, mode?: ShellMode): string {
    const canonical = resolveTitleHistoryLookupId(title, mode);
    if (canonical !== title.id) return canonical;
    return this.aliases.lookupTitleIdByAliasId(title.id) ?? title.id;
  }

  resolveForJob(
    job: Pick<DownloadJobRecord, "titleId" | "mediaKind" | "mode" | "externalIds">,
  ): string {
    return this.resolveForTitle(
      {
        id: job.titleId,
        type: job.mediaKind === "movie" ? "movie" : "series",
        externalIds: job.externalIds,
        isAnime: job.mediaKind === "anime",
      },
      downloadJobShellMode(job),
    );
  }
}
