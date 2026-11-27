import {
  formatBootstrapPlan,
  resolveBootstrapIntent,
  resolveLaunchMode,
  resolveLaunchSurfaceName,
  resolveStartupInitialRoute,
  type BootstrapArgs,
} from "@/app/bootstrap/bootstrap-intent";
import { isBelowOnboardedFloor } from "@/app/bootstrap/startup-setup";
import type { KunaiShareAction, PlaybackTargetRef } from "@/domain/share/playback-target-ref";
import { getKunaiPaths } from "@kunai/storage";

export type LaunchDryRunArgs = BootstrapArgs & {
  readonly offline: boolean;
  readonly history: boolean;
  readonly continuePlayback: boolean;
  readonly download: boolean;
  readonly setup: boolean;
  readonly initialRoute?: string;
};

export type LaunchDryRunShare = {
  readonly action: KunaiShareAction;
  readonly ref: PlaybackTargetRef;
};

/**
 * Build the `--dry-run` plan without creating or mutating launch state. The
 * config read is intentional: Discover startup is user configuration, so a plan
 * that ignored it would describe a different first surface than the real launch.
 */
export async function formatLaunchDryRunPlan(
  args: LaunchDryRunArgs,
  pendingShareLaunch: LaunchDryRunShare | null,
): Promise<readonly string[]> {
  const configJson = await (async (): Promise<{
    discoverShowOnStartup?: boolean;
    onboardingVersion?: number;
  }> => {
    try {
      // SAFETY: config.json is locally written JSON; both optional fields are validated by the boolean/number consumers below.
      return (await Bun.file(getKunaiPaths().configPath).json()) as {
        discoverShowOnStartup?: boolean;
        onboardingVersion?: number;
      };
    } catch {
      return {};
    }
  })();
  const intent = resolveBootstrapIntent(args);
  return formatBootstrapPlan({
    intent,
    mode: resolveLaunchMode(args) ?? "movie/series",
    route:
      resolveLaunchSurfaceName(args) ??
      resolveStartupInitialRoute({
        discoverShowOnStartup: configJson.discoverShowOnStartup === true,
        freshInstall: isBelowOnboardedFloor(configJson.onboardingVersion ?? 0),
        hasExplicitTarget: Boolean(intent.query || intent.directTitle || pendingShareLaunch),
      }),
    shareAction: pendingShareLaunch?.action,
    download: args.download,
    setup: args.setup,
  });
}
