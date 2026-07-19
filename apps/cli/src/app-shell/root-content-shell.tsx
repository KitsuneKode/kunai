import type { Container } from "@/container";
import { toErrorScenario } from "@/domain/playback/playback-problem";
import type { SessionState } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import { Box } from "ink";
import React from "react";

import { buildPlaybackFailureWaterfall } from "./playback-failure-waterfall";
import { PlaybackRootContent, type PlaybackRootContentInput } from "./playback-mount-shell";
import { clearPlaybackShellError, peekPlaybackShellError } from "./playback-shell-error-capture";
import type { ResolvedRootContent, RootContentSession } from "./root-content-state";
import { getRootOverlayResetKey } from "./root-overlay-model";
import type { RootOwnedOverlay } from "./root-shell-state";
import { ErrorShell, RootIdleShell } from "./root-status-shells";
import { RootContentSuspension } from "./RootContentSuspension";
import { RootOverlayLoader } from "./RootOverlayLoader";

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

export function renderErrorRootContent(
  ctx: Pick<RootContentRendererContext, "container" | "state" | "stateManager">,
): React.ReactElement {
  const { state, container, stateManager } = ctx;
  const playbackFailureWaterfall = buildPlaybackFailureWaterfall({
    state,
    recentEvents: container.diagnosticsService.getRecent(40),
  });

  return (
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
  );
}

export function renderIdleRootContent(state: SessionState): React.ReactElement {
  return <RootIdleShell state={state} />;
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
        : renderIdleRootContent(ctx.state);
    case "idle":
    default:
      return renderIdleRootContent(ctx.state);
  }
}

export function mountedRootContentKindLabel(
  session: RootContentSession,
): RootContentSession["kind"] {
  return session.kind;
}
