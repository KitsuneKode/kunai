import { isJsonNumber, isJsonObject, isJsonString, type JsonValue } from "@kunai/types";

import type { ProviderMetadata } from "./code-metadata";
import seedHistory from "./generated-provider-status-history.json";
import seedStatus from "./generated-provider-status.json";
import { BENTO_MODES, type BentoMode, servesMode } from "./home-bento";
import seedNotices from "./status-notices.json";

/**
 * The provider status model: what the daily sweep reports, what the page shows.
 *
 * Three small documents feed the page, each with a bundled seed and a live copy:
 *
 * - the latest result per provider (`generated-provider-status.json`),
 * - one status per provider per day (`generated-provider-status-history.json`), and
 * - maintainer notices (`status-notices.json`): a hand-written line about an
 *   incident or a known problem, posted by editing one file, with no release.
 *
 * The live copies come from the `status-data` branch (`provider-status-live.ts`)
 * and are external data, so each is parsed and validated here before it is trusted.
 * A document that does not fit is rejected whole and the bundled seed is used: a
 * board drawn from a half-parsed file would misstate providers it claims to know.
 *
 * Everything below `parse*` is pure, so the rules (how fresh is fresh, what a
 * strip is, how providers group) are tested without a network or a clock.
 */

export type ProviderSweepStatus = "healthy" | "degraded" | "blocked" | "down" | "dead";

/** A provider the sweep has no result for is shown as such, never omitted. */
export type BoardStatus = ProviderSweepStatus | "unchecked";

export type ProviderStatusRow = {
  readonly id: string;
  readonly upstreamHttp: number | null;
  readonly upstreamReachable: boolean;
  readonly resolveStatus: string;
  readonly resolveMs: number | null;
  readonly streams: number;
  readonly qualities: readonly string[];
  readonly servers: readonly string[];
  readonly audioLanguages: readonly string[];
  readonly subtitleLanes: number;
  readonly effectiveStatus: ProviderSweepStatus;
  readonly note: string;
};

export type ProviderStatusFile = {
  readonly generatedAt: string;
  readonly schemaVersion: 1;
  readonly providers: readonly ProviderStatusRow[];
};

export type StatusHistoryDay = {
  /** UTC calendar day, `YYYY-MM-DD`. */
  readonly day: string;
  readonly providers: Readonly<Record<string, ProviderSweepStatus>>;
};

export type StatusHistory = {
  readonly schemaVersion: 1;
  /** Oldest first. */
  readonly days: readonly StatusHistoryDay[];
};

export type NoticeLevel = "info" | "warning" | "incident";

export type StatusNotice = {
  readonly id: string;
  readonly level: NoticeLevel;
  readonly title: string;
  readonly body: string;
  /** Provider ids the notice is about; empty means the whole project. */
  readonly providers: readonly string[];
  /** ISO timestamp it starts showing. */
  readonly since: string;
  /** ISO timestamp it stops showing, or null to show until removed. */
  readonly until: string | null;
};

export type StatusNotices = {
  readonly schemaVersion: 1;
  readonly notices: readonly StatusNotice[];
};

const SWEEP_STATUSES: ReadonlySet<string> = new Set([
  "healthy",
  "degraded",
  "blocked",
  "down",
  "dead",
]);
const NOTICE_LEVELS: ReadonlySet<string> = new Set(["info", "warning", "incident"]);

function isSweepStatus(value: string): value is ProviderSweepStatus {
  return SWEEP_STATUSES.has(value);
}

function isNoticeLevel(value: string): value is NoticeLevel {
  return NOTICE_LEVELS.has(value);
}

function stringList(value: JsonValue | undefined): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (!isJsonString(item)) return null;
    out.push(item);
  }
  return out;
}

