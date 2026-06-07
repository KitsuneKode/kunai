import { truncateLine } from "../shell-text";

export type ContextCardKind = "next" | "previous" | "now" | "related";
export type ContextCardTone = "success" | "warning" | "muted" | "danger";
export type ContextThumbnailState = "none" | "loading" | "ready" | "failed";

export type ContextCardModel = {
  readonly kind: ContextCardKind;
  readonly title: string;
  readonly subtitle?: string;
  readonly thumbnailUrl?: string;
  readonly thumbnailState: ContextThumbnailState;
  readonly stateLabel?: string;
  readonly stateTone?: ContextCardTone;
  readonly actionLabel?: string;
};

// Connective words that should not contribute initials, so
// "Challengers of Science" reads as "CS", not "CO".
const TILE_STOPWORDS = new Set(["of", "the", "a", "an", "and", "to", "in", "no", "wa", "de"]);

export function clampContextCardText(value: string, width: number): string {
  return truncateLine(value, Math.max(1, width));
}

export function buildContextCardTile(title: string): string {
  const words = title
    .trim()
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);

  const first = words[0];
  if (!first) return "??";
  if (words.length === 1) return first.slice(0, 2).toUpperCase();

  // Keep the first word's initial, then the next word that isn't a connective
  // stopword: "The Boys" -> "TB", but "Challengers of Science" -> "CS".
  const second =
    words.slice(1).find((w) => !TILE_STOPWORDS.has(w.toLowerCase())) ?? words[1] ?? first;
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}

export function contextCardGlyph(
  input: Pick<ContextCardModel, "kind" | "stateLabel" | "stateTone">,
): string {
  if (input.stateTone === "danger") return "×";
  if (input.stateTone === "warning") return "◷";
  if (input.stateTone === "success" && input.kind === "previous") return "✓";
  if (input.stateTone === "success" && input.kind === "next") return "▶";
  if (input.stateLabel?.toLowerCase().includes("watched")) return "✓";
  return "·";
}

export function buildPlaybackContextCards(input: {
  readonly nextEpisodeLabel?: string;
  readonly previousEpisodeLabel?: string;
  readonly hasNextEpisode?: boolean;
  readonly hasPreviousEpisode?: boolean;
}): readonly ContextCardModel[] {
  const cards: ContextCardModel[] = [];
  if (input.hasNextEpisode && input.nextEpisodeLabel) {
    cards.push({
      kind: "next",
      title: input.nextEpisodeLabel,
      subtitle: "next",
      thumbnailState: "none",
      stateLabel: "playable",
      stateTone: "success",
    });
  }
  if (input.hasPreviousEpisode && input.previousEpisodeLabel) {
    cards.push({
      kind: "previous",
      title: input.previousEpisodeLabel,
      subtitle: "previous",
      thumbnailState: "none",
      stateLabel: "watched",
      stateTone: "success",
    });
  }
  return cards;
}
