import type { ConfirmStripEffect } from "@/app-shell/primitives/ConfirmStrip.model";
import type { ConfirmStripController } from "@/app-shell/primitives/use-confirm-strip";
import type { Container } from "@/container";
import {
  deleteDownloads,
  formatDownloadRemovalFeedback,
} from "@/services/download/download-removal";
import type { DownloadJobRecord } from "@/services/storage/storage-read-models";

export function executeDownloadConfirmation(input: {
  readonly container: Container;
  readonly effect: ConfirmStripEffect;
  readonly jobs: readonly DownloadJobRecord[];
  readonly confirm: ConfirmStripController;
  readonly refresh: () => void;
}): void {
  const job = input.jobs.find((candidate) => candidate.id === input.effect.targetId);
  if (!job) {
    input.confirm.transition({ type: "fail", message: "Download row is no longer visible" });
    return;
  }
  if (input.effect.verb === "abort") {
    void input.container.downloadService
      .abort(job.id)
      .then(() => {
        input.confirm.transition({ type: "succeed" });
        input.refresh();
        return undefined;
      })
      .catch((error) => {
        input.confirm.transition({
          type: "fail",
          message: error instanceof Error ? error.message : "Unable to abort download",
        });
      });
    return;
  }
  const deleteArtifact = input.effect.verb === "delete files";
  void deleteDownloads(input.container.downloadService, [job.id], deleteArtifact)
    .then((summary) => {
      input.refresh();
      input.container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: formatDownloadRemovalFeedback(summary),
      });
      const retained = summary.retained[0];
      if (retained) input.confirm.transition({ type: "fail", message: retained.reason });
      else input.confirm.transition({ type: "succeed" });
      return undefined;
    })
    .catch((error) => {
      input.confirm.transition({
        type: "fail",
        message: error instanceof Error ? error.message : "Unable to remove download",
      });
    });
}

export function armDownloadConfirmation(input: {
  readonly job: DownloadJobRecord;
  readonly forceRecordOnly: boolean;
  readonly visibleIds: readonly string[];
  readonly confirm: ConfirmStripController;
}): void {
  const deleteArtifact =
    !input.forceRecordOnly &&
    (input.job.status === "repairable" ||
      input.job.status === "completed" ||
      input.job.status === "completed-with-notes");
  const verb =
    input.job.status === "running" ? "abort" : deleteArtifact ? "delete files" : "remove record";
  input.confirm.transition({
    type: "arm",
    targetId: input.job.id,
    label: input.job.titleName,
    verb,
    executingLabel:
      verb === "abort"
        ? `Aborting ${input.job.titleName}`
        : verb === "delete files"
          ? `Deleting local files for ${input.job.titleName}`
          : `Removing ${input.job.titleName} from Downloads`,
    visibleIds: input.visibleIds,
  });
}
