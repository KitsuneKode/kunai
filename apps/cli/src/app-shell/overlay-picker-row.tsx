import { Text } from "ink";

import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";

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
  const prefix = input.selected ? "❯ " : "  ";
  const row = formatPickerOptionRow({
    label: input.label,
    detail: input.detail,
    badge: input.badge,
    width: Math.max(0, input.width - prefix.length),
  });
  return { prefix, ...row };
}

export function PickerOptionRow({
  label,
  detail,
  badge,
  width,
  selected,
  accentColor,
  pickerAccent,
}: {
  readonly label: string;
  readonly detail?: string;
  readonly badge?: string;
  readonly width: number;
  readonly selected: boolean;
  readonly accentColor: string | null;
  readonly pickerAccent: string;
}) {
  const row = formatPickerDisplayRow({
    label,
    detail,
    badge,
    width,
    selected,
  });

  return (
    <>
      <Text color={selected ? pickerAccent : palette.gray}>{row.prefix}</Text>
      <Text color={selected ? pickerAccent : (accentColor ?? palette.text)} wrap="truncate-end">
        {row.text}
      </Text>
      {row.badgeSuffix ? (
        <Text color={selected ? pickerAccent : (accentColor ?? palette.gray)} wrap="truncate-end">
          {row.badgeSuffix}
        </Text>
      ) : null}
    </>
  );
}
