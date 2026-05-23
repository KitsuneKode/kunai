import { palette } from "./shell-theme";
import type { BrowseIdleContext, ShellAction } from "./types";

export function resolveIdleContinueAction(idleContext: BrowseIdleContext | undefined): ShellAction {
  return idleContext?.continueWatching?.titleId ? "resume-continue-watching" : "continue";
}

export type BrowseIdleReturnLoopRow = {
  readonly id: string;
  readonly glyph: string;
  readonly glyphColor: string;
  readonly title: string;
  readonly meta?: string;
  readonly hint?: string;
  readonly focused: boolean;
};

export type BrowseIdleReturnLoopModel = {
  readonly rows: readonly BrowseIdleReturnLoopRow[];
  readonly hasSelectableContinue: boolean;
};

export function buildBrowseIdleReturnLoopModel(
  idleContext: BrowseIdleContext | undefined,
  options: { readonly idleFocused: boolean },
): BrowseIdleReturnLoopModel | null {
  if (!idleContext) return null;

  const rows: BrowseIdleReturnLoopRow[] = [];

  if (idleContext.continueWatching && !idleContext.playlistNext) {
    const cw = idleContext.continueWatching;
    const meta = [cw.ep, cw.remainingLabel].filter(Boolean).join(" · ");
    rows.push({
      id: "continue",
      glyph: "⏸",
      glyphColor: palette.accent,
      title: cw.title,
      meta: meta.length > 0 ? meta : undefined,
      hint: options.idleFocused ? "↵ resume first" : cw.titleId ? "↓ to select" : undefined,
      focused: options.idleFocused,
    });
  }

  if (idleContext.playlistNext) {
    const next = idleContext.playlistNext;
    rows.push({
      id: "playlist-next",
      glyph: "▶",
      glyphColor: palette.ok,
      title: next.title,
      meta: next.ep,
      hint: "up next in playlist",
      focused: false,
    });
  }

  const readyCount = idleContext.todayReleaseCount ?? 0;
  if (readyCount > 0) {
    rows.push({
      id: "ready-now",
      glyph: "✓",
      glyphColor: palette.ok,
      title:
        readyCount === 1
          ? "1 episode ready for you now"
          : `${readyCount} episodes ready for you now`,
      meta: "source confirmed",
      hint: "/calendar for schedule · /notifications for alerts",
      focused: false,
    });
  }

  if (rows.length === 0) return null;

  return {
    rows,
    hasSelectableContinue: Boolean(idleContext.continueWatching?.titleId),
  };
}
