import { sparklinePaths } from "@/lib/analytics-derive";

/**
 * A figure's own shape, drawn beside the figure.
 *
 * Decorative by construction: the tile it sits in already carries the number,
 * the delta and the window as text, and the day-by-day table is the full twin.
 * So this is `aria-hidden` rather than labelled, which would read a polyline
 * aloud as nothing useful.
 *
 * Plain SVG, rendered on the server: four of these sit above the fold, and
 * pulling in the chart library for a 28px outline would put it on the critical
 * path of the page's first paint. `vector-effect: non-scaling-stroke` keeps the
 * line at 1.5px however far `preserveAspectRatio="none"` stretches the box.
 */
const WIDTH = 120;
const HEIGHT = 32;

export function Sparkline({
  values,
  className,
}: {
  readonly values: readonly number[];
  readonly className?: string;
}) {
  const paths = sparklinePaths(values, WIDTH, HEIGHT);
  // One point (or none) is not a shape. Render nothing rather than a dot that
  // reads as a rendering failure.
  if (!paths) return null;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={className}
    >
      <path d={paths.area} fill="currentColor" opacity={0.14} />
      <path
        d={paths.line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
