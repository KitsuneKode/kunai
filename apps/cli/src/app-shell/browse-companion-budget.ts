import { PREVIEW_POSTER_ROWS } from "./browse-shell-view";
import { measureDetailsSheetRowBudget } from "./details-pane-ui";
import type { DetailsPanelData } from "./details-panel";
import {
  BROWSE_LIST_MIN_ROWS,
  getBrowseListMaxVisible,
  getBrowseSharedContentRowBudget,
} from "./layout-policy";
import {
  estimatePreviewRailRowBudget,
  shouldRenderBrowsePreviewRail,
} from "./primitives/PreviewRail.model";
import type { PreviewRailModel } from "./primitives/PreviewRail.model";
import type { ShellPanelLine } from "./types";

export { shouldRenderBrowsePreviewRail };

export type BrowseStackedListLayout = {
  readonly listMaxVisible: number;
  readonly stackedCompanionRows: number;
  readonly showStackedCompanion: boolean;
};

/**
 * Medium browse stacks the companion under the list. The list keeps at least
 * min(item count, BROWSE_LIST_MIN_ROWS) rows when space allows; otherwise the
 * stacked companion is hidden instead of shrinking the list.
 */
export function resolveBrowseStackedListLayout(input: {
  readonly terminalRows: number;
  readonly chromeRows: number;
  readonly listItemCount: number;
  readonly stackedCompanionNaturalRows: number;
  readonly rootHeaderRows?: number;
  readonly transientRows?: number;
}): BrowseStackedListLayout {
  const sharedBudget = getBrowseSharedContentRowBudget(
    input.terminalRows,
    input.chromeRows,
    input.rootHeaderRows,
    input.transientRows,
  );
  const listCap = Math.max(0, Math.min(input.listItemCount, 18));
  const listFloor = Math.min(listCap, BROWSE_LIST_MIN_ROWS, Math.max(1, sharedBudget));
  const natural = input.stackedCompanionNaturalRows;

  if (natural <= 0 || listCap <= 0) {
    return {
      listMaxVisible: Math.max(1, Math.min(listCap || 1, sharedBudget)),
      stackedCompanionRows: 0,
      showStackedCompanion: false,
    };
  }

  const listWithCompanion = getBrowseListMaxVisible(
    input.terminalRows,
    input.chromeRows,
    input.rootHeaderRows,
    input.transientRows,
    natural,
  );
  if (listWithCompanion >= listFloor) {
    return {
      listMaxVisible: listWithCompanion,
      stackedCompanionRows: natural,
      showStackedCompanion: true,
    };
  }

  const listWithoutCompanion = getBrowseListMaxVisible(
    input.terminalRows,
    input.chromeRows,
    input.rootHeaderRows,
    input.transientRows,
    0,
  );
  return {
    listMaxVisible: Math.max(listFloor, listWithoutCompanion),
    stackedCompanionRows: 0,
    showStackedCompanion: false,
  };
}

export function getBrowseStackedCompanionRows(input: {
  readonly showCompanion: boolean;
  readonly companionBesideList: boolean;
  readonly showPreviewRail: boolean;
  readonly previewRailModel: PreviewRailModel | null;
  readonly previewWidth: number;
  readonly companionView: DetailsPanelData;
  readonly detailsLines: readonly ShellPanelLine[];
  readonly detailsMaxVisibleLines: number;
}): number {
  if (!input.showCompanion || input.companionBesideList) return 0;

  const companionRows = input.showPreviewRail
    ? estimatePreviewRailRowBudget(input.previewRailModel, {
        reserveRows: PREVIEW_POSTER_ROWS,
        bodyWidth: Math.max(16, input.previewWidth - 2),
      })
    : measureDetailsSheetRowBudget(
        input.companionView,
        input.detailsLines,
        input.detailsMaxVisibleLines,
        input.previewWidth,
      );

  // Column layout: one row of separation above the stacked companion block.
  return companionRows + 1;
}
