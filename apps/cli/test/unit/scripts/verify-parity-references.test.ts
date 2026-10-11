import { describe, expect, test } from "bun:test";

import {
  citeFindings,
  localCheckoutVersion,
} from "../../../../../scripts/verify-parity-references";

const PIN = "5.1.4";

describe("citeFindings", () => {
  test("flags a stale bare version cite", () => {
    const findings = citeFindings(
      "f.ts",
      " * Parity with ani-cli v5.1.2: /search endpoint.",
      "ani-cli",
      PIN,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.cite).toBe("ani-cli 5.1.2");
  });

  test("accepts the pinned version", () => {
    const findings = citeFindings(
      "f.ts",
      " * Parity with ani-cli v5.1.4: /search endpoint.",
      "ani-cli",
      PIN,
    );
    expect(findings).toHaveLength(0);
  });

  test("accepts a dated historical cite", () => {
    const findings = citeFindings(
      "f.ts",
      ' * "Parity with ani-cli v5.0 (2026-08-01): browse search."',
      "ani-cli",
      PIN,
    );
    expect(findings).toHaveLength(0);
  });

  test("accepts a historical-worded cite without a date", () => {
    const findings = citeFindings(
      "f.ts",
      "ani-cli v5.0.0 deleted its AllAnime code",
      "ani-cli",
      PIN,
    );
    expect(findings).toHaveLength(0);
  });

  test("a month-only date does not exempt a stale cite", () => {
    const findings = citeFindings("f.ts", "Parity with ani-cli v5.1.2 (2026-09).", "ani-cli", PIN);
    expect(findings).toHaveLength(1);
  });

  test("major-only cites are not version-pinned", () => {
    const findings = citeFindings("f.ts", "ani-cli v5 moved primary to anidb.app", "ani-cli", PIN);
    expect(findings).toHaveLength(0);
  });

  test("backticked cites are caught", () => {
    const findings = citeFindings("f.md", "Parity reference: ani-cli `5.1.0`", "ani-cli", PIN);
    expect(findings).toHaveLength(1);
  });
});

describe("localCheckoutVersion", () => {
  test("returns null for a missing checkout", () => {
    expect(localCheckoutVersion("/nonexistent/path", "ani-cli")).toBeNull();
  });
});
