import { palette } from "../shell-theme";
import {
  listRowEpColumn,
  listRowMarkerColumn,
  listRowStatusColumn,
  listRowTimeColumn,
  listRowTitleColumn,
  type ListRowColumn,
} from "./ListRow.model";

export type CalendarRowLayout = {
  readonly timeWidth: number;
  readonly markerWidth: number;
  readonly titleWidth: number;
  readonly episodeWidth: number;
  readonly statusWidth: number;
  readonly flexColumnIndex: number;
};

export type MediaListRowLayout = {
  readonly titleWidth: number;
  readonly episodeWidth: number;
  readonly statusWidth: number;
  readonly recencyWidth: number;
  readonly flexColumnIndex: number;
};

export type QueueRowLayout = {
  readonly titleWidth: number;
  readonly stateWidth: number;
  readonly progressWidth: number;
  readonly metaWidth: number;
  readonly flexColumnIndex: number;
};

/** Schedule list: fixed time + attention marker + flex title + episode slot + status. */
export function computeCalendarRowLayout(rowWidth: number): CalendarRowLayout {
  const timeWidth = 7;
  const episodeWidth = 8;
  const statusWidth = Math.min(18, Math.max(12, Math.floor(rowWidth * 0.22)));
  return {
    timeWidth,
    markerWidth: 2,
    titleWidth: 12,
    episodeWidth,
    statusWidth,
    // Time and marker both precede the flexing title column.
    flexColumnIndex: 2,
  };
}

/** History / library rows: flex title + optional episode + status (+ optional recency). */
export function computeMediaListRowLayout(
  rowWidth: number,
  options: {
    readonly hasEpisode?: boolean;
    readonly hasRecency?: boolean;
    readonly statusShare?: number;
  } = {},
): MediaListRowLayout {
  const hasEpisode = options.hasEpisode ?? true;
  const hasRecency = options.hasRecency ?? false;
  const statusShare = options.statusShare ?? 0.24;
  return {
    titleWidth: 12,
    episodeWidth: hasEpisode ? 7 : 0,
    statusWidth: Math.min(22, Math.max(12, Math.floor(rowWidth * statusShare))),
    recencyWidth: hasRecency ? 8 : 0,
    flexColumnIndex: 0,
  };
}

/** Download queue rows: flex title + state + progress bar + meta. */
export function computeQueueRowLayout(shellWidth: number): QueueRowLayout {
  const stateWidth = 16;
  const progressWidth = Math.min(24, Math.max(18, Math.floor(shellWidth * 0.28)));
  const metaWidth = 12;
  return {
    titleWidth: 12,
    stateWidth,
    progressWidth,
    metaWidth,
    flexColumnIndex: 0,
  };
}

export function buildMediaListRowColumns(input: {
  readonly title: string;
  readonly episodeCode?: string;
  readonly statusLabel: string;
  readonly statusColor: string;
  readonly statusDim?: boolean;
  readonly recencyLabel?: string;
  readonly layout: MediaListRowLayout;
}): ListRowColumn[] {
  const ep = input.episodeCode?.trim() ?? "";
  const columns: ListRowColumn[] = [
    listRowTitleColumn(input.title, input.layout.titleWidth),
    ...(ep.length > 0 ? [listRowEpColumn(ep, input.layout.episodeWidth)] : []),
    listRowStatusColumn(
      input.statusLabel,
      input.layout.statusWidth,
      input.statusColor,
      input.statusDim ?? false,
    ),
  ];
  if (input.recencyLabel && input.layout.recencyWidth > 0) {
    columns.push(
      listRowStatusColumn(input.recencyLabel, input.layout.recencyWidth, palette.muted, true),
    );
  }
  return columns;
}

export const LIST_ROW_LAYOUT_BREAKPOINTS = [80, 100, 120, 160] as const;

export type ListRowLayoutFixture = {
  readonly breakpoint: number;
  readonly companion: boolean;
  readonly innerWidth: number;
  readonly listWidth: number;
  readonly rowWidth: number;
  readonly schedule: CalendarRowLayout;
  readonly history: MediaListRowLayout;
  readonly library: MediaListRowLayout;
  readonly queue: QueueRowLayout;
};

/** Width regression fixtures for prototype harnesses and unit tests. */
export function buildListRowLayoutFixtures(): readonly ListRowLayoutFixture[] {
  return LIST_ROW_LAYOUT_BREAKPOINTS.map((breakpoint) => {
    const innerWidth = Math.max(24, breakpoint - 8);
    const companion = breakpoint >= 120;
    const previewWidth = companion ? Math.max(28, Math.floor(innerWidth * 0.3)) : 0;
    const listWidth = companion ? Math.max(48, innerWidth - previewWidth - 4) : innerWidth;
    const rowWidth = Math.max(20, listWidth - 4);
    return {
      breakpoint,
      companion,
      innerWidth,
      listWidth,
      rowWidth,
      schedule: computeCalendarRowLayout(rowWidth),
      history: computeMediaListRowLayout(rowWidth, { hasEpisode: true, hasRecency: true }),
      library: computeMediaListRowLayout(rowWidth, { hasEpisode: true }),
      queue: computeQueueRowLayout(breakpoint),
    };
  });
}

export function buildCalendarRowColumns(input: {
  readonly timeLabel: string;
  readonly title: string;
  readonly marker?: string;
  readonly markerColor?: string;
  readonly episodeCode?: string;
  readonly episodeColor?: string;
  readonly statusText: string;
  readonly statusColor: string;
  readonly statusDim: boolean;
  readonly layout: CalendarRowLayout;
}): ListRowColumn[] {
  const ep = input.episodeCode?.trim() ?? "";
  return [
    listRowTimeColumn(input.timeLabel, input.layout.timeWidth),
    listRowMarkerColumn(input.marker ?? "", input.layout.markerWidth, input.markerColor),
    listRowTitleColumn(input.title, input.layout.titleWidth),
    listRowEpColumn(ep, input.layout.episodeWidth, input.episodeColor),
    listRowStatusColumn(
      input.statusText,
      input.layout.statusWidth,
      input.statusColor,
      input.statusDim,
    ),
  ];
}
