export type ActionRowTone = "normal" | "success" | "warning" | "danger" | "muted";

export type ActionRowModel = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly shortcut?: string;
  readonly tone?: ActionRowTone;
  readonly disabledReason?: string;
};

export function normalizeActionShortcut(shortcut: string): string {
  return shortcut.replace(/^\[/u, "").replace(/\]$/u, "");
}

export function getEnabledActionRows(rows: readonly ActionRowModel[]): readonly ActionRowModel[] {
  return rows.filter((row) => !row.disabledReason);
}
