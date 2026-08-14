import {
  canPersistEnabled,
  canSend,
  envBlockFlag,
  resolveConsentState,
  type ConsentEnv,
} from "@/domain/analytics/consent-policy";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { ensureInstallId } from "./install-id";

/** Official ping endpoint. Override with `KUNAI_ANALYTICS_URL`. */
export const DEFAULT_ANALYTICS_ENDPOINT = "https://kunai-analytics.vercel.app/api/ping";

export const ANALYTICS_PING_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Delay before retrying a failed send. A failed ping must not consume the
 * 24h cadence, or a single flaky network moment silently discards the day.
 * Retries happen on the next CLI launch — never on an in-process timer, which
 * would be killed with the short-lived process.
 */
export const ANALYTICS_RETRY_BACKOFF_MS = 15 * 60 * 1000;

/**
 * Shown instead of a real UUID to anyone who has not enabled analytics.
 * Rendering a preview must never be what creates an identifier.
 */
export const UNSET_INSTALL_ID_PLACEHOLDER = "<generated when you enable>";

/** Wire contract with users — exactly five keys. Never add one silently. */
export type AnalyticsPayload = {
  readonly installId: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
  readonly ts: number;
};

export type AnalyticsConsentChoice = "enabled" | "disabled";

/**
 * What the caller must do next. The service cannot show UI — it lives in
 * `services/` and the disclosure lives in `app-shell/` — so it returns an
 * instruction instead of reaching across the boundary.
 */
export type SessionStartOutcome =
  | { readonly kind: "needs-disclosure" }
  | { readonly kind: "quiet" }
  | { readonly kind: "pinged" };

export type AnalyticsFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type AnalyticsConfig = {
  getRaw(): KitsuneConfig;
  update(partial: Partial<KitsuneConfig>): Promise<void>;
  save(): Promise<void>;
};

export type UsageAnalyticsServiceDeps = {
  readonly config: AnalyticsConfig;
  readonly currentVersion: string;
  readonly endpoint: string;
  readonly fetchImpl?: AnalyticsFetch;
  readonly now?: () => number;
  readonly platform?: { readonly os: string; readonly arch: string };
  readonly pingTimeoutMs?: number;
  /** Injectable for tests; defaults to `process.env`. */
  readonly env?: ConsentEnv;
};

export class UsageAnalyticsService {
  private readonly fetchImpl: AnalyticsFetch;
  private readonly now: () => number;
  private readonly platform: { readonly os: string; readonly arch: string };
  private readonly pingTimeoutMs: number;
  private readonly env: ConsentEnv;

  constructor(private readonly deps: UsageAnalyticsServiceDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = deps.now ?? (() => Date.now());
    this.platform = deps.platform ?? { os: process.platform, arch: process.arch };
    this.pingTimeoutMs = deps.pingTimeoutMs ?? 2_500;
    this.env = deps.env ?? { DO_NOT_TRACK: process.env.DO_NOT_TRACK, CI: process.env.CI };
  }

  getStatus(): KitsuneConfig["analytics"] {
    return this.deps.config.getRaw().analytics;
  }

  /**
   * The config keys a consent choice implies. Pure, so the setup wizard can
   * fold it into its single batched write instead of becoming a second writer.
   */
  consentPatch(choice: AnalyticsConsentChoice): Partial<KitsuneConfig> {
    const blocked = envBlockFlag(this.env) !== null;
    if (choice === "disabled" || blocked) {
      // Clearing the id is the guarantee: it exists iff analytics is enabled.
      return { analytics: "disabled", installId: "" };
    }
    return { analytics: "enabled", installId: ensureInstallId(this.deps.config.getRaw()) };
  }

  async setConsent(
    choice: AnalyticsConsentChoice,
  ): Promise<{ readonly applied: AnalyticsConsentChoice }> {
    const patch = this.consentPatch(choice);
    await this.deps.config.update(patch);
    await this.deps.config.save();
    return { applied: patch.analytics as AnalyticsConsentChoice };
  }

