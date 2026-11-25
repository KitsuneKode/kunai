import {
  analyticsDayKey,
  analyticsMonthKey,
  isAnalyticsMonth,
} from "@/domain/analytics/analytics-day";
import {
  canPersistEnabled,
  canSend,
  envBlockFlag,
  resolveConsentState,
  type ConsentEnv,
} from "@/domain/analytics/consent-policy";
import { isAndroidRuntime } from "@/domain/platform-runtime";
import { dbgErr } from "@/logger";
import type {
  AnalyticsPingCompletion,
  KitsuneConfig,
  PersistedAnalyticsConsent,
} from "@/services/persistence/ConfigService";

import { ensureInstallId, isValidInstallId, monthlyWireId, rotateInstallId } from "./install-id";
import type { PingLog } from "./ping-log";

/**
 * Where an opted-in install sends its daily ping.
 *
 * **This is not consent.** A fresh install is `unset` and sends nothing; only an
 * explicit enable in Settings permits a request or creates an identifier, and
 * `DO_NOT_TRACK`, `CI`, and a non-TTY session still suppress every send. Having
 * a default only removes the step where a consenting user would otherwise have
 * had to find and paste a URL — which nobody does, so consent produced no data.
 *
 * Deliberately a domain Kunai controls rather than the host's own URL. This
 * string is baked into every published npm package and compiled binary, and
 * those are immutable — so the endpoint has to outlive whatever is serving it
 * today. DNS can move; a `*.vercel.app` in a shipped binary cannot.
 *
 * `KUNAI_ANALYTICS_URL` or `analyticsEndpoint` still override it, so a
 * self-hoster can point their installs at their own ingest.
 */
export const DEFAULT_ANALYTICS_ENDPOINT = "https://analytics.kunai.kitsunekode.in/api/ping";

export const ANALYTICS_PING_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Delay before retrying a failed send. A failed ping must not consume the
 * 24h cadence, or a single flaky network moment silently discards the day.
 * Retries happen on the next CLI launch — never on an in-process timer, which
 * would be killed with the short-lived process.
 */
export const ANALYTICS_RETRY_BACKOFF_MS = 15 * 60 * 1000;

/**
 * Shown instead of a real id to anyone who has not enabled analytics.
 * Rendering a preview must never be what creates an identifier.
 */
export const UNSET_INSTALL_ID_PLACEHOLDER = "<generated when you enable>";

/** Shown instead of a cohort to anyone who has not enabled analytics. */
export const UNSET_COHORT_PLACEHOLDER = "<the month you enable>";

/**
 * Wire contract with users (payload v2): exactly these six keys, sorted. Never
 * add one silently: `.docs/analytics-privacy-contract.md` and the user-facing
 * MDX both document this list, and `analytics-payload-drift.test.ts` reads this
 * constant so a seventh field cannot pass while the docs still say six.
 */
export const ANALYTICS_PAYLOAD_KEYS = ["arch", "cohort", "day", "id", "os", "version"] as const;

/** The same keys in the order the body carries them, for copy that names them. */
export const ANALYTICS_PAYLOAD_FIELDS = ["id", "cohort", "day", "version", "os", "arch"] as const;

export type AnalyticsPayload = {
  /** `monthlyWireId(installId, month of day)`: rotates every calendar month. */
  readonly id: string;
  /** `YYYY-MM` analytics was enabled in. */
  readonly cohort: string;
  /** The client's analytics day label, `YYYY-MM-DD` (`analytics-day.ts`). */
  readonly day: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
};

/** The analytics consent fields of a config, as the payload builder reads them. */
export type AnalyticsIdentity = {
  readonly analytics: KitsuneConfig["analytics"];
  readonly installId: string;
  readonly analyticsCohort: string;
};

export type AnalyticsPlatform = { readonly os: string; readonly arch: string };

/**
 * `android` on an Android runtime, otherwise `process.platform`. Termux reports
 * `linux`, so an Android install used to be counted as Linux.
 */
export function analyticsOs(
  platform: string = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return isAndroidRuntime(platform, env) ? "android" : platform;
}

/**
 * The cohort a ping from this identity carries. An install that opted in
 * before cohorts existed has none stored; it is counted from the month of its
 * first v2 ping, which is the documented upgrade seam.
 */
function cohortFor(identity: AnalyticsIdentity, now: number): string {
  return isAnalyticsMonth(identity.analyticsCohort)
    ? identity.analyticsCohort
    : analyticsMonthKey(now);
}

/**
 * Exact payload the next ping would carry. Pure, shared by the send path,
 * `/analytics`, the consent screen and `kunai analytics preview`, so none of
 * them can describe a body the others would not send.
 *
 * Without consent and a valid id it shows placeholders: a preview must never
 * be what creates an identifier.
 */
