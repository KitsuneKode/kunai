import { Box } from "ink";
import React from "react";

import { plainModeEnabled } from "../plain-mode";
import type { PosterResult } from "../poster-types";
import { PreviewRail } from "./PreviewRail";
import { shouldRenderPreviewRail, type PreviewRailModel } from "./PreviewRail.model";

export type MediaListShellProps = {
  readonly columns: number;
  readonly listWidth: number;
  readonly railWidth?: number;
  readonly list: React.ReactNode;
  /** Custom rail content; wins over `railModel` when both are provided. */
  readonly rail?: React.ReactNode;
  readonly railModel?: PreviewRailModel | null;
  readonly poster?: PosterResult;
};

/** Two-pane list + optional preview rail — shared by browse, calendar, history, library. */
export const MediaListShell = React.memo(function MediaListShell({
  columns,
  listWidth,
  railWidth = 32,
  list,
  rail,
  railModel,
  poster,
}: MediaListShellProps) {
  const plain = plainModeEnabled();
  const hasRail = rail !== undefined || (railModel !== undefined && railModel !== null);
  const showRail = plain ? hasRail : shouldRenderPreviewRail({ columns, hasModel: hasRail });
  if (plain) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="column">{list}</Box>
        {showRail ? (
          <Box flexDirection="column">
            {rail ??
              (railModel ? (
                <PreviewRail model={railModel} width={Math.max(40, columns - 2)} poster={poster} />
              ) : null)}
          </Box>
        ) : null}
      </Box>
    );
  }
  return (
    <Box flexDirection={showRail ? "row" : "column"} justifyContent="space-between" flexGrow={1}>
      <Box flexDirection="column" width={showRail ? listWidth : undefined}>
        {list}
      </Box>
      {showRail ? (
        <Box marginLeft={2} flexDirection="column">
          {rail ??
            (railModel ? (
              <PreviewRail model={railModel} width={railWidth} poster={poster} />
            ) : null)}
        </Box>
      ) : null}
    </Box>
  );
});