function parseRow(raw: JsonValue): ProviderStatusRow | null {
  if (!isJsonObject(raw)) return null;
  const { id, resolveStatus, effectiveStatus, note, upstreamHttp, resolveMs } = raw;
  if (!isJsonString(id) || id.length === 0) return null;
  if (!isJsonString(resolveStatus) || !isJsonString(note)) return null;
  if (!isJsonString(effectiveStatus) || !isSweepStatus(effectiveStatus)) return null;
  const qualities = stringList(raw.qualities);
  const servers = stringList(raw.servers);
  const audioLanguages = stringList(raw.audioLanguages);
  if (!qualities || !servers || !audioLanguages) return null;
  if (!isJsonNumber(raw.streams) || !isJsonNumber(raw.subtitleLanes)) return null;
  const reachable = raw.upstreamReachable;
  if (reachable !== true && reachable !== false) return null;
  return {
    id,
    upstreamHttp: isJsonNumber(upstreamHttp) ? upstreamHttp : null,
    upstreamReachable: reachable,
    resolveStatus,
    resolveMs: isJsonNumber(resolveMs) ? resolveMs : null,
    streams: raw.streams,
    qualities,
    servers,
    audioLanguages,
    subtitleLanes: raw.subtitleLanes,
    effectiveStatus,
    note,
  };
}

/** Validate the latest-results document, or null if any part of it does not fit. */
export function parseStatusFile(raw: JsonValue): ProviderStatusFile | null {
  if (!isJsonObject(raw) || raw.schemaVersion !== 1) return null;
  if (!isJsonString(raw.generatedAt) || Number.isNaN(Date.parse(raw.generatedAt))) return null;
  if (!Array.isArray(raw.providers)) return null;
  const providers: ProviderStatusRow[] = [];
  for (const entry of raw.providers) {
    const row = parseRow(entry);
    if (!row) return null;
    providers.push(row);
  }
  return { generatedAt: raw.generatedAt, schemaVersion: 1, providers };
}

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Validate the history document, or null if any part of it does not fit. */
export function parseHistory(raw: JsonValue): StatusHistory | null {
  if (!isJsonObject(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.days)) return null;
  const days: StatusHistoryDay[] = [];
  for (const entry of raw.days) {
    if (!isJsonObject(entry) || !isJsonString(entry.day) || !isDay(entry.day)) return null;
    if (!isJsonObject(entry.providers)) return null;
    const providers: Record<string, ProviderSweepStatus> = {};
    for (const [id, status] of Object.entries(entry.providers)) {
      if (!isJsonString(status) || !isSweepStatus(status)) return null;
      providers[id] = status;
    }
    days.push({ day: entry.day, providers });
  }
  days.sort((a, b) => a.day.localeCompare(b.day));
  return { schemaVersion: 1, days };
}

function parseNotice(raw: JsonValue): StatusNotice | null {
  if (!isJsonObject(raw)) return null;
  const { id, level, title, body, since, until } = raw;
  if (!isJsonString(id) || id.length === 0) return null;
  if (!isJsonString(level) || !isNoticeLevel(level)) return null;
  if (!isJsonString(title) || title.length === 0 || !isJsonString(body)) return null;
  if (!isJsonString(since) || Number.isNaN(Date.parse(since))) return null;
  if (until !== null && until !== undefined) {
    if (!isJsonString(until) || Number.isNaN(Date.parse(until))) return null;
  }
  const providers = raw.providers === undefined ? [] : stringList(raw.providers);
  if (!providers) return null;
  return {
    id,
    level,
    title,
    body,
    providers,
    since,
    until: isJsonString(until) ? until : null,
  };
}

/** Validate the notices document, or null if any part of it does not fit. */
export function parseNotices(raw: JsonValue): StatusNotices | null {
  if (!isJsonObject(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.notices)) return null;
  const notices: StatusNotice[] = [];
  for (const entry of raw.notices) {
    const notice = parseNotice(entry);
    if (!notice) return null;
    notices.push(notice);
  }
  return { schemaVersion: 1, notices };
}

// The bundled seeds are committed files the sweep and a maintainer wrote; they go
// through the same parsers as live data, so a malformed seed fails loudly in tests
// rather than silently at runtime.
export const bundledStatus: ProviderStatusFile = parseStatusFile(seedStatus) ?? {
  generatedAt: new Date(0).toISOString(),
  schemaVersion: 1,
  providers: [],
};
export const bundledHistory: StatusHistory = parseHistory(seedHistory) ?? {
  schemaVersion: 1,
  days: [],
};
export const bundledNotices: StatusNotices = parseNotices(seedNotices) ?? {
  schemaVersion: 1,
  notices: [],
};

/** Kept for the callers that read the seed directly. */
export const providerStatus: ProviderStatusFile = bundledStatus;

// ---------------------------------------------------------------------------------
// Choosing between the live copy and the bundled one
// ---------------------------------------------------------------------------------

