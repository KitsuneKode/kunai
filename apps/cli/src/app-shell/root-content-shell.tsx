import type { Container } from "@/container";
import { toErrorScenario } from "@/domain/playback/playback-problem";
import type { SessionState } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import { Box } from "ink";
import React from "react";

import { resolveCommandContext } from "./commands";
import { buildPlaybackFailureWaterfall } from "./playback-failure-waterfall";
import { PlaybackRootContent, type PlaybackRootContentInput } from "./playback-mount-shell";
import { clearPlaybackShellError, peekPlaybackShellError } from "./playback-shell-error-capture";
import type { ResolvedRootContent, RootContentSession } from "./root-content-state";
import { getRootOverlayResetKey } from "./root-overlay-model";
import type { RootOwnedOverlay } from "./root-shell-state";
import { ErrorShell, RootIdleShell } from "./root-status-shells";
import { resolveRootSurfaceCommand } from "./root-workflow-dispatch";
import { RootContentSuspension } from "./RootContentSuspension";
import { RootOverlayLoader } from "./RootOverlayLoader";
import { useShellInput } from "./shell-command-input";
import { CommandPalette } from "./shell-command-ui";
import type { FooterAction } from "./types";

export type RootContentRendererContext = {
  readonly container: Container;
  readonly state: SessionState;
  readonly stateManager: SessionStateManager;
  readonly rootOverlay: RootOwnedOverlay | null;
  readonly playbackRootInput: PlaybackRootContentInput;
  readonly clearShellScreen: () => void;
};

/**
 * Renders a mounted browse/post-playback session in a stable first-child
 * position whether or not a root-owned overlay currently covers it. The
 * `Box` identity (keyed by session id) and the `RootContentSuspension`
 * wrapper are present in both states — only `display` and the suspended
 * flag change — so React never unmounts the session's local state (typed
 * query, selection, focus zone, calendar cursor, …) while an overlay is
 * open on top of it.
 */
export function RetainedRootContentLayer({
  session,
  suspended,
}: {
  readonly session: RootContentSession;
  readonly suspended: boolean;
}): React.ReactElement {
  return (
    <Box key={session.id} flexGrow={1} display={suspended ? "none" : "flex"}>
      <RootContentSuspension suspended={suspended}>{session.element}</RootContentSuspension>
    </Box>
  );
}

export function renderRootOverlayContent(
  overlay: RootOwnedOverlay,
  ctx: Pick<RootContentRendererContext, "container" | "state" | "clearShellScreen">,
): React.ReactElement {
  return (
    <RootOverlayLoader
      key={getRootOverlayResetKey(overlay)}
      overlay={overlay}
      state={ctx.state}
      container={ctx.container}
      onRedraw={ctx.clearShellScreen}
    />
  );
}

function ErrorRootSurface({
  ctx,
}: {
  readonly ctx: Pick<RootContentRendererContext, "container" | "state" | "stateManager">;
}): React.ReactElement {
  const { state, container, stateManager } = ctx;
  const playbackFailureWaterfall = buildPlaybackFailureWaterfall({
    state,
    recentEvents: container.diagnosticsService.getRecent(40),
  });

  return (
    <CommandCapableRootSurface
      container={container}
      state={state}
      // "error" outranks overlays in resolveRootShellSurface — an overlay opened
      // while it is set would sit in activeModals unrendered. Clear first, the
      // same transition Enter performs, then let the command land on the
      // surface that replaces it.
      beforeResolve={() => {
        clearPlaybackShellError();
        stateManager.dispatch({ type: "CLEAR_PLAYBACK_PROBLEM" });
        stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
      }}
    >
      {(commandMode) => (
        <ErrorShell
          message={state.playbackError || "An unknown error occurred"}
          scenario={toErrorScenario(state.playbackProblem, {
            providerName:
              container.providerRegistry.get(state.provider)?.metadata.name ?? state.provider,
            title: state.currentTitle?.name,
            resolveRetryCount: state.resolveRetryCount,
          })}
          waterfall={playbackFailureWaterfall}
          debugEnabled={Boolean(container.debugTracePath)}
          debugError={peekPlaybackShellError()}
          inputLocked={commandMode}
          onResolve={() => {
            clearPlaybackShellError();
            stateManager.dispatch({ type: "CLEAR_PLAYBACK_PROBLEM" });
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
          }}
          onRetry={() => {
            clearPlaybackShellError();
            stateManager.dispatch({ type: "CLEAR_PLAYBACK_PROBLEM" });
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "loading" });
          }}
        />
      )}
    </CommandCapableRootSurface>
  );
}

