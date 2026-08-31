// =============================================================================
// setup-screens.tsx — the seven screens, each inside the Sakura frame
//
// Every screen asks something or pays something off. The old flow spent three
// of seven slides asking nothing, which is why it read as a slideshow.
// =============================================================================

import { Box, Text } from "ink";
import React from "react";

import { CompanionPet } from "../CompanionPet";
import { BLOOM_FRAMES, reducedMotionEnabled, STATIC_PETAL } from "../primitives/SakuraPetal";
import { palette } from "../shell-theme";
import type { ScopedDependencyRow } from "./dependency-rows";
import { ChoiceRow, ScreenTitle, ToggleRow, type FooterKey } from "./SetupFrame";

export const MODE_OPTIONS = [
  {
    value: "series" as const,
    label: "Shows & movies",
    detail: "TMDB catalog, series and films",
  },
  { value: "anime" as const, label: "Anime", detail: "AniList catalog, sub and dub" },
  { value: "youtube" as const, label: "YouTube", detail: "Search and play from YouTube" },
];

export const DOWNLOAD_QUALITIES = ["1080p", "best", "720p", "480p"] as const;

function stateGlyph(state: ScopedDependencyRow["state"]): string {
  if (state === "ok") return "✓";
  if (state === "blocking") return "✗";
  return "△";
}

function stateColor(state: ScopedDependencyRow["state"]): string {
  if (state === "ok") return palette.ok;
  if (state === "blocking") return palette.danger;
  return palette.warn;
}

/** Pads to a fixed cell budget so columns line up and rows never reflow. */
function pad(value: string, width: number): string {
  if (value.length === width) return value;
  if (value.length > width) return `${value.slice(0, Math.max(0, width - 1))}…`;
  return value.padEnd(width);
}

// ─── 1 · Dependencies ─────────────────────────────────────────────────────────

