import type { ConfigService, KitsuneConfig } from "@/services/persistence/ConfigService";

import type { InstallMethod } from "./install-method";
import { updateGuidanceForInstallMethod } from "./install-method";
import { shouldRunUpdateCheck, updateCheckCachePatch } from "./update-check-cache";

export type UpdateCheckStatus =
  | "disabled"
  | "snoozed"
  | "fresh"
  | "up-to-date"
  | "update-available"
  | "error";

export type UpdateCheckResult = {
  readonly status: UpdateCheckStatus;
  readonly currentVersion: string;
  readonly latestVersion: string | null;
  readonly guidance?: string;
  readonly error?: string;
};

type UpdateConfig = Pick<ConfigService, "getRaw" | "update" | "save">;

type UpdateDiagnostics = {
  record(event: { category: string; message: string; context?: Record<string, unknown> }): void;
};

export class UpdateService {
  constructor(
    private readonly deps: {
      readonly config: UpdateConfig;
      readonly diagnostics: UpdateDiagnostics;
      readonly currentVersion: string;
      readonly installMethod: InstallMethod;
      readonly fetchLatestVersion: () => Promise<string>;
      readonly now?: () => number;
    },
  ) {}

  async checkForUpdate(options: { force?: boolean } = {}): Promise<UpdateCheckResult> {
    const now = this.now();
    const config = this.deps.config.getRaw() as KitsuneConfig;
    if (!config.updateChecksEnabled && !options.force) {
      return this.result("disabled", null);
    }
    if (config.updateSnoozedUntil > now && !options.force) {
      return this.result("snoozed", config.lastKnownLatestVersion || null);
    }
    if (!options.force && !shouldRunUpdateCheck(config, now)) {
      return this.result("fresh", config.lastKnownLatestVersion || null);
    }

    try {
      const latestVersion = normalizeVersion(await this.deps.fetchLatestVersion());
      await this.deps.config.update(updateCheckCachePatch({ now, latestVersion, failed: false }));
      await this.deps.config.save();

      if (compareVersions(latestVersion, normalizeVersion(this.deps.currentVersion)) > 0) {
        const guidance = updateGuidanceForInstallMethod(this.deps.installMethod);
        this.deps.diagnostics.record({
          category: "update",
          message: "Update available",
          context: {
            currentVersion: this.deps.currentVersion,
            latestVersion,
            installMethod: this.deps.installMethod.kind,
          },
        });
        return {
          status: "update-available",
          currentVersion: this.deps.currentVersion,
          latestVersion,
          guidance,
        };
      }

      this.deps.diagnostics.record({
        category: "update",
        message: "Kunai is up to date",
        context: { currentVersion: this.deps.currentVersion, latestVersion },
      });
      return this.result("up-to-date", latestVersion);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.config.update(
        updateCheckCachePatch({ now, latestVersion: null, failed: true }),
      );
      await this.deps.config.save();
      this.deps.diagnostics.record({
        category: "update",
        message: "Update check failed",
        context: { error: message },
      });
      return { ...this.result("error", null), error: message };
    }
  }

  checkInBackground(): void {
    void this.checkForUpdate().catch(() => {
      // checkForUpdate records failures; this guard keeps startup fire-and-forget.
    });
  }

  async snoozeForDays(days: number): Promise<void> {
    const safeDays = Math.max(1, Math.min(90, Math.floor(days)));
    await this.deps.config.update({
      updateSnoozedUntil: this.now() + safeDays * 24 * 60 * 60 * 1000,
    });
    await this.deps.config.save();
    this.deps.diagnostics.record({
      category: "update",
      message: "Update checks snoozed",
      context: { days: safeDays },
    });
  }

  async setChecksEnabled(enabled: boolean): Promise<void> {
    await this.deps.config.update({ updateChecksEnabled: enabled });
    await this.deps.config.save();
    this.deps.diagnostics.record({
      category: "update",
      message: enabled ? "Update checks enabled" : "Update checks disabled",
    });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private result(status: UpdateCheckStatus, latestVersion: string | null): UpdateCheckResult {
    return {
      status,
      currentVersion: this.deps.currentVersion,
      latestVersion,
      guidance:
        status === "update-available"
          ? updateGuidanceForInstallMethod(this.deps.installMethod)
          : undefined,
    };
  }
}

export async function fetchLatestKunaiVersion(): Promise<string> {
  const response = await fetch("https://registry.npmjs.org/@kitsunekode%2fkunai/latest");
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status}`);
  }
  const payload = (await response.json()) as { version?: unknown };
  if (typeof payload.version !== "string" || !payload.version.trim()) {
    throw new Error("npm registry response did not include a version");
  }
  return payload.version;
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
