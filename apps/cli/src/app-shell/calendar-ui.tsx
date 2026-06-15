import type { BrowseShellOption } from "@/app-shell/types";
import { Box, Text } from "ink";
import React from "react";

import {
  CALENDAR_TYPE_TABS,
  calendarReleaseRowPresentation,
  compactCalendarStatusLabel,
  windowCalendarDayStrip,
  type CalendarDay,
  type CalendarTypeTab,
} from "./calendar-ui.model";
import { ClaudeTabRow } from "./primitives/ClaudeTabRow";
import { buildCalendarRowColumns, computeCalendarRowLayout } from "./primitives/list-row-layout";
import { ListRow } from "./primitives/ListRow";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import type { StateBlockModel } from "./primitives/StateBlock.model";
import { palette } from "./shell-theme";
import { usePosterPreview } from "./use-poster-preview";

/** Width reserved at the start of a schedule row for the mini-poster + new dot. */
const CALENDAR_ROW_LEAD_WIDTH = 7;

/**
 * Text mini-poster for a calendar row; falls back to title initials when no art.
 * The async poster fetch only runs for the focused row (`enabled`) — fetching one
 * per visible row caused navigation lag and dropped keypresses, since every scroll
 * remounted a dozen concurrent fetches. Unfocused rows render cheap initials.
 */
function CalendarMini({
  url,
  title,
  enabled,
}: {
  readonly url?: string;
  readonly title: string;
  readonly enabled: boolean;
}) {
  const { poster } = usePosterPreview(url, {
    rows: 2,
    cols: 4,
    enabled: enabled && Boolean(url),
    variant: "preview",
    inkEmbedded: true,
    preserveTerminalImages: true,
    debounceMs: 160,
  });
  if (poster.kind !== "none") return <Text>{poster.placeholder}</Text>;
  return <Text color={palette.dim}>{title.slice(0, 2).toUpperCase()}</Text>;
}

export function CalendarScheduleStatus({
  model,
  width = 72,
}: {
  readonly model: StateBlockModel;
  readonly width?: number;
}) {
  return (
    <Box marginTop={1}>
      <StateBlock model={model} width={width} />
    </Box>
  );
}

