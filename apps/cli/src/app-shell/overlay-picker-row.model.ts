import { truncateLine } from "./shell-text";

export function formatPickerOptionRow(input: {
  readonly label: string;
  readonly detail?: string;
  readonly badge?: string;
  readonly width: number;
}): { readonly text: string; readonly badgeSuffix: string } {
  const badgeSuffix = input.badge ? `  ${input.badge}` : "";
  const textWidth = Math.max(0, input.width - badgeSuffix.length);
  const text = truncateLine(`${input.label}${input.detail ? `  ${input.detail}` : ""}`, textWidth);
  return { text, badgeSuffix };
}

export function formatPickerDisplayRow(input: {
  readonly label: string;
  readonly detail?: string;
  readonly badge?: string;
  readonly width: number;
  readonly selected: boolean;
}): { readonly prefix: string; readonly text: string; readonly badgeSuffix: string } {
  const prefix = input.selected ? "▌ " : "  ";
  const row = formatPickerOptionRow({
    label: input.label,
    detail: input.detail,
    badge: input.badge,
    width: Math.max(0, input.width - prefix.length),
  });
  return { prefix, ...row };
}
