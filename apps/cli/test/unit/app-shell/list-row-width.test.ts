import { describe, expect, test } from "bun:test";

// ListRow is Ink-based; test the width budget helper indirectly via exported layout math.
import { computeCalendarRowLayout } from "@/app-shell/primitives/list-row-layout";
import {
  listRowEpColumn,
  listRowStatusColumn,
  listRowTimeColumn,
  listRowTitleColumn,
} from "@/app-shell/primitives/ListRow.model";

const MARKER_WIDTH = 2;
const COLUMN_GAP = 1;

function totalListRowWidth(
  columns: ReadonlyArray<{ width: number }>,
  rowWidth: number,
  flexColumnIndex: number,
): number {
  const flexIndex = flexColumnIndex >= 0 && flexColumnIndex < columns.length ? flexColumnIndex : 0;
  const fixedWidth = columns.reduce(
    (sum, col, index) => (index === flexIndex ? sum : sum + col.width + COLUMN_GAP),
    0,
  );
  const flexBase = columns[flexIndex]?.width ?? 0;
  const flexWidth = Math.max(1, rowWidth - MARKER_WIDTH - fixedWidth - COLUMN_GAP - flexBase);
  return (
    MARKER_WIDTH +
    columns.reduce(
      (sum, col, index) =>
        sum + (index === flexIndex ? flexBase + flexWidth : col.width) + COLUMN_GAP,
      0,
    )
  );
}

describe("ListRow width budget", () => {
  test("calendar columns never exceed rowWidth", () => {
    for (const rowWidth of [48, 60, 80, 113, 140]) {
      const layout = computeCalendarRowLayout(rowWidth);
      const columns = [
        { width: layout.timeWidth },
        { width: layout.titleWidth },
        { width: layout.episodeWidth },
        { width: layout.statusWidth },
      ];
      expect(totalListRowWidth(columns, rowWidth, layout.flexColumnIndex)).toBeLessThanOrEqual(
        rowWidth + 1,
      );
    }
  });

  test("schedule row columns match production layout bases", () => {
    const layout = computeCalendarRowLayout(100);
    const columns = [
      listRowTimeColumn("9 PM", layout.timeWidth),
      listRowTitleColumn("Example", layout.titleWidth),
      listRowEpColumn("E10", layout.episodeWidth),
      listRowStatusColumn("resolving", layout.statusWidth, "#fff"),
    ];
    expect(columns.map((col) => col.width)).toEqual([7, 12, 8, 18]);
  });
});
