import { isMpvHwdecMode, type MpvHwdecMode } from "@kunai/config";
import { getKunaiPaths } from "@kunai/storage";

/** Small pre-container config read used only for startup routing and dependency interpretation. */
export type StartupConfigPeek = {
  readonly onboardingVersion?: number;
  readonly downloadOnboardingDismissed?: boolean;
  readonly defaultMode?: string;
  readonly player?: string;
  readonly mpvHwdec?: unknown;
};

export async function readStartupConfigPeek(): Promise<StartupConfigPeek> {
  try {
    return (await Bun.file(getKunaiPaths().configPath).json()) as StartupConfigPeek;
  } catch {
    return {};
  }
}

/** A malformed persisted value falls back to the same no-override default ConfigService applies. */
export function resolveStartupMpvHwdecMode(
  cliMode: MpvHwdecMode | undefined,
  configured: unknown,
): MpvHwdecMode {
  return cliMode ?? (isMpvHwdecMode(configured) ? configured : "mpv-default");
}
