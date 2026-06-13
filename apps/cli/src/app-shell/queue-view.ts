import type { QueueEntry } from "@kunai/storage";

export type QueueRowState = "playing" | "pending" | "played";

export type QueueViewRow = {
  readonly id: string;
  readonly title: string;
  readonly episodeLabel: string;
  readonly sourceLabel: string;
  readonly state: QueueRowState;
  readonly position: number;
  readonly posterUrl?: string;
  readonly titleId: string;
};

export type QueueRailModel = {
  readonly title: string;
  readonly episodeLabel: string;
  readonly sourceLabel: string;
  readonly posterUrl?: string;
};

export type QueueView = {
  readonly state: "empty" | "success";
  readonly rows: readonly QueueViewRow[];
  readonly selectedIndex: number;
  readonly counts: { readonly unplayed: number; readonly total: number };
  readonly stale: boolean;
  readonly recoverableSessions: number;
  readonly rail: QueueRailModel | null;
  readonly emptyHint: string;
};

export type BuildQueueViewInput = {
  readonly entries: readonly QueueEntry[];
  readonly selectedId: string | null;
  readonly resolvePoster: (titleId: string) => string | undefined;
  readonly recoverableSessions: number;
  readonly stale?: boolean;
};

function episodeLabel(entry: QueueEntry): string {
  if (entry.mediaKind === "movie") return "Movie";
  if (entry.season !== undefined && entry.episode !== undefined) {
    return `S${String(entry.season).padStart(2, "0")}·E${String(entry.episode).padStart(2, "0")}`;
  }
  const ep = entry.episode ?? entry.absoluteEpisode;
  return ep !== undefined ? `E${String(ep).padStart(2, "0")}` : "—";
}

function sourceLabel(source: string): string {
  switch (source) {
    case "history":
      return "from history";
    case "watchlist":
      return "watchlist";
    case "post-play":
      return "post-play";
    default:
      return "added";
  }
}

export function buildQueueView(input: BuildQueueViewInput): QueueView {
  const played = input.entries.filter((entry) => entry.playedAt !== undefined);
  const unplayed = input.entries.filter((entry) => entry.playedAt === undefined);
  const total = input.entries.length;

  if (total === 0) {
    return {
      state: "empty",
      rows: [],
      selectedIndex: 0,
      counts: { unplayed: 0, total: 0 },
      stale: input.stale ?? false,
      recoverableSessions: input.recoverableSessions,
      rail: null,
      emptyHint:
        input.recoverableSessions > 0
          ? "Queue is empty · press r to restore your last queue"
          : "Queue is empty · add from browse, history, or post-play (q)",
    };
  }

  const firstUnplayedId = unplayed[0]?.id;
  const ordered = [...played, ...unplayed];
  let unplayedPos = 0;
  const rows: QueueViewRow[] = ordered.map((entry) => {
    const isPlayed = entry.playedAt !== undefined;
    if (!isPlayed) unplayedPos += 1;
    return {
      id: entry.id,
      title: entry.title,
      episodeLabel: episodeLabel(entry),
      sourceLabel: sourceLabel(entry.source),
      state: isPlayed ? "played" : entry.id === firstUnplayedId ? "playing" : "pending",
      position: isPlayed ? 0 : unplayedPos,
      posterUrl: input.resolvePoster(entry.titleId),
      titleId: entry.titleId,
    };
  });

  const foundIndex = rows.findIndex((row) => row.id === input.selectedId);
  const selectedIndex = foundIndex >= 0 ? foundIndex : 0;
  const selected = rows[selectedIndex];
  const rail: QueueRailModel | null = selected
    ? {
        title: selected.title,
        episodeLabel: selected.episodeLabel,
        sourceLabel: selected.sourceLabel,
        posterUrl: selected.posterUrl,
      }
    : null;

  return {
    state: "success",
    rows,
    selectedIndex,
    counts: { unplayed: unplayed.length, total },
    stale: input.stale ?? false,
    recoverableSessions: input.recoverableSessions,
    rail,
    emptyHint: "",
  };
}