export function renderErrorRootContent(
  ctx: Pick<RootContentRendererContext, "container" | "state" | "stateManager">,
): React.ReactElement {
  return <ErrorRootSurface ctx={ctx} />;
}

const SURFACE_FOOTER_ACTIONS: readonly FooterAction[] = [
  { key: "/", label: "commands", action: "command-mode" },
];

/**
 * Idle and error surfaces print `/verb` hints — for those to be true the
 * surface has to own a palette. `useShellInput` mounts it; resolutions route
 * through the same resolver the overlay host uses so behaviour cannot fork.
 */
function CommandCapableRootSurface({
  container,
  state,
  beforeResolve,
  children,
}: {
  readonly container: Container;
  readonly state: SessionState;
  /** Runs before a resolved command — e.g. clearing the error state so an opened overlay can actually render over the surface. */
  readonly beforeResolve?: () => void;
  readonly children: (commandMode: boolean) => React.ReactElement;
}): React.ReactElement {
  const commands = resolveCommandContext(state, "rootOverlay");
  const { commandMode, commandInput, commandCursor, highlightedIndex, paletteNotice } =
    useShellInput({
      footerActions: SURFACE_FOOTER_ACTIONS,
      commands,
      escapeAction: null,
      onResolve: (action) => {
        beforeResolve?.();
        resolveRootSurfaceCommand({ container, state, action });
      },
    });
  return (
    <>
      {children(commandMode)}
      {commandMode ? (
        <CommandPalette
          input={commandInput}
          cursor={commandCursor}
          commands={commands}
          highlightedIndex={highlightedIndex}
          notice={paletteNotice}
        />
      ) : null}
    </>
  );
}

function IdleRootSurface({
  container,
  state,
}: {
  readonly container: Container;
  readonly state: SessionState;
}): React.ReactElement {
  return (
    <CommandCapableRootSurface container={container} state={state}>
      {() => <RootIdleShell state={state} />}
    </CommandCapableRootSurface>
  );
}

export function renderIdleRootContent(ctx: {
  readonly container: Container;
  readonly state: SessionState;
}): React.ReactElement {
  return <IdleRootSurface container={ctx.container} state={ctx.state} />;
}

export function renderPlaybackRootContent(input: PlaybackRootContentInput): React.ReactElement {
  return <PlaybackRootContent {...input} />;
}

export function RootContentBody({
  resolved,
  ctx,
}: {
  readonly resolved: ResolvedRootContent;
  readonly ctx: RootContentRendererContext;
}): React.ReactElement | null {
  switch (resolved.kind) {
    case "error":
      return renderErrorRootContent(ctx);
    case "playback":
      return renderPlaybackRootContent(ctx.playbackRootInput);
    case "mounted":
      return <RetainedRootContentLayer session={resolved.session} suspended={false} />;
    case "overlay-over-mounted":
      return (
        <>
          <RetainedRootContentLayer session={resolved.session} suspended />
          {ctx.rootOverlay ? renderRootOverlayContent(ctx.rootOverlay, ctx) : null}
        </>
      );
    case "overlay":
      return ctx.rootOverlay
        ? renderRootOverlayContent(ctx.rootOverlay, ctx)
        : renderIdleRootContent(ctx);
    case "idle":
    default:
      return renderIdleRootContent(ctx);
  }
}

export function mountedRootContentKindLabel(
  session: RootContentSession,
): RootContentSession["kind"] {
  return session.kind;
}
