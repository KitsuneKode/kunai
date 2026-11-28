import { formatTimestamp } from "@/services/continuation/history-progress";
import { Box, Text } from "ink";
import React from "react";

import { plainModeEnabled, selectionPrefix } from "./plain-mode";
import { buildPlaybackRecoveryViewModel } from "./playback-recovery-view-model";
import { padColumnsEnd, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import type { LoadingShellState } from "./types";

/**
 * Failure & recovery surface: one primary recover action, preserved-progress
 * fact, and diagnostics kept off the primary row.
 */
export const PlaybackRecoveryView = React.memo(function PlaybackRecoveryView({
  model,
  state,
  width,
}: {
  model: NonNullable<ReturnType<typeof buildPlaybackRecoveryViewModel>>;
  state: Pick<LoadingShellState, "currentPosition" | "duration" | "progress">;
  width: number;
}) {
  const plain = plainModeEnabled();
  const { state: block } = model;
  const isLiveFault = block.kind === "error";
  const titleColor = isLiveFault ? palette.dangerText : palette.accentDeep;
  const glyph = plain ? (isLiveFault ? "Error:" : "Recovery:") : isLiveFault ? "×" : "◐";

  const hasPosition =
    state.currentPosition !== undefined &&
    Number.isFinite(state.currentPosition) &&
    state.currentPosition > 0;
  const hasProgress =
    state.progress !== undefined && Number.isFinite(state.progress) && state.progress > 0;
  const preservedFact: string | null = hasPosition
    ? `${formatTimestamp(state.currentPosition ?? 0)} saved`
    : hasProgress
      ? `${Math.round(state.progress ?? 0)}% saved`
      : null;

  const primaryAction = block.actions?.find((action) => action.id === "recover");
  const secondaryActions =
    block.actions?.filter((action) => action.id !== "recover" && action.id !== "diagnostics") ?? [];
  const hasDiagnostics = block.actions?.some((action) => action.id === "diagnostics") ?? false;
  const detailWidth = Math.max(10, width - 28);

  return (
    <Box flexDirection="column">
      <Text color={titleColor} bold>
        {glyph} {block.title}
      </Text>
      {preservedFact ? (
        <Box marginTop={1}>
          <Text color={palette.muted}>{"progress  "}</Text>
          <Text color={palette.ok}>{preservedFact}</Text>
          <Text color={palette.muted}>{" · "}</Text>
          <Text color={palette.ok}>not marked watched</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={palette.ok}>not marked watched</Text>
        </Box>
      )}
      {primaryAction ? (
        <Box marginTop={1}>
          <Text color={palette.accent} bold>
            {selectionPrefix(true, plain)}
          </Text>
          <Text color={palette.accent} bold>
            {padColumnsEnd(primaryAction.label, 16)}
          </Text>
          <Text color={palette.muted}>{truncateLine(primaryAction.detail ?? "", detailWidth)}</Text>
          <Text color={palette.accent}>
            {primaryAction.shortcut ? `  ${primaryAction.shortcut}` : ""}
          </Text>
        </Box>
      ) : null}
      {secondaryActions.length > 0 ? (
        <Box flexDirection="column">
          {secondaryActions.map((action) => (
            <Box key={action.id}>
              <Text color={palette.dim}>{"  "}</Text>
              <Text color={palette.textDim}>{padColumnsEnd(action.label, 16)}</Text>
              <Text color={palette.dim}>{truncateLine(action.detail ?? "", detailWidth)}</Text>
              <Text color={palette.dim}>{action.shortcut ? `  ${action.shortcut}` : ""}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      {hasDiagnostics ? (
        <Box marginTop={1}>
          <Text color={palette.dim} dimColor>
            [d] diagnostics
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
