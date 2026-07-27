import type { ConfigService, KitsuneConfig } from "@/services/persistence/ConfigService";

import { isVersionedBinaryManifest, readInstallManifest } from "./install-manifest";
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

/**
 * Should this run stop before touching the network, and with what result?
 * Returns null to proceed.
 *
 * `force` marks an explicit user request ("update now" in the shell), which
 * deliberately ignores every opt-out: those govern *automatic* behaviour only.
 * Without that distinction, switching off auto-apply also silently disabled the
 * manual update action, which then reported "Update did not apply (disabled)".
 */
export function resolveAutoUpdateGate(input: {
  readonly config: Pick<
    KitsuneConfig,
    | "updateChecksEnabled"
    | "autoApplyBinaryUpdates"
    | "updateSnoozedUntil"
    | "updateCheckIntervalDays"
    | "lastUpdateCheckAt"
    | "lastUpdateCheckFailedAt"
  >;
  readonly now: number;
  readonly force: boolean;
}): BinaryAutoUpdateResult | null {
  if (input.force) return null;
  if (!input.config.updateChecksEnabled || !input.config.autoApplyBinaryUpdates) {
    return { status: "disabled" };
  }
  if (input.config.updateSnoozedUntil > input.now) return { status: "snoozed" };
  if (!shouldRunUpdateCheck(input.config as KitsuneConfig, input.now)) return { status: "fresh" };
  return null;
}

type BinaryAutoUpdateDeps = {
  readonly config: Pick<ConfigService, "getRaw" | "update" | "save">;
  readonly currentVersion: string;
  readonly now?: () => number;
  readonly readInstallManifest?: typeof readInstallManifest;
  readonly getPendingRestartVersion?: (currentVersion: string) => Promise<string | null>;
  readonly resolveLatestVersion?: typeof resolveLatestVersion;
  readonly installLatest?: typeof installLatest;
};

const BACKGROUND_INTERVAL_MS = 30 * 60 * 1000;

export class BinaryAutoUpdater {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastBackgroundRun = 0;

  constructor(private readonly deps: BinaryAutoUpdateDeps) {}

  async runOnce(options: { force?: boolean } = {}): Promise<BinaryAutoUpdateResult> {
    const config = this.deps.config.getRaw() as KitsuneConfig;
    const gate = resolveAutoUpdateGate({
      config,
      now: this.now(),
      force: options.force === true,
    });
    if (gate) return gate;

    const manifest = await (this.deps.readInstallManifest ?? readInstallManifest)();
    if (!manifest || !isVersionedBinaryManifest(manifest)) {
      return { status: "disabled" };
    }

    const pending = await (this.deps.getPendingRestartVersion ?? getPendingRestartVersion)(
      this.deps.currentVersion,
    );
    if (pending) {
      return { status: "pending-restart", version: pending };
    }

    try {
      const latest = await (this.deps.resolveLatestVersion ?? resolveLatestVersion)("binary");
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

      const result: InstallLatestResult = await (this.deps.installLatest ?? installLatest)({
        version: latest,
      });
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

  startBackground(options: { readonly runImmediately?: boolean } = {}): void {
    if (options.runImmediately !== false) void this.runOnce().catch(() => {});
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      const now = Date.now();
      if (now - this.lastBackgroundRun < BACKGROUND_INTERVAL_MS) return;
      this.lastBackgroundRun = now;
      void this.runOnce().catch(() => {});
    }, BACKGROUND_INTERVAL_MS);
    this.intervalHandle.unref?.();
  }

  /** Stop future background update checks. Idempotent; used during shutdown. */
  stopBackground(): void {
    if (!this.intervalHandle) return;
    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
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
  if (!manifest?.activeVersion || manifest.method !== "binary") return null;
  if (compareVersions(manifest.activeVersion, normalizeVersion(currentVersion)) > 0) {
    return manifest.activeVersion;
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