export function describeAnalyticsPayload(input: {
  readonly identity: AnalyticsIdentity;
  readonly version: string;
  readonly platform: AnalyticsPlatform;
  readonly now: number;
}): AnalyticsPayload {
  const { identity, now } = input;
  const day = analyticsDayKey(now);
  const enabled = identity.analytics === "enabled" && isValidInstallId(identity.installId);
  return {
    id: enabled ? monthlyWireId(identity.installId, day.slice(0, 7)) : UNSET_INSTALL_ID_PLACEHOLDER,
    cohort: enabled ? cohortFor(identity, now) : UNSET_COHORT_PLACEHOLDER,
    day,
    version: input.version,
    os: input.platform.os,
    arch: input.platform.arch,
  };
}

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
  recordAnalyticsPing(completion: AnalyticsPingCompletion): Promise<boolean>;
  readPersistedAnalyticsConsent(): Promise<PersistedAnalyticsConsent>;
};

export type UsageAnalyticsServiceDeps = {
  readonly config: AnalyticsConfig;
  readonly currentVersion: string;
  readonly endpoint: string;
  /** Where sent pings are recorded for `kunai analytics log`. */
  readonly pingLog: PingLog;
  readonly fetchImpl?: AnalyticsFetch;
  readonly now?: () => number;
  readonly platform?: AnalyticsPlatform;
  readonly pingTimeoutMs?: number;
  /** Injectable for tests; defaults to `process.env`. */
  readonly env?: ConsentEnv;
};

export class UsageAnalyticsService {
  private readonly fetchImpl: AnalyticsFetch;
  private readonly now: () => number;
  private readonly platform: AnalyticsPlatform;
  private readonly pingTimeoutMs: number;
  private readonly env: ConsentEnv;

