/**
 * Ink surface for the series + anime playback walkthrough.
 *
 * Interactive: VHS types into BrowseShell, arrows the episode list, waits out
 * resolve, supervises playing at 1×, then `q` to post-play and `/anime` to
 * switch lanes. Fixtures only — no providers, mpv, or analytics.
 */

import { BrowseShell } from "@/app-shell/browse-shell";
import { COMMAND_CONTEXTS } from "@/app-shell/commands";
import { LoadingShell } from "@/app-shell/loading-shell";
import { PostPlayShell } from "@/app-shell/post-play-shell";
import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";
import { fallbackCommandState } from "@/app-shell/shell-command-model";
import { ShellFrame } from "@/app-shell/shell-frame";
import { APP_LABEL, palette } from "@/app-shell/shell-theme";
import type { ShellAction } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";
import { Box, Text } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  SEARCH_DELAY_MS,
  RESOLVE_DURATION_MS,
  clampPostPlayActionIndex,
  episodeRowsFor,
  laneAfterShellAction,
  playingState,
  postPlayProps,
  providerFor,
  resolvingState,
  searchResultsFor,
  titleFor,
  type WalkthroughLane,
  type WalkthroughPhase,
} from "./playback-walkthrough-scenes";

const TICK_MS = 100;
const BROWSE_COMMANDS = fallbackCommandState(SEARCH_BROWSE_COMMAND_IDS);
const PICKER_COMMANDS = fallbackCommandState(COMMAND_CONTEXTS.modalPicker);
const PLAYBACK_COMMANDS = fallbackCommandState(COMMAND_CONTEXTS.activePlayback);
const POST_PLAY_COMMANDS = fallbackCommandState([
  "next",
  "replay",
  "search",
  "anime-mode",
  "series-mode",
  "toggle-mode",
  "help",
  "quit",
]);

function noop(): void {}

function EpisodePicker({
  lane,
  onPlay,
  onBack,
  onShellAction,
}: {
  readonly lane: WalkthroughLane;
  readonly onPlay: () => void;
  readonly onBack: () => void;
  readonly onShellAction: (action: ShellAction) => void;
}) {
  const rows = episodeRowsFor(lane);
  const [selected, setSelected] = useState(0);
  const lastIndex = Math.max(0, rows.length - 1);

  return (
    <ShellFrame
      eyebrow={APP_LABEL}
      title={titleFor(lane)}
      subtitle="Pick episode"
      status={{ label: providerFor(lane), tone: "info" }}
      footerTask="Episode"
      footerMode="minimal"
      footerActions={[
        { key: "enter", label: "play", primary: true },
        { key: "esc", label: "back" },
      ]}
      commands={PICKER_COMMANDS}
      escapeAction="back-to-results"
      onUnhandledInput={(_input, key) => {
        if (key.upArrow) {
          setSelected((index) => Math.max(0, index - 1));
          return;
        }
        if (key.downArrow) {
          setSelected((index) => Math.min(lastIndex, index + 1));
          return;
        }
        if (key.return) onPlay();
      }}
      onResolve={(action) => {
        if (action === "back-to-results") {
          onBack();
          return;
        }
        onShellAction(action);
      }}
    >
      <Box flexDirection="column" paddingX={1}>
        {rows.map((row, index) => {
          const focused = index === selected;
          return (
            <Text key={row.id} color={focused ? palette.text : palette.textDim} bold={focused}>
              {focused ? "▌ " : "  "}
              {row.label}
              <Text color={palette.muted}>{`  ${row.detail}`}</Text>
            </Text>
          );
        })}
      </Box>
    </ShellFrame>
  );
}

