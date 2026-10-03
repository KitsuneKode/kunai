import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { codeMetadata } from "../lib/code-metadata";
import {
  activeNotices,
  buildBoard,
  bundledHistory,
  bundledNotices,
  bundledStatus,
  chooseHistory,
  chooseStatus,
  currentStreak,
  describeAge,
  donutSlices,
  freshness,
  modeOf,
  overallStatus,
  parseHistory,
  parseNotices,
  parseStatusFile,
  STATUS_MEANING,
  stripFor,
  uptimePercent,
  UPTIME_MIN_DAYS,
  type Board,
  type BoardStatus,
  type ProviderStatusFile,
  type ProviderStatusRow,
  type StatusHistory,
} from "../lib/provider-status";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-03T12:00:00Z");

function row(id: string, effectiveStatus: ProviderStatusRow["effectiveStatus"]): ProviderStatusRow {
  return {
    id,
    upstreamHttp: 200,
    upstreamReachable: true,
    resolveStatus: effectiveStatus === "healthy" ? "resolved" : "exhausted",
    resolveMs: 1200,
    streams: effectiveStatus === "healthy" ? 2 : 0,
    qualities: [],
    servers: [],
    audioLanguages: [],
    subtitleLanes: 0,
    effectiveStatus,
    note: "",
  };
}

function file(generatedAt: string, rows: readonly ProviderStatusRow[]): ProviderStatusFile {
  return { generatedAt, schemaVersion: 1, providers: rows };
}

describe("the bundled seeds", () => {
  test("parse with the same rules as live data, so a bad seed fails here and not in production", () => {
    expect(bundledStatus.providers.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(bundledStatus.generatedAt))).toBe(false);
    expect(bundledHistory.days.length).toBeGreaterThan(0);
    expect(bundledNotices.schemaVersion).toBe(1);
  });

  test("the seed history agrees with the seed results on the day they share", () => {
    const day = bundledStatus.generatedAt.slice(0, 10);
    const entry = bundledHistory.days.find((candidate) => candidate.day === day);
    expect(entry).toBeDefined();
    for (const result of bundledStatus.providers) {
      expect(entry?.providers[result.id]).toBe(result.effectiveStatus);
    }
  });

  test("the seed notices start empty: nothing is announced that nobody wrote", () => {
    expect(bundledNotices.notices).toEqual([]);
  });
});

describe("every registered provider has a probe in the daily sweep", () => {
  // The sweep once probed eight of twelve providers, so four never appeared on the board
  // and the missing rows read as a clean bill of health. A provider cannot be registered
  // now without a line in the sweep, or this fails.
  const sweep = fs.readFileSync(
    path.resolve(import.meta.dir, "../../../packages/providers/scripts/provider-status-sweep.ts"),
    "utf-8",
  );
  const probed = new Set([...sweep.matchAll(/^\s+id: "([a-z]+)",$/gm)].map((match) => match[1]));

  test("lists every provider the CLI registers", () => {
    for (const id of codeMetadata.providerIds) expect(probed.has(id)).toBe(true);
  });
});

describe("parseStatusFile", () => {
  const valid = JSON.parse(
    JSON.stringify(file("2026-10-03T06:23:00.000Z", [row("vidlink", "healthy")])),
  );

  test("accepts a well-formed file", () => {
    expect(parseStatusFile(valid)?.providers[0]?.id).toBe("vidlink");
  });

  test("rejects an unknown schema version", () => {
    expect(parseStatusFile({ ...valid, schemaVersion: 2 })).toBeNull();
  });

  test("rejects an invalid timestamp", () => {
    expect(parseStatusFile({ ...valid, generatedAt: "yesterday-ish" })).toBeNull();
  });

  test("rejects a state the page has no word for, rather than drawing it as something else", () => {
    const bad = { ...valid, providers: [{ ...valid.providers[0], effectiveStatus: "thriving" }] };
    expect(parseStatusFile(bad)).toBeNull();
  });

  test("rejects the whole file when one row is malformed: a half-read board misstates the rest", () => {
    const { note: _omitted, ...incomplete } = valid.providers[0];
    expect(parseStatusFile({ ...valid, providers: [valid.providers[0], incomplete] })).toBeNull();
  });

  test("rejects things that are not a file at all", () => {
    for (const junk of [null, 3, "x", [], { providers: [] }]) {
      expect(parseStatusFile(junk)).toBeNull();
    }
  });
});

