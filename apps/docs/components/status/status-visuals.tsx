import {
  STATUS_MEANING,
  type BoardStatus,
  type DonutSlice,
  type StripCell,
} from "@/lib/provider-status";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconHelpCircle,
  IconPlugConnectedX,
  IconShieldLock,
  IconTool,
  type Icon,
} from "@tabler/icons-react";

/**
 * How each provider state looks: a colour and a glyph.
 *
 * Colour is never the only carrier: every state also has its own glyph and its
 * word, so the board reads for a colour-blind visitor and in forced-colours mode.
 * The colours are the theme's own status tokens (`--kunai-ok`, `-warning`, `-info`,
 * `-danger`) plus `--kunai-gated` for the one state that has no fault colour, and
 * a muted grey for a provider nobody has checked.
 *
 * `tone` sets `--status-c` on an element and everything inside reads it, so a pill
 * and a strip bar of one state can never disagree about its colour. `color` is the
 * same colour for the places a class cannot reach, a gradient stop.
 */
export const STATUS_VISUAL = {
  healthy: {
    icon: IconCircleCheck,
    tone: "[--status-c:var(--kunai-ok)]",
    color: "var(--kunai-ok)",
  },
  degraded: {
    icon: IconAlertTriangle,
    tone: "[--status-c:var(--kunai-warning)]",
    color: "var(--kunai-warning)",
  },
  blocked: {
    icon: IconShieldLock,
    tone: "[--status-c:var(--kunai-gated)]",
    color: "var(--kunai-gated)",
  },
  down: { icon: IconTool, tone: "[--status-c:var(--kunai-info)]", color: "var(--kunai-info)" },
  dead: {
    icon: IconPlugConnectedX,
    tone: "[--status-c:var(--kunai-danger)]",
    color: "var(--kunai-danger)",
  },
  unchecked: {
    icon: IconHelpCircle,
    tone: "[--status-c:var(--color-fd-muted-foreground)]",
    color: "var(--color-fd-muted-foreground)",
  },
} satisfies Record<BoardStatus, { icon: Icon; tone: string; color: string }>;

export function StatusPill({ status }: { readonly status: BoardStatus }) {
  const { icon: Glyph, tone } = STATUS_VISUAL[status];
  return (
    <span
      className={`${tone} inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--status-c)_14%,transparent)] px-2.5 py-1 text-xs font-medium whitespace-nowrap text-[var(--status-c)]`}
    >
      <Glyph className="size-3.5" stroke={1.75} aria-hidden="true" />
      {STATUS_MEANING[status].label}
    </span>
  );
}

/** "Oct 3" for a `YYYY-MM-DD` UTC day. */
function shortDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * A provider's last thirty days as thirty bars that fill the column, oldest to newest.
 *
 * A day with no recorded sweep is a hollow bar, not a coloured one: a gap is a day
 * nobody checked, which says nothing about whether the provider was fine. The
 * drawing is hidden from assistive tech and its summary is read as text instead (a
 * sentence, where thirty bars would be thirty meaningless stops). Each bar draws its
 * own date and state on hover (see `status.css`).
 */
export function HistoryStrip({
  cells,
  summary,
}: {
  readonly cells: readonly StripCell[];
  readonly summary: string;
}) {
  // Thirty empty bars say nothing thirty times. With no day recorded at all the strip
  // is one quiet dashed line instead, which reads as "nothing here yet" at a glance.
  if (cells.every((cell) => cell.status === null)) {
    return (
      <>
        <span className="sr-only">{summary}</span>
        <div aria-hidden="true" className="flex h-7 items-center">
          <span className="border-fd-border w-full border-t border-dashed" />
        </div>
      </>
    );
  }
  return (
    <>
      <span className="sr-only">{summary}</span>
      <div aria-hidden="true" className="grid h-7 auto-cols-fr grid-flow-col gap-[3px]">
        {cells.map((cell) => {
          const status = cell.status ?? "unchecked";
          const label = cell.status ? STATUS_MEANING[status].label : "No check recorded";
          return (
            <span
              key={cell.day}
              data-state={cell.status ?? "none"}
              data-tip={`${shortDay(cell.day)} · ${label}`}
              className={`kunai-strip-cell ${cell.status ? STATUS_VISUAL[status].tone : ""}`}
            />
          );
        })}
      </div>
    </>
  );
}

/** The CSS for the ring: each slice a coloured arc, the gaps between them transparent. */
export function donutBackground(slices: readonly DonutSlice[]): string {
  if (slices.length === 0) {
    return "conic-gradient(color-mix(in oklab, var(--kunai-line) 90%, transparent) 0deg 360deg)";
  }
  const stops: string[] = [];
  let cursor = 0;
  for (const slice of slices) {
    if (slice.from > cursor) stops.push(`transparent ${cursor}deg ${slice.from}deg`);
    stops.push(`${STATUS_VISUAL[slice.status].color} ${slice.from}deg ${slice.to}deg`);
    cursor = slice.to;
  }
  if (cursor < 360) stops.push(`transparent ${cursor}deg 360deg`);
  return `conic-gradient(${stops.join(", ")})`;
}

/** Thickness of the ring, in pixels. */
const RING = 16;

/**
 * The overview ring: how the providers divide among the states, with the number that
 * resolves in the middle.
 *
 * Drawn with a conic gradient and a radial mask rather than an SVG or a chart
 * library: it is a handful of arcs, so there is nothing to measure or resize, and it
 * costs no JavaScript. Decorative: the counts beside it are the same numbers as text.
 * `dimmed` greys it when the results are old, so a stale board does not look as
 * confident as a fresh one.
 */
export function StatusDonut({
  slices,
  value,
  caption,
  dimmed = false,
  size = 176,
}: {
  readonly slices: readonly DonutSlice[];
  readonly value: string;
  readonly caption: string;
  readonly dimmed?: boolean;
  readonly size?: number;
}) {
  const mask = `radial-gradient(farthest-side, transparent calc(100% - ${RING}px), #000 calc(100% - ${RING - 1}px))`;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      data-dimmed={dimmed || undefined}
    >
      <div
        aria-hidden="true"
        className={`absolute inset-0 rounded-full transition-[filter,opacity] duration-300 ${dimmed ? "opacity-55 saturate-50" : ""}`}
        style={{ background: donutBackground(slices), maskImage: mask, WebkitMaskImage: mask }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-fd-foreground font-sans text-4xl leading-none font-semibold tabular-nums">
          {value}
        </span>
        <span className="text-fd-muted-foreground mt-1.5 max-w-[7rem] text-xs leading-4">
          {caption}
        </span>
      </div>
    </div>
  );
}
