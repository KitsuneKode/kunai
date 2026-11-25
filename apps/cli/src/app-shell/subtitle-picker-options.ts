import type { ShellPickerOption } from "@/app-shell/types";

export type SubtitlePickerEntry = {
  readonly url: string;
  readonly display?: string;
  readonly language?: string;
  readonly release?: string;
  readonly sourceKind?: "embedded" | "external";
  readonly sourceName?: string;
};

function describeSubtitleEntry(entry: SubtitlePickerEntry): string {
  const parts = [entry.language ?? "unknown"];
  if (entry.sourceKind === "embedded") {
    parts.push("built-in");
  } else if (entry.sourceKind === "external") {
    parts.push("external");
  }
  if (entry.sourceName) {
    parts.push(entry.sourceName);
  }
  if (entry.release) {
    parts.push(entry.release);
  }
  return parts.join("  ·  ");
}

/**
 * Picker rows for a subtitle inventory. The inventory keeps same-file tracks
 * apart when their language cannot be told, so two rows can share a label and
 * detail; those are numbered so the picker never shows indistinguishable rows.
 */
export function buildSubtitlePickerOptions(
  entries: readonly SubtitlePickerEntry[],
): ShellPickerOption<string>[] {
  const rows = entries.map((entry) => ({
    value: entry.url,
    label: entry.display ?? entry.language ?? "Unknown track",
    detail: describeSubtitleEntry(entry),
  }));
  const identity = (row: (typeof rows)[number]) => `${row.label}\u0000${row.detail}`;
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(identity(row), (totals.get(identity(row)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = identity(row);
    if ((totals.get(key) ?? 0) < 2) return row;
    const ordinal = (seen.get(key) ?? 0) + 1;
    seen.set(key, ordinal);
    return { ...row, label: `${row.label} (${ordinal})` };
  });
}
