/**
 * Ink surface for the series + anime playback walkthrough.
 *
 * Driven by an injected clock over `playback-walkthrough-scenes.ts`. VHS records
 * this process; it never boots providers, mpv, or analytics.
 */

import { BrowseShell } from "@/app-shell/browse-shell";
import { COMMAND_CONTEXTS } from "@/app-shell/commands";
import { LoadingShell } from "@/app-shell/loading-shell";
import { PostPlayShell } from "@/app-shell/post-play-shell";
import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";
import { fallbackCommandState } from "@/app-shell/shell-command-model";
import { ShellFrame } from "@/app-shell/shell-frame";
import { APP_LABEL, palette } from "@/app-shell/shell-theme";
import type { SearchResult } from "@/domain/types";
import { Box, Text } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  browseQueryFor,
  browseResultsFor,
  episodeRowsFor,
  playingState,
  postPlayProps,
  providerFor,
  resolvingState,
  selectedEpisodeIndex,
  titleCardCopy,
  titleFor,
  walkthroughAt,
  walkthroughTotalDurationMs,
  type WalkthroughLane,
} from "./playback-walkthrough-scenes";

const TICK_MS = 100;
const BROWSE_COMMANDS = fallbackCommandState(SEARCH_BROWSE_COMMAND_IDS);
const PICKER_COMMANDS = fallbackCommandState(COMMAND_CONTEXTS.modalPicker);
const PLAYBACK_COMMANDS = fallbackCommandState(COMMAND_CONTEXTS.activePlayback);

function defaultNowMs(): number {
  return Date.now();
}

function noop(): void {}

async function searchLane(lane: WalkthroughLane) {
  return {
    options: browseResultsFor(lane),
    subtitle: `${browseResultsFor(lane).length} titles`,
  };
}

function TitleCard({ lane }: { readonly lane: WalkthroughLane }) {
  const copy = titleCardCopy(lane);
  return (
    <ShellFrame
      eyebrow={APP_LABEL}
      title={copy.title}
      subtitle={copy.subtitle}
      status={{ label: copy.eyebrow, tone: "info" }}
      footerTask="Walkthrough"
      footerMode="minimal"
      footerActions={[{ key: "ctrl+c", label: "stop" }]}
      commands={PICKER_COMMANDS}
      inputLocked
      onResolve={noop}
    >
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color={palette.text} bold>
          {copy.title}
        </Text>
        <Text color={palette.muted}>{copy.subtitle}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.dim}>1 Search and pick a title</Text>
          <Text color={palette.dim}>2 Confirm the episode</Text>
          <Text color={palette.dim}>3 Resolve a direct stream</Text>
          <Text color={palette.dim}>4 Supervise mpv at 1.5×</Text>
          <Text color={palette.dim}>5 Post-play — next, replay, or search</Text>
        </Box>
      </Box>
    </ShellFrame>
  );
}

function EpisodePicker({ lane }: { readonly lane: WalkthroughLane }) {
  const rows = episodeRowsFor(lane);
  const selected = selectedEpisodeIndex(lane);
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
      inputLocked
      onResolve={noop}
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

function DoneCard() {
  return (
    <ShellFrame
      eyebrow={APP_LABEL}
      title="Walkthrough complete"
      subtitle="Series and anime — search, play, post-play"
      status={{ label: "1.5× demo", tone: "success" }}
      footerTask="Done"
      footerMode="minimal"
      footerActions={[{ key: "ctrl+c", label: "exit" }]}
      commands={PICKER_COMMANDS}
      inputLocked
      onResolve={noop}
    >
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color={palette.ok} bold>
          Walkthrough complete
        </Text>
        <Text color={palette.muted}>Series lane · Andor S01E03</Text>
        <Text color={palette.muted}>Anime lane · Frieren E04</Text>
        <Text color={palette.dim}>Playback shown at 1.5×. Press Ctrl+C to leave.</Text>
      </Box>
    </ShellFrame>
  );
}

export function PlaybackWalkthroughApp({
  nowMs = defaultNowMs,
  onDone,
}: {
  readonly nowMs?: () => number;
  readonly onDone: () => void;
}) {
  const startedAt = useRef(nowMs());
  const finished = useRef(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((value) => value + 1);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const clock = walkthroughAt(nowMs() - startedAt.current);
  useEffect(() => {
    if (clock || finished.current) return;
    finished.current = true;
    onDone();
  }, [clock, onDone]);

  const browseSeries = useMemo(() => browseResultsFor("series"), []);
  const browseAnime = useMemo(() => browseResultsFor("anime"), []);

  if (!clock) {
    return <DoneCard />;
  }

  const { scene, sceneElapsedMs } = clock;
  if (scene.phase === "title") return <TitleCard lane={scene.lane} />;
  if (scene.phase === "episodes") return <EpisodePicker lane={scene.lane} />;
  if (scene.phase === "resolving") {
    return (
      <LoadingShell
        state={{ ...resolvingState(scene.lane, sceneElapsedMs), commands: PLAYBACK_COMMANDS }}
        onCancel={noop}
        onStop={noop}
      />
    );
  }
  if (scene.phase === "playing") {
    return (
      <LoadingShell
        state={{ ...playingState(scene.lane, sceneElapsedMs), commands: PLAYBACK_COMMANDS }}
        onStop={noop}
        onNext={noop}
        onPrevious={noop}
        onPickEpisode={noop}
        onPickSource={noop}
        onPickQuality={noop}
        onToggleAutoplay={noop}
        onToggleAutoskip={noop}
      />
    );
  }
  if (scene.phase === "post-play") {
    return <PostPlayShell {...postPlayProps(scene.lane)} />;
  }
  if (scene.phase === "done") return <DoneCard />;

  const lane = scene.lane;
  const results = lane === "series" ? browseSeries : browseAnime;
  return (
    <BrowseShell<SearchResult>
      mode={lane}
      provider={providerFor(lane)}
      initialQuery={browseQueryFor(lane)}
      initialResults={results}
      initialResultSubtitle={`${results.length} titles`}
      initialSelectedIndex={0}
      placeholder={lane === "series" ? "Search series" : "Search anime"}
      commands={BROWSE_COMMANDS}
      onSearch={() => searchLane(lane)}
      onResolve={noop}
      onSubmit={noop}
      onCancel={noop}
    />
  );
}

export function walkthroughRuntimeMs(): number {
  return walkthroughTotalDurationMs();
}
