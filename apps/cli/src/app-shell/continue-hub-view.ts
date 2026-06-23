import type {
  ContinuationHubPrimaryAction,
  ContinuationHubRow,
} from "@/services/continuation/ContinueWatchingService";

import { palette } from "./shell-theme";

export type ContinueHubViewItem =
  | { readonly kind: "section"; readonly label: string }
  | {
      readonly kind: "row";
      readonly row: ContinueHubViewRow;
      readonly flatIndex: number;
      readonly selected: boolean;
    };

export type ContinueHubViewRow = {
  readonly id: string;
  readonly title: string;
  readonly episodeCode: string;
  readonly statusLabel: string;
  readonly statusColor: string;
  readonly statusDim: boolean;
  readonly recencyLabel: string;
  readonly actionLabel: string;
  readonly sourceLabel: string;
  readonly hubRow: ContinuationHubRow;
};

export type ContinueHubView = {
  readonly state: "empty" | "success";
  readonly flatRows: readonly ContinueHubViewRow[];
  readonly items: readonly ContinueHubViewItem[];
  readonly selectedIndex: number;
  readonly totalRows: number;
};

const GROUP_LABELS: Record<ContinuationHubRow["group"], string> = {
  resume: "Resume",
  "offline-ready": "Offline ready",
  "new-episodes": "New episodes",
  "new-seasons": "New seasons",
  "airing-upcoming": "Airing / upcoming",
  "up-to-date": "Up to date / tracked",
};

export function buildContinueHubView(input: {
  readonly rows: readonly ContinuationHubRow[];
  readonly selectedIndex: number;
  readonly maxVisible: number;
  readonly filterQuery?: string;
}): ContinueHubView {
  const query = (input.filterQuery ?? "").trim().toLowerCase();
  const filtered = query
    ? input.rows.filter((row) => `${row.title} ${row.badge}`.toLowerCase().includes(query))
    : input.rows;
  const flatRows = filtered.map(toViewRow);
  const selectedIndex = clamp(input.selectedIndex, flatRows.length);
  const maxVisible = Math.max(1, input.maxVisible);
  const start = windowStart(selectedIndex, flatRows.length, maxVisible);
  const visible = flatRows.slice(start, start + maxVisible);
  const items: ContinueHubViewItem[] = [];
  let lastGroup: ContinuationHubRow["group"] | null = null;
  for (const [offset, row] of visible.entries()) {
    const group = row.hubRow.group;
    if (group !== lastGroup) {
      items.push({ kind: "section", label: GROUP_LABELS[group] });
      lastGroup = group;
    }
    const flatIndex = start + offset;
    items.push({ kind: "row", row, flatIndex, selected: flatIndex === selectedIndex });
  }
  return {
    state: flatRows.length > 0 ? "success" : "empty",
    flatRows,
    items,
    selectedIndex,
    totalRows: flatRows.length,
  };
}

function toViewRow(row: ContinuationHubRow): ContinueHubViewRow {
  return {
    id: row.id,
    title: row.title,
    episodeCode: episodeCode(row),
    statusLabel: row.badge,
    statusColor: statusColor(row),
    statusDim: row.group === "up-to-date" || row.group === "airing-upcoming",
    recencyLabel: sourceLabel(row),
    actionLabel: actionLabel(row.primaryAction),
    sourceLabel: sourceLabel(row),
    hubRow: row,
  };
}

function episodeCode(row: ContinuationHubRow): string {
  if (row.target.mediaKind === "movie") return "movie";
  const season = String(row.target.season ?? 1).padStart(2, "0");
  const episode = String(row.target.episode ?? 1).padStart(2, "0");
  return `S${season}E${episode}`;
}

function sourceLabel(row: ContinuationHubRow): string {
  switch (row.sourceAvailability.kind) {
    case "both-ready":
      return "local + stream";
    case "local-ready":
      return "local";
    case "online-ready":
      return "stream";
    case "local-broken":
      return "offline issue";
    case "online-unknown":
      return "tracked";
  }
}

function actionLabel(action: ContinuationHubPrimaryAction | undefined): string {
  if (!action) return "view";
  switch (action.kind) {
    case "ask-inline":
      return "choose source";
    case "play-local":
      return "play local";
    case "resume-online":
      return "resume";
    case "select-online":
      return "stream";
    case "manage-offline":
      return "manage offline";
  }
}

function statusColor(row: ContinuationHubRow): string {
  switch (row.group) {
    case "resume":
      return palette.warn;
    case "offline-ready":
      return palette.ok;
    case "new-episodes":
    case "new-seasons":
      return palette.info;
    case "airing-upcoming":
      return palette.muted;
    case "up-to-date":
      return palette.dim;
  }
}

function clamp(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function windowStart(selectedIndex: number, length: number, maxVisible: number): number {
  if (length <= maxVisible) return 0;
  const half = Math.floor(maxVisible / 2);
  return Math.max(0, Math.min(selectedIndex - half, length - maxVisible));
}
