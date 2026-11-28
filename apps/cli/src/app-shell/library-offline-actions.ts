import type { ConfirmStripEffect } from "@/app-shell/primitives/ConfirmStrip.model";
import type { ConfirmStripController } from "@/app-shell/primitives/use-confirm-strip";
import type { Container } from "@/container";
import type { OfflineLibraryShelfGroup } from "@/domain/offline/OfflineLibraryEngine";
import {
  deleteDownloads,
  formatDownloadRemovalFeedback,
} from "@/services/download/download-removal";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";

export function executeLibraryDeletion(input: {
  readonly container: Container;
  readonly effect: ConfirmStripEffect;
  readonly groups: readonly { readonly group: OfflineLibraryShelfGroup }[];
  readonly confirm: ConfirmStripController;
  readonly setEntries: (
    update: (
      previous: readonly OfflineLibraryEntry[] | null,
    ) => readonly OfflineLibraryEntry[] | null,
  ) => void;
}): void {
  const group = input.groups.find((row) => row.group.key === input.effect.targetId)?.group;
  if (!group) {
    input.confirm.transition({ type: "fail", message: "Library row is no longer visible" });
    return;
  }
  const groupEntryIds = group.entries.map((entry) => entry.jobId);
  void deleteDownloads(input.container.downloadService, groupEntryIds, true).then((summary) => {
    const removed = new Set(summary.removedJobIds);
    input.setEntries((prev) => (prev ? prev.filter((entry) => !removed.has(entry.job.id)) : null));
    input.container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: formatDownloadRemovalFeedback(summary),
    });
    const retained = summary.retained[0];
    if (retained) input.confirm.transition({ type: "fail", message: retained.reason });
    else input.confirm.transition({ type: "succeed" });
    return undefined;
  });
}

export function toggleLibraryCleanupProtection(input: {
  readonly container: Container;
  readonly group: OfflineLibraryShelfGroup;
}): void {
  const groupEntryIds = input.group.entries.map((entry) => entry.jobId);
  const protectedSet = new Set(input.container.config.protectedDownloadJobIds);
  const allProtected = groupEntryIds.every((id) => protectedSet.has(id));
  void (async () => {
    const updated = new Set(input.container.config.protectedDownloadJobIds);
    for (const jobId of groupEntryIds) {
      if (allProtected) updated.delete(jobId);
      else updated.add(jobId);
    }
    await input.container.config.update({ protectedDownloadJobIds: [...updated] });
    await input.container.config.save();
  })();
  input.container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: allProtected
      ? `Removed cleanup protection: ${input.group.titleName}`
      : `Protected from cleanup: ${input.group.titleName}`,
  });
}

export function armLibraryDeletion(input: {
  readonly group: OfflineLibraryShelfGroup;
  readonly visibleIds: readonly string[];
  readonly confirm: ConfirmStripController;
}): void {
  input.confirm.transition({
    type: "arm",
    targetId: input.group.key,
    label: `${input.group.titleName} and all local files`,
    verb: "delete",
    executingLabel: `Deleting local files for ${input.group.titleName}`,
    visibleIds: input.visibleIds,
  });
}

export function refreshLibraryEntries(input: {
  readonly container: Container;
  readonly detailGroup: OfflineLibraryShelfGroup | null;
  readonly setEntries: (entries: readonly OfflineLibraryEntry[]) => void;
  readonly setLibraryView: (view: "titles" | "title-detail") => void;
  readonly setDetailGroup: (group: OfflineLibraryShelfGroup | null) => void;
  readonly countEntries: (
    group: OfflineLibraryShelfGroup,
    entries: readonly OfflineLibraryEntry[],
  ) => number;
}): void {
  void (async () => {
    const result = await input.container.offlineLibraryService.listCompletedEntries(200);
    input.setEntries(result);
    if (input.detailGroup && input.countEntries(input.detailGroup, result) === 0) {
      input.setLibraryView("titles");
      input.setDetailGroup(null);
    }
  })();
}
