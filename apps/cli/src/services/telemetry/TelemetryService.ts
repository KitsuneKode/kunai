import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { isTelemetryEnvBlocked, type TelemetryEnvFlags } from "./consent";
import { ensureInstallId } from "./install-id";

/** Official opt-in ping endpoint. Override with `KUNAI_TELEMETRY_URL`. */
export const DEFAULT_TELEMETRY_ENDPOINT = "https://kunai-telemetry.vercel.app/api/ping";

export const TELEMETRY_PING_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Wire contract with users — never add fields without updating docs + snapshot tests. */
export type TelemetryPayload = {
  readonly installId: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
  readonly ts: number;
};

export type TelemetryStatus = KitsuneConfig["telemetry"];

type TelemetryConfig = Pick<
  {
    getRaw(): KitsuneConfig;
    update(partial: Partial<KitsuneConfig>): Promise<void>;
    save(): Promise<void>;
  },
  "getRaw" | "update" | "save"
>;

export type TelemetryFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type TelemetryServiceDeps = {
  readonly config: TelemetryConfig;
  readonly currentVersion: string;
  readonly endpoint: string;
  readonly fetchImpl?: TelemetryFetch;
  readonly now?: () => number;
  readonly platform?: { readonly os: string; readonly arch: string };
  readonly pingTimeoutMs?: number;
  /** Injectable for tests; defaults to `process.env`. */
  readonly env?: TelemetryEnvFlags;
};

export class TelemetryService {
  private readonly fetchImpl: TelemetryFetch;
  private readonly now: () => number;
  private readonly platform: { readonly os: string; readonly arch: string };
  private readonly pingTimeoutMs: number;
  private readonly env: TelemetryEnvFlags;

  constructor(private readonly deps: TelemetryServiceDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = deps.now ?? (() => Date.now());
    this.platform = deps.platform ?? { os: process.platform, arch: process.arch };
    this.pingTimeoutMs = deps.pingTimeoutMs ?? 2_500;
    this.env = deps.env ?? {
      DO_NOT_TRACK: process.env.DO_NOT_TRACK,
      CI: process.env.CI,
    };
  }

  getStatus(): TelemetryStatus {
    return this.deps.config.getRaw().telemetry;
  }

  /**
   * Persist consent. Enabling is refused when DO_NOT_TRACK or CI is set — stores
   * `disabled` instead so config cannot override the hard env gate.
   */
  async setStatus(status: Exclude<TelemetryStatus, "unset">): Promise<{
    readonly applied: Exclude<TelemetryStatus, "unset">;
  }> {
    const installId = ensureInstallId(this.deps.config.getRaw());
    const applied = status === "enabled" && isTelemetryEnvBlocked(this.env) ? "disabled" : status;
    await this.deps.config.update({ telemetry: applied, installId });
    await this.deps.config.save();
    return { applied };
  }

  /**
   * Exact JSON that would be sent — never includes titles, queries, paths, or URLs.
   * Persists a fresh install id so repeated previews stay stable.
   */
  async previewPayload(): Promise<TelemetryPayload> {
    const config = this.deps.config.getRaw();
    const installId = ensureInstallId(config);
    if (installId !== config.installId) {
      await this.deps.config.update({ installId });
      await this.deps.config.save();
    }
    return {
      installId,
      version: this.deps.currentVersion,
      os: this.platform.os,
      arch: this.platform.arch,
      ts: this.now(),
    };
  }

  /** Fire-and-forget; never blocks startup/playback. Failures are silent. */
  pingInBackground(): void {
    void this.maybePing().catch(() => {
      // Silent by design — telemetry must never surface as a user-facing failure.
    });
  }

  async maybePing(): Promise<void> {
    const config = this.deps.config.getRaw();
    if (config.telemetry !== "enabled") {
      return;
    }
    // Hard gate: env flags win over a stale enabled config.
    if (isTelemetryEnvBlocked(this.env)) {
      return;
    }
    const endpoint = this.deps.endpoint.trim();
    if (!endpoint) {
      return;
    }
    const now = this.now();
    if (
      config.lastTelemetryPingAt > 0 &&
      now - config.lastTelemetryPingAt < TELEMETRY_PING_INTERVAL_MS
    ) {
      return;
    }

    const installId = ensureInstallId(config);
    if (installId !== config.installId) {
      await this.deps.config.update({ installId });
      await this.deps.config.save();
    }

    const payload: TelemetryPayload = {
      installId,
      version: this.deps.currentVersion,
      os: this.platform.os,
      arch: this.platform.arch,
      ts: now,
    };

    // Persist cadence before the network call so a hung request cannot spam.
    await this.deps.config.update({ lastTelemetryPingAt: now, installId });
    await this.deps.config.save();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.pingTimeoutMs);
    try {
      await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch {
      // Silent — network/timeout/abort must not affect the CLI.
    } finally {
      clearTimeout(timer);
    }
  }
}

export function resolveTelemetryEndpoint(
  env: NodeJS.ProcessEnv = process.env,
  configured = "",
): string {
  const fromEnv = typeof env.KUNAI_TELEMETRY_URL === "string" ? env.KUNAI_TELEMETRY_URL.trim() : "";
  if (fromEnv) return fromEnv;
  const fromConfig = configured.trim();
  if (fromConfig) return fromConfig;
  return DEFAULT_TELEMETRY_ENDPOINT;
}
