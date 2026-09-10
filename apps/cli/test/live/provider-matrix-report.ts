/**
 * Report shaping for the serial provider matrix.
 *
 * These are the seams that decide what a matrix row *says*, so they are kept
 * out of the runner and unit-tested. Two harness defects made the matrix lie
 * about live providers, and both live here:
 *
 * - a smoke may print several JSON objects (payload plus per-check results),
 *   which is not one parseable document;
 * - a smoke reports early-exit failures through `console.error`, so the
 *   diagnosis is on stderr while only stdout was ever read.
 *
 * Both surfaced as `harness-failure`, the one class that means "we learned
 * nothing" — hiding a healthy provider and an upstream outage alike.
 */

export type SmokePayload = Record<string, unknown>;

/**
 * Release-evidence taxonomy for matrix rows. Default CI must not depend on these.
 * - healthy: stream resolved
 * - provider-drift: upstream contract/route failure while the harness ran
 * - environment-network: unreachable upstream — timeout, connect, DNS/TLS,
 *   WAF-shaped block, or a 5xx/maintenance response
 * - harness-failure: no provider evidence at all (unparseable smoke output, or
 *   a matrix deadline that produced no payload)
 *
 * ReleaseProviderSignoff.failureClass reuses provider-drift / environment-network /
 * harness-failure (null when the default route is resolved and reachable).
 */
export type ProviderHealthClass =
  | "healthy"
  | "provider-drift"
  | "environment-network"
  | "harness-failure";

/** Text that means the upstream never gave us a usable answer. */
const UNREACHABLE_UPSTREAM =
  /within \d+s|timed out|timeout|econn|enotfound|network|cannot connect|connection|403|waf|socket|maintenance|unavailable|http 5\d{2}|\b50[0234]\b/;

/** Text that means the upstream answered, but not with a route we can use. */
const DRIFTED_ROUTE =
  /404|not-found|did not find|no playable|exhausted|route-dead|unsupported-title/;

/**
 * Every top-level JSON object in `text`, in order.
 *
 * Brace counting is string- and escape-aware so a `{` inside a URL or message
 * cannot desynchronise the scan.
 */
function extractJsonObjects(text: string): SmokePayload[] {
  const objects: SmokePayload[] = [];
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf("{", index);
    if (start < 0) break;

    const end = findBalancedObjectEnd(text, start);
    if (end < 0) {
      // A lone `{` — a stack trace, or a log line truncated mid-object. Skipping
      // only this brace matters: treating it as an open object would swallow
      // every well-formed payload printed after it.
      index = start + 1;
      continue;
    }

    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1));
      if (value && typeof value === "object" && !Array.isArray(value)) {
        objects.push(value as SmokePayload);
      }
      index = end + 1;
    } catch {
      // findBalancedObjectEnd can close on a later object's `}` when the
      // opener belongs to a truncated log line. Skipping to that `end`
      // would jump over the real payload. Advance one brace and scan again.
      index = start + 1;
    }
  }

  return objects;
}

/**
 * Index of the `}` closing the object that opens at `start`, or -1 when the
 * text never closes it. String- and escape-aware so a brace inside a URL or a
 * message cannot desynchronise the scan.
 */
function findBalancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/**
 * The provider payload a smoke emitted, or null when it emitted none.
 *
 * `ok` is a required field of `ProviderSmokePayload`, so it is what separates a
 * verdict from the structured debug logging the container also writes. Among
 * verdicts, the object naming a provider wins over document order, because a
 * smoke may print supplementary per-check objects after its payload.
 *
 * stdout is the documented channel; stderr is read only when stdout announced
 * no verdict, which is where an early-exit failure reports its reason.
 */
export function parseSmokePayload(stdout: string, stderr = ""): SmokePayload | null {
  const streams = [stdout, stderr].map((stream) =>
    extractJsonObjects(stream).filter((object) => typeof object.ok === "boolean"),
  );

  // A provider verdict first, from either stream. A smoke can exit early after
  // printing supplementary `{ check: … }` lines and leave its real failure on
  // stderr; both carry `ok`, so preferring document order would return the
  // check line and lose the diagnosis.
  for (const verdicts of streams) {
    const verdict = verdicts.find(isProviderVerdict);
    if (verdict) return verdict;
  }

  // Nothing named a provider or a stage. Return whatever was said rather than
  // nothing, because `harness-failure` is reserved for learning nothing at all.
  for (const verdicts of streams) {
    if (verdicts[0]) return verdicts[0];
  }
  return null;
}

/**
 * Distinguishes the report a smoke makes about the provider from the check
 * lines it prints alongside it. An early-exit failure names a `stage` rather
 * than a provider, and is just as much provider evidence.
 */
function isProviderVerdict(object: SmokePayload): boolean {
  if (typeof object.check === "string") return false;
  return typeof object.provider === "string" || typeof object.stage === "string";
}

/**
 * Which kind of failure a matrix row represents.
 *
 * `harness` means the smoke produced no payload to reason about; anything the
 * provider actually told us is provider evidence and must never be reported as
 * a harness failure.
 */
export function classifyProviderHealth(
  result: {
    readonly ok?: boolean;
    readonly error?: unknown;
    readonly reason?: unknown;
    readonly failureCodes?: readonly string[];
  },
  { timedOut = false, harness = false }: { timedOut?: boolean; harness?: boolean } = {},
): ProviderHealthClass {
  if (result.ok === true) return "healthy";
  if (harness) return "harness-failure";

  const haystack = [
    typeof result.error === "string" ? result.error : "",
    typeof result.reason === "string" ? result.reason : "",
    ...(Array.isArray(result.failureCodes) ? result.failureCodes : []),
  ]
    .join(" ")
    .toLowerCase();

  if (timedOut || UNREACHABLE_UPSTREAM.test(haystack)) return "environment-network";
  if (DRIFTED_ROUTE.test(haystack)) return "provider-drift";
  return "provider-drift";
}