export function DependencyScreen({
  rows,
  selected,
  rechecking,
  tick,
  showFix,
  contentWidth = 84,
}: {
  readonly rows: readonly ScopedDependencyRow[];
  readonly selected: number;
  readonly rechecking: boolean;
  readonly tick: number;
  readonly showFix: boolean;
  /** Columns available inside the frame, from `setupContentWidth`. */
  readonly contentWidth?: number;
}) {
  // Budget the columns against the box, not the terminal. Overflowing rows do
  // not truncate in Ink — they wrap, which breaks alignment and inserts blank
  // lines between rows. The role column collapses first: it is the least
  // load-bearing of the three, and `01-shell-footer-contract.md` says to hide
  // supporting text before the thing being decided.
  const PREFIX = 4;
  const nameWidth = 18;
  const ROLE_WIDTH = 20;
  const MIN_DETAIL = 24;
  // Derived from what actually fits, not a round number: the role column earns
  // its place only once name and detail both have room.
  const roleWidth = contentWidth >= PREFIX + nameWidth + MIN_DETAIL + ROLE_WIDTH ? ROLE_WIDTH : 0;
  const detailWidth = Math.max(MIN_DETAIL, contentWidth - PREFIX - nameWidth - roleWidth - 1);
  const still = reducedMotionEnabled();
  // The petal belongs where the work is. It used to bloom on the *consent*
  // screen, under text the user was reading, while this screen — the only one
  // that actually probes anything — had no motion at all.
  const petal =
    rechecking && !still
      ? (BLOOM_FRAMES[tick % BLOOM_FRAMES.length] ?? STATIC_PETAL)
      : STATIC_PETAL;
  const active = rows[selected];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={rechecking ? palette.accent : palette.ok} bold>
          {petal}
        </Text>
        <Text color={palette.text} bold>
          {"  Let's get you watching"}
        </Text>
      </Box>
      <Box marginBottom={1} flexDirection="column">
        <Text color={palette.muted}>Kunai finds playable streams and hands them to mpv.</Text>
        <Text color={palette.muted}>
          {rechecking ? "Checking this machine again…" : "Here's what's on this machine."}
        </Text>
      </Box>

      <Box flexDirection="column">
        {rows.map((row, i) => {
          const isSelected = i === selected;
          return (
            <Box key={row.id} flexDirection="column">
              <Box backgroundColor={isSelected ? palette.accentFill : undefined}>
                <Text color={isSelected ? palette.accent : palette.dim}>
                  {isSelected ? "▌" : " "}
                </Text>
                <Text color={stateColor(row.state)} bold>
                  {` ${stateGlyph(row.state)} `}
                </Text>
                <Text color={row.state === "ok" ? palette.text : palette.textDim}>
                  {pad(row.name, nameWidth)}
                </Text>
                <Text color={palette.dim}>{pad(row.detail, detailWidth)}</Text>
                {roleWidth > 0 ? <Text color={palette.dim}>{pad(row.role, roleWidth)}</Text> : null}
              </Box>
              {isSelected && row.consequence ? (
                <Box paddingLeft={4}>
                  <Text color={palette.muted}>{row.consequence}</Text>
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>

      {showFix && active?.fix ? (
        <Box flexDirection="column" marginTop={1} paddingLeft={4}>
          <Text color={palette.muted}>{`Install ${active.name} on this machine`}</Text>
          <Text color={palette.accent}>{active.fix}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function dependencyFooter(hasFix: boolean): readonly FooterKey[] {
  return [
    { key: "enter", label: "continue" },
    ...(hasFix ? [{ key: "d", label: "how to fix" }] : []),
    { key: "r", label: "recheck" },
    { key: "S", label: "remaining defaults" },
    // The one destructive key the grammar names. Deeper screens rely on the
    // two-press guard; here quitting has cost nothing yet, so it is safe to show.
    { key: "esc", label: "quit" },
  ];
}

// ─── 2 · Mode ─────────────────────────────────────────────────────────────────

export function ModeScreen({ selected }: { readonly selected: number }) {
  return (
    <Box flexDirection="column">
      <ScreenTitle
        text="What do you watch most?"
        sub="Sets where Kunai starts. Every mode stays one keystroke away."
      />
      <Box flexDirection="column">
        {MODE_OPTIONS.map((option, i) => (
          <ChoiceRow
            key={option.value}
            label={option.label}
            detail={option.detail}
            selected={i === selected}
          />
        ))}
      </Box>
    </Box>
  );
}

// ─── 3 · Language ─────────────────────────────────────────────────────────────

/**
 * One column of the language screen. The header carries a `❯` when focused —
 * header color alone did not survive glare or color-blindness, and the arrow
 * keys move whichever column this marker names. The focused option's detail
 * renders under its label: the catalog's explanations were written for the
 * person deciding, and bare labels like "Pick each time" drop exactly the
 * context a first-run user needs (#233).
 */
function LanguageColumn({
  heading,
  focused,
  options,
  index,
}: {
  readonly heading: string;
  readonly focused: boolean;
  readonly options: readonly { value: string; label: string; detail: string }[];
  readonly index: number;
}) {
  const active = options[index];
  return (
    <Box flexDirection="column" width="48%">
      <Text color={focused ? palette.accent : palette.dim} bold>
        {focused ? "❯ " : "  "}
        {heading}
      </Text>
      {options.map((option, i) => (
        <Box key={option.value}>
          <Text
            color={
              focused && i === index
                ? palette.accent
                : i === index
                  ? palette.accentDim
                  : palette.dim
            }
          >
            {i === index ? "▌ " : "  "}
          </Text>
          <Text color={i === index ? palette.text : palette.muted}>{option.label}</Text>
        </Box>
      ))}
      {focused && active ? (
        <Box>
          <Text color={palette.dim}>{"  "}</Text>
          <Text color={palette.textDim}>↳ {active.detail}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function LanguageScreen({
  lanes,
  activeLane,
  profiles,
  audioOptions,
  subtitleOptions,
  audioIndex,
  subtitleIndex,
  focus,
}: {
  readonly lanes: readonly {
    readonly value: "series" | "movie" | "anime" | "youtube";
    readonly label: string;
  }[];
  readonly activeLane: "series" | "movie" | "anime" | "youtube";
  readonly profiles: Readonly<
    Record<"series" | "movie" | "anime" | "youtube", { audio: string; subtitle: string }>
  >;
  readonly audioOptions: readonly { value: string; label: string; detail: string }[];
  readonly subtitleOptions: readonly { value: string; label: string; detail: string }[];
  readonly audioIndex: number;
  readonly subtitleIndex: number;
  readonly focus: "audio" | "subtitle";
}) {
  return (
    <Box flexDirection="column">
      <ScreenTitle
        text="Language"
        sub="Each media type keeps its own defaults. Change either again per episode."
      />
      <Box marginBottom={1} gap={1} flexWrap="wrap">
        {lanes.map((lane) => {
          const active = lane.value === activeLane;
          const profile = profiles[lane.value];
          const audio = audioOptions.find((option) => option.value === profile.audio)?.label;
          const subtitle = subtitleOptions.find(
            (option) => option.value === profile.subtitle,
          )?.label;
          return (
            <Box key={lane.value} backgroundColor={active ? palette.accentFill : undefined}>
              <Text color={active ? palette.accent : palette.dim}>{active ? "▌ " : "  "}</Text>
              <Text color={active ? palette.text : palette.muted} bold={active}>
                {lane.label}
              </Text>
              <Text color={active ? palette.textDim : palette.dim}>
                {` ${audio ?? profile.audio}/${subtitle ?? profile.subtitle}`}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box gap={2}>
        <LanguageColumn
          heading="Audio"
          focused={focus === "audio"}
          options={audioOptions}
          index={audioIndex}
        />
        <LanguageColumn
          heading="Subtitles"
          focused={focus === "subtitle"}
          options={subtitleOptions}
          index={subtitleIndex}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={palette.textDim}>
          tab / shift-tab switches profile · ←→ picks audio or subtitles · ↑↓ chooses · a applies
          this profile to all
        </Text>
      </Box>
    </Box>
  );
}

// ─── 4 · Playback ─────────────────────────────────────────────────────────────

export type PlaybackToggles = {
  readonly autoNext: boolean;
  readonly skipIntro: boolean;
  readonly skipCredits: boolean;
};

export function PlaybackScreen({
  toggles,
  selected,
}: {
  readonly toggles: PlaybackToggles;
  readonly selected: number;
}) {
  const rows = [
    {
      key: "autoNext",
      label: "Play the next episode automatically",
      detail: "Keeps a binge going without a keystroke",
      on: toggles.autoNext,
    },
    {
      key: "skipIntro",
      label: "Skip intros",
      detail: "Uses AniSkip and IntroDB timings when they exist",
      on: toggles.skipIntro,
    },
    {
      key: "skipCredits",
      label: "Skip credits",
      detail: "Jumps the end card and rolls on",
      on: toggles.skipCredits,
    },
  ];

  return (
    <Box flexDirection="column">
      <ScreenTitle text="How playback should feel" sub="All three are easy to change later." />
      <Box flexDirection="column">
        {rows.map((row, i) => (
          <ToggleRow
            key={row.key}
            label={row.label}
            detail={row.detail}
            on={row.on}
            selected={i === selected}
          />
        ))}
      </Box>
    </Box>
  );
}

// ─── 5 · Library & accounts ───────────────────────────────────────────────────

export type LibraryToggles = {
  readonly downloadsEnabled: boolean;
  readonly downloadQuality: string;
  readonly connectAniList: boolean;
  readonly connectTmdb: boolean;
  readonly presenceDiscord: boolean;
};

export function LibraryScreen({
  toggles,
  selected,
  ytDlpReady,
  downloadPath,
}: {
  readonly toggles: LibraryToggles;
  readonly selected: number;
  readonly ytDlpReady: boolean;
  readonly downloadPath: string;
}) {
  return (
    <Box flexDirection="column">
      <ScreenTitle
        text="Downloads & accounts"
        sub="Accounts are linked after setup, so a browser hiccup never traps you here."
      />
      <Box flexDirection="column">
        <ToggleRow
          label="Download for offline"
          detail={downloadPath}
          on={toggles.downloadsEnabled}
          selected={selected === 0}
          {...(ytDlpReady
            ? {}
            : { disabledNote: "yt-dlp not found — install it, then turn this on" })}
        />
        <ToggleRow
          kind="cycle"
          label={`Download quality — ${toggles.downloadQuality}`}
          detail={`space cycles ${DOWNLOAD_QUALITIES.join(" · ")}`}
          on={toggles.downloadsEnabled}
          selected={selected === 1}
          // A cycle row under a switch that is off is a dead control; saying so
          // beats letting space spin a value nothing uses yet (#233).
          {...(toggles.downloadsEnabled
            ? {}
            : { disabledNote: "turn on downloads first — then space cycles quality" })}
        />
      </Box>

      <Box marginTop={1} marginBottom={0}>
        <Text color={palette.muted}>While we're here</Text>
      </Box>
      <Box flexDirection="column">
        <ToggleRow
          label="AniList"
          detail="Track watch progress on your list"
          on={toggles.connectAniList}
          selected={selected === 2}
        />
        <ToggleRow
          label="TMDB"
          detail="Track shows and films"
          on={toggles.connectTmdb}
          selected={selected === 3}
        />
        <ToggleRow
          label="Discord presence"
          detail="Show friends what you're watching"
          on={toggles.presenceDiscord}
          selected={selected === 4}
        />
      </Box>
    </Box>
  );
}

// ─── 7 · Done ─────────────────────────────────────────────────────────────────

export type SummaryLine = {
  readonly ok: boolean;
  readonly label: string;
  readonly detail: string;
};

export function DoneScreen({
  headline,
  summary,
  outstanding,
}: {
  readonly headline: string;
  readonly summary: readonly SummaryLine[];
  readonly outstanding: readonly SummaryLine[];
}) {
  return (
    <Box flexDirection="column">
      {/* The one screen in setup where she is the point rather than decoration:
          nothing here re-renders, there is vertical room, and it is the last
          thing seen before the shell opens. `idle` rather than the wizard's
          `wait` — the waiting is over. */}
      <Box marginBottom={1} flexDirection="row">
        <Box marginRight={2}>
          <CompanionPet pose="idle" rows={3} />
        </Box>
        <Box flexDirection="column">
          <Text color={palette.ok} bold>
            {STATIC_PETAL}
          </Text>
          <Text color={palette.text} bold>
            You're all set
          </Text>
          <Text color={palette.muted}>{headline}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {[...summary, ...outstanding].map((line) => (
          <Box key={line.label}>
            <Text color={line.ok ? palette.ok : palette.warn} bold>
              {line.ok ? "✓ " : "△ "}
            </Text>
            <Text color={palette.text}>{pad(line.label, 22)}</Text>
            <Text color={palette.muted}>{line.detail}</Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column">
        <Text color={palette.muted}>Try these first</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text color={palette.textDim}>
            type a title, or <Text color={palette.dim}>/discover · /calendar · /random</Text>
          </Text>
          <Text color={palette.textDim}>
            press <Text color={palette.accent}>/</Text> any time for commands
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
