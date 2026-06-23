import { Box, Text } from "ink";
import React from "react";

import type { ContinueHubView } from "./continue-hub-view";
import { buildMediaListRowColumns, computeMediaListRowLayout } from "./primitives/list-row-layout";
import { ListRow } from "./primitives/ListRow";
import { ResumeCard } from "./primitives/ResumeCard";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import { palette } from "./shell-theme";

export function ContinueHubShell({
  view,
  rowWidth,
}: {
  readonly view: ContinueHubView;
  readonly rowWidth: number;
}) {
  const effectiveRowWidth = Math.max(32, rowWidth);
  const rowLayout = computeMediaListRowLayout(effectiveRowWidth, {
    hasEpisode: true,
    hasRecency: true,
  });
  const selected = view.flatRows[view.selectedIndex] ?? null;

  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1} paddingX={1}>
      <Text color={palette.text} bold>
        Continue
      </Text>
      <Text color={palette.dim}>Resume first, then local copies and new episodes.</Text>

      {view.state === "empty" ? (
        <StateBlock
          model={{
            kind: "empty",
            title: "Nothing ready to continue",
            detail: "Watch or download something and it will appear here.",
          }}
          width={effectiveRowWidth}
        />
      ) : null}

      {view.state === "success" ? (
        <Box flexDirection="column" flexGrow={1} marginTop={1}>
          {view.items.map((item) => {
            if (item.kind === "section") {
              return <SectionGroup key={`section-${item.label}`} label={item.label} />;
            }
            return (
              <ListRow
                key={`${item.row.id}-${item.flatIndex}`}
                selected={item.selected}
                rowWidth={effectiveRowWidth}
                flexColumnIndex={rowLayout.flexColumnIndex}
                columns={buildMediaListRowColumns({
                  title: item.row.title,
                  episodeCode: item.row.episodeCode,
                  statusLabel: item.row.statusLabel,
                  statusColor: item.row.statusColor,
                  statusDim: item.row.statusDim,
                  recencyLabel: item.row.sourceLabel,
                  layout: rowLayout,
                })}
              />
            );
          })}
        </Box>
      ) : null}

      {selected ? (
        <ResumeCard label={selected.actionLabel} action="↵ enter" width={effectiveRowWidth} />
      ) : null}
    </Box>
  );
}
