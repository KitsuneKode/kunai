/** A removal receipt reflects the committed job record, never optimistic UI state. */
export type DownloadDeleteResult =
  | { readonly status: "deleted" | "missing"; readonly jobId: string }
  | { readonly status: "retained"; readonly jobId: string; readonly reason: string };

export type DownloadRemovalSummary = {
  readonly removedJobIds: readonly string[];
  readonly retained: readonly Extract<DownloadDeleteResult, { status: "retained" }>[];
};

/** Every selected item gets a receipt, including an unexpected persistence failure. */
export async function deleteDownloads(
  service: {
    deleteJob(id: string, options: { deleteArtifact: boolean }): Promise<DownloadDeleteResult>;
  },
  jobIds: readonly string[],
  deleteArtifact: boolean,
): Promise<DownloadRemovalSummary> {
  const results = await Promise.all(
    jobIds.map(async (jobId) => {
      try {
        return await service.deleteJob(jobId, { deleteArtifact });
      } catch (cause) {
        return {
          status: "retained",
          jobId,
          reason: cause instanceof Error ? cause.message : "Removal failed. Refresh and try again.",
        } as const;
      }
    }),
  );
  const removedJobIds: string[] = [];
  const retained: Array<Extract<DownloadDeleteResult, { status: "retained" }>> = [];
  for (const result of results) {
    if (result.status === "retained") retained.push(result);
    else removedJobIds.push(result.jobId);
  }
  return { removedJobIds, retained };
}

export function formatDownloadRemovalFeedback(summary: DownloadRemovalSummary): string {
  const removed = summary.removedJobIds.length;
  const kept = summary.retained.length;
  const first = summary.retained[0];
  if (!first) return `Removed ${removed} download ${removed === 1 ? "record" : "records"}.`;
  const prefix = removed > 0 ? `Removed ${removed}; kept ${kept}. ` : "Download kept. ";
  return prefix + first.reason;
}
