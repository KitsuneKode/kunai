import { Text } from "ink";

import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";

export function PickerOptionRow({
  label,
  detail,
  badge,
  width,
  selected,
  accentColor,
  pickerAccent,
  labelColor,
}: {
  readonly label: string;
  readonly detail?: string;
  readonly badge?: string;
  readonly width: number;
  readonly selected: boolean;
  readonly accentColor: string | null;
  readonly pickerAccent: string;
  /** Force the label hue (destructive rows go red even unselected). Overrides the neutral default. */
  readonly labelColor?: string;
}) {
  // Treatment C: a single accent bar marks the selected row (paired with the
  // elevated row surface), instead of a chevron stacked under other markers.
  const prefix = selected ? "▌ " : "  ";
  const badgeSuffix = badge ? `  ${badge}` : "";
  // Budget: width minus prefix (2) and badge
  const contentWidth = Math.max(0, width - prefix.length - badgeSuffix.length);
  const truncatedLabel = truncateLine(label, contentWidth);
  // Detail only shown when label leaves room (at least 5 chars)
  const detailBudget = contentWidth - truncatedLabel.length - 2;
  const truncatedDetail =
    detail && detailBudget >= 5 ? truncateLine(detail, detailBudget) : undefined;

  return (
    <>
      <Text color={selected ? pickerAccent : palette.dim}>{prefix}</Text>
      {/* Titles win by weight, never by hue (Sakura): the label stays neutral;
          only the trailing badge carries the state color (accentColor). */}
      <Text color={labelColor ?? (selected ? pickerAccent : palette.text)} wrap="truncate-end">
        {truncatedLabel}
      </Text>
      {truncatedDetail ? (
        <Text color={selected ? palette.dim : palette.muted} wrap="truncate-end">
          {"  "}
          {truncatedDetail}
        </Text>
      ) : null}
      {badgeSuffix ? (
        <Text color={selected ? pickerAccent : (accentColor ?? palette.dim)} wrap="truncate-end">
          {badgeSuffix}
        </Text>
      ) : null}
    </>
  );
}
