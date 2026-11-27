import { describe, expect, test } from "bun:test";

import {
  resolveProviderPickerStatus,
  type ProviderPickerEvidence,
} from "@/app-shell/provider-picker-status";
import { resolveEffectiveProviderHealth } from "@/services/playback/provider-health-policy";
import type { ProviderHealth } from "@kunai/types";

const NOW = new Date("2026-11-27T12:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function stored(
  status: ProviderHealth["status"],
  checkedAt: string,
  consecutiveFailures = 0,
  extra: Partial<ProviderHealth> = {},
): ProviderHealth {
  return { providerId: "vidlink", status, checkedAt, consecutiveFailures, ...extra };
}

function statusOf(evidence: Partial<ProviderPickerEvidence> & { stored?: ProviderHealth }) {
  const { stored: record, ...rest } = evidence;
  return resolveProviderPickerStatus(
    {
      health: resolveEffectiveProviderHealth(record, NOW),
      isCurrentProvider: false,
      ...rest,
    },
    NOW,
  );
}

const KNOWN_ISSUE = { since: "2026-11-27", summary: "every resolve times out" };

describe("provider picker status · unchecked", () => {
  test("a provider with no record says so instead of looking healthy", () => {
    const status = statusOf({});
    expect(status.tone).toBe("neutral");
    expect(status.badge).toBe("not checked yet");
    expect(status.explanation).toContain("no resolve recorded on this device");
  });

  test("a failure that aged out of fallback's way is not a success", () => {
    const status = statusOf({ stored: stored("down", minutesAgo(9 * 60), 6) });
    expect(status.tone).toBe("neutral");
    expect(status.badge).toBe("not rechecked · failed 9h ago");
    expect(status.badge).not.toContain("healthy");
    expect(status.explanation).toContain("it will be tried again");
  });

  test("a corrupt timestamp is no evidence either way", () => {
    const status = statusOf({ stored: stored("down", "not-a-date", 7) });
    expect(status.tone).toBe("neutral");
    expect(status.badge).toBe("not checked yet");
  });
});

describe("provider picker status · healthy", () => {
  test("a clean last resolve reads healthy, with its age", () => {
    const status = statusOf({ stored: stored("healthy", minutesAgo(6)) });
    expect(status.tone).toBe("success");
    expect(status.badge).toBe("healthy · 6m ago");
    expect(status.reason).toBeUndefined();
  });

  test("a healthy provider keeps its verdict and names its quarantined endpoints", () => {
    const status = statusOf({ stored: stored("healthy", minutesAgo(6)), quarantinedEndpoints: 2 });
    expect(status.tone).toBe("success");
    expect(status.reason).toBe("2 endpoints quarantined");
    expect(status.explanation).toContain("2 endpoints quarantined");
  });

  test("a local success outranks the manifest's dated claim", () => {
    const status = statusOf({ stored: stored("healthy", minutesAgo(6)), knownIssue: KNOWN_ISSUE });
    expect(status.badge).toBe("healthy · 6m ago");
    expect(status.explanation).not.toContain("known issue");
  });
});

