import type { InstallMethodKind } from "./install-method";
import { planUpgrade } from "./upgrade-planner";

/**
 * What the inbox's "update available" action should actually do.
 *
 * The notification used to hand every user to a web page, even on a native
 * install where `kunai upgrade` performs a transactional in-place update with
 * rollback. Route by install method instead: self-update where we own the
 * binary, and show the exact one-line command everywhere else, because a CLI
 * that self-mutates under a package manager fights the package manager — the
 * precise thing the install manifest exists to prevent.
 */
export type NotificationUpdateAction =
  | { readonly kind: "up-to-date" }
  /** We own the binary: run the versioned installer in place. */
  | { readonly kind: "self-update" }
  /** A package manager owns it: tell the user what to run. */
  | { readonly kind: "run-command"; readonly command: string; readonly message: string }
  /** Nothing safe to automate: point at the release page. */
  | { readonly kind: "open-release-page"; readonly message: string };

export type ResolveNotificationUpdateActionInput = {
  readonly channel: InstallMethodKind;
  readonly currentVersion: string;
  readonly latestVersion: string | null;
};

export function resolveNotificationUpdateAction(
  input: ResolveNotificationUpdateActionInput,
): NotificationUpdateAction {
  // An unknown target version means the notification predates a resolvable
  // release; the release page is the only honest destination.
  if (!input.latestVersion) {
    return {
      kind: "open-release-page",
      message: "Opening the release page — the new version could not be resolved.",
    };
  }

  const plan = planUpgrade({
    channel: input.channel,
    currentVersion: input.currentVersion,
    latestVersion: input.latestVersion,
    // Only the channel and versions decide the shape below; the remaining
    // planner inputs matter for `self-replace`, which we treat as `binary`.
    binPath: "",
    dlBase: "",
    os: "linux",
    arch: "x64",
    libc: "gnu",
  });

  switch (plan.kind) {
    case "up-to-date":
      return { kind: "up-to-date" };
    case "exec": {
      const command = plan.command.join(" ");
      return {
        kind: "run-command",
        command,
        message: `Update with: ${command}`,
      };
    }
    case "manual":
      return { kind: "open-release-page", message: plan.message };
    case "self-replace":
      return { kind: "self-update" };
  }
}