  /**
   * Exact JSON that would be sent. A query: performs no writes, and does not
   * mint an install id for someone who has not enabled analytics.
   */
  describePayload(): AnalyticsPayload {
    const config = this.deps.config.getRaw();
    const enabled = config.analytics === "enabled" && config.installId.trim().length > 0;
    return {
      installId: enabled ? config.installId : UNSET_INSTALL_ID_PLACEHOLDER,
      version: this.deps.currentVersion,
      os: this.platform.os,
      arch: this.platform.arch,
      ts: this.now(),
    };
  }

  /**
   * The one entry point `main.ts` calls. All branching lives here.
   *
   * The first run never sends: disclosure is raised, the caller persists the
   * outcome, and the ping goes out on the next launch. Without that rule
   * "on by default, disclosed" would mean the data left before the notice.
   */
  async onSessionStart(options: { readonly isInteractive: boolean }): Promise<SessionStartOutcome> {
    const state = resolveConsentState({
      env: this.env,
      isInteractive: options.isInteractive,
      stored: this.deps.config.getRaw().analytics,
    });

    if (!canPersistEnabled(state)) {
      // A stale `enabled` config must not survive an env block.
      if (this.deps.config.getRaw().analytics === "enabled") {
        await this.deps.config.update({ analytics: "disabled", installId: "" });
        await this.deps.config.save();
      }
      return { kind: "quiet" };
    }

    if (state.kind === "awaiting-disclosure") return { kind: "needs-disclosure" };
    if (!canSend(state)) return { kind: "quiet" };

    await this.maybePing();
    return { kind: "pinged" };
  }

  /** Fire-and-forget; never blocks startup/playback. Failures are silent. */
  pingInBackground(): void {
    void this.maybePing().catch(() => {
      // Silent by design — analytics must never surface as a user-facing failure.
    });
  }

  async maybePing(): Promise<void> {
    const config = this.deps.config.getRaw();
    const state = resolveConsentState({
      env: this.env,
      isInteractive: true,
      stored: config.analytics,
    });
    if (!canSend(state)) return;

    const endpoint = this.deps.endpoint.trim();
    if (!endpoint) return;

    const now = this.now();
    if (
      config.lastAnalyticsPingAt > 0 &&
      now - config.lastAnalyticsPingAt < ANALYTICS_PING_INTERVAL_MS
    ) {
      return;
    }
    // A pending retry from an earlier failed send is still cooling down.
    if (config.analyticsRetryAfter > now) return;

    const installId = ensureInstallId(config);
    const payload: AnalyticsPayload = {
      installId,
      version: this.deps.currentVersion,
      os: this.platform.os,
      arch: this.platform.arch,
      ts: now,
    };

    const outcome = await this.send(endpoint, payload);

    // Success and permanent rejection both consume the 24h cadence; only a
    // transient failure schedules a near-term retry.
    await this.deps.config.update(
      outcome === "retry"
        ? { installId, analyticsRetryAfter: now + ANALYTICS_RETRY_BACKOFF_MS }
        : { installId, lastAnalyticsPingAt: now, analyticsRetryAfter: 0 },
    );
    await this.deps.config.save();
  }

  /**
   * `permanent` covers success and 4xx: both mean "do not try this again today".
   * `retry` covers network errors, timeouts, and 5xx.
   */
  private async send(endpoint: string, payload: AnalyticsPayload): Promise<"permanent" | "retry"> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.pingTimeoutMs);
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return response.status >= 500 ? "retry" : "permanent";
    } catch {
      // Network error, timeout, or abort — all transient.
      return "retry";
    } finally {
      clearTimeout(timer);
    }
  }
}

export function resolveAnalyticsEndpoint(
  env: NodeJS.ProcessEnv = process.env,
  configured = "",
): string {
  const fromEnv = typeof env.KUNAI_ANALYTICS_URL === "string" ? env.KUNAI_ANALYTICS_URL.trim() : "";
  if (fromEnv) return fromEnv;
  const fromConfig = configured.trim();
  if (fromConfig) return fromConfig;
  return DEFAULT_ANALYTICS_ENDPOINT;
}
