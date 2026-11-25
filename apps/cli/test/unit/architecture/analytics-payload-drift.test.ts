import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ANALYTICS_PAYLOAD_FIELDS,
  ANALYTICS_PAYLOAD_KEYS,
  analyticsOs,
  describeAnalyticsPayload,
  type AnalyticsPayload,
} from "@/services/analytics/usage-analytics-service";
import { RELEASE_MARKER_NAMES } from "@/services/update/release-marker";

import { IST_DAY_BOUNDARY_FROM } from "../../../../analytics-ingest/src/analytics-day";
import {
  ANALYTICS_PAYLOAD_KEYS as INGEST_V1_KEYS,
  ANALYTICS_PAYLOAD_V2_KEYS as INGEST_V2_KEYS,
} from "../../../../analytics-ingest/src/ingest";
import { ALLOWED_OS } from "../../../../analytics-ingest/src/payload-validation";

const ROOT = join(import.meta.dir, "../../../../..");
const CONTRACT = join(ROOT, ".docs/analytics-privacy-contract.md");
const USER_DOC = join(ROOT, "docs/users/reliability-and-privacy.mdx");

/**
 * The client sends one shape (v2); the ingest accepts two. v1 is what every
 * earlier release sends and stays accepted, so the contract names both.
 */
const INGEST_WIRE_KEYS = [...new Set([...INGEST_V1_KEYS, ...INGEST_V2_KEYS])];

/**
 * Prose in both documents is hard-wrapped, so a phrase can straddle a newline.
 * Collapse whitespace before matching, or every assertion here becomes a test
 * of where the author happened to wrap a line.
 */
function prose(path: string): string {
  return readFileSync(path, "utf8").replace(/\s+/g, " ");
}

/**
 * The contract requires that any payload change lands in both documents in the
 * same change set. This is the gate that makes that true rather than
 * aspirational — the previous revision's contract said the same thing and the
 * code drifted from it anyway.
 */
