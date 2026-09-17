/**
 * Shared matrix harness helpers — pure, Node-compatible, no network.
 *
 * `provider-matrix.smoke.mjs` runs under `node`, so this file must stay
 * plain `.mjs` with no TS syntax and no Bun/CLI imports. Bun unit tests
 * import these same functions, which is what keeps the matrix parser and
 * its contract tests from drifting apart.
 */

/**
 * Try to parse one JSON value. Returns the object or null.
 */
export function tryParseJsonObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * A smoke payload is the primary resolve report, not an auxiliary check
 * line (`{ check: "quality-ladder" }`). Primary payloads carry a provider
 * identity; check lines carry `check`.
 */
export function isPrimarySmokePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.check === "string") return false;
  return typeof value.provider === "string" || typeof value.providerId === "string";
}

/**
 * Parse smoke stdout that may contain:
 * - a single pretty-printed JSON payload (most smokes), or
 * - NDJSON / multiple JSON documents (youtube.smoke.ts emits the primary
 *   payload plus `quality-ladder` and `type-short-search` check lines).
 *
 * Strategy: whole-output parse first, then per-line scan for the first
 * primary payload, then brace-scan fallback for pretty-printed output with
 * log prefixes.
 */
export function parseJsonPayload(stdout) {
  if (!stdout || typeof stdout !== "string") return null;
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const whole = tryParseJsonObject(trimmed);
  if (whole) return whole;

  // Per-line scan: handles NDJSON and pretty-printed payloads mixed with
  // log lines. Collect primary payloads; prefer one with stream evidence.
  let firstPrimary = null;
  let firstAny = null;
  for (const line of trimmed.split("\n")) {
    const candidate = tryParseJsonObject(line.trim());
    if (!candidate) continue;
    if (!firstAny) firstAny = candidate;
    if (isPrimarySmokePayload(candidate)) {
      if (!firstPrimary) firstPrimary = candidate;
      // A payload with resolve evidence is the report we want even if a
      // slimmer primary line came first.
      if (typeof candidate.streamResolved === "boolean") return candidate;
    }
  }
  if (firstPrimary) return firstPrimary;

  // Brace-scan fallback for a single pretty-printed object with prefixes.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    // NDJSON brace-scan would glue documents together, so only use it when
    // the per-line scan found nothing primary.
    const glued = tryParseJsonObject(trimmed.slice(start, end + 1));
    if (glued) return glued;
  }
  return firstAny;
}

/**
 * Matrix reads stdout first, then stderr. Search-stage failures
 * (anidb-onigiri) historically went to stderr via console.error while
 * success goes to stdout, which misclassified structured provider
 * evidence as `harness-failure`. Returns the payload plus where it came
 * from, or null.
 */
export function parseSmokeOutput(stdout, stderr) {
  const fromStdout = parseJsonPayload(stdout);
  if (fromStdout) return { payload: fromStdout, source: "stdout" };
  const fromStderr = parseJsonPayload(stderr);
  if (fromStderr) return { payload: fromStderr, source: "stderr" };
  return null;
}

/**
 * Release-evidence taxonomy for matrix rows. Default CI must not depend on these.
 * - healthy: stream resolved
 * - provider-drift: upstream contract/route failure while the harness ran
 * - environment-network: timeout, connect, DNS/TLS, or WAF-shaped blocks
 * - harness-failure: unparseable smoke output or matrix deadline without provider JSON
 */
export function classifyProviderHealth(result, { timedOut, harness }) {
  if (result?.ok) return "healthy";
  if (harness) return "harness-failure";

  const haystack = [
    result?.error ?? "",
    result?.reason ?? "",
    result?.stage ?? "",
    result?.streamProbeStatus ?? "",
    result?.streamProbeReason ?? "",
    ...(Array.isArray(result?.failureCodes) ? result.failureCodes : []),
    ...(Array.isArray(result?.failureMessages) ? result.failureMessages : []),
  ]
    .join(" ")
    .toLowerCase();

  if (
    timedOut ||
    /within \d+s|timed out|timeout|econn|enotfound|network|cannot connect|connection|403|waf|socket|captcha|cloudflare|just a moment|challenge|blocked by|\b5\d\d\b|http 5\d\d|maintenance/.test(
      haystack,
    )
  ) {
    return "environment-network";
  }

  if (
    /404|not-found|did not find|no playable|exhausted|route-dead|unsupported-title|zero results|search returned/.test(
      haystack,
    )
  ) {
    return "provider-drift";
  }

  return "provider-drift";
}

export function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

export function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

export function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

export function parseScore(value) {
  if (!value || typeof value !== "object") return null;
  return {
    functional: booleanOrNull(value.functional),
    performative: booleanOrNull(value.performative),
    ordered: booleanOrNull(value.ordered),
  };
}