function PostPlayView({
  lane,
  onShellAction,
}: {
  readonly lane: WalkthroughLane;
  readonly onShellAction: (action: ShellAction) => void;
}) {
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const props = postPlayProps(lane);

  return (
    <ShellFrame
      eyebrow={APP_LABEL}
      title={titleFor(lane)}
      subtitle={props.episodeLabel}
      contentOnlyChrome
      status={{ label: providerFor(lane), tone: "info" }}
      footerTask="Post-play"
      footerMode="minimal"
      footerActions={[
        { key: "/", label: "commands" },
        { key: "esc", label: "search" },
      ]}
      commands={POST_PLAY_COMMANDS}
      escapeAction="search"
      onUnhandledInput={(_input, key) => {
        if (key.upArrow) {
          setSelectedActionIndex((index) => clampPostPlayActionIndex(index - 1));
          return;
        }
        if (key.downArrow) {
          setSelectedActionIndex((index) => clampPostPlayActionIndex(index + 1));
        }
      }}
      onResolve={onShellAction}
    >
      <PostPlayShell {...props} selectedActionIndex={selectedActionIndex} />
    </ShellFrame>
  );
}

export function PlaybackWalkthroughApp() {
  const [lane, setLane] = useState<WalkthroughLane>("series");
  const [phase, setPhase] = useState<WalkthroughPhase>("browse");
  const [browseEpoch, setBrowseEpoch] = useState(0);
  const [, setTick] = useState(0);
  const phaseStartedAt = useRef(Date.now());

  const goPhase = useCallback((next: WalkthroughPhase) => {
    phaseStartedAt.current = Date.now();
    setPhase(next);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((value) => value + 1);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (phase !== "resolving") return;
    const timer = setTimeout(() => {
      goPhase("playing");
    }, RESOLVE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [goPhase, phase]);

  const sceneElapsedMs = Date.now() - phaseStartedAt.current;

  const openBrowse = useCallback(
    (nextLane: WalkthroughLane) => {
      phaseStartedAt.current = Date.now();
      setLane(nextLane);
      goPhase("browse");
      setBrowseEpoch((value) => value + 1);
    },
    [goPhase],
  );

  const handleShellAction = useCallback(
    (action: ShellAction) => {
      const nextLane = laneAfterShellAction(lane, action);
      if (nextLane) {
        openBrowse(nextLane);
        return;
      }
      if (action === "search" || action === "back-to-results") {
        openBrowse(lane);
      }
    },
    [lane, openBrowse],
  );

  const runSearch = useCallback(
    async (query: string) => {
      await Bun.sleep(SEARCH_DELAY_MS);
      const options = searchResultsFor(lane, query);
      return {
        options,
        subtitle: `${options.length} titles`,
      };
    },
    [lane],
  );

  if (phase === "episodes") {
    return (
      <EpisodePicker
        lane={lane}
        onPlay={() => goPhase("resolving")}
        onBack={() => goPhase("browse")}
        onShellAction={handleShellAction}
      />
    );
  }

  if (phase === "resolving") {
    return (
      <LoadingShell
        key="resolving"
        state={{
          ...resolvingState(lane, sceneElapsedMs),
          commands: PLAYBACK_COMMANDS,
          onCommandAction: handleShellAction,
        }}
        onCancel={() => goPhase("browse")}
        onStop={() => goPhase("post-play")}
      />
    );
  }

  if (phase === "playing") {
    return (
      <LoadingShell
        key="playing"
        state={{
          ...playingState(lane, sceneElapsedMs),
          commands: PLAYBACK_COMMANDS,
          onCommandAction: (action) => {
            if (action === "quit") {
              goPhase("post-play");
              return;
            }
            handleShellAction(action);
          },
        }}
        onStop={() => goPhase("post-play")}
        onCancel={() => goPhase("post-play")}
        onNext={noop}
        onPrevious={noop}
        onPickEpisode={() => goPhase("episodes")}
        onPickSource={noop}
        onPickQuality={noop}
        onToggleAutoplay={noop}
        onToggleAutoskip={noop}
        onReturnToSearch={() => openBrowse(lane)}
      />
    );
  }

  if (phase === "post-play") {
    return <PostPlayView lane={lane} onShellAction={handleShellAction} />;
  }

  return (
    <BrowseShell<SearchResult>
      key={`${lane}-${browseEpoch}`}
      mode={lane}
      provider={providerFor(lane)}
      placeholder={lane === "series" ? "Search series" : "Search anime"}
      commands={BROWSE_COMMANDS}
      onSearch={runSearch}
      onResolve={handleShellAction}
      onSubmit={() => goPhase("episodes")}
      onCancel={noop}
    />
  );
}