describe("analytics payload documentation drift", () => {
  const docs = [
    ["contract", CONTRACT],
    ["user doc", USER_DOC],
  ] as const;

  test("the wire key list matches the payload type exactly", () => {
    // Binds the constant the docs are checked against to the type actually
    // sent. Adding a field to AnalyticsPayload without adding it here is a
    // compile error; adding it to both then fails the doc assertions below.
    const sample: AnalyticsPayload = {
      id: "id",
      cohort: "2026-11",
      day: "2026-11-25",
      version: "0.0.0",
      os: "linux",
      arch: "x64",
    };
    expect(Object.keys(sample).sort()).toEqual([...ANALYTICS_PAYLOAD_KEYS]);
    expect(ANALYTICS_PAYLOAD_KEYS).toHaveLength(6);
    expect([...ANALYTICS_PAYLOAD_FIELDS].sort()).toEqual([...ANALYTICS_PAYLOAD_KEYS]);
  });

  test("the body the client builds carries the fields in the documented order", () => {
    const built = describeAnalyticsPayload({
      identity: { analytics: "unset", installId: "", analyticsCohort: "" },
      version: "0.0.0",
      platform: { os: "linux", arch: "x64" },
      now: Date.UTC(2026, 10, 25),
    });
    expect(Object.keys(built)).toEqual([...ANALYTICS_PAYLOAD_FIELDS]);
  });

  /**
   * `{ id, cohort, day, version, os, arch }`, built from the code's field
   * order: imported, never re-declared. A local copy would let a seventh wire
   * field ship while this file stayed green and both documents still said six,
   * which is the precise failure this gate exists to prevent.
   */
  const DOCUMENTED_PAYLOAD = `\`{ ${ANALYTICS_PAYLOAD_FIELDS.join(", ")} }\``;

  test("the ingest accepts exactly what the client sends", () => {
    // The client's shape must be one the ingest accepts, or every ping 400s and
    // the client backs off for a day.
    expect([...ANALYTICS_PAYLOAD_KEYS]).toEqual([...INGEST_V2_KEYS]);
  });

  test("every os the client can report is one the ingest accepts", () => {
    const reported = [
      analyticsOs("linux", {}),
      analyticsOs("darwin", {}),
      analyticsOs("win32", {}),
      analyticsOs("linux", { TERMUX_VERSION: "0.118.1" }),
      analyticsOs("android", {}),
    ];
    expect(reported).toContain("android");
    for (const os of reported) expect([...ALLOWED_OS]).toContain(os);
  });

  test("the contract names every key of both shapes the ingest accepts", () => {
    const body = prose(CONTRACT);
    for (const key of INGEST_WIRE_KEYS) expect(body).toContain(`\`${key}\``);
    for (const wireKeys of [INGEST_V1_KEYS, INGEST_V2_KEYS]) {
      const listed = [...body.matchAll(/`\{ ([\w, ]+) \}`/g)].map((match) =>
        (match[1] ?? "").split(", ").sort().join(","),
      );
      expect(listed, `contract states ${wireKeys.join(", ")}`).toContain([...wireKeys].join(","));
    }
    for (const os of ALLOWED_OS) expect(body).toContain(`\`${os}\``);
  });

  for (const [label, path] of docs) {
    test(`${label} names exactly the six wire keys, in wire order`, () => {
      // Matching each key alone proves nothing: `id`, `day` and `os` occur in
      // any English paragraph. The documented shape has to match the code's.
      expect(prose(path)).toContain(DOCUMENTED_PAYLOAD);
    });

    test(`${label} states the id rotates monthly and is never the raw id`, () => {
      const body = prose(path).toLowerCase();
      expect(body).toMatch(/every (calendar )?month/);
      expect(body).toContain("hmac");
    });

    test(`${label} names android as a sent os`, () => {
      expect(prose(path)).toContain("android");
    });

    test(`${label} points at the local ping log and the preview`, () => {
      const body = prose(path);
      expect(body).toContain("kunai analytics log");
      expect(body).toContain("kunai analytics preview");
      expect(body.toLowerCase()).toMatch(/deleted when you turn it off|disable,? .*remove/);
    });

    test(`${label} documents the release markers and that Kunai receives nothing`, () => {
      const body = prose(path);
      for (const name of RELEASE_MARKER_NAMES) expect(body).toContain(name);
      expect(body).toMatch(/GitHub counts the download; (we|Kunai) receives? nothing/);
      for (const optOut of ["DO_NOT_TRACK", "CI", "KUNAI_NO_MARKER"])
        expect(body).toContain(optOut);
    });

    test(`${label} describes a neutral consent screen`, () => {
      expect(prose(path).toLowerCase()).toMatch(/neither .* is pre-selected/);
    });

    test(`${label} states that consent is a keystroke and no skip can grant it`, () => {
      // The guarantee that actually protects people: only a keystroke on the
      // consent screen may enable it, and no skip, accept-all, or
      // non-interactive path can. That is what these docs must keep saying.
      const body = prose(path).toLowerCase();
      expect(body).toMatch(/keystroke|confirm|explicit choice|explicitly enable/);
      expect(body).toMatch(/no skip|skipping setup leaves|may enable it|can turn it on for you/);
    });

    test(`${label} states the small-cell floor without promising joint anonymity`, () => {
      const body = prose(path);
      expect(body).toMatch(/fewer than 5|under 5|below five|floor of 5|floor: 5/i);
      expect(body).toMatch(/small-cell/i);
      expect(body).toMatch(/not (a (claim of )?)?joint (k-)?anonymity/i);
    });

    test(`${label} states that the notice cannot send before consent`, () => {
      expect(prose(path).toLowerCase()).toMatch(/before consent|notice does not.*send/);
    });

    test(`${label} points at the settings switch that reverses the choice`, () => {
      // The consent screen is a moment; Settings is the standing control. A doc
      // that pins the keystroke gate but never says the decision is reversible
      // describes a one-way door Kunai does not have.
      expect(prose(path).toLowerCase()).toMatch(/settings/);
      expect(prose(path).toLowerCase()).toMatch(
        /any time|anytime|at will|enable or disable|enable\/disable/,
      );
    });

    test(`${label} states that turning it off deletes the install id`, () => {
      expect(prose(path).toLowerCase()).toMatch(
        /delet\w+ (it|the install id)|install id.*delet|clears `?installid`?/,
      );
    });
  }

  test("the user doc does not promise the retired lifetimeMethod field", () => {
    // The contract may name it — it explains the removal. The user-facing page
    // must not still describe it as something Kunai reports.
    expect(prose(USER_DOC)).not.toContain("lifetimeMethod");
    expect(prose(USER_DOC)).not.toMatch(/HyperLogLog/i);
  });

  test("the contract records lifetimeMethod as removed rather than current", () => {
    expect(prose(CONTRACT)).toMatch(/`lifetimeMethod` was removed/);
  });

  test("the contract states the install_lifetime retention tradeoff", () => {
    const body = prose(CONTRACT);
    expect(body).toContain("install_lifetime");
    expect(body).toMatch(/permanent|life of the project/i);
  });

  test("the contract states that the ingest never reads a client IP", () => {
    expect(prose(CONTRACT)).toMatch(/never reads a client IP/i);
  });
});

/**
 * The day boundary is a single constant in `analytics-day.ts`. Both documents
 * describe it by date, so each date here is derived from that constant and
 * never typed. If the cutover moves, these fail until both documents move with
 * it — otherwise production would switch at one instant while the published
 * description named another.
 */
describe("the documents state the cutover the ingest clock uses", () => {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const longUtcDate = (ms: number) => {
    const date = new Date(ms);
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  };

  /** The UTC date of the cutover instant: the short changeover day. */
  const seamDay = longUtcDate(IST_DAY_BOUNDARY_FROM);
  /** The IST date at the cutover instant: the first full IST day. */
  const firstIstDay = longUtcDate(IST_DAY_BOUNDARY_FROM + IST_OFFSET_MS);

  test("the contract names the exact cutover instant and the first IST day", () => {
    const body = prose(CONTRACT);
    expect(body).toContain(new Date(IST_DAY_BOUNDARY_FROM).toISOString());
    expect(body).toContain(firstIstDay);
  });

  test("the contract's changeover sentence names the right label", () => {
    // The ISO instant check above would still pass if only the instant moved
    // and this sentence kept describing the old seam day.
    const seamLabel = new Date(IST_DAY_BOUNDARY_FROM).toISOString().slice(0, 10);
    expect(prose(CONTRACT)).toContain(`\`${seamLabel}\` spans 00:00 to 18:30 UTC`);
  });

  test("the user doc names the first IST day and the changeover day", () => {
    const body = prose(USER_DOC);
    expect(body).toContain(firstIstDay);
    expect(body).toContain(seamDay);
  });
});