export function CalendarDayStrip({
  days,
  selectedDayKey,
  narrow = false,
  maxWidth,
  dense = false,
}: {
  days: readonly CalendarDay[];
  selectedDayKey: string | null;
  narrow?: boolean;
  /** When set, navigation hint hides instead of wrapping past the list edge. */
  maxWidth?: number;
  /** Short terminals: collapse vertical margins so the list keeps its rows. */
  dense?: boolean;
}) {
  const { windowDays, hasPrev, hasNext } = windowCalendarDayStrip(days, selectedDayKey, narrow);
  const showHint = maxWidth === undefined || maxWidth >= 92;

  return (
    <Box
      flexDirection="row"
      marginTop={dense ? 0 : 1}
      marginBottom={dense ? 0 : 1}
      alignItems="center"
      width={maxWidth}
      overflow="hidden"
    >
      <Text color={palette.dim} dimColor>
        {hasPrev ? "‹ " : "  "}
      </Text>
      {windowDays.map((day) => {
        const isSelected = selectedDayKey === day.key;
        const isToday = day.isToday;
        // Boxed chips with a clear hierarchy: the SELECTED day is the rose accent
        // pill (matches the type tabs); TODAY is a distinct amber pill so it always
        // stands apart; other days are readable text chips (not near-background).
        const background = isSelected ? palette.accentFill : isToday ? palette.warnFill : undefined;
        const foreground = isSelected || isToday ? palette.text : palette.textDim;
        return (
          <Box key={day.key} marginRight={1}>
            <Text backgroundColor={background} color={foreground} bold={isSelected || isToday}>
              {` ${day.label} `}
            </Text>
          </Box>
        );
      })}
      <Text color={palette.dim} dimColor>
        {hasNext ? " ›" : "  "}
      </Text>
      {showHint ? (
        <Box marginLeft={1}>
          <Text color={palette.dim} dimColor>
            {selectedDayKey !== null ? "← → day · a/esc all" : "a/→ pick day"}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function CalendarTypeTabs({
  activeTab,
  compact,
  maxWidth,
  dense = false,
}: {
  activeTab: CalendarTypeTab;
  compact: boolean;
  maxWidth?: number;
  dense?: boolean;
}) {
  if (compact) return null;
  const labels = CALENDAR_TYPE_TABS.map((tab) => (tab === "TV" ? "Series" : tab));
  const activeIndex = CALENDAR_TYPE_TABS.indexOf(activeTab);
  return (
    <ClaudeTabRow
      labels={labels}
      activeIndex={activeIndex}
      hint={maxWidth === undefined || maxWidth >= 100 ? "⇥ Tab cycles type" : undefined}
      maxWidth={maxWidth}
      dense={dense}
    />
  );
}

export function CalendarScheduleRow<T>({
  option,
  selected,
  rowWidth,
  showDayHeader,
  dayHeaderLabel,
  timeLabel,
  episodeCode,
  statusLabel,
  statusColor,
  statusDim,
  statusGlyph,
  showForYouHeader,
  showForYouHeaderOnce,
  weekTag,
  isNew,
  tracked,
  posterUrl,
}: {
  option: BrowseShellOption<T>;
  selected: boolean;
  rowWidth: number;
  showDayHeader?: boolean;
  dayHeaderLabel?: string | null;
  timeLabel: string;
  episodeCode?: string;
  statusLabel?: string;
  statusColor?: string;
  statusDim?: boolean;
  statusGlyph?: string;
  showForYouHeader?: boolean;
  showForYouHeaderOnce?: boolean;
  weekTag?: string | null;
  isNew?: boolean;
  tracked?: boolean;
  posterUrl?: string;
  showTimeHeader?: boolean;
  showTbdHeader?: boolean;
  showSectionHeader?: string | null;
  nowMs?: number;
}) {
  const presentation = calendarReleaseRowPresentation(option);
  const ep = episodeCode ?? option.previewBadge ?? "";
  const status = statusLabel ?? presentation.label;
  const color = statusColor ?? presentation.color;
  const dim = statusDim ?? presentation.dim;
  const glyph = statusGlyph ?? presentation.glyph.trim();
  const innerWidth = Math.max(16, rowWidth - CALENDAR_ROW_LEAD_WIDTH);
  const layout = computeCalendarRowLayout(innerWidth);
  const statusText = compactCalendarStatusLabel(
    glyph ? `${glyph} ${status}` : status,
    layout.statusWidth,
  );
  const kind = option.calendar?.contentKind;
  const epColor =
    kind === "anime"
      ? palette.typeAnime
      : kind === "movie"
        ? palette.typeMovie
        : kind === "series"
          ? palette.typeSeries
          : palette.muted;

  const columns = buildCalendarRowColumns({
    timeLabel,
    title: option.label,
    episodeCode: ep,
    episodeColor: epColor,
    statusText,
    statusColor: color,
    statusDim: dim,
    layout,
  });

  return (
    <Box flexDirection="column" width={rowWidth} marginBottom={0}>
      {showForYouHeader && showForYouHeaderOnce ? (
        <SectionGroup label="For you · releasing today" marginTop={1} />
      ) : null}
      {showDayHeader && dayHeaderLabel ? (
        <SectionGroup label={dayHeaderLabel} tag={weekTag ?? undefined} marginTop={1} />
      ) : null}
      <Box flexDirection="row">
        <Box width={5}>
          <CalendarMini url={posterUrl} title={option.label} enabled={selected} />
        </Box>
        <Text color={isNew ? palette.accent : palette.ok}>
          {isNew ? "● " : tracked ? "● " : "  "}
        </Text>
        <Box flexGrow={1}>
          <ListRow
            selected={selected}
            rowWidth={innerWidth}
            flexColumnIndex={layout.flexColumnIndex}
            columns={columns}
          />
        </Box>
      </Box>
    </Box>
  );
}