describe("parseHistory", () => {
  test("accepts a well-formed record and sorts it oldest first", () => {
    const parsed = parseHistory({
      schemaVersion: 1,
      days: [
        { day: "2026-10-02", providers: { vidlink: "blocked" } },
        { day: "2026-10-01", providers: { vidlink: "healthy" } },
      ],
    });
    expect(parsed?.days.map((entry) => entry.day)).toEqual(["2026-10-01", "2026-10-02"]);
  });

  test("rejects a bad day or a bad status", () => {
    expect(
      parseHistory({ schemaVersion: 1, days: [{ day: "2026-13-40", providers: {} }] }),
    ).toBeNull();
    expect(
      parseHistory({ schemaVersion: 1, days: [{ day: "2026-10-01", providers: { a: "fine" } }] }),
    ).toBeNull();
  });
});

describe("parseNotices", () => {
  const notice = {
    id: "allmanga-keys",
    level: "warning",
    title: "AllManga keys rotated",
    body: "A fix is in progress.",
    providers: ["allanime"],
    since: "2026-10-03T00:00:00Z",
    until: null,
  };

  test("accepts a notice, with the providers list and the end optional", () => {
    const parsed = parseNotices({
      schemaVersion: 1,
      notices: [notice, { id: "n2", level: "info", title: "Note", body: "", since: notice.since }],
    });
    expect(parsed?.notices).toHaveLength(2);
    expect(parsed?.notices[1]?.providers).toEqual([]);
    expect(parsed?.notices[1]?.until).toBeNull();
  });

  test("rejects an unknown level or an empty title", () => {
    expect(parseNotices({ schemaVersion: 1, notices: [{ ...notice, level: "fyi" }] })).toBeNull();
    expect(parseNotices({ schemaVersion: 1, notices: [{ ...notice, title: "" }] })).toBeNull();
  });

  test("rejects a bad start or end time", () => {
    expect(parseNotices({ schemaVersion: 1, notices: [{ ...notice, since: "soon" }] })).toBeNull();
    expect(parseNotices({ schemaVersion: 1, notices: [{ ...notice, until: "later" }] })).toBeNull();
  });
});

describe("choosing between the live and the bundled copy", () => {
  const older = file("2026-09-21T00:00:00Z", [row("vidlink", "healthy")]);
  const newer = file("2026-10-03T00:00:00Z", [row("vidlink", "blocked")]);

  test("takes the live copy when it is newer", () => {
    expect(chooseStatus(older, newer)).toEqual({ file: newer, source: "live" });
  });

  test("keeps the bundled copy when live is older, since live is not better for being live", () => {
    expect(chooseStatus(newer, older).source).toBe("bundled");
  });

  test("a tie goes to live", () => {
    expect(chooseStatus(older, { ...older }).source).toBe("live");
  });

  test("falls back to bundled when there is no live copy", () => {
    expect(chooseStatus(older, null)).toEqual({ file: older, source: "bundled" });
  });

  test("history takes whichever has the newest day", () => {
    const a: StatusHistory = { schemaVersion: 1, days: [{ day: "2026-09-21", providers: {} }] };
    const b: StatusHistory = { schemaVersion: 1, days: [{ day: "2026-10-03", providers: {} }] };
    expect(chooseHistory(a, b)).toBe(b);
    expect(chooseHistory(b, a)).toBe(b);
    expect(chooseHistory(a, null)).toBe(a);
  });
});

describe("freshness", () => {
  const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString();

  test("is fresh inside thirty hours, which allows for the schedule slipping", () => {
    expect(freshness(at(2), NOW).state).toBe("fresh");
    expect(freshness(at(30), NOW).state).toBe("fresh");
  });

  test("is late between thirty and seventy-two hours", () => {
    expect(freshness(at(31), NOW).state).toBe("late");
    expect(freshness(at(72), NOW).state).toBe("late");
  });

  test("is stale after that: the check is not running", () => {
    expect(freshness(at(73), NOW).state).toBe("stale");
    expect(freshness(at(24 * 12), NOW).state).toBe("stale");
  });

  test("an unreadable timestamp is stale, never fresh", () => {
    expect(freshness("not a date", NOW).state).toBe("stale");
  });

  test("a timestamp in the future is treated as just now, not as negative age", () => {
    expect(freshness(at(-5), NOW)).toEqual({ state: "fresh", hours: 0 });
  });
});