export type StatusSource = "live" | "bundled";

export type ChosenStatus = {
  readonly file: ProviderStatusFile;
  readonly source: StatusSource;
};

/** The newer of two result files. A tie goes to the live one, which is the fresher read. */
export function chooseStatus(
  bundled: ProviderStatusFile,
  live: ProviderStatusFile | null,
): ChosenStatus {
  if (live && Date.parse(live.generatedAt) >= Date.parse(bundled.generatedAt)) {
    return { file: live, source: "live" };
  }
  return { file: bundled, source: "bundled" };
}

/** The history with the newest last day. */
export function chooseHistory(bundled: StatusHistory, live: StatusHistory | null): StatusHistory {
  const newest = (history: StatusHistory) => history.days.at(-1)?.day ?? "";
  if (live && newest(live) >= newest(bundled)) return live;
  return bundled;
}

// ---------------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------------

/** A daily sweep that has not reported inside this is late. */
export const LATE_AFTER_HOURS = 30;
/** One that has not reported inside this is not running, and the page says so. */
export const STALE_AFTER_HOURS = 72;

export type Freshness = {
  /** `fresh`: on schedule. `late`: a day overdue. `stale`: the sweep is not running. */
  readonly state: "fresh" | "late" | "stale";
  readonly hours: number;
};

/**
 * How current a result is. The sweep runs once a day and the window allows for
 * its schedule slipping, so "fresh" is inside thirty hours, not twenty-four.
 */
export function freshness(generatedAt: string, now: number): Freshness {
  const then = Date.parse(generatedAt);
  if (Number.isNaN(then)) return { state: "stale", hours: Number.POSITIVE_INFINITY };
  const hours = Math.max(0, (now - then) / 3_600_000);
  if (hours <= LATE_AFTER_HOURS) return { state: "fresh", hours };
  if (hours <= STALE_AFTER_HOURS) return { state: "late", hours };
  return { state: "stale", hours };
}

/** "3 hours ago", "2 days ago". */
export function describeAge(hours: number): string {
  if (!Number.isFinite(hours)) return "at an unknown time";
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) {
    const whole = Math.round(hours);
    return `${whole} ${whole === 1 ? "hour" : "hours"} ago`;
  }
  return `${Math.round(hours / 24)} days ago`;
}

// ---------------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------------

/** The notices that are showing now: started, and not yet ended. */
export function activeNotices(notices: StatusNotices, now: number): readonly StatusNotice[] {
  return notices.notices.filter((notice) => {
    if (Date.parse(notice.since) > now) return false;
    return notice.until === null || Date.parse(notice.until) > now;
  });
}

// ---------------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------------

/** One day in a provider's strip: its status, or null where no sweep recorded it. */
export type StripCell = {
  readonly day: string;
  readonly status: ProviderSweepStatus | null;
};

/** Days shown in a strip. */
export const STRIP_DAYS = 30;

const DAY_MS = 86_400_000;

/** The UTC day `days` before `day`. */
function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * A provider's last `days` days ending on `endDay`, oldest first. A day with no
 * recorded sweep is a null cell, not a guessed one: a gap in the strip is a day
 * nobody checked, which is different from a day it was fine.
 */
export function stripFor(
  history: StatusHistory,
  providerId: string,
  endDay: string,
  days: number = STRIP_DAYS,
): readonly StripCell[] {
  const byDay = new Map(history.days.map((entry) => [entry.day, entry.providers]));
  const cells: StripCell[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = shiftDay(endDay, -back);
    cells.push({ day, status: byDay.get(day)?.[providerId] ?? null });
  }
  return cells;
}

export type Streak = {
  readonly status: ProviderSweepStatus;
  /** Consecutive recorded days it has held that status, ending on the latest one. */
  readonly days: number;
};

/**
 * How long a provider has been in its latest recorded state.
 *
 * Walks back from the newest day it was recorded and counts while the status holds
 * AND the days are consecutive on the calendar. A gap ends the streak: a day nobody
 * checked is not a day the provider is known to have been fine, so "healthy for nine
 * days" never spans one. Reads the whole history, not just the strip's thirty days.
 */
