import type {
  DiagnosticSeverity,
  DiagnosticsHealthRow,
} from "@/services/diagnostics/diagnostics-insight";

export type DiagnosticsSectionId = "attention" | "unknown" | "ok";

export interface DiagnosticsSection {
  readonly id: DiagnosticsSectionId;
  readonly title: string;
  readonly rows: readonly DiagnosticsHealthRow[];
}

const SECTION_TITLES: Record<DiagnosticsSectionId, string> = {
  attention: "Needs attention",
  unknown: "Not measured yet",
  ok: "Healthy",
};

/** Rendering order. Whatever the user must act on comes first. */
const SECTION_ORDER: readonly DiagnosticsSectionId[] = ["attention", "unknown", "ok"];

/**
 * Exhaustive by construction: adding a severity without deciding where it
 * belongs is a type error rather than a row that silently reads as a fault.
 */
function sectionFor(severity: DiagnosticSeverity): DiagnosticsSectionId {
  switch (severity) {
    case "healthy":
      return "ok";
    case "unknown":
      return "unknown";
    case "degraded":
    case "recoverable":
    case "blocked":
      return "attention";
  }
}

/**
 * Group health rows by what the user must do about them.
 *
 * Grouping by subsystem — the previous shape — put a broken integration, a
 * subsystem with no data yet, and a perfectly healthy one in the same visual
 * channel, so nothing stood out and "Unknown" read as a fault. Actionability is
 * the axis that matters when someone opens diagnostics.
 *
 * Empty sections are omitted so a healthy session shows one short block rather
 * than three headings and a lot of nothing.
 */
export function buildDiagnosticsSections(
  rows: readonly DiagnosticsHealthRow[],
): readonly DiagnosticsSection[] {
  const grouped = new Map<DiagnosticsSectionId, DiagnosticsHealthRow[]>();
  for (const row of rows) {
    const id = sectionFor(row.severity);
    const bucket = grouped.get(id);
    if (bucket) bucket.push(row);
    else grouped.set(id, [row]);
  }

  return SECTION_ORDER.flatMap((id) => {
    const sectionRows = grouped.get(id);
    if (!sectionRows || sectionRows.length === 0) return [];
    return [{ id, title: SECTION_TITLES[id], rows: sectionRows }];
  });
}
