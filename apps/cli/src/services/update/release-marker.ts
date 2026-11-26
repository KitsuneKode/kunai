/**
 * Release marker assets: how installs and updates get counted without Kunai
 * receiving anything.
 *
 * Every release carries two tiny files, `install.marker` and `update.marker`.
 * The installers fetch the first after a successful install, and the native
 * updater fetches the second after a verified activation. GitHub's per-asset
 * download count is the whole measurement. The request goes to the same host
 * that just served the binary, carries nothing the binary download did not,
 * and its response is ignored.
 *
 * Opt-in, like the ping: a marker is fetched only when usage analytics is
 * `enabled` in config.json. The callers decide that (the updater from its
 * config, `kunai upgrade` from `readStandaloneAnalyticsConsented`, the
 * installers from the config file); a first install has no consent, so it is
 * never counted.
 *
 * Best effort only: one attempt, a short timeout, every failure swallowed,
 * nothing printed, and never awaited by the update itself. `DO_NOT_TRACK`,
 * `CI` and `KUNAI_NO_MARKER` still turn it off even with consent.
 */

import { isTruthyEnv } from "@/domain/analytics/consent-policy";

export const RELEASE_MARKER_NAMES = ["install.marker", "update.marker"] as const;

export type ReleaseMarkerName = (typeof RELEASE_MARKER_NAMES)[number];

export type ReleaseMarkerEnv = {
  readonly DO_NOT_TRACK?: string | undefined;
  readonly CI?: string | undefined;
  readonly KUNAI_NO_MARKER?: string | undefined;
};

export const RELEASE_MARKER_TIMEOUT_MS = 3_000;

/** True when any opt-out says not to fetch a marker. */
export function releaseMarkerSkipped(env: ReleaseMarkerEnv): boolean {
  return isTruthyEnv(env.DO_NOT_TRACK) || isTruthyEnv(env.CI) || isTruthyEnv(env.KUNAI_NO_MARKER);
}

/**
 * Starts the one marker request and returns without waiting for it. The
 * returned promise never rejects and settles within the timeout. A
 * long-running caller drops it; a command about to `process.exit` may wait on
 * it after reporting success, or the exit would cut the request off. `null`
 * means an opt-out skipped it.
 */
export function startReleaseMarkerFetch(input: {
  readonly dlBase: string;
  readonly version: string;
  readonly marker: ReleaseMarkerName;
  readonly env?: ReleaseMarkerEnv;
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}): Promise<void> | null {
  const env = input.env ?? {
    DO_NOT_TRACK: process.env.DO_NOT_TRACK,
    CI: process.env.CI,
    KUNAI_NO_MARKER: process.env.KUNAI_NO_MARKER,
  };
  if (releaseMarkerSkipped(env)) return null;
  const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const url = `${input.dlBase}/download/v${input.version}/${input.marker}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? RELEASE_MARKER_TIMEOUT_MS);
  // A pending marker must never hold a short-lived `kunai upgrade` open.
  timer.unref();
  return fetchImpl(url, { signal: controller.signal })
    .then((response) => response.body?.cancel())
    .catch(() => undefined)
    .finally(() => clearTimeout(timer))
    .then(() => undefined);
}
