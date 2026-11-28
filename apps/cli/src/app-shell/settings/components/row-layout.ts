import { measureColumns, truncateLine } from "../../shell-text";

/** Fit label + right-hand state on one terminal row; the label yields first. */
export function fitSettingsRowText(input: {
  readonly width: number;
  readonly prefix: string;
  readonly label: string;
  readonly value?: string;
  readonly plain: boolean;
}): { readonly label: string; readonly separator: string; readonly value: string } {
  const value = input.value ?? "";
  const separator = value ? (input.plain ? ": " : " · ") : "";
  const prefixWidth = measureColumns(input.prefix);
  const available = Math.max(0, input.width - prefixWidth);
  const valueWidth = measureColumns(value);
  const separatorWidth = measureColumns(separator);
  let labelWidth = available - valueWidth - separatorWidth;
  if (labelWidth < 1) {
    // The state never wraps. At extreme widths it is the only thing that can
    // still be shown; the label disappears rather than colliding with it.
    const fittedValue = truncateLine(value, Math.max(0, available - separatorWidth));
    return { label: "", separator: fittedValue ? separator : "", value: fittedValue };
  }
  return { label: truncateLine(input.label, labelWidth), separator, value };
}
