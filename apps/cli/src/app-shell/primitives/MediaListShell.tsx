import { Box } from "ink";
import React from "react";

import type { PosterResult } from "../poster-types";
import { PreviewRail, type PreviewRailModel, shouldRenderPreviewRail } from "./PreviewRail";

/** Two-pane list + optional preview rail — shared by browse, calendar, history, library. */
export const MediaListShell = React.memo(function MediaListShell({
  columns,
  listWidth,
  railWidth = 32,
  list,
  railModel,
  poster,
}: {
  readonly columns: number;
  readonly listWidth: number;
  readonly railWidth?: number;
  readonly list: React.ReactNode;
  readonly railModel: PreviewRailModel | null;
  readonly poster?: PosterResult;
}) {
  const showRail = shouldRenderPreviewRail({ columns, hasModel: railModel !== null });
  return (
    <Box flexDirection={showRail ? "row" : "column"} justifyContent="space-between" flexGrow={1}>
      <Box flexDirection="column" width={showRail ? listWidth : undefined}>
        {list}
      </Box>
      {showRail && railModel ? (
        <Box marginLeft={2} flexDirection="column">
          <PreviewRail model={railModel} width={railWidth} poster={poster} />
        </Box>
      ) : null}
    </Box>
  );
});