describe("describeAge", () => {
  test("speaks in hours then days", () => {
    expect(describeAge(0.2)).toBe("less than an hour ago");
    expect(describeAge(1)).toBe("1 hour ago");
    expect(describeAge(5.4)).toBe("5 hours ago");
    expect(describeAge(24 * 12)).toBe("12 days ago");
    expect(describeAge(Number.POSITIVE_INFINITY)).toBe("at an unknown time");
  });
});

describe("activeNotices", () => {
  const make = (since: string, until: string | null) => ({
    schemaVersion: 1 as const,
    notices: [
      { id: "n", level: "info" as const, title: "t", body: "", providers: [], since, until },
    ],
  });

  test("shows a notice between its start and its end", () => {
    expect(activeNotices(make("2026-10-01T00:00:00Z", "2026-10-09T00:00:00Z"), NOW)).toHaveLength(
      1,
    );
  });

  test("shows one with no end until it is removed", () => {
    expect(activeNotices(make("2026-10-01T00:00:00Z", null), NOW)).toHaveLength(1);
  });

  test("hides one that has not started or has ended", () => {
    expect(activeNotices(make("2026-10-04T00:00:00Z", null), NOW)).toHaveLength(0);
    expect(activeNotices(make("2026-09-01T00:00:00Z", "2026-10-02T00:00:00Z"), NOW)).toHaveLength(
      0,
    );
  });
});

