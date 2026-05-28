import { StateBlock } from "@/app-shell/primitives/StateBlock";
import { palette } from "@/app-shell/shell-theme";
import { Box, Text } from "ink";
import React from "react";

import { captureSurface } from "./render-capture";

function LibraryShellPreview() {
  const tab: "library" | "queue" = "library";
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="row" columnGap={3}>
        <Text color={tab === "library" ? palette.accent : palette.dim} bold={tab === "library"}>
          {tab === "library" ? "▸ " : "  "}Library
        </Text>
        <Text color={palette.dim}> Queue</Text>
      </Box>
      <Text color={palette.dim} dimColor>
        downloads on · runway: title opt-in
      </Text>
      <Box marginTop={1}>
        <StateBlock
          model={{
            kind: "empty",
            title: "Offline library is empty",
            detail: "Download an episode from playback to see it here.",
          }}
          width={72}
        />
      </Box>
    </Box>
  );
}

await captureSurface("library-empty", <LibraryShellPreview />);
console.log("captured library shell preview");
process.exit(0);
