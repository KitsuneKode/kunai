/**
 * Ink surface for the README UI walkthrough.
 *
 * The real BrowseShell, LoadingShell and PostPlayShell, driven by fixtures:
 * search, pick, resolve, play, a stalled stream, post-play. The one addition is
 * the `x` key, which toggles the stalled state so a tape can show the real
 * recovery prompt without a real stall. No providers, mpv, or analytics.
 */

import { BrowseShell } from "@/app-shell/browse-shell";
import { COMMAND_CONTEXTS } from "@/app-shell/commands";
import { LoadingShell } from "@/app-shell/loading-shell";
import { PostPlayShell } from "@/app-shell/post-play-shell";
import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";
import { fallbackCommandState } from "@/app-shell/shell-command-model";
import { ShellFrame } from "@/app-shell/shell-frame";
import { APP_LABEL } from "@/app-shell/shell-theme";
import type { ShellAction } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";
import { useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  PROVIDER,
  RESOLVE_DURATION_MS,
  SEARCH_DELAY_MS,
  TITLE,
  playingState,
  postPlayProps,
  resolvingState,
  searchResults,
} from "./ui-demo-scenes";

type Phase = "browse" | "resolving" | "playing" | "post-play";

const TICK_MS = 100;
const BROWSE_COMMANDS = fallbackCommandState(SEARCH_BROWSE_COMMAND_IDS);
const PLAYBACK_COMMANDS = fallbackCommandState(COMMAND_CONTEXTS.activePlayback);
const POST_PLAY_COMMANDS = fallbackCommandState(["next", "replay", "search", "help", "quit"]);

function noop(): void {}

function StallKey({ onToggle }: { readonly onToggle: () => void }) {
  useInput((input) => {
    if (input === "x") onToggle();
  });
  return null;
}

export function UiDemoApp() {
  const [phase, setPhase] = useState<Phase>("browse");
  const [stalled, setStalled] = useState(false);
  const [, setTick] = useState(0);
  const phaseStartedAt = useRef(Date.now());

  const goPhase = useCallback((next: Phase) => {
    phaseStartedAt.current = Date.now();
    setPhase(next);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (phase !== "resolving") return;
    const timer = setTimeout(() => goPhase("playing"), RESOLVE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [goPhase, phase]);

  const sceneElapsedMs = Date.now() - phaseStartedAt.current;

  const runSearch = useCallback(async (query: string) => {
    await Bun.sleep(SEARCH_DELAY_MS);
    const options = searchResults(query);
    return { options, subtitle: `${options.length} titles` };
  }, []);

  if (phase === "resolving") {
    return (
      <LoadingShell
        key="resolving"
        state={{
          ...resolvingState(sceneElapsedMs),
          commands: PLAYBACK_COMMANDS,
          onCommandAction: noop,
        }}
        onCancel={() => goPhase("browse")}
        onStop={() => goPhase("post-play")}
      />
    );
  }

  if (phase === "playing") {
    return (
      <>
        <StallKey onToggle={() => setStalled((value) => !value)} />
        <LoadingShell
          key="playing"
          state={{
            ...playingState(sceneElapsedMs, stalled),
            commands: PLAYBACK_COMMANDS,
            onCommandAction: (action: ShellAction) => {
              if (action === "quit") goPhase("post-play");
            },
          }}
          onStop={() => goPhase("post-play")}
          onCancel={() => goPhase("post-play")}
          onNext={noop}
          onPrevious={noop}
          onPickEpisode={noop}
          onPickSource={noop}
          onPickQuality={noop}
          onToggleAutoplay={noop}
          onToggleAutoskip={noop}
          onReturnToSearch={() => goPhase("browse")}
        />
      </>
    );
  }

  if (phase === "post-play") {
    return (
      <ShellFrame
        eyebrow={APP_LABEL}
        title={TITLE}
        subtitle=""
        contentOnlyChrome
        status={{ label: PROVIDER, tone: "info" }}
        footerTask="Post-play"
        footerMode="minimal"
        footerActions={[
          { key: "s", label: "search", action: "search" },
          { key: "/", label: "commands", action: "command-mode" },
        ]}
        commands={POST_PLAY_COMMANDS}
        escapeAction="search"
        onResolve={() => goPhase("browse")}
      >
        <PostPlayShell {...postPlayProps()} selectedActionIndex={0} />
      </ShellFrame>
    );
  }

  return (
    <BrowseShell<SearchResult>
      key="browse"
      mode="series"
      provider={PROVIDER}
      placeholder="Search movies and series"
      commands={BROWSE_COMMANDS}
      onSearch={runSearch}
      onResolve={noop}
      onSubmit={() => goPhase("resolving")}
      onCancel={noop}
    />
  );
}
