import type { NotificationSignal } from "./NotificationEngine";

type UpdateCheckLike = {
  readonly status: string;
  readonly currentVersion: string;
  readonly latestVersion: string | null;
};

/** Pure: map an UpdateService check result to an app-update signal, or null. */
export function updateSignalFromCheck(result: UpdateCheckLike): NotificationSignal | null {
  if (result.status !== "update-available" || !result.latestVersion) return null;
  return {
    type: "app-update",
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
  };
}
