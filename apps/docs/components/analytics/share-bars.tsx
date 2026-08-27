import { residualShare } from "@/lib/analytics-derive";
import { rankShareBuckets, type ShareBucket } from "@/lib/analytics-metrics";

/**
 * A ranked horizontal bar chart for one breakdown of the usage snapshot.
 *
 * Form: the data's job is "compare magnitude across a handful of named
 * buckets", so it is a bar chart, not a stacked ribbon — a single stack of
 * same-coloured segments (what this page shipped before) encodes identity in
 * nothing at all and makes every bucket unreadable.
 *
 * It renders as a real `<table>`: the value beside every bar is the chart's own
 * table view, so nothing here is reachable only through colour.
 */

function formatShare(share: number): string {
  const percent = share * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

function ShareRow({ bucket }: { readonly bucket: ShareBucket }) {
  return (
    <tr className="kunai-chart-row">
      <th
        scope="row"
        className={`truncate text-left text-xs ${
          bucket.residual ? "text-muted-foreground" : "text-foreground font-medium"
        }`}
      >
        {bucket.label}
      </th>
      {/*
        Decorative: the bar restates the count and percentage cells that follow,
        so a screen reader gets the full row without it. Hidden rather than
        labelled, which would read every value twice.
      */}
      <td className="kunai-chart-plot" aria-hidden="true">
        <div
          className="kunai-chart-bar"
          data-residual={bucket.residual}
          style={{ width: `${Math.max(bucket.share * 100, 0.6)}%` }}
        />
      </td>
      <td className="text-foreground text-right text-xs tabular-nums">
        {bucket.count.toLocaleString("en-US")}
      </td>
      <td className="text-muted-foreground text-right text-xs tabular-nums">
        {formatShare(bucket.share)}
      </td>
    </tr>
  );
}

export function ShareBars({
  label,
  counts,
}: {
  readonly label: string;
  readonly counts: Readonly<Record<string, number>>;
}) {
  const buckets = rankShareBuckets(counts);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const fullySuppressed = residualShare(counts) >= 1;

  return (
    <figure className="m-0 flex flex-col gap-3">
      {/* The caption names the figure for assistive tech; the card heading
          above already carries it visually, so showing both prints the label
          twice. */}
      <figcaption className="sr-only">{label}</figcaption>
      {buckets.length === 0 ? (
        <p className="text-muted-foreground m-0 text-xs">No installs reported in this cut.</p>
      ) : fullySuppressed ? (
        /*
          One bar at 100% labelled "other" is not a chart — it encodes nothing
          and reads as a rendering failure. State the count in words instead,
          and say what would make the breakdown appear.
        */
        <div className="flex flex-col gap-1.5">
          <p className="text-foreground m-0 text-sm">
            All <span className="tabular-nums">{total.toLocaleString("en-US")}</span>{" "}
            {total === 1 ? "install is" : "installs are"} below the reporting floor.
          </p>
          <p className="text-muted-foreground m-0 text-xs text-pretty">
            A bucket needs 5 installs before it is named here.
          </p>
        </div>
      ) : (
        <table className="kunai-chart">
          <caption className="sr-only">
            {label} — installs and share of the snapshot day, largest first.
          </caption>
          <colgroup>
            <col className="kunai-chart-col-label" />
            <col />
            <col className="kunai-chart-col-value" />
            <col className="kunai-chart-col-share" />
          </colgroup>
          <thead className="sr-only">
            <tr>
              <th scope="col">Bucket</th>
              <th scope="col">Relative size</th>
              <th scope="col">Installs</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <ShareRow bucket={bucket} key={bucket.label} />
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
