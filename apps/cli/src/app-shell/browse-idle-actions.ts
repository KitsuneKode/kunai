import {
  formatReadyForYouNowMeta,
  RETURN_LOOP_FOR_YOU_NOW_HEADING,
  RETURN_LOOP_NAV_HINT,
} from "./return-loop-copy";
import { palette } from "./shell-theme";
import type { BrowseIdleContext, ShellAction } from "./types";

export function resolveIdleContinueAction(idleContext: BrowseIdleContext | undefined): ShellAction {
  return idleContext?.continueWatching?.titleId ? "resume-continue-watching" : "continue";
}

export function resolveIdleRowAction(
  rowId: string,
  idleContext: BrowseIdleContext | undefined,
): ShellAction | null {
  if (!idleContext) return null;
  switch (rowId) {
    case "continue":
      return resolveIdleContinueAction(idleContext);
    case "offline-ready":
      return idleContext.offlineReadyNext?.offlineJobId ? "play-offline-ready" : null;
    case "playlist-next":
      return idleContext.playlistNext?.titleId ? "play-queue-next" : null;
    case "ready-now":
      return (idleContext.todayReleaseCount ?? 0) > 0 ? "notifications" : null;
    case "calendar-nudge":
      return (idleContext.calendarNudge?.airingTodayCount ?? 0) > 0 ? "calendar" : null;
    default:
      return null;
  }
}

export type BrowseIdleReturnLoopRow = {
  readonly id: string;
  readonly glyph: string;
  readonly glyphColor: string;
  readonly title: string;
  readonly meta?: string;
  readonly hint?: string;
  readonly focused: boolean;
  readonly actionable: boolean;
};

export type BrowseIdleReturnLoopModel = {
  readonly heading: string;
  readonly rows: readonly BrowseIdleReturnLoopRow[];
  readonly hasSelectableContinue: boolean;
  readonly hasSelectableRows: boolean;
};

function idleRowHint(rowId: string, focused: boolean): string | undefined {
  if (!focused) return undefined;
  switch (rowId) {
    case "continue":
      return "↵ resume · m menu";
    case "offline-ready":
      return "↵ play offline";
    case "playlist-next":
      return "↵ play next · m menu";
    case "ready-now":
      return "↵ open notices";
    case "calendar-nudge":
      return "↵ open calendar";
    default:
      return undefined;
  }
}

export function buildBrowseIdleReturnLoopModel(
  idleContext: BrowseIdleContext | undefined,
  options: { readonly idleFocused: boolean; readonly selectedIndex?: number },
): BrowseIdleReturnLoopModel | null {
  if (!idleContext) return null;

  const selectedIndex = Math.max(0, options.selectedIndex ?? 0);
  const rows: BrowseIdleReturnLoopRow[] = [];

  if (idleContext.continueWatching) {
    const cw = idleContext.continueWatching;
    const meta = [cw.ep, cw.remainingLabel].filter(Boolean).join(" · ");
    const rowIndex = rows.length;
    rows.push({
      id: "continue",
      glyph: "⏸",
      glyphColor: palette.accent,
      title: cw.title,
      meta: meta.length > 0 ? meta : undefined,
      hint: idleRowHint("continue", options.idleFocused && selectedIndex === rowIndex),
      focused: options.idleFocused && selectedIndex === rowIndex,
      actionable: true,
    });
  }

  if (idleContext.offlineReadyNext) {
    const offline = idleContext.offlineReadyNext;
    const rowIndex = rows.length;
    rows.push({
      id: "offline-ready",
      glyph: "⬇",
      glyphColor: palette.ok,
      title: offline.title,
      meta: offline.ep ? `${offline.ep} · ready offline` : "ready offline",
      hint: idleRowHint("offline-ready", options.idleFocused && selectedIndex === rowIndex),
      focused: options.idleFocused && selectedIndex === rowIndex,
      actionable: Boolean(offline.offlineJobId),
    });
  }

  if (idleContext.playlistNext) {
    const next = idleContext.playlistNext;
    const rowIndex = rows.length;
    rows.push({
      id: "playlist-next",
      glyph: "▶",
      glyphColor: palette.ok,
      title: next.title,
      meta: next.ep,
      hint: idleRowHint("playlist-next", options.idleFocused && selectedIndex === rowIndex),
      focused: options.idleFocused && selectedIndex === rowIndex,
      actionable: Boolean(next.titleId),
    });
  }

  const readyCount = idleContext.todayReleaseCount ?? 0;
  if (readyCount > 0) {
    const titleCount = idleContext.todayReleaseTitleCount ?? 0;
    const rowIndex = rows.length;
    rows.push({
      id: "ready-now",
      glyph: "✦",
      glyphColor: palette.accent,
      title: "Unwatched releases",
      meta: formatReadyForYouNowMeta(readyCount, titleCount),
      hint:
        options.idleFocused && selectedIndex === rowIndex
          ? idleRowHint("ready-now", true)
          : RETURN_LOOP_NAV_HINT,
      focused: options.idleFocused && selectedIndex === rowIndex,
      actionable: true,
    });
  }

  const airingToday = idleContext.calendarNudge?.airingTodayCount ?? 0;
  if (airingToday > 0) {
    const rowIndex = rows.length;
    rows.push({
      id: "calendar-nudge",
      glyph: "◎",
      glyphColor: palette.muted,
      title: "On your schedule today",
      meta: airingToday === 1 ? "1 tracked title airing" : `${airingToday} tracked titles airing`,
      hint: idleRowHint("calendar-nudge", options.idleFocused && selectedIndex === rowIndex),
      focused: options.idleFocused && selectedIndex === rowIndex,
      actionable: true,
    });
  }

  if (rows.length === 0) return null;

  return {
    heading: RETURN_LOOP_FOR_YOU_NOW_HEADING,
    rows,
    hasSelectableContinue: Boolean(idleContext.continueWatching?.titleId),
    hasSelectableRows: rows.some((row) => row.actionable),
  };
}

export function countIdleReturnLoopRows(idleContext: BrowseIdleContext | undefined): number {
  return buildBrowseIdleReturnLoopModel(idleContext, { idleFocused: false })?.rows.length ?? 0;
}
