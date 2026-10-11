/**
 * Headline layout for the social cards.
 *
 * Shared by every card route (a shared title, a docs page): they all hand the
 * same two-line slot a string of unknown length, and each used to need its own
 * answer to "what if it does not fit".
 */

/** Characters one headline line fits at the card's type size. */
const LINE_BUDGET = 22;

/**
 * Break a title across at most two lines near its middle.
 *
 * The card's headline slot is two lines tall. Satori does not wrap for us here
 * because each line is its own element, so a long title has to be split before
 * it is handed over or it overflows the card.
 */
export function splitHeadline(title: string, emptyFallback: string): string[] {
  // Collapse every whitespace run, not just the ends. A title carrying a newline
  // or tab reaches satori as literal control characters inside one text node,
  // which lays out unpredictably; and a title that is only whitespace would
  // otherwise render an empty headline on an otherwise complete card.
  const trimmed = title.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return [emptyFallback];
  if (trimmed.length <= LINE_BUDGET) return [trimmed];

  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    // One unbroken token cannot wrap. Cutting it silently would drop the tail
    // without the reader ever knowing the title continued, so the ellipsis is
    // part of the contract, not decoration.
    if (trimmed.length <= LINE_BUDGET * 2) {
      return [trimmed.slice(0, LINE_BUDGET), trimmed.slice(LINE_BUDGET)];
    }
    return [trimmed.slice(0, LINE_BUDGET), `${trimmed.slice(LINE_BUDGET, LINE_BUDGET * 2 - 1)}…`];
  }

  // Balance the two lines rather than filling the first: a title split as
  // "Attack on" / "Titan" reads better than "Attack on Titan: The Final" / "Season".
  let best = 1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let cut = 1; cut < words.length; cut++) {
    const head = words.slice(0, cut).join(" ").length;
    const tail = words.slice(cut).join(" ").length;
    const delta = Math.abs(head - tail);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = cut;
    }
  }
  const head = words.slice(0, best).join(" ");
  const tail = words.slice(best).join(" ");
  return [truncate(head), truncate(tail)];
}

/**
 * Fit a sentence to one line, ending on a word and marking the cut.
 *
 * Cutting mid-word ("resolve a direct stre…") reads as a rendering fault; this
 * backs up to the last space and drops trailing punctuation so the ellipsis
 * never follows a comma. A string that already fits is returned unchanged.
 */
export function clipLine(text: string, budget: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= budget) return collapsed;
  const clipped = collapsed.slice(0, budget - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const onWord = lastSpace > budget * 0.5 ? clipped.slice(0, lastSpace) : clipped;
  return `${onWord.replace(/[,;:.\s]+$/, "")}…`;
}

/** Cut an over-long line, marking it so a dropped tail is never silent. */
function truncate(line: string): string {
  return line.length <= LINE_BUDGET ? line : `${line.slice(0, LINE_BUDGET - 1)}…`;
}
