import { buildBrowseIdleReturnLoopModel } from "@/app-shell/browse-idle-actions";
import { Box, Text } from "ink";
import React from "react";

import { captureSurface } from "./render-capture";

function BrowseIdleReturnLoopPreview() {
  const model = buildBrowseIdleReturnLoopModel(
    {
      continueWatching: {
        title: "Frieren: Beyond Journey's End",
        ep: "S01E28",
        titleId: "tmdb:123",
        mediaKind: "series",
      },
      todayReleaseCount: 2,
      todayReleaseTitleCount: 1,
    },
    { idleFocused: true },
  );
  if (!model) return <Text>no idle model</Text>;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Search · idle return loop</Text>
      {model.rows.map((row) => (
        <Text key={row.id}>
          {row.focused ? "▌ " : "  "}
          {row.glyph} {row.title}
          {row.meta ? `  ${row.meta}` : ""}
          {row.hint ? ` · ${row.hint}` : ""}
        </Text>
      ))}
    </Box>
  );
}

await captureSurface("browse-idle-return-loop", <BrowseIdleReturnLoopPreview />);
console.log("captured browse idle return loop");
process.exit(0);
