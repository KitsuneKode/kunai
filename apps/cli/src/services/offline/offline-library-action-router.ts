import { chooseFromListShell, type ListShellActionContext } from "@/app-shell/pickers";
import { queueMoreOfflineTitleEpisodes } from "@/app-shell/workflows";
import type { Container } from "@/container";
import {
  parseOfflineTitleCleanupPreference,
  type OfflineTitleCleanupPreference,
} from "@/services/download/download-cleanup-policy";
import {
  resolveOfflineArtifactStatus,
  type OfflineLibraryEntry,
} from "@/services/offline/offline-library";

export type OfflineLibraryGroupActionType =
  | "search-online"
  | "download-more"
  | "check-integrity"
  | "repair-missing"
  | "toggle-continuation"
  | "edit-cleanup"
  | "protect-group"
  | "unprotect-group"
  | "delete-group";

export type OfflineLibraryGroupAction = {
  readonly type: OfflineLibraryGroupActionType;
};

export type OfflineLibraryActionResult = "continue" | "exit" | "refresh";

async function setOfflineGroupProtection(
  container: Container,
  jobIds: readonly string[],
  protect: boolean,
): Promise<void> {
  const updated = new Set(container.config.protectedDownloadJobIds);
  for (const jobId of jobIds) {
    if (protect) updated.add(jobId);
    else updated.delete(jobId);
  }
  await container.config.update({ protectedDownloadJobIds: [...updated] });
  await container.config.save();
}

/**
 * Routes offline library group actions from Library detail and workflow pickers.
 * UI surfaces should call this instead of invoking downloadService directly.
 */
export async function routeOfflineLibraryGroupAction(
  container: Container,
  entries: readonly OfflineLibraryEntry[],
  action: OfflineLibraryGroupAction,
  actionContext?: ListShellActionContext,
): Promise<OfflineLibraryActionResult> {
  const first = entries[0]?.job;
  if (!first) return "exit";

  const offlinePolicy = container.offlineTitlePolicies.get(first.titleId);

  if (action.type === "search-online") {
    container.stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: first.titleName });
    container.stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "idle" });
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Search prepared for ${first.titleName}. Submit it to continue online.`,
    });
    return "exit";
  }

  if (action.type === "check-integrity") {
    const statuses = await Promise.all(
      entries.map(async (entry) => ({
        job: entry.job,
        status: await resolveOfflineArtifactStatus(entry.job),
      })),
    );
    const issueCount = statuses.filter((entry) => entry.status !== "ready").length;
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note:
        issueCount === 0
          ? `Integrity check passed for ${entries.length} local item(s).`
          : `Integrity check found ${issueCount} item(s) needing repair.`,
    });
    return "continue";
  }

  if (action.type === "repair-missing") {
    const repairEntries = entries.filter((entry) => entry.status !== "ready");
    for (const entry of repairEntries) {
      container.downloadService.retry(entry.job.id);
    }
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Re-download queued for ${repairEntries.length} missing ${
        repairEntries.length === 1 ? "item" : "items"
      }`,
    });
    void container.downloadService.processQueue();
    return "refresh";
  }

  if (action.type === "download-more") {
    await queueMoreOfflineTitleEpisodes(container, first, actionContext);
    return "continue";
  }

  if (action.type === "toggle-continuation") {
    const enrolling = offlinePolicy?.enrolled !== true;
    container.offlineTitlePolicies.upsert({
      titleId: first.titleId,
      mediaKind: first.mediaKind,
      titleName: first.titleName,
      enrolled: enrolling,
      runwayTarget: container.config.offlineDefaultRunwayTarget,
      profileJson: JSON.stringify({
        audio: first.animeLang ?? "original",
        subtitle: first.subLang ?? "none",
        quality: first.selectedQualityLabel ?? "best",
      }),
      cleanupJson:
        offlinePolicy?.cleanupJson ?? JSON.stringify({ mode: "keep-last-watched", count: 1 }),
      updatedAt: new Date().toISOString(),
    });
    if (enrolling) {
      container.offlineRunwayService.enqueueEvaluation(first.titleId, "policy-change");
    }
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: enrolling
        ? `Keeping ${first.titleName} ready offline within your runway limit.`
        : `Stopped offline continuation for ${first.titleName}. Existing files stay local.`,
    });
    return "continue";
  }

  if (action.type === "edit-cleanup") {
    const policy = await chooseFromListShell<OfflineTitleCleanupPreference>({
      title: `After watching ${first.titleName}`,
      subtitle:
        "Controls cleanup suggestions only; local files stay until you explicitly delete them",
      actionContext,
      options: [
        {
          value: { mode: "keep-last-watched", count: 1 },
          label: "Keep latest watched episode",
          detail: "Keep one watched local fallback and suggest older watched files",
        },
        {
          value: { mode: "cleanup-watched", graceDays: container.config.autoCleanupGraceDays },
          label: `Suggest cleanup after ${container.config.autoCleanupGraceDays} days`,
          detail: "Uses your cleanup grace window when cleanup suggestions are enabled",
        },
      ],
    });
    if (!policy) return "continue";
    container.offlineTitlePolicies.upsert({
      titleId: first.titleId,
      mediaKind: first.mediaKind,
      titleName: first.titleName,
      enrolled: offlinePolicy?.enrolled === true,
      runwayTarget: offlinePolicy?.runwayTarget ?? container.config.offlineDefaultRunwayTarget,
      profileJson:
        offlinePolicy?.profileJson ??
        JSON.stringify({
          audio: first.animeLang ?? "original",
          subtitle: first.subLang ?? "none",
          quality: first.selectedQualityLabel ?? "best",
        }),
      cleanupJson: JSON.stringify(policy),
      updatedAt: new Date().toISOString(),
    });
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note:
        policy.mode === "keep-last-watched"
          ? `Keeping one watched local episode for ${first.titleName}.`
          : `Cleanup suggestions for ${first.titleName} use a ${policy.graceDays}-day grace.`,
    });
    return "continue";
  }

  if (action.type === "protect-group" || action.type === "unprotect-group") {
    await setOfflineGroupProtection(
      container,
      entries.map((entry) => entry.job.id),
      action.type === "protect-group",
    );
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note:
        action.type === "protect-group"
          ? `Protected ${first.titleName} from watched-download cleanup.`
          : `Removed cleanup protection for ${first.titleName}.`,
    });
    return "continue";
  }

  if (action.type === "delete-group") {
    const confirmed = await chooseFromListShell<boolean>({
      title: `Delete ${first.titleName}?`,
      subtitle: `Remove ${entries.length} local ${
        entries.length === 1 ? "item" : "items"
      }, subtitles, and queue records for this title.`,
      actionContext,
      options: [
        { value: false, label: "Keep title", detail: "Go back without deleting anything" },
        {
          value: true,
          label: "Delete local title",
          detail: "Remove all local files and download records in this group",
        },
      ],
    });
    if (!confirmed) return "continue";
    await Promise.all(
      entries.map((entry) =>
        container.downloadService.deleteJob(entry.job.id, { deleteArtifact: true }),
      ),
    );
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Deleted offline title: ${first.titleName}`,
    });
    return "exit";
  }

  return "continue";
}

export function parseOfflineCleanupFromPolicy(
  cleanupJson: string | undefined,
): ReturnType<typeof parseOfflineTitleCleanupPreference> {
  return parseOfflineTitleCleanupPreference(cleanupJson);
}
