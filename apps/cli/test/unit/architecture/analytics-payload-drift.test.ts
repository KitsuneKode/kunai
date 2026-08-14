import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ANALYTICS_PAYLOAD_KEYS,
  type AnalyticsPayload,
} from "@/services/analytics/UsageAnalyticsService";

const ROOT = join(import.meta.dir, "../../../../..");
const CONTRACT = join(ROOT, ".docs/analytics-privacy-contract.md");
const USER_DOC = join(ROOT, "docs/users/reliability-and-privacy.mdx");

/**
 * Imported, never re-declared. A local copy would let a sixth wire field ship
 * while this file stayed green and both documents still said five — which is
 * the precise failure this gate exists to prevent.
 */
const PAYLOAD_KEYS = ANALYTICS_PAYLOAD_KEYS;

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
      installId: "id",
      version: "0.0.0",
      os: "linux",
      arch: "x64",
      ts: 1,
    };
    expect(Object.keys(sample).sort()).toEqual([...ANALYTICS_PAYLOAD_KEYS]);
    expect(ANALYTICS_PAYLOAD_KEYS).toHaveLength(5);
  });

  for (const [label, path] of docs) {
    test(`${label} names exactly the five wire keys`, () => {
      const body = prose(path);
      for (const key of PAYLOAD_KEYS) {
        expect(body).toContain(key);
      }
    });

    test(`${label} states the opt-out default, not opt-in`, () => {
      const body = prose(path).toLowerCase();
      expect(body).toMatch(/opt[- ]out/);
      expect(body).not.toMatch(/analytics is \*\*opt-in\*\*|telemetry is \*\*opt-in\*\*/);
    });

    test(`${label} states the k-anonymity floor`, () => {
      expect(prose(path)).toMatch(/fewer than 5|under 5|floor of 5|floor: 5/i);
    });

    test(`${label} states that the first run does not send`, () => {
      expect(prose(path).toLowerCase()).toMatch(/first run (never sends|sends nothing)/);
    });

    test(`${label} states that turning it off deletes the install id`, () => {
      expect(prose(path).toLowerCase()).toMatch(/delet\w+ (it|the install id)|install id.*delet/);
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
