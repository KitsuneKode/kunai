import { palette } from "../shell-theme";

export type ListRowColumn = {
  readonly text: string;
  readonly width: number;
  readonly color?: string;
  readonly dim?: boolean;
  readonly align?: "left" | "right";
};

export function listRowTimeColumn(time: string, width = 6): ListRowColumn {
  return { text: time, width, color: palette.text, align: "left" };
}

export function listRowTitleColumn(title: string, width: number): ListRowColumn {
  return { text: title, width, color: palette.text };
}

/**
 * Attention marker between time and title. The glyph carries the meaning, not
 * the colour — two states separated only by tint are indistinguishable to a
 * colourblind reader and nearly so at a glance.
 */
export function listRowMarkerColumn(
  marker: string,
  width: number,
  color: string = palette.muted,
): ListRowColumn {
  return { text: marker, width, color, align: "left" };
}

export function listRowEpColumn(
  ep: string,
  width = 8,
  color: string = palette.muted,
): ListRowColumn {
  // A per-kind tint (anime/series/movie) reads as a vivid tag; the default muted
  // ep code stays dim.
  return { text: ep, width, color, dim: color === palette.muted };
}

export function listRowStatusColumn(
  status: string,
  width: number,
  color: string,
  dim = false,
): ListRowColumn {
  // Cap at the budgeted width; ListRow truncates to prevent row spill.
  return {
    text: status,
    width,
    color,
    dim,
    align: "right",
  };
}