export function currentStreak(history: StatusHistory, providerId: string): Streak | null {
  const recorded = history.days.filter((entry) => entry.providers[providerId] !== undefined);
  const latest = recorded.at(-1);
  const status = latest?.providers[providerId];
  if (!latest || !status) return null;
  let days = 1;
  let expected = shiftDay(latest.day, -1);
  for (let index = recorded.length - 2; index >= 0; index -= 1) {
    const entry = recorded[index];
    if (!entry || entry.day !== expected || entry.providers[providerId] !== status) break;
    days += 1;
    expected = shiftDay(entry.day, -1);
  }
  return { status, days };
}

/** Whole-number percentage of recorded days that were healthy, or null with nothing recorded. */
export function uptimePercent(healthyDays: number, recordedDays: number): number | null {
  if (recordedDays <= 0) return null;
  return Math.round((healthyDays / recordedDays) * 100);
}

/**
 * Days of history before an uptime percentage is worth printing. One good day is
 * "100% uptime" and means nothing, so below this the page prints the streak instead.
 */
export const UPTIME_MIN_DAYS = 7;

export type BoardRow = {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly recommended: boolean;
  readonly status: BoardStatus;
  /** The sweep's full result, or null when the provider has none. */
  readonly sweep: ProviderStatusRow | null;
  readonly strip: readonly StripCell[];
  /** Days in the strip the provider was healthy, and days that were recorded at all. */
  readonly healthyDays: number;
  readonly recordedDays: number;
  /** How long it has been in its current state, or null when nothing is recorded. */
  readonly streak: Streak | null;
};

export type BoardGroup = {
  readonly mode: BentoMode;
  readonly rows: readonly BoardRow[];
};

export type Board = {
  readonly groups: readonly BoardGroup[];
  readonly counts: Readonly<Record<BoardStatus, number>>;
  readonly total: number;
};

/** The mode a provider is listed under: the first the CLI's modes say it serves. */
export function modeOf(provider: Pick<ProviderMetadata, "mediaKinds">): BentoMode {
  const probe = { kinds: provider.mediaKinds };
  return BENTO_MODES.find((mode) => servesMode(probe, mode)) ?? BENTO_MODES[0] ?? FALLBACK_MODE;
}

const FALLBACK_MODE: BentoMode = {
  id: "series",
  label: "Series & movies",
  commandId: "series-mode",
  alias: "series",
  kinds: ["series", "movie"],
};

/**
 * Every registered provider, grouped by the mode it serves, with its result and its
 * strip. Built from the registered list, not from the sweep file, so a provider the
 * sweep has no result for appears as "not checked" instead of vanishing: a missing
 * row reads as a clean bill of health, and an unchecked one must not.
 *
 * Within a group the order is the registry's, which is stable day to day. Sorting by
 * status would reshuffle the page every time a provider changed state.
 */
export function buildBoard(input: {
  readonly providers: readonly ProviderMetadata[];
  readonly file: ProviderStatusFile;
  readonly history: StatusHistory;
  readonly now: number;
}): Board {
  const endDay = new Date(input.now).toISOString().slice(0, 10);
  const sweepById = new Map(input.file.providers.map((row) => [row.id, row]));
  const counts = {
    healthy: 0,
    degraded: 0,
    blocked: 0,
    down: 0,
    dead: 0,
    unchecked: 0,
  } satisfies Record<BoardStatus, number>;

  const rowsByMode = new Map<BentoMode["id"], BoardRow[]>();
  for (const provider of input.providers) {
    const mode = modeOf(provider);
    const sweep = sweepById.get(provider.id) ?? null;
    const status: BoardStatus = sweep ? sweep.effectiveStatus : "unchecked";
    const strip = stripFor(input.history, provider.id, endDay);
    counts[status] += 1;
    const row: BoardRow = {
      id: provider.id,
      name: provider.displayName,
      domain: provider.domain,
      recommended: provider.recommended,
      status,
      sweep,
      strip,
      healthyDays: strip.filter((cell) => cell.status === "healthy").length,
      recordedDays: strip.filter((cell) => cell.status !== null).length,
      streak: currentStreak(input.history, provider.id),
    };
    rowsByMode.set(mode.id, [...(rowsByMode.get(mode.id) ?? []), row]);
  }

  const groups = BENTO_MODES.map((mode) => ({ mode, rows: rowsByMode.get(mode.id) ?? [] })).filter(
    (group) => group.rows.length > 0,
  );
  return { groups, counts, total: input.providers.length };
}

