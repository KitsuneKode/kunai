import type { ErrorScenario } from "@/domain/playback/playback-problem";
import type { SessionState } from "@/domain/session/SessionState";
import { Box, Text, useInput } from "ink";
import React from "react";

import { palette } from "./shell-theme";

export type { ErrorScenario } from "@/domain/playback/playback-problem";

export function RootIdleShell({ state }: { state: SessionState }) {
  const hasSession = !!state.currentTitle;
  const currentEpisode = state.currentEpisode
    ? `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(
        state.currentEpisode.episode,
      ).padStart(2, "0")}`
    : null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {hasSession ? (
        <Box flexDirection="column" gap={0}>
          <Text color={palette.dim} dimColor>
            {state.mode === "anime" ? "anime" : "series"}
          </Text>
          <Box marginTop={1}>
            <Text color={palette.amber}>{"⏸  "}</Text>
            <Text color="white" bold>
              {state.currentTitle!.name}
            </Text>
            {currentEpisode ? <Text color={palette.teal}>{`  ${currentEpisode}`}</Text> : null}
          </Box>
          <Box marginTop={1}>
            <Text color={palette.dim} dimColor>
              {"/history to continue  ·  /calendar for today  ·  / for commands"}
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" gap={0}>
          <Text color={palette.amber}>{"◈  welcome to kunai"}</Text>
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
          <Text color={palette.amber}>
            {"◌  timed out after "}
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
          <Text color={palette.amber}>{"⚠  stream interrupted"}</Text>
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
          <Text color={palette.amber}>/library for downloaded titles</Text>
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
  onResolve,
  onRetry,
}: {
  message: string;
  scenario?: ErrorScenario;
  onResolve: () => void;
  onRetry?: () => void;
}) {
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
    <Box flexDirection="row" marginTop={1}>
      <Text color={palette.red}>{"│ "}</Text>
      <Box flexDirection="column">
        <Text color={palette.red} bold>
          Playback failed
        </Text>
        {scenario ? (
          <ScenarioDetail scenario={scenario} />
        ) : (
          <Text color={palette.text}>{message}</Text>
        )}
        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            {onRetry ? "r retry  ·  Enter / Esc dismiss" : "Enter / Esc to continue"}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