describe("provider picker status · failing and quarantined", () => {
  test("one failure under the degraded threshold is not reported as healthy", () => {
    // The store keeps status "healthy" until the second failure in a row.
    const status = statusOf({ stored: stored("healthy", minutesAgo(6), 1) });
    expect(status.tone).toBe("warning");
    expect(status.badge).toBe("1 failure · 6m ago");
    expect(status.explanation).toBe("last resolve failed 6m ago · still used in auto-fallback");
  });

  test("degraded names the streak and that fallback still uses it", () => {
    const status = statusOf({ stored: stored("degraded", minutesAgo(5), 3) });
    expect(status.tone).toBe("warning");
    expect(status.badge).toBe("degraded · 3 failures · 5m ago");
    expect(status.explanation).toBe(
      "degraded · 3 failures, last 5m ago · still used in auto-fallback",
    );
  });

  test("a sustained failure rate degrades a provider whose last resolve worked", () => {
    const status = statusOf({
      stored: stored("healthy", minutesAgo(5), 0, { recentFailureRate: 0.9, observations: 8 }),
    });
    expect(status.tone).toBe("warning");
    expect(status.badge).toBe("degraded · 5m ago");
    expect(status.explanation).toContain("degraded · most recent resolves failed, last 5m ago");
  });

  test("down reads down, says it is skipped, and stays selectable", () => {
    const status = statusOf({ stored: stored("down", minutesAgo(12), 5) });
    expect(status.tone).toBe("error");
    expect(status.badge).toBe("down · 5 failures · 12m ago");
    expect(status.reason).toBe("skipped in auto-fallback");
    expect(status.explanation).toBe(
      "down · 5 failures, last 12m ago · skipped in auto-fallback · Enter still tries it",
    );
  });

  test("the provider in use never claims it was skipped", () => {
    const status = statusOf({ stored: stored("down", minutesAgo(12), 5), isCurrentProvider: true });
    expect(status.compactBadge).toBe("down");
    expect(status.reason).toBeUndefined();
    expect(status.explanation).not.toContain("skipped in auto-fallback");
    expect(status.explanation).toContain("in use now");
  });

  test("a failure on the title in hand outranks a healthy global record", () => {
    const status = statusOf({
      stored: stored("healthy", minutesAgo(30)),
      titleFailure: { consecutiveFailures: 2, errorClass: "timeout" },
    });
    expect(status.tone).toBe("warning");
    expect(status.badge).toBe("failing on this title");
    expect(status.reason).toBe("timeout on this title");
    expect(status.explanation).toBe(
      "2 failures on this title (timeout) · healthy elsewhere, last resolve 30m ago",
    );
  });

  test("quarantine alone is evidence, even with no global record", () => {
    const status = statusOf({ quarantinedEndpoints: 1 });
    expect(status.tone).toBe("warning");
    expect(status.badge).toBe("1 endpoint quarantined");
    expect(status.compactBadge).toBe("quarantined");
  });
});

describe("provider picker status · manifest known issue", () => {
  test("with no local evidence the dated claim is shown, as a claim", () => {
    const status = statusOf({ knownIssue: KNOWN_ISSUE });
    expect(status.tone).toBe("error");
    expect(status.badge).toBe("known issue · 2026-11-27");
    expect(status.reason).toBe("every resolve times out");
    expect(status.explanation).toContain("not checked on this device");
    expect(status.explanation).toContain("Enter still tries it");
  });

  test("an aged-out local failure does not clear it", () => {
    const status = statusOf({
      stored: stored("down", minutesAgo(9 * 60), 6),
      knownIssue: KNOWN_ISSUE,
    });
    expect(status.badge).toBe("known issue · 2026-11-27");
    expect(status.explanation).toContain("last attempt failed 9h ago");
  });

  test("a failure on the title in hand is this device's evidence for the claim", () => {
    const status = statusOf({ knownIssue: KNOWN_ISSUE, titleFailure: { consecutiveFailures: 2 } });
    expect(status.badge).toBe("known issue · 2026-11-27");
    expect(status.explanation).toContain("2 failures on this title");
    expect(status.explanation).not.toContain("not checked on this device");
  });

  test("a live local failure is reported first, with the claim as context", () => {
    const status = statusOf({ stored: stored("down", minutesAgo(12), 5), knownIssue: KNOWN_ISSUE });
    expect(status.badge).toBe("down · 5 failures · 12m ago");
    expect(status.explanation).toContain("known issue since 2026-11-27: every resolve times out");
  });
});

test("every compact badge fits beside a provider name at the 40-column floor", () => {
  const cases = [
    statusOf({}),
    statusOf({ stored: stored("healthy", minutesAgo(6)) }),
    statusOf({ stored: stored("healthy", minutesAgo(6), 1) }),
    statusOf({ stored: stored("degraded", minutesAgo(5), 3) }),
    statusOf({ stored: stored("down", minutesAgo(12), 5) }),
    statusOf({ quarantinedEndpoints: 3 }),
    statusOf({ knownIssue: KNOWN_ISSUE }),
    statusOf({ titleFailure: { consecutiveFailures: 1 } }),
  ];
  for (const status of cases) {
    expect(status.compactBadge.length).toBeGreaterThan(0);
    expect(status.compactBadge.length).toBeLessThanOrEqual(11);
  }
});