export type OverallTone = "good" | "mixed" | "bad" | "unknown";

export type Overall = {
  readonly tone: OverallTone;
  readonly headline: string;
  readonly detail: string;
};

/**
 * One honest sentence about the whole board: the first thing a visitor reads.
 *
 * A stale board gets its own answer before anything about providers, because a
 * confident "everything is working" drawn from three-week-old results is the exact
 * failure this page was rebuilt to stop. Otherwise it is judged on the providers the
 * check actually saw: "not checked" is neither good nor bad, so it is left out of
 * the ratio and mentioned on its own.
 */
export function overallStatus(board: Board, fresh: Freshness): Overall {
  const checked = board.total - board.counts.unchecked;
  const unchecked =
    board.counts.unchecked > 0
      ? ` ${board.counts.unchecked} ${board.counts.unchecked === 1 ? "provider has" : "providers have"} no result yet.`
      : "";

  if (fresh.state === "stale") {
    return {
      tone: "unknown",
      headline: "This board is out of date",
      detail: `The daily check has stopped reporting, so these results are history, not how providers are now.${unchecked}`,
    };
  }
  if (checked === 0) {
    return {
      tone: "unknown",
      headline: "Nothing has been checked yet",
      detail: "The daily check has no results to show.",
    };
  }
  const healthy = board.counts.healthy;
  if (healthy === checked) {
    return {
      tone: "good",
      headline: "Every checked provider is working",
      detail: `All ${checked} resolved a stream in the last check.${unchecked}`,
    };
  }
  if (healthy === 0) {
    return {
      tone: "bad",
      headline: "No provider resolved in the last check",
      detail: `That can be real, or the network the check runs from being turned away. Try another provider, or your own relay.${unchecked}`,
    };
  }
  const mostly = healthy / checked >= 0.6;
  return {
    tone: mostly ? "good" : "mixed",
    headline: mostly ? "Most providers are working" : "Some providers are struggling",
    detail: `${healthy} of ${checked} checked providers resolved a stream. Kunai moves to the next one on its own when a provider fails.${unchecked}`,
  };
}

/** The slices of the donut: a status and its share of a full turn, in degrees. */
export type DonutSlice = {
  readonly status: BoardStatus;
  readonly from: number;
  readonly to: number;
};

/** Degrees of empty space between slices, so neighbours read as separate. */
const DONUT_GAP = 3;

/**
 * Slices for the overview ring, in the order the states are listed. A state with no
 * providers has no slice; a single state is a full ring with no gap to leave. The
 * order is fixed so a state keeps its place around the ring from day to day.
 */
export function donutSlices(
  counts: Readonly<Record<BoardStatus, number>>,
  order: readonly BoardStatus[],
): readonly DonutSlice[] {
  const present = order.filter((status) => counts[status] > 0);
  const total = present.reduce((sum, status) => sum + counts[status], 0);
  if (total === 0) return [];
  if (present.length === 1 && present[0]) return [{ status: present[0], from: 0, to: 360 }];
  const usable = 360 - DONUT_GAP * present.length;
  let cursor = 0;
  return present.map((status) => {
    const span = (counts[status] / total) * usable;
    const slice = { status, from: cursor, to: cursor + span };
    cursor += span + DONUT_GAP;
    return slice;
  });
}

/** What each state means, in the words the page prints under its legend. */
export const STATUS_MEANING = {
  healthy: {
    label: "Healthy",
    meaning: "Reachable, and a real resolve returned playable streams.",
  },
  degraded: {
    label: "Degraded",
    meaning:
      "Reachable, but the resolve found nothing playable and gave no clear reason. Usually a key rotation or a partial outage.",
  },
  blocked: {
    label: "Region-gated",
    meaning:
      "Alive, but it challenges the network the check runs from. It often works from other regions or through your own relay.",
  },
  down: {
    label: "Maintenance",
    meaning: "The provider itself reports maintenance.",
  },
  dead: {
    label: "Unreachable",
    meaning:
      "The check could not connect. A single day can be a runner-side fault; several in a row is a real outage.",
  },
  unchecked: {
    label: "Not checked",
    meaning: "The daily check has no result for this provider yet. That says nothing either way.",
  },
} satisfies Record<BoardStatus, { label: string; meaning: string }>;
