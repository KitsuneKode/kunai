import type { TitleInfo } from "@/domain/types";
import { looksLikeOpaqueProviderNativeId } from "@kunai/core";
import { externalIdsToAliases, type HistoryTitleAliasInput } from "@kunai/storage";
import type { DownloadJobRecord } from "@kunai/storage";
import type { ProviderExternalIds } from "@kunai/types";

/**
 * The alias rows a download registers so its title stays findable under every
 * id it arrived with. History has indexed its own titles this way since the
 * catalog-identity-parity work; downloads participate through the same rows.
 */
export function downloadTitleAliases(
  title: Pick<TitleInfo, "id" | "externalIds">,
  providerId: string,
): readonly HistoryTitleAliasInput[] {
  const aliases = [...externalIdsToAliases(title.externalIds)];
  if (looksLikeOpaqueProviderNativeId(title.id, title.externalIds)) {
    const nativeId = title.id.replace(/^allanime:/, "").trim();
    if (nativeId) aliases.push({ ns: `provider:${providerId}`, id: nativeId });
  }
  return aliases;
}

/** External ids persisted on a job, with only the ids a legacy prefixed title
 * genuinely encodes recovered for rows written before the column existed. */
export function downloadJobExternalIds(
  job: Pick<DownloadJobRecord, "titleId" | "externalIds">,
): ProviderExternalIds | undefined {
  if (job.externalIds) return job.externalIds;
  const titleId = job.titleId.trim();
  if (titleId.startsWith("tmdb:")) return { tmdbId: titleId.slice("tmdb:".length) };
  if (titleId.startsWith("anilist:")) return { anilistId: titleId.slice("anilist:".length) };
  if (titleId.startsWith("youtube:")) return { youtubeId: titleId.slice("youtube:".length) };
  return undefined;
}
