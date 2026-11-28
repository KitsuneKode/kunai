import { MANAGED_MPV_CAPABILITIES } from "@/domain/playback/player-capabilities";
import { Box, Text } from "ink";
import React from "react";

import {
  buildNowPlayingGoStrip,
  playbackHasSkippableSegment,
  type NowPlayingGoStripModel,
} from "./now-playing-go-strip.model";
import { plainModeEnabled } from "./plain-mode";
import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import type { LoadingShellState } from "./types";

export function NowPlayingGoStrip({
  state,
  width,
  canOpenTracks,
}: {
  readonly state: Pick<
    LoadingShellState,
    | "contentKind"
    | "titleType"
    | "hasNextEpisode"
    | "hasPreviousEpisode"
    | "currentPosition"
    | "playerCapabilities"
    | "skipTiming"
  >;
  readonly width: number;
  readonly canOpenTracks: boolean;
}) {
  const model = buildNowPlayingGoStrip({
    contentKind: state.contentKind,
    titleType: state.titleType,
    hasNextEpisode: Boolean(state.hasNextEpisode),
    hasPreviousEpisode: Boolean(state.hasPreviousEpisode),
    hasSkippableSegment: playbackHasSkippableSegment(state.skipTiming, state.currentPosition),
    canOpenTracks,
    capabilities: state.playerCapabilities ?? MANAGED_MPV_CAPABILITIES,
    width,
  });
  return <NowPlayingGoStripView model={model} width={width} />;
}

export function NowPlayingGoStripView({
  model,
  width,
}: {
  readonly model: NowPlayingGoStripModel;
  readonly width: number;
}) {
  if (!model.line && !model.limitation) return null;
  const plain = plainModeEnabled();
  const color = plain ? palette.text : palette.muted;
  return (
    <Box marginTop={1} flexDirection="column">
      {model.line ? (
        <Text color={color}>{truncateLine(model.line, Math.max(8, width))}</Text>
      ) : null}
      {model.limitation ? (
        <Text color={color}>{truncateLine(model.limitation, Math.max(8, width))}</Text>
      ) : null}
    </Box>
  );
}
