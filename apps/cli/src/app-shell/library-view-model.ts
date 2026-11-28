import type { LibraryShelfRow } from "@/app-shell/library-shelf-model";
import { plainModeEnabled } from "@/app-shell/plain-mode";
import type { PreviewFact, PreviewRailModel } from "@/app-shell/primitives/PreviewRail.model";
import { truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { formatMediaItemCount, presentMedia } from "@/domain/media/media-presentation";
import type { OfflineLibraryShelfGroup } from "@/domain/offline/OfflineLibraryEngine";
import { historyContentType, isFinished } from "@/services/continuation/history-progress";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import type { HistoryProgress } from "@/services/storage/storage-read-models";

export function isLibraryGroupProtected(
  group: OfflineLibraryShelfGroup,
  protectedIds: ReadonlySet<string>,
): boolean {
  return group.entries.some((entry) => protectedIds.has(entry.jobId));
}

function offlineGroupJobIdSet(group: OfflineLibraryShelfGroup): ReadonlySet<string> {
  return new Set(group.entries.map((entry) => entry.jobId));
}

export function selectOfflineGroupEntries(
  group: OfflineLibraryShelfGroup,
  entries: readonly OfflineLibraryEntry[],
): readonly OfflineLibraryEntry[] {
  const jobIds = offlineGroupJobIdSet(group);
  return entries.filter((entry) => jobIds.has(entry.job.id));
}

export function formatLibraryTitle(
  group: OfflineLibraryShelfGroup,
  protectedTitle: boolean,
): string {
  const plain = plainModeEnabled();
  const shield = protectedTitle ? (plain ? " [protected]" : " ⚲") : "";
  const downloaded =
    group.readyCount > 0 && group.entries.length > 0
      ? plain
        ? ` ${group.readyCount}/${group.entries.length} ready`
        : ` ↓ ${group.readyCount}/${group.entries.length}`
      : "";
  return `${group.titleName}${downloaded}${shield}`;
}

/**
 * The compact position column for a shelf row.
 *
 * Season facts come from the canonical position each entry already carries.
 * They used to be recovered by running a regex over the entry's display label,
 * which quietly reported a season for any movie stored with a legacy synthetic
 * season 1 slot.
 */
export function formatLibrarySeasonCode(group: OfflineLibraryShelfGroup): string {
  const seasons = new Set(
    group.entries.flatMap((entry) =>
      entry.presentation.position.kind === "episode" &&
      entry.presentation.position.seasonIsMeaningful &&
      entry.presentation.position.season !== undefined
        ? [entry.presentation.position.season]
        : [],
    ),
  );
  if (seasons.size === 1) {
    const season = [...seasons][0];
    return season === undefined ? "—" : `S${String(season).padStart(2, "0")}`;
  }
  const only = group.entries.length === 1 ? group.entries[0]?.presentation : undefined;
  if (only) return only.positionLabel ?? only.kindLabel;
  return "—";
}

export function formatLibraryStatus(
  row: LibraryShelfRow,
  historyMap: Record<string, HistoryProgress>,
) {
  const { group } = row;
  const plain = plainModeEnabled();
  const hist = historyMap[group.titleId];
  if (hist && !isFinished(hist) && (hist.durationSeconds ?? 0) > 0) {
    const pct = Math.round((hist.positionSeconds / (hist.durationSeconds ?? 0)) * 100);
    if (pct > 0 && pct < 95) {
      return { label: plain ? `${pct}%` : `▸ ${pct}%`, color: palette.accent, dim: false };
    }
  }
  if (group.readyCount > 0) {
    const count = formatMediaItemCount({
      mediaKind: group.mediaKind,
      contentType: group.contentType,
      count: group.readyCount,
    });
    return {
      label: plain ? count : `↓ ${count}`,
      color: palette.ok,
      dim: false,
    };
  }
  if (group.issueCount > 0) {
    const issues = group.issueCount === 1 ? "1 issue" : `${group.issueCount} issues`;
    return {
      label: plain ? issues : `${group.issueCount}⚠`,
      color: palette.accentDeep,
      dim: false,
    };
  }
  return { label: "needs attention", color: palette.dim, dim: true };
}

export function buildLibraryPreviewRailModel(
  group: OfflineLibraryShelfGroup,
  historyMap: Record<string, HistoryProgress>,
  entries: readonly OfflineLibraryEntry[],
  protectedIds: ReadonlySet<string>,
): PreviewRailModel {
  const hist = historyMap[group.titleId];
  const protectedTitle = isLibraryGroupProtected(group, protectedIds);
  const sizeBytes = selectOfflineGroupEntries(group, entries).reduce(
    (sum, entry) => sum + (entry.job.fileSize ?? 0),
    0,
  );
  const sizeLabel =
    sizeBytes >= 1_073_741_824
      ? `${(sizeBytes / 1_073_741_824).toFixed(1)} GB`
      : sizeBytes > 0
        ? `${(sizeBytes / 1_048_576).toFixed(1)} MB`
        : "—";

  const facts: PreviewFact[] = [
    {
      label: "offline",
      value: `${group.readyCount} of ${formatMediaItemCount({
        mediaKind: group.mediaKind,
        contentType: group.contentType,
        count: group.entries.length,
      })}`,
      tone: group.readyCount > 0 ? "success" : "warning",
    },
    {
      label: "size",
      value: sizeLabel,
      tone: "muted",
    },
  ];

  if (hist && !isFinished(hist) && (hist.durationSeconds ?? 0) > 0) {
    const pct = Math.round((hist.positionSeconds / (hist.durationSeconds ?? 0)) * 100);
    const histPresentation = presentMedia({
      title: group.titleName,
      mediaKind: historyContentType(hist),
      season: hist.season,
      episode: hist.episode ?? hist.absoluteEpisode,
    });
    const ep = histPresentation.positionLabel ?? histPresentation.kindLabel;
    facts.push({
      label: "progress",
      value: `${ep} · ${pct}%`.trim(),
      tone: "warning",
    });
  }

  facts.push({
    label: "protected",
    value: protectedTitle ? "yes" : "no",
    tone: protectedTitle ? "success" : "muted",
  });

  return {
    title: group.titleName,
    subtitle: truncateLine(group.artifactSummary, 40),
    overview: group.detail,
    posterState: group.previewImageUrl ? "ready" : "none",
    posterUrl: group.previewImageUrl,
    facts,
  };
}
