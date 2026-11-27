// Browse on a first launch: the field is live before the picks are
//
// A never-onboarded install lands on recommendation picks. They used to be
// awaited before Browse mounted, so a cold cache showed a static welcome
// screen that took no typing until the catalog answered, and when they did
// arrive the list took the keyboard from under the search field. Here the
// picks load beneath a field that already has focus, and keep it.
//
// Board: `.reference/design/cli/kunai-onboarding-v4.html`.

import { Box, Text } from "ink";
import React from "react";

import type { BrowseFocusZone } from "./browse-focus-zone";
import { reducedMotionEnabled } from "./motion-policy";
import { plainModeEnabled } from "./plain-mode";
import { BLOOM_FRAMES, STATIC_PETAL, useFrameTick } from "./primitives/SakuraPetal";
import { SakuraLoader } from "./SakuraLoader";
import { palette } from "./shell-theme";

/** What to do while the picks load — each one a command the field accepts now. */
export const COLD_START_ACTIONS = [
  { command: "/trending", wide: "what is popular this week", narrow: "popular this week" },
  { command: "/calendar", wide: "what airs today", narrow: "airing today" },
  { command: "/random", wide: "pick something for me", narrow: "surprise me" },
] as const;

export const COLD_START_LABEL = "Finding something to watch…";

/**
 * Where focus lands when picks arrive. Picks the user asked for own the list;
 * picks that loaded on their own at startup never take the field.
 */
export function picksFocusZone(count: number, startup: boolean): BrowseFocusZone {
  return count > 0 && !startup ? "list" : "query";
}

/** The line under the search field, by what the field is doing. */
export function browseQueryHint(input: {
  readonly commandMode: boolean;
  readonly suggesting: boolean;
  readonly optionCount: number;
  readonly canFocusIdleRows: boolean;
  readonly listFocused: boolean;
  readonly queryEmpty: boolean;
  readonly loadingPicks: boolean;
}): string | undefined {
  if (input.commandMode) return undefined;
  if (input.suggesting) return "↓ suggestions · → complete · esc dismiss · ↵ search";
  if (input.loadingPicks) return "Type a title, then enter · no need to wait";
  if (input.optionCount === 0) {
    return input.canFocusIdleRows
      ? "Type a title · ↓ for you now · / commands"
      : "Type a title · / commands · /guide tour · /filters guided search";
  }
  if (input.listFocused) return "results own keys · Esc search";
  return input.queryEmpty ? "Type a title, then enter · ↓ picks" : "↓ results · / commands";
}

function ColdStart({ width }: { readonly width: number }) {
  const plain = plainModeEnabled();
  const tick = useFrameTick(true, 150);
  const petal = reducedMotionEnabled()
    ? STATIC_PETAL
    : (BLOOM_FRAMES[tick % BLOOM_FRAMES.length] ?? STATIC_PETAL);
  const narrow = width < 60;
  return (
    <Box flexDirection="column">
      <Box>
        {plain ? null : <Text color={palette.accent}>{`${petal}  `}</Text>}
        <Text color={palette.text}>{COLD_START_LABEL}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={palette.muted}>Or start here</Text>
        {COLD_START_ACTIONS.map((action) => (
          <Box key={action.command} paddingLeft={2}>
            <Text color={palette.accent}>{action.command.padEnd(11)}</Text>
            <Text color={palette.muted}>{narrow ? action.narrow : action.wide}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function loaderSublabel(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("trending")) return "Fetching what's popular right now";
  if (lower.includes("recommend")) return "Building picks from your watch history";
  return "Matching titles across the catalog · usually a few seconds";
}

/** The body of Browse while a list is loading. */
export function BrowseLoadingBlock({
  message,
  coldStart,
  width,
}: {
  readonly message: string;
  /** Picks loading on their own at startup, not a search the user is waiting on. */
  readonly coldStart: boolean;
  readonly width: number;
}) {
  if (coldStart) {
    return (
      <Box marginTop={1} flexGrow={1} flexDirection="column">
        <ColdStart width={width} />
      </Box>
    );
  }
  return (
    <Box marginTop={2} flexGrow={1} flexDirection="column">
      <SakuraLoader
        label={message.trim().length > 0 ? message.replace(/\.\.\.$/, "…") : "Loading…"}
        sublabel={loaderSublabel(message)}
        active
      />
    </Box>
  );
}

export const STARTUP_EMPTY_TITLE = "No picks to show right now";

/** The second line of the idle empty state, when the first one needs a gloss. */
export function browseEmptyDetail(
  mode: keyof typeof LANE_NOUN,
  message: string,
): string | undefined {
  if (message === STARTUP_EMPTY_TITLE) {
    return "Type a title to search. No connection? Check it, then run /discover.";
  }
  if (!message.includes("trending")) return undefined;
  if (mode === "youtube") {
    return "Use type:playlist|video|channel to narrow · /filters for guided facets";
  }
  return "Use year:2022 or mode:anime to narrow · /filters for guided facets";
}

const LANE_NOUN = { series: "shows & movies", anime: "anime", youtube: "YouTube" } as const;

/** `No results for "x" in <lane>` — the lane is the commonest reason for a miss. */
export function noResultsTitle(query: string, mode: keyof typeof LANE_NOUN): string {
  return `No results for "${query}" in ${LANE_NOUN[mode]}`;
}
