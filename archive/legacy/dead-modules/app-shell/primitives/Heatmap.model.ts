import { heatBucket } from "../format/heatmap";
import { heatColor, statsHeatCellColor } from "../shell-theme";

export type HeatRow = { readonly label: string; readonly values: readonly number[] };

export function heatmapCellColor(value: number, max: number, tintHex?: string): string {
  const bucket = heatBucket(value, max);
  if (tintHex) return statsHeatCellColor(bucket, tintHex);
  return heatColor(bucket);
}