describe("stripFor", () => {
  const history: StatusHistory = {
    schemaVersion: 1,
    days: [
      { day: "2026-09-30", providers: { vidlink: "healthy" } },
      { day: "2026-10-02", providers: { vidlink: "blocked" } },
    ],
  };

  test("is thirty days ending on the given day, oldest first", () => {
    const cells = stripFor(history, "vidlink", "2026-10-03");
    expect(cells).toHaveLength(30);
    expect(cells.at(0)?.day).toBe("2026-09-04");
    expect(cells.at(-1)?.day).toBe("2026-10-03");
  });

  test("a day nobody checked is a gap, not a guessed status", () => {
    const cells = stripFor(history, "vidlink", "2026-10-03");
    const byDay = new Map(cells.map((cell) => [cell.day, cell.status]));
    expect(byDay.get("2026-09-30")).toBe("healthy");
    expect(byDay.get("2026-10-01")).toBeNull();
    expect(byDay.get("2026-10-02")).toBe("blocked");
    expect(byDay.get("2026-10-03")).toBeNull();
  });

  test("counts days across a month boundary correctly", () => {
    const cells = stripFor(history, "vidlink", "2026-10-02", 5);
    expect(cells.map((cell) => cell.day)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  test("a provider the history never mentions is all gaps", () => {
    expect(stripFor(history, "ghost", "2026-10-03").every((cell) => cell.status === null)).toBe(
      true,
    );
  });
});

describe("buildBoard", () => {
  const sweep = file("2026-10-03T06:00:00Z", [
    row("vidlink", "healthy"),
    row("hianime", "blocked"),
    row("youtube", "healthy"),
  ]);
  const history: StatusHistory = {
    schemaVersion: 1,
    days: [
      { day: "2026-10-02", providers: { vidlink: "healthy" } },
      { day: "2026-10-03", providers: { vidlink: "blocked" } },
    ],
  };
  const board = buildBoard({ providers: codeMetadata.providers, file: sweep, history, now: NOW });

  test("lists every registered provider exactly once, whether or not the sweep saw it", () => {
    const ids = board.groups.flatMap((group) => group.rows.map((r) => r.id));
    expect(ids.sort()).toEqual([...codeMetadata.providerIds].sort());
    expect(board.total).toBe(codeMetadata.providers.length);
  });

  test("a provider with no result is Not checked, not omitted and not assumed fine", () => {
    const vidrock = board.groups.flatMap((group) => group.rows).find((r) => r.id === "vidrock");
    expect(vidrock?.status).toBe("unchecked");
    expect(vidrock?.sweep).toBeNull();
    expect(board.counts.unchecked).toBe(codeMetadata.providers.length - 3);
  });

  test("the counts add up to the total", () => {
    const sum = Object.values(board.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(board.total);
    expect(board.counts.healthy).toBe(2);
    expect(board.counts.blocked).toBe(1);
  });

  test("groups follow the CLI's modes in Tab order and hold the providers that serve them", () => {
    expect(board.groups.map((group) => group.mode.id)).toEqual(["series", "anime", "youtube"]);
    for (const group of board.groups) {
      for (const r of group.rows) {
        const meta = codeMetadata.providers.find((p) => p.id === r.id);
        expect(meta && modeOf(meta).id).toBe(group.mode.id);
      }
    }
  });

  test("within a group the order is the registry's, so the page does not reshuffle as states change", () => {
    const series = board.groups.find((group) => group.mode.id === "series");
    const registry = codeMetadata.providers
      .filter((p) => modeOf(p).id === "series")
      .map((p) => p.id);
    expect(series?.rows.map((r) => r.id)).toEqual(registry);
  });

  test("carries each provider's strip and its healthy-day count", () => {
    const vidlink = board.groups.flatMap((group) => group.rows).find((r) => r.id === "vidlink");
    expect(vidlink?.strip).toHaveLength(30);
    expect(vidlink?.recordedDays).toBe(2);
    expect(vidlink?.healthyDays).toBe(1);
  });
});

describe("state meanings", () => {
  test("every state, including the unknown one, says what it means", () => {
    for (const state of ["healthy", "degraded", "blocked", "down", "dead", "unchecked"] as const) {
      expect(STATUS_MEANING[state].label.length).toBeGreaterThan(2);
      expect(STATUS_MEANING[state].meaning.length).toBeGreaterThan(20);
    }
  });
});

describe("status colours", () => {
  // Each state's text sits on a tint of its own colour over the card. Measured, not
  // estimated: the tokens are read from the stylesheet the page actually uses.
  const tokens = fs.readFileSync(
    path.resolve(import.meta.dir, "../app/styles/tokens.css"),
    "utf-8",
  );

  function token(name: string): string {
    const match = tokens.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!match?.[1]) throw new Error(`token ${name} not found`);
    return match[1];
  }

  function channels(hex: string) {
    const part = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);
    return [part(1), part(3), part(5)] as const;
  }

  function luminance([r, g, b]: readonly [number, number, number]): number {
    const lin = (c: number) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function contrast(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
  ): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  }

  const card = channels("#1c1620");

  test.each(["--kunai-ok", "--kunai-warning", "--kunai-info", "--kunai-danger", "--kunai-gated"])(
    "%s reads at 4.5:1 on its own 14% tint over the card",
    (name) => {
      const fg = channels(token(name));
      const mix = (base: number, tint: number) => Math.round(base * 0.86 + tint * 0.14);
      const bg = [mix(card[0], fg[0]), mix(card[1], fg[1]), mix(card[2], fg[2])] as const;
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("currentStreak", () => {
  const day = (d: string, status: "healthy" | "blocked" | "dead") => ({
    day: d,
    providers: { vidlink: status },
  });

  test("counts consecutive recorded days in the latest state", () => {
    const history: StatusHistory = {
      schemaVersion: 1,
      days: [
        day("2026-10-01", "blocked"),
        day("2026-10-02", "healthy"),
        day("2026-10-03", "healthy"),
      ],
    };
    expect(currentStreak(history, "vidlink")).toEqual({ status: "healthy", days: 2 });
  });

  test("a change of state ends it", () => {
    const history: StatusHistory = {
      schemaVersion: 1,
      days: [day("2026-10-01", "healthy"), day("2026-10-02", "dead")],
    };
    expect(currentStreak(history, "vidlink")).toEqual({ status: "dead", days: 1 });
  });

  test("a day nobody checked ends it: it never spans a gap", () => {
    // Healthy on the 1st and the 3rd says nothing about the 2nd.
    const history: StatusHistory = {
      schemaVersion: 1,
      days: [day("2026-10-01", "healthy"), day("2026-10-03", "healthy")],
    };
    expect(currentStreak(history, "vidlink")).toEqual({ status: "healthy", days: 1 });
  });

  test("counts across a month boundary", () => {
    const history: StatusHistory = {
      schemaVersion: 1,
      days: [
        day("2026-09-29", "healthy"),
        day("2026-09-30", "healthy"),
        day("2026-10-01", "healthy"),
      ],
    };
    expect(currentStreak(history, "vidlink")?.days).toBe(3);
  });

  test("is null for a provider the history never mentions", () => {
    expect(
      currentStreak({ schemaVersion: 1, days: [day("2026-10-01", "healthy")] }, "ghost"),
    ).toBeNull();
    expect(currentStreak({ schemaVersion: 1, days: [] }, "vidlink")).toBeNull();
  });
});

describe("uptimePercent", () => {
  test("is the share of recorded days that were healthy, rounded", () => {
    expect(uptimePercent(29, 30)).toBe(97);
    expect(uptimePercent(0, 4)).toBe(0);
    expect(uptimePercent(1, 3)).toBe(33);
  });

  test("is null when nothing is recorded, never 0% or 100%", () => {
    expect(uptimePercent(0, 0)).toBeNull();
  });

  test("a percentage needs a week of history before it is worth printing", () => {
    expect(UPTIME_MIN_DAYS).toBe(7);
  });
});

describe("overallStatus", () => {
  function board(counts: Partial<Record<BoardStatus, number>>): Board {
    const full = {
      healthy: 0,
      degraded: 0,
      blocked: 0,
      down: 0,
      dead: 0,
      unchecked: 0,
      ...counts,
    } satisfies Record<BoardStatus, number>;
    return { groups: [], counts: full, total: Object.values(full).reduce((a, b) => a + b, 0) };
  }
  const fresh = { state: "fresh", hours: 3 } as const;

  test("a stale board never claims anything about providers", () => {
    // Three-week-old results were once presented as current. This is the answer to that.
    const verdict = overallStatus(board({ healthy: 8 }), { state: "stale", hours: 300 });
    expect(verdict.tone).toBe("unknown");
    expect(verdict.headline).toBe("This board is out of date");
    expect(verdict.detail).toContain("history");
  });

  test("says everything works only when every checked provider resolved", () => {
    expect(overallStatus(board({ healthy: 5 }), fresh)).toMatchObject({
      tone: "good",
      headline: "Every checked provider is working",
    });
  });

  test("is mostly good at 60% and above, and mixed below it", () => {
    expect(overallStatus(board({ healthy: 3, blocked: 2 }), fresh).tone).toBe("good");
    expect(overallStatus(board({ healthy: 2, blocked: 3 }), fresh)).toMatchObject({
      tone: "mixed",
      headline: "Some providers are struggling",
    });
  });

  test("is bad when none resolved, and says that can be the check's network", () => {
    const verdict = overallStatus(board({ blocked: 3, dead: 1 }), fresh);
    expect(verdict.tone).toBe("bad");
    expect(verdict.detail).toContain("network");
  });

  test("not-checked providers are left out of the ratio and mentioned on their own", () => {
    const verdict = overallStatus(board({ healthy: 3, unchecked: 4 }), fresh);
    expect(verdict.headline).toBe("Every checked provider is working");
    expect(verdict.detail).toContain("4 providers have no result yet");
  });

  test("a board with nothing checked says so instead of dividing by zero", () => {
    expect(overallStatus(board({ unchecked: 12 }), fresh).headline).toBe(
      "Nothing has been checked yet",
    );
  });
});

describe("donutSlices", () => {
  const order: readonly BoardStatus[] = [
    "healthy",
    "degraded",
    "blocked",
    "down",
    "dead",
    "unchecked",
  ];
  const counts = (partial: Partial<Record<BoardStatus, number>>) => ({
    healthy: 0,
    degraded: 0,
    blocked: 0,
    down: 0,
    dead: 0,
    unchecked: 0,
    ...partial,
  });

  test("gives each present state a slice proportional to its count", () => {
    const slices = donutSlices(counts({ healthy: 3, blocked: 1 }), order);
    expect(slices.map((slice) => slice.status)).toEqual(["healthy", "blocked"]);
    const [first, second] = slices;
    expect((first?.to ?? 0) - (first?.from ?? 0)).toBeCloseTo(
      3 * ((second?.to ?? 0) - (second?.from ?? 0)),
      5,
    );
  });

  test("leaves a gap between slices and fills the whole turn", () => {
    const slices = donutSlices(counts({ healthy: 1, down: 1, dead: 2 }), order);
    for (let index = 1; index < slices.length; index += 1) {
      expect((slices[index]?.from ?? 0) - (slices[index - 1]?.to ?? 0)).toBeGreaterThan(0);
    }
    expect(slices.at(-1)?.to).toBeLessThanOrEqual(360);
  });

  test("keeps the states in the given order, so one holds its place from day to day", () => {
    const slices = donutSlices(counts({ dead: 1, healthy: 1, blocked: 1 }), order);
    expect(slices.map((slice) => slice.status)).toEqual(["healthy", "blocked", "dead"]);
  });

  test("one state is a full ring with no gap to leave", () => {
    expect(donutSlices(counts({ healthy: 4 }), order)).toEqual([
      { status: "healthy", from: 0, to: 360 },
    ]);
  });

  test("an empty board has no slices", () => {
    expect(donutSlices(counts({}), order)).toEqual([]);
  });
});
