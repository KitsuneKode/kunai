import type { SessionState } from "@/domain/session/SessionState";
import { Box, Text, useInput } from "ink";
import React from "react";

import { LocalSection } from "./shell-primitives";
import { palette } from "./shell-theme";

export function RootIdleShell({ state }: { state: SessionState }) {
  const currentTitle = state.currentTitle?.name ?? "No title selected yet";
  const currentEpisode = state.currentEpisode
    ? `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(
        state.currentEpisode.episode,
      ).padStart(2, "0")}`
    : null;
  const hasSearchResults = state.searchResults.length > 0;

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
      <Box flexDirection="column">
        <Text bold color="white">
          {state.mode === "anime"
            ? "Browse anime and keep playback command-ready"
            : "Browse your favorite movies and series"}
        </Text>
        <Text color={palette.muted}>
          {hasSearchResults
            ? `${state.searchResults.length} results are still loaded. Keep browsing or continue playback.`
            : "The fullscreen shell is ready. Search, review details, and continue without dropping back to the terminal."}
        </Text>

        <LocalSection title="Current session" tone="info" marginTop={2}>
          <Text color="white">{currentTitle}</Text>
          <Text color={palette.muted}>
            {currentEpisode
              ? `${currentEpisode}  ·  Ready to resume episode flow`
              : hasSearchResults
                ? "Search results are available and ready to reopen"
                : "Start with a title search or switch modes"}
          </Text>
        </LocalSection>

        <LocalSection title="Fast paths" tone="success">
          <Text color="white">/history or --continue</Text>
          <Text color={palette.muted}>
            Resume the newest unfinished item without treating history like a hidden tool.
          </Text>
          <Text color="white">/offline or --offline</Text>
          <Text color={palette.muted}>
            Open completed local downloads first. Use /downloads for the queue.
          </Text>
        </LocalSection>

        {state.searchQuery.trim().length > 0 ? (
          <LocalSection title="Search context" tone="success">
            <Text color="white">{state.searchQuery}</Text>
            <Text color={palette.muted}>
              {hasSearchResults
                ? `${state.searchResults.length} results cached in this session`
                : "Query is loaded and ready for the next browse pass"}
            </Text>
          </LocalSection>
        ) : null}
      </Box>

      <Box marginTop={2}>
        <Text color={palette.gray} dimColor italic>
          Preparing the next fullscreen panel…
        </Text>
      </Box>
    </Box>
  );
}

export function ErrorShell({
  message,
  onResolve,
  onRetry,
}: {
  message: string;
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
    <Box flexDirection="column" borderStyle="round" borderColor={palette.red} paddingX={1}>
      <Box marginBottom={1}>
        <Text color={palette.red} bold>
          ⚠ Playback Error
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text color="white">{message}</Text>
      </Box>
      <Box>
        <Text color={palette.gray} dimColor>
          {onRetry ? "R retry  ·  Enter / Esc dismiss" : "Enter / Esc to continue"}
        </Text>
      </Box>
    </Box>
  );
}
