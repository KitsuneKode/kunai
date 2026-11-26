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
import type { CalendarCursor } from "./hooks/use-calendar-cursor";
import { MouseTarget } from "./mouse/MouseRegions";
import { plainModeEnabled } from "./plain-mode";
import { ClaudeTabRow } from "./primitives/ClaudeTabRow";
import { buildCalendarRowColumns, computeCalendarRowLayout } from "./primitives/list-row-layout";
import { ListRow } from "./primitives/ListRow";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import type { StateBlockModel } from "./primitives/StateBlock.model";
import { palette } from "./shell-theme";

/** Schedule rows start at the time column; no lead gutter is reserved. */
const CALENDAR_ROW_LEAD_WIDTH = 0;

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
  onSelect,
}: {
  days: readonly CalendarDay[];
  selectedDayKey: string | null;
  narrow?: boolean;
  /** When set, navigation hint hides instead of wrapping past the list edge. */
  maxWidth?: number;
  /** Short terminals: collapse vertical margins so the list keeps its rows. */
  dense?: boolean;
  /** Tap on a date chip (Termux sends taps as clicks); absent = not tappable. */
  onSelect?: (dayKey: string) => void;
}) {
  const { windowDays, hasPrev, hasNext } = windowCalendarDayStrip(days, selectedDayKey, narrow);
  const showHint = maxWidth === undefined || maxWidth >= 92;
  const plain = plainModeEnabled();

  return (
    <Box
      flexDirection="row"
      marginTop={dense ? 0 : 1}
      marginBottom={dense ? 0 : 1}
      alignItems="center"
      width={maxWidth}
      overflow="hidden"
    >
      <Text color={palette.dim}>
        {plain ? (hasPrev ? "previous " : "") : hasPrev ? "‹ " : "  "}
      </Text>
      {windowDays.map((day) => {
        const isSelected = selectedDayKey === day.key;
        const isToday = day.isToday;
        if (plain) {
          const markers = [isSelected ? "[active]" : null, isToday ? "(today)" : null, day.label]
            .filter((part): part is string => part !== null)
            .join(" ");
          return (
            <MouseTarget
              key={day.key}
              id={`calendar:day:${day.key}`}
              active={Boolean(onSelect)}
              onClick={() => onSelect?.(day.key)}
            >
              <Box marginRight={1}>
                <Text color={palette.text} bold={isSelected || isToday}>
                  {` ${markers} `}
                </Text>
              </Box>
            </MouseTarget>
          );
        }
        // Boxed chips with a clear hierarchy: the SELECTED day is the rose accent
        // pill (matches the type tabs); TODAY is a distinct amber pill so it always
        // stands apart; other days are readable text chips (not near-background).
        const background = isSelected ? palette.accentFill : isToday ? palette.warnFill : undefined;
        const foreground = isSelected || isToday ? palette.text : palette.textDim;
        return (
          <MouseTarget
            key={day.key}
            id={`calendar:day:${day.key}`}
            active={Boolean(onSelect)}
            onClick={() => onSelect?.(day.key)}
          >
            <Box marginRight={1}>
              <Text backgroundColor={background} color={foreground} bold={isSelected || isToday}>
                {` ${day.label} `}
              </Text>
            </Box>
          </MouseTarget>
        );
      })}
      <Text color={palette.dim}>{plain ? (hasNext ? " next" : "") : hasNext ? " ›" : "  "}</Text>
      {showHint ? (
        <Box marginLeft={1}>
          <Text color={palette.dim}>
            {plain ? "previous/next date, Esc close" : "← → date · Esc close"}
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
  onSelect,
}: {
  activeTab: CalendarTypeTab;
  compact: boolean;
  maxWidth?: number;
  dense?: boolean;
  /** Tap on a type tab; absent = not tappable. */
  onSelect?: (tab: CalendarTypeTab) => void;
}) {
  const labels = CALENDAR_TYPE_TABS.map((tab) => (tab === "TV" ? "Series" : tab));
  const activeIndex = CALENDAR_TYPE_TABS.indexOf(activeTab);
  // Narrow terminals (portrait phones) used to lose the type tabs entirely, so
  // nothing said which slice was showing or that Tab changes it.
  if (compact) {
    return (
      <Text color={palette.dim}>
        <Text color={palette.accent}>{labels[activeIndex] ?? activeTab}</Text>
        {" · Tab: type"}
      </Text>
    );
  }
  const showHint = maxWidth === undefined || maxWidth >= 100;
  return (
    <ClaudeTabRow
      labels={labels}
      activeIndex={activeIndex}
      hint={showHint ? (plainModeEnabled() ? "Tab cycles type" : "⇥ Tab cycles type") : undefined}
      maxWidth={maxWidth}
      dense={dense}
      pointer={
        onSelect
          ? {
              id: "calendar:type",
              select: (index) => {
                const tab = CALENDAR_TYPE_TABS[index];
                if (tab) onSelect(tab);
              },
            }
          : undefined
      }
    />
  );
}

function CalendarScheduleRowInner<T>({
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
  optionIndex,
  pointer,
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
  showTimeHeader?: boolean;
  showTbdHeader?: boolean;
  showSectionHeader?: string | null;
  nowMs?: number;
  /** The row's index on its date; taps report it back to `pointer`. */
  optionIndex?: number;
  /** Stable tap handlers (memo-safe); absent = not tappable. */
  pointer?: Pick<CalendarCursor, "tapRow" | "wheel">;
}) {
  const presentation = calendarReleaseRowPresentation(option);
  const ep = episodeCode ?? option.previewBadge ?? "";
  const status = statusLabel ?? presentation.label;
  const color = statusColor ?? presentation.color;
  const dim = statusDim ?? presentation.dim;
  const plain = plainModeEnabled();
  const glyph = plain ? "" : (statusGlyph ?? presentation.glyph.trim());
  const innerWidth = Math.max(16, rowWidth - CALENDAR_ROW_LEAD_WIDTH);
  const layout = computeCalendarRowLayout(innerWidth);
  const statusText = compactCalendarStatusLabel(
    glyph ? `${glyph} ${status}` : status,
    layout.statusWidth,
  );
  // Episode code is secondary context — color must not encode content type.
  const epColor = palette.muted;

  // Distinct glyphs, not just distinct tints: "new for you" and "tracked" used to
  // share ● and differ only by colour, which is unreadable at a glance and
  // invisible to a colourblind reader.
  const marker = plain ? "" : isNew ? "●" : tracked ? "★" : "";
  const markerColor = isNew ? palette.accent : palette.ok;
  const titlePrefix = plain ? (isNew ? "[new] " : tracked ? "[tracked] " : "") : "";

  const columns = buildCalendarRowColumns({
    timeLabel,
    title: `${titlePrefix}${option.label}`,
    marker,
    markerColor,
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
      {/* Only the row is a target — a tap on a date header selects nothing. */}
      <MouseTarget
        id={`calendar:row:${optionIndex ?? -1}`}
        active={Boolean(pointer) && optionIndex !== undefined}
        onClick={() => {
          if (optionIndex !== undefined) pointer?.tapRow(optionIndex, selected);
        }}
        onWheel={pointer?.wheel}
      >
        <Box flexGrow={1}>
          <ListRow
            selected={selected}
            rowWidth={innerWidth}
            flexColumnIndex={layout.flexColumnIndex}
            columns={columns}
          />
        </Box>
      </MouseTarget>
    </Box>
  );
}

// Memoized so a selection change only re-renders the two rows whose `selected`
// flips — not every visible row. Row props come from the memoized render-row list,
// so identities are stable and the shallow compare holds. The generic cast keeps
// the <T> call signature React.memo would otherwise erase.
export const CalendarScheduleRow = React.memo(
  CalendarScheduleRowInner,
) as typeof CalendarScheduleRowInner;
