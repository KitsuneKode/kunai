import type { BrowseShellOption } from "@/app-shell/types";
import { Box, Text } from "ink";
import React from "react";

import {
  CALENDAR_TYPE_TABS,
  calendarReleaseRowPresentation,
  windowCalendarDayStrip,
  type CalendarDay,
  type CalendarTypeTab,
} from "./calendar-ui.model";
import { ClaudeTabRow } from "./primitives/ClaudeTabRow";
import { ListRow } from "./primitives/ListRow";
import {
  listRowEpColumn,
  listRowStatusColumn,
  listRowTimeColumn,
  listRowTitleColumn,
} from "./primitives/ListRow.model";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import type { StateBlockModel } from "./primitives/StateBlock.model";
import { palette } from "./shell-theme";

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
}: {
  days: readonly CalendarDay[];
  selectedDayKey: string | null;
  narrow?: boolean;
}) {
  const { windowDays, hasPrev, hasNext } = windowCalendarDayStrip(days, selectedDayKey, narrow);

  return (
    <Box flexDirection="row" marginTop={1} marginBottom={1} alignItems="center">
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
      <Box marginLeft={1}>
        <Text color={palette.dim} dimColor>
          {selectedDayKey !== null ? "← → day · a/esc all days" : "a/→ pick a day"}
        </Text>
      </Box>
    </Box>
  );
}

export function CalendarTypeTabs({
  activeTab,
  compact,
}: {
  activeTab: CalendarTypeTab;
  compact: boolean;
}) {
  if (compact) return null;
  const labels = CALENDAR_TYPE_TABS.map((tab) => (tab === "TV" ? "Series" : tab));
  const activeIndex = CALENDAR_TYPE_TABS.indexOf(activeTab);
  return <ClaudeTabRow labels={labels} activeIndex={activeIndex} hint="⇥ Tab cycles type" />;
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
  const kind = option.calendar?.contentKind;
  const epColor =
    kind === "anime"
      ? palette.typeAnime
      : kind === "movie"
        ? palette.typeMovie
        : kind === "series"
          ? palette.typeSeries
          : palette.muted;

  const timeWidth = 7;
  const epWidth = 8;
  const statusWidth = Math.min(18, Math.max(12, Math.floor(rowWidth * 0.22)));
  // The title is the FLEX column (flexColumnIndex=1) — give it a small base; ListRow
  // hands it the leftover row width. The time/ep/status columns keep fixed widths so
  // they stay aligned across rows and a long title truncates instead of pushing them.
  const titleWidth = 12;

  return (
    <Box flexDirection="column" width={rowWidth} marginBottom={0}>
      {showForYouHeader && showForYouHeaderOnce ? (
        <SectionGroup label="For you · releasing today" marginTop={1} />
      ) : null}
      {showDayHeader && dayHeaderLabel ? (
        <SectionGroup label={dayHeaderLabel} marginTop={1} />
      ) : null}
      <ListRow
        selected={selected}
        rowWidth={rowWidth}
        flexColumnIndex={1}
        columns={[
          listRowTimeColumn(timeLabel, timeWidth),
          listRowTitleColumn(option.label, titleWidth),
          listRowEpColumn(ep, epWidth, epColor),
          listRowStatusColumn(`${glyph} ${status}`, statusWidth, color, dim),
        ]}
      />
    </Box>
  );
}
