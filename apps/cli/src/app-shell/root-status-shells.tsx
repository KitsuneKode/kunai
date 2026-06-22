import { resolveContentKind, showsEpisodeLabel } from "@/domain/media/content-kind";
import type { ErrorScenario } from "@/domain/playback/playback-problem";
import type { SessionState } from "@/domain/session/SessionState";
import { Box, Text, useInput } from "ink";
import React from "react";

import { extractErrorDebugExcerpt } from "./error-debug-excerpt";
import type {
  PlaybackFailureWaterfallModel,
  PlaybackFailureWaterfallRow,
} from "./playback-failure-waterfall";
import { palette } from "./shell-theme";

export type { ErrorScenario } from "@/domain/playback/playback-problem";

export function RootIdleShell({ state }: { state: SessionState }) {
  const currentTitle = state.currentTitle;
  const hasSession = !!currentTitle;
  const currentEpisode =
    state.currentEpisode && showsEpisodeLabel(currentTitle)
      ? `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(
          state.currentEpisode.episode,
        ).padStart(2, "0")}`
      : null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {hasSession ? (
        <Box flexDirection="column" gap={0}>
          <Text color={palette.dim} dimColor>
            {resolveContentKind(currentTitle, state.mode)}
          </Text>
          <Box marginTop={1}>
            <Text color={palette.accent}>{"⏸  "}</Text>
            <Text color={palette.text} bold>
              {currentTitle?.name ?? "Current session"}
            </Text>
            {currentEpisode ? <Text color={palette.muted}>{`  ${currentEpisode}`}</Text> : null}
          </Box>
          <Box marginTop={1}>
            <Text color={palette.dim} dimColor>
              {"/history to continue  ·  /calendar for today  ·  / for commands"}
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" gap={0}>
          <Text color={palette.text} bold>
            {"◈  welcome to kunai"}
          </Text>
          <Box marginTop={1}>
            <Text color={palette.dim}>
              {"search for a title to begin  ·  /discover for recommendations"}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function ScenarioDetail({ scenario }: { scenario: ErrorScenario }) {
  switch (scenario.kind) {
    case "provider-timeout":
      return (
        <Box flexDirection="column">
          <Text color={palette.danger}>
            {"✗  timed out after "}
            {scenario.elapsedSec}
            {"s"}
          </Text>
          <Text color={palette.dim} dimColor>
            {scenario.providerName}
          </Text>
          <Text color={palette.dim} dimColor>
            r retry · /fallback for another provider
          </Text>
        </Box>
      );
    case "stream-broken":
      return (
        <Box flexDirection="column">
          <Text color={palette.danger}>{"✗  stream interrupted"}</Text>
          <Text color={palette.dim} dimColor>
            {`attempt ${scenario.attempt} of ${scenario.maxAttempts}`}
          </Text>
          <Text color={palette.dim} dimColor>
            r retry · /recover to refresh the stream
          </Text>
        </Box>
      );
    case "network-offline":
      return (
        <Box flexDirection="column">
          <Text color={palette.dim}>{"○  offline"}</Text>
          <Text color={palette.accent}>/library for downloaded titles</Text>
        </Box>
      );
    case "provider-session":
      return (
        <Box flexDirection="column">
          <Text color={palette.danger}>{`●  ${scenario.providerName} session required`}</Text>
          <Text color={palette.dim} dimColor>
            /settings · add Videasy session token
          </Text>
          <Text color={palette.dim} dimColor>
            /fallback for another provider
          </Text>
        </Box>
      );
    case "title-unavailable":
      return (
        <Box flexDirection="column">
          <Text color={palette.dim}>{`◌  ${scenario.title} not found`}</Text>
          <Text color={palette.dim} dimColor>
            r retry · /watchlist to save for later
          </Text>
        </Box>
      );
  }
}

export function ErrorShell({
  message,
  scenario,
  waterfall,
  debugEnabled = false,
  debugError,
  onResolve,
  onRetry,
}: {
  message: string;
  scenario?: ErrorScenario;
  waterfall?: PlaybackFailureWaterfallModel | null;
  debugEnabled?: boolean;
  debugError?: unknown;
  onResolve: () => void;
  onRetry?: () => void;
}) {
  const debugExcerpt = debugEnabled ? extractErrorDebugExcerpt(debugError) : null;

  useInput((input, key) => {
    if (key.return || key.escape) {
      onResolve();
      return;
    }
    if (input.toLowerCase() === "r" && onRetry) {
      onRetry();
    }
  });

  return (
    <Box
      flexDirection="row"
      marginTop={1}
      borderStyle="round"
      borderColor={palette.danger}
      paddingX={1}
    >
      <Text color={palette.danger}>{"│ "}</Text>
      <Box flexDirection="column" flexGrow={1}>
        <Text color={palette.danger} bold>
          Playback failed
        </Text>
        {scenario ? (
          <ScenarioDetail scenario={scenario} />
        ) : (
          <Text color={palette.text}>{message}</Text>
        )}
        {waterfall ? <FailureWaterfall model={waterfall} /> : null}
        {debugExcerpt ? (
          <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={palette.dim}>
            <Text color={palette.dim} dimColor>
              debug
            </Text>
            <Text color={palette.muted}>{debugExcerpt.message}</Text>
            {debugExcerpt.topFrame ? (
              <Text color={palette.dim} dimColor>
                {debugExcerpt.topFrame}
              </Text>
            ) : null}
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text color={palette.dim} dimColor>
            {onRetry ? "r retry  ·  Enter / Esc dismiss" : "Enter / Esc to continue"}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function FailureWaterfall({ model }: { model: PlaybackFailureWaterfallModel }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={palette.dim} dimColor>
        {model.title}
        {model.truncated ? "  ·  more in /diagnostics" : ""}
      </Text>
      {model.rows.map((row) => (
        <FailureWaterfallRow row={row} key={`${row.label}:${row.status}:${row.detail ?? ""}`} />
      ))}
    </Box>
  );
}

function FailureWaterfallRow({ row }: { row: PlaybackFailureWaterfallRow }) {
  const marker = row.status === "succeeded" ? "✓" : row.status === "failed" ? "x" : "·";
  const color =
    row.status === "succeeded"
      ? palette.ok
      : row.status === "failed"
        ? palette.danger
        : palette.dim;
  return (
    <Text color={color}>
      {marker} {row.label}
      {row.detail ? <Text color={palette.dim}>{`  ·  ${row.detail}`}</Text> : null}
    </Text>
  );
}
