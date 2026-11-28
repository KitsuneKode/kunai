import { Box, Text } from "ink";
import React from "react";

import { plainModeEnabled } from "../plain-mode";
import { palette } from "../shell-theme";
import { failoverBannerCopy, type PlaybackFailoverBannerModel } from "./FailoverBanner.model";

export function FailoverBanner({ model }: { readonly model: PlaybackFailoverBannerModel }) {
  const plain = plainModeEnabled();
  const copy = failoverBannerCopy(model);
  const color = model.tone === "error" ? palette.dangerText : palette.warn;
  const prefix = plain ? `${model.tone} ` : "";
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={color} bold>
        {prefix}
        {copy.headline}
      </Text>
      {copy.detail ? <Text color={color}>{copy.detail}</Text> : null}
    </Box>
  );
}
