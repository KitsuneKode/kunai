import { PREVIEW_POSTER_ROWS } from "./browse-shell-view";
import { measureDetailsSheetRowBudget } from "./details-pane-ui";
import type { DetailsPanelData } from "./details-panel";
import {
  estimatePreviewRailRowBudget,
  shouldRenderBrowsePreviewRail,
} from "./primitives/PreviewRail.model";
import type { PreviewRailModel } from "./primitives/PreviewRail.model";
import type { ShellPanelLine } from "./types";

export { shouldRenderBrowsePreviewRail };

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
