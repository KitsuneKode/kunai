import { expect, test } from "bun:test";

import {
  deleteDownloads,
  formatDownloadRemovalFeedback,
  type DownloadDeleteResult,
} from "@/services/download/download-removal";

test("partial removal keeps every failed item visible and reports its reason", async () => {
  const summary = await deleteDownloads(
    {
      async deleteJob(id): Promise<DownloadDeleteResult> {
        if (id === "blocked") return { status: "retained", jobId: id, reason: "File is in use." };
        if (id === "storage") throw new Error("Database write failed.");
        return { status: id === "missing" ? "missing" : "deleted", jobId: id };
      },
    },
    ["removed", "blocked", "storage", "missing"],
    true,
  );
  expect(summary.removedJobIds).toEqual(["removed", "missing"]);
  expect(summary.retained.map((result) => result.jobId)).toEqual(["blocked", "storage"]);
  expect(summary.retained[1]?.reason).toBe("Database write failed.");
  expect(formatDownloadRemovalFeedback(summary)).toBe("Removed 2; kept 2. File is in use.");
});