  constructor(private readonly deps: UsageAnalyticsServiceDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = deps.now ?? (() => Date.now());
    this.platform = deps.platform ?? { os: analyticsOs(), arch: process.arch };
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
      // The cohort goes with it, so a later enable counts as a new install.
      return { analytics: "disabled", installId: "", analyticsCohort: "" };
    }
    const config = this.deps.config.getRaw();
    const installId = ensureInstallId(config);
    // Affirming an enable that already holds keeps its cohort; anything that
    // mints an identity starts a new one in the month the key was pressed.
    const keepsCohort =
      config.analytics === "enabled" &&
      config.installId.trim() === installId &&
      isAnalyticsMonth(config.analyticsCohort);
    return {
      analytics: "enabled",
      installId,
      analyticsCohort: keepsCohort ? config.analyticsCohort : analyticsMonthKey(this.now()),
    };
  }

  async setConsent(
    choice: AnalyticsConsentChoice,
  ): Promise<{ readonly applied: AnalyticsConsentChoice }> {
    const patch = this.consentPatch(choice);
    await this.deps.config.update(patch);
    await this.deps.config.save();
    await this.settleLocalPingLog();
    return { applied: patch.analytics as AnalyticsConsentChoice };
  }

  /**
   * A fresh identity, from the explicit rotate action. The new id starts its
   * own cohort and cadence, and the log of pings sent under the old one goes:
   * a rotation that kept the old ids beside the new one would not be one.
   */
  async rotateIdentity(): Promise<{ readonly installId: string }> {
    const installId = rotateInstallId();
    await this.deps.config.update({
      installId,
      analyticsCohort: analyticsMonthKey(this.now()),
      // Carrying the old timestamps forward would suppress the first ping
      // under the new id for up to a day.
      lastAnalyticsPingAt: 0,
      analyticsRetryAfter: 0,
    });
    await this.deps.config.save();
    await this.deps.pingLog.remove().catch(() => undefined);
    return { installId };
  }

  /**
   * Removes the local ping log unless analytics is enabled. Derived from
   * state rather than told which way a choice went, so every caller that
   * writes consent can run it after its save, and startup can run it to catch
   * a disable written by a sibling process or by hand.
   */
  async settleLocalPingLog(): Promise<void> {
    if (this.deps.config.getRaw().analytics === "enabled") return;
    await this.deps.pingLog.remove().catch(() => undefined);
  }

  /** Records the non-interactive upgrader recommendation without granting consent. */
  async markNoticeShown(): Promise<void> {
    await this.deps.config.update({ analyticsNoticeShown: true });
    await this.deps.config.save();
  }

  /**
   * Exact JSON that would be sent. A query: performs no writes, and does not
   * mint an install id for someone who has not enabled analytics.
   *
   * `id` is this month's HMAC, matching the body byte for byte. Showing the
   * stored UUID here would make this screen -- the one surface whose whole job
   * is telling the user what leaves their machine -- the only place claiming
   * the raw id is transmitted.
   */
  describePayload(): AnalyticsPayload {
    return describeAnalyticsPayload({
      identity: this.deps.config.getRaw(),
      version: this.deps.currentVersion,
      platform: this.platform,
      now: this.now(),
    });
  }

  /**
   * The one entry point `main.ts` calls. All branching lives here.
   *
   * An unconsented interactive run raises a non-blocking recommendation. The
   * caller records that it was shown, but cannot enable analytics or mint an
   * id; only a later explicit enable may make a future session eligible.
   *
   * Awaits no network. The ping is fired in the background so the caller can
   * `await` this before mounting the shell and get a deterministic
   * `needs-disclosure` answer — the disclosure flag is read during render with
   * no subscription, so it must be settled before the first paint rather than
   * racing it.
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
        await this.deps.config.update({
          analytics: "disabled",
          installId: "",
          analyticsCohort: "",
        });
        await this.deps.config.save();
      }
    }
    // Catches a disable this process did not write (a sibling, a hand edit).
    // Backgrounded: startup awaits this method before the first paint.
    void this.settleLocalPingLog();
    if (!canPersistEnabled(state)) return { kind: "quiet" };

    if (state.kind === "awaiting-disclosure") {
      return this.deps.config.getRaw().analyticsNoticeShown
        ? { kind: "quiet" }
        : { kind: "needs-disclosure" };
    }
    if (!canSend(state)) return { kind: "quiet" };

    this.pingInBackground(options);
    return { kind: "pinged" };
  }

  /** Fire-and-forget; never blocks startup/playback. Failures are silent. */
  pingInBackground(options: { readonly isInteractive: boolean }): void {
    void this.maybePing(options).catch(() => {
      // Silent by design — analytics must never surface as a user-facing failure.
    });
  }

  /**
   * `isInteractive` is the caller's, never assumed. This gate is deliberately a
   * second one — `onSessionStart` has already refused a non-TTY session — but a
   * second gate that hardcodes the permissive answer is not a gate. Non-TTY is a
   * hard delivery bar even for an opted-in install (`consent-policy.ts`), so
   * re-deriving it as `true` here would make the next caller of this method a
   * contract breach rather than a bug.
   */
  async maybePing(options: { readonly isInteractive: boolean }): Promise<void> {
    const config = this.deps.config.getRaw();
    const state = resolveConsentState({
      env: this.env,
      isInteractive: options.isInteractive,
      stored: config.analytics,
    });
    if (!canSend(state)) return;

    const endpoint = this.deps.endpoint.trim();
    if (!endpoint) return;
    // Second gate, not a duplicate of `resolveAnalyticsEndpoint`: the endpoint
    // is injected, so nothing else guarantees what arrives here.
    if (!isTransportSafeAnalyticsEndpoint(endpoint)) return;

    const now = this.now();
    if (
      config.lastAnalyticsPingAt > 0 &&
      now - config.lastAnalyticsPingAt < ANALYTICS_PING_INTERVAL_MS
    ) {
      return;
    }
    // A pending retry from an earlier failed send is still cooling down.
    if (config.analyticsRetryAfter > now) return;

    // Identity creation and repair require an explicit consent choice.
    if (!isValidInstallId(config.installId)) return;
    const installId = config.installId;

    // Everything above read this process's snapshot. A sibling kunai may have
    // disabled analytics or rotated the id since, so nothing is sent until the
    // file agrees; the completion's own re-check only guards the bookkeeping,
    // after the request has already left.
    if (!(await this.persistedConsentAllows(installId))) return;
    // This month's HMAC of the stored id, never the id itself. `installId`
    // below is persisted locally so the identity survives restarts.
    const identity = this.deps.config.getRaw();
    const payload = describeAnalyticsPayload({
      identity,
      version: this.deps.currentVersion,
      platform: this.platform,
      now,
    });
    const body = JSON.stringify(payload);
    // A ping the log cannot record is not sent: `kunai analytics log` promises
    // every ping, and a gap would make it a sample.
    if (!(await this.recordInPingLog(endpoint, body, installId, now))) return;

    const outcome = await this.send(endpoint, body);

    await this.deps.config.recordAnalyticsPing({
      installId,
      // An install that opted in before cohorts existed keeps the cohort its
      // first v2 ping carried, or every month would report it as new again.
      ...(isAnalyticsMonth(identity.analyticsCohort) ? {} : { analyticsCohort: payload.cohort }),
      ...(outcome === "retry"
        ? { analyticsRetryAfter: now + ANALYTICS_RETRY_BACKOFF_MS }
        : { lastAnalyticsPingAt: now, analyticsRetryAfter: 0 }),
    });
  }

  /**
   * Appends the exact body to the local log. If consent changed while the
   * append ran, the disable already removed the file, so the entry this wrote
   * is removed again rather than outliving the consent it was written under.
   */
  private async recordInPingLog(
    endpoint: string,
    body: string,
    installId: string,
    now: number,
  ): Promise<boolean> {
    try {
      await this.deps.pingLog.append({ sentAt: new Date(now).toISOString(), endpoint, body });
    } catch {
      return false;
    }
    const local = this.deps.config.getRaw();
    if (local.analytics === "enabled" && local.installId === installId) return true;
    await this.deps.pingLog.remove().catch(() => undefined);
    return false;
  }

  /**
   * True only when config.json still says `enabled` with this exact id and this
   * process has not changed its mind while the file was read. Fails closed: a
   * file that cannot be read or parsed sends nothing.
   */
  private async persistedConsentAllows(installId: string): Promise<boolean> {
    let onDisk: PersistedAnalyticsConsent;
    try {
      onDisk = await this.deps.config.readPersistedAnalyticsConsent();
    } catch {
      return false;
    }
    if (onDisk.analytics !== "enabled" || onDisk.installId !== installId) return false;
    const local = this.deps.config.getRaw();
    return local.analytics === "enabled" && local.installId === installId;
  }

  /**
   * `permanent` covers success and 4xx: both mean "do not try this again today".
   * `retry` covers network errors, timeouts, and 5xx.
   */
  private async send(endpoint: string, body: string): Promise<"permanent" | "retry"> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.pingTimeoutMs);
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
        signal: controller.signal,
        // An https endpoint that 302s to http:// would carry the payload right
        // back out in cleartext, so the scheme check above has to survive the
        // hop. Refusing to follow one at all is simpler than re-validating each.
        redirect: "error",
      });
      const outcome = response.status >= 500 ? "retry" : "permanent";
      // The status is the whole answer. Leaving the body unread pins the
      // connection until the socket times out.
      await response.body?.cancel().catch(() => undefined);
      return outcome;
    } catch {
      // Network error, timeout, or abort — all transient.
      return "retry";
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Loopback hosts allowed over cleartext http, so a self-hoster can develop
 * against `apps/analytics-ingest` locally. Same list, same reason as
 * `normalizeRelayBaseUrl` in `packages/relay`.
 */
const LOOPBACK_ANALYTICS_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * https only, plus the loopback exception above.
 *
 * The payload carries a monthly HMAC of the install id with its cohort, day,
 * version, OS, and architecture. Over cleartext http anything on the path reads
 * it and can follow one install through a month — the HMAC exists so no
 * *endpoint* holds the raw id, and that is worth little if the wire is readable.
 */
export function isTransportSafeAnalyticsEndpoint(endpoint: string): boolean {
  const trimmed = endpoint.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && LOOPBACK_ANALYTICS_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Where this install would ping: `KUNAI_ANALYTICS_URL`, then
 * `analyticsEndpoint`, then the built-in default.
 *
 * An override that is not transport-safe returns `""`, which stops sending
 * entirely — it is **not** redirected to the built-in default. Somebody who
 * pointed their installs at their own ingest asked for their telemetry to go
 * there and nowhere else; quietly sending it to Kunai's endpoint instead would
 * be the same class of breach as enabling analytics for them. This is the
 * posture `normalizeRelayBaseUrl` already takes: an unusable base URL turns the
 * feature off rather than substituting one the user did not choose.
 */
export function resolveAnalyticsEndpoint(
  env: NodeJS.ProcessEnv = process.env,
  configured = "",
): string {
  const fromEnv = typeof env.KUNAI_ANALYTICS_URL === "string" ? env.KUNAI_ANALYTICS_URL.trim() : "";
  if (fromEnv) return acceptOverride(fromEnv, "KUNAI_ANALYTICS_URL");
  const fromConfig = configured.trim();
  if (fromConfig) return acceptOverride(fromConfig, "analyticsEndpoint");
  return DEFAULT_ANALYTICS_ENDPOINT;
}

function acceptOverride(endpoint: string, source: string): string {
  if (isTransportSafeAnalyticsEndpoint(endpoint)) return endpoint;
  dbgErr(
    "analytics.endpoint",
    `${source} must be https (loopback http allowed); analytics will not send`,
    new Error("rejected non-https analytics endpoint"),
  );
  return "";
}
