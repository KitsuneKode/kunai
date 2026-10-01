/**
 * What a delete actually did. Callers announce `deleted` only for that status.
 * `remainingPaths` is for a later cleanup retry, not for analytics or the shell.
 */
export type DownloadDeleteResult =
  | { readonly status: "deleted"; readonly jobId: string }
  | {
      readonly status: "retained";
      readonly jobId: string;
      readonly reason: "artifact-removal-failed" | "owned-by-other-worker";
      readonly remainingPaths: readonly string[];
    };
