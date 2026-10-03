"use client";

import { platformColumns, platformLabel } from "@/lib/analytics-derive";
import type { SeriesPoint } from "@/lib/analytics-series";
import { revealWithin } from "@/lib/reveal-in-container";
import * as React from "react";

/**
 * The table twin.
 *
 * Every plotted value is reachable here, so the charts' tooltips enhance
 * rather than gate. It is no longer behind a `<details>`: the charts are
 * client components, so with JavaScript off this table is the *only*
 * rendering of the data, and a collapsed summary would hide it entirely.
 *
 * Two deliberate choices live in this file:
 *
 * Newest first. `points` arrives ascending — that is a parse-time contract
 * the charts share, so the table copies before it reverses. Reversing
 * `points` in place would silently flip every x-axis on the page.
 *
 * Chunked reveal, not sentinel loading. The window is bounded by the
 * endpoint at 180 days, so "Show 30 more days" needs at most five clicks
 * and never adds a scroll listener. It also keeps the table honest as the
 * chart's accessible twin: the first PAGE_SIZE rows ship inside the SSR
 * HTML, which means the no-JS rendering is the newest month — a real read,
 * not a loading skeleton.
 */

export const TREND_TABLE_PAGE_SIZE = 30;

/**
 * How many rows must render for `day` to exist in the DOM.
 *
 * Shared by the "Show more" button and chart-hover sync: hovering a day the
 * table has not revealed yet expands until the row exists, then the row
 * scrolls into view — the chart becomes a range selector for the table.
 * Returns `current` when the day is already rendered, absent, or null.
 */
export function visibleCountForDay(
  rows: readonly SeriesPoint[],
  day: string | null,
  current: number,
): number {
  if (!day) return current;
  const index = rows.findIndex((row) => row.day === day);
  return index >= current ? index + 1 : current;
}

export function TrendTable({
  points,
  hoveredDay = null,
}: {
  readonly points: readonly SeriesPoint[];
  readonly hoveredDay?: string | null;
}) {
  const rows = React.useMemo(() => [...points].reverse(), [points]);
  const [visibleCount, setVisibleCount] = React.useState(TREND_TABLE_PAGE_SIZE);
  const hoveredRowRef = React.useRef<HTMLTableRowElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const headRef = React.useRef<HTMLTableSectionElement | null>(null);

  // Chart hover names a day that may sit below the rendered chunk; expand
  // until it exists. Revealed rows stay revealed on mouseleave — collapsing
  // them would shift the layout under the cursor.
  React.useEffect(() => {
    setVisibleCount((current) => visibleCountForDay(rows, hoveredDay, current));
  }, [rows, hoveredDay]);

  // Moves the panel's own scroll position and nothing else. `scrollIntoView` here
  // also scrolled the page toward the table whenever the chart pointer changed
  // day, which read as the whole site shaking while hovering the chart.
  React.useEffect(() => {
    const panel = panelRef.current;
    const row = hoveredRowRef.current;
    if (hoveredDay && panel && row) revealWithin(panel, row, headRef.current?.offsetHeight ?? 0);
  }, [hoveredDay, visibleCount]);

  const visible = rows.slice(0, visibleCount);
  const exhausted = visibleCount >= rows.length;
  // The column is absent, not a column of dashes, when the served series
  // predates the field entirely. A mid-window null is a real gap and gets `—`.
  const hasNewColumn = points.some((point) => point.newInstalls !== null);
  // Platform columns only for buckets the window published. A dash means the
  // platform was under the naming floor that day — NOT zero, since the
  // suppressed installs are counted inside `other`.
  const osColumns = platformColumns(points);

  return (
    <div ref={panelRef} className="flex max-h-[260px] flex-col overflow-y-auto overscroll-contain">
      <table className="kunai-chart text-xs">
        <caption className="sr-only">
          {hasNewColumn
            ? "Active, first-seen, and lifetime installs per day"
            : "Active and lifetime installs per day"}
          {osColumns.length > 0
            ? "; platform columns hold the day's published OS buckets — a dash means under the naming floor, not zero"
            : ""}
        </caption>
        <thead ref={headRef} className="bg-card sticky top-0">
          <tr>
            <th scope="col" className="text-muted-foreground text-left font-normal">
              Day
            </th>
            <th scope="col" className="text-muted-foreground text-right font-normal">
              Active
            </th>
            {hasNewColumn ? (
              <th scope="col" className="text-muted-foreground text-right font-normal">
                New
              </th>
            ) : null}
            {osColumns.map((key) => (
              <th key={key} scope="col" className="text-muted-foreground text-right font-normal">
                {platformLabel(key)}
              </th>
            ))}
            <th scope="col" className="text-muted-foreground text-right font-normal">
              Lifetime
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((point) => {
            const isHovered = point.day === hoveredDay;
            return (
              <tr
                key={point.day}
                ref={isHovered ? hoveredRowRef : undefined}
                data-hovered={isHovered || undefined}
                className="kunai-chart-row"
              >
                <th scope="row" className="text-foreground text-left font-normal tabular-nums">
                  {point.day}
                </th>
                <td className="text-foreground text-right tabular-nums">{point.activeInstalls}</td>
                {hasNewColumn ? (
                  <td className="text-foreground text-right tabular-nums">
                    {point.newInstalls ?? "—"}
                  </td>
                ) : null}
                {osColumns.map((key) => (
                  <td key={key} className="text-muted-foreground text-right tabular-nums">
                    {point.byOs[key] ?? "—"}
                  </td>
                ))}
                <td className="text-muted-foreground text-right tabular-nums">
                  {point.lifetimeInstalls}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/*
        A real button, not a scroll sentinel: focusable, announces itself,
        and does not hand assistive tech a permanently partial table. With
        JS off it is inert and the SSR'd newest month above is the read.
      */}
      {exhausted ? (
        rows.length > TREND_TABLE_PAGE_SIZE ? (
          <p className="text-muted-foreground m-0 py-2 text-center text-xs">
            All {rows.length} days shown
          </p>
        ) : null
      ) : (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-1 w-full shrink-0 rounded-md py-2 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
          onClick={() =>
            setVisibleCount((current) => Math.min(current + TREND_TABLE_PAGE_SIZE, rows.length))
          }
        >
          Show {Math.min(TREND_TABLE_PAGE_SIZE, rows.length - visibleCount)} more days
        </button>
      )}
    </div>
  );
}
