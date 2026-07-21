import type { OfflineLibraryShelfGroup } from "@/domain/offline/OfflineLibraryEngine";
import { isFinished } from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@/services/storage/storage-read-models";

export type LibraryShelfSectionId = "in-progress" | "downloaded" | "needs-attention";

export interface LibraryShelfRow {
  readonly kind: "offline";
  readonly group: OfflineLibraryShelfGroup;
}

export interface LibraryShelfSection {
  readonly id: LibraryShelfSectionId;
  readonly label: string;
  readonly rows: readonly LibraryShelfRow[];
}

const SHELF_SECTION_ORDER: readonly {
  readonly id: LibraryShelfSectionId;
  readonly label: string;
}[] = [
  { id: "in-progress", label: "In progress" },
  { id: "downloaded", label: "Downloaded" },
  { id: "needs-attention", label: "Needs attention" },
];

export function buildLibraryShelfSections(input: {
  readonly groups: readonly OfflineLibraryShelfGroup[];
  readonly historyByTitle: Readonly<Record<string, HistoryProgress>>;
}): readonly LibraryShelfSection[] {
  const buckets: Record<LibraryShelfSectionId, LibraryShelfRow[]> = {
    "in-progress": [],
    downloaded: [],
    "needs-attention": [],
  };

  for (const group of input.groups) {
    buckets[classifyLibrarySection(group, input.historyByTitle)].push({
      kind: "offline",
      group,
    });
  }

  return SHELF_SECTION_ORDER.map(({ id, label }) => ({
    id,
    label,
    rows: buckets[id],
  })).filter((section) => section.rows.length > 0);
}

export function buildLibraryFlatRows(input: {
  readonly groups: readonly OfflineLibraryShelfGroup[];
  readonly historyByTitle: Readonly<Record<string, HistoryProgress>>;
}): readonly LibraryShelfRow[] {
  return buildLibraryShelfSections(input).flatMap((section) => section.rows);
}

export function libraryRowKey(row: LibraryShelfRow): string {
  return row.group.key;
}

export function classifyLibrarySection(
  group: OfflineLibraryShelfGroup,
  historyByTitle: Readonly<Record<string, HistoryProgress>>,
): LibraryShelfSectionId {
  const hist = historyByTitle[group.titleId];
  if (hist && !isFinished(hist) && hist.positionSeconds > 30) {
    const duration = hist.durationSeconds ?? 0;
    const pct = duration > 0 ? (hist.positionSeconds / duration) * 100 : 0;
    if (pct > 0 && pct < 95) return "in-progress";
  }
  if (group.readyCount > 0) return "downloaded";
  return "needs-attention";
}
