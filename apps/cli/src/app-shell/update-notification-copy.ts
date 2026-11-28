import type { InstallMethodKind } from "@/services/update/install-method";
import { resolveNotificationUpdateAction } from "@/services/update/notification-update-action";

/** What to tell someone whose install cannot update itself. Reuses the
 * notification's own routing so the manual action and the inbox never disagree
 * about how this channel upgrades. */
export function describeUnmanagedUpdate(
  channel: InstallMethodKind,
  currentVersion: string,
  latestVersion: string | null,
): string {
  const action = resolveNotificationUpdateAction({ channel, currentVersion, latestVersion });
  if (action.kind === "run-command") return action.message;
  if (action.kind === "open-release-page") return action.message;
  return "This install is managed elsewhere — update through the tool that installed Kunai.";
}
