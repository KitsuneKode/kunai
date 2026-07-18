import type { ConfigService, KitsuneConfig } from "@/services/persistence/ConfigService";

import { readInstallManifest } from "./install-manifest";
import { installLatest, type InstallLatestResult } from "./native-installer/install-latest";
import { resolveLatestVersion } from "./resolve-latest-version";
import { shouldRunUpdateCheck, updateCheckCachePatch } from "./update-check-cache";

export type BinaryAutoUpdateResult =
  | { readonly status: "disabled" }
  | { readonly status: "snoozed" }
  | { readonly status: "fresh" }
  | { readonly status: "up-to-date" }
  | { readonly status: "installed"; readonly version: string }
  | { readonly status: "pending-restart"; readonly version: string }
  | { readonly status: "skipped" }
  | { readonly status: "error"; readonly error: string };

type BinaryAutoUpdateDeps = {
  readonly config: Pick<ConfigService, "getRaw" | "update" | "save">;
  readonly currentVersion: string;
  readonly now?: () => number;
};

const BACKGROUND_INTERVAL_MS = 30 * 60 * 1000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastBackgroundRun = 0;

export class BinaryAutoUpdater {
  constructor(private readonly deps: BinaryAutoUpdateDeps) {}

  async runOnce(options: { force?: boolean } = {}): Promise<BinaryAutoUpdateResult> {
    const config = this.deps.config.getRaw() as KitsuneConfig;
    if (!config.updateChecksEnabled || !config.autoApplyBinaryUpdates) {
      return { status: "disabled" };
    }
    if (config.updateSnoozedUntil > this.now() && !options.force) {
      return { status: "snoozed" };
    }
    if (!options.force && !shouldRunUpdateCheck(config, this.now())) {
      return { status: "fresh" };
    }

    const manifest = await readInstallManifest();
    if (manifest?.channel !== "binary" && manifest?.layout !== "versioned") {
      return { status: "disabled" };
    }

    const pending = await getPendingRestartVersion(this.deps.currentVersion);
    if (pending) {
      return { status: "pending-restart", version: pending };
    }

    try {
      const latest = await resolveLatestVersion("binary");
      if (!latest) {
        throw new Error("Could not resolve latest version");
      }

      await this.deps.config.update(
        updateCheckCachePatch({ now: this.now(), latestVersion: latest, failed: false }),
      );
      await this.deps.config.save();

      if (compareVersions(latest, normalizeVersion(this.deps.currentVersion)) <= 0) {
        return { status: "up-to-date" };
      }

      const result: InstallLatestResult = await installLatest({ version: latest });
      if (result.status === "installed") {
        return { status: "installed", version: result.version };
      }
      if (result.status === "up-to-date") {
        return { status: "up-to-date" };
      }
      if (result.status === "skipped") {
        return { status: "skipped" };
      }
      return { status: "error", error: result.error };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.config.update(
        updateCheckCachePatch({ now: this.now(), latestVersion: null, failed: true }),
      );
      await this.deps.config.save();
      return { status: "error", error: message };
    }
  }

  startBackground(): void {
    void this.runOnce().catch(() => {});
    if (intervalHandle) return;
    intervalHandle = setInterval(() => {
      const now = Date.now();
      if (now - lastBackgroundRun < BACKGROUND_INTERVAL_MS) return;
      lastBackgroundRun = now;
      void this.runOnce().catch(() => {});
    }, BACKGROUND_INTERVAL_MS);
    intervalHandle.unref?.();
  }

  /** Stop future background update checks. Idempotent; used during shutdown. */
  stopBackground(): void {
    if (!intervalHandle) return;
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  async setAutoApply(enabled: boolean): Promise<void> {
    await this.deps.config.update({ autoApplyBinaryUpdates: enabled });
    await this.deps.config.save();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

/** True when manifest version is newer than the running process (restart needed). */
export async function getPendingRestartVersion(currentVersion: string): Promise<string | null> {
  const manifest = await readInstallManifest();
  if (!manifest?.version || manifest.channel !== "binary") return null;
  if (compareVersions(manifest.version, normalizeVersion(currentVersion)) > 0) {
    return manifest.version;
  }
  return null;
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}
