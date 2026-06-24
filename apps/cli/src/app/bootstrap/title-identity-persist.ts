import { resolveTitleHistoryLookupId } from "@/app/bootstrap/title-info";
import type { ShellMode, TitleInfo } from "@/domain/types";
import { mergeProviderNativeId } from "@kunai/core";
import type { HistoryRepository } from "@kunai/storage";

/** Merge a discovered provider-native id into history metadata without retitling rows. */
export function persistProviderNativeMapping(
  historyRepository: Pick<HistoryRepository, "backfillTitleMetadata">,
  title: Pick<TitleInfo, "id" | "type" | "name" | "externalIds" | "isAnime">,
  providerId: string,
  nativeId: string,
  mode?: ShellMode,
): void {
  const trimmed = nativeId.replace(/^allanime:/, "").trim();
  if (!trimmed) return;

  const canonicalId = resolveTitleHistoryLookupId(title, mode);
  const externalIds = mergeProviderNativeId(title.externalIds, providerId, trimmed);
  if (!externalIds) return;

  historyRepository.backfillTitleMetadata(canonicalId, { externalIds });
}
