import type { Container } from "@/container";
import { toErrorScenario } from "@/domain/playback/playback-problem";
import type { OfflineMode } from "@/domain/session/offline-mode";
import type { SessionState } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import { Box } from "ink";
import React from "react";

import { OfflineModeProvider } from "./offline-mode-context";
import { buildErrorNextStep, UNEXPLAINED_FAILURE_MESSAGE } from "./playback-error-next-step";
import { buildPlaybackFailureWaterfall } from "./playback-failure-waterfall";
import { PlaybackRootContent, type PlaybackRootContentInput } from "./playback-mount-shell";
import { clearPlaybackShellError, peekPlaybackShellError } from "./playback-shell-error-capture";
import { openSessionProviderPicker } from "./provider-picker-overlay";
import type { ResolvedRootContent, RootContentSession } from "./root-content-state";
import { getRootOverlayResetKey } from "./root-overlay-model";
import type { RootOwnedOverlay } from "./root-shell-state";
import { ErrorShell, RootIdleShell } from "./root-status-shells";
import { RootContentSuspension } from "./RootContentSuspension";
import { RootOverlayLoader } from "./RootOverlayLoader";
import { buildDependencyRows } from "./setup/dependency-rows";

export type RootContentRendererContext = {
  readonly container: Container;
  readonly state: SessionState;
  readonly stateManager: SessionStateManager;
  readonly rootOverlay: RootOwnedOverlay | null;
  readonly playbackRootInput: PlaybackRootContentInput;
  readonly clearShellScreen: () => void;
  readonly offlineMode: OfflineMode;
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

  // The same row model setup and the startup strip read, so the command a
  // failure names is the one this machine was already told about.
  const snapshot = container.capabilitySnapshot;
  const rows = snapshot ? buildDependencyRows(snapshot) : [];
  const fixFor = (id: string) => rows.find((row) => row.id === id)?.fix ?? null;
  const canRetry = true;
  const canPickProvider = Boolean(state.currentTitle);
  const dependencyCause = state.playbackProblem?.cause;
  const recoveryAffordance =
    dependencyCause !== "mpv-missing" &&
    dependencyCause !== "vlc-missing" &&
    dependencyCause !== "android-intent-launcher-missing" &&
    dependencyCause !== "yt-dlp-missing";

  return (
    <ErrorShell
      message={
        state.playbackError || state.playbackProblem?.userMessage || UNEXPLAINED_FAILURE_MESSAGE
      }
      nextStep={buildErrorNextStep({
        problem: state.playbackProblem,
        canRetry,
        canPickProvider,
        commands: {
          player: fixFor(state.playbackProblem?.cause === "vlc-missing" ? "vlc" : "mpv"),
          ytDlp: fixFor("yt-dlp"),
          curlImpersonate: fixFor("curl-impersonate"),
        },
        curlImpersonates: snapshot?.curl.impersonates,
      })}
      scenario={toErrorScenario(state.playbackProblem, {
        providerName:
          container.providerRegistry.get(state.provider)?.metadata.name ?? state.provider,
        title: state.currentTitle?.name,
        resolveRetryCount: state.resolveRetryCount,
      })}
      waterfall={playbackFailureWaterfall}
      debugEnabled={Boolean(container.debugTracePath)}
      debugError={peekPlaybackShellError()}
      recoveryAffordance={recoveryAffordance}
      onOpenTracks={
        recoveryAffordance && state.stream
          ? () => {
              stateManager.dispatch({
                type: "SET_PLAYBACK_RECOVERY_REQUEST",
                request: "tracks",
              });
            }
          : undefined
      }
      onResolve={() => {
        clearPlaybackShellError();
        stateManager.dispatch({ type: "CLEAR_PLAYBACK_PROBLEM" });
        stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
      }}
      onProviders={
        state.currentTitle
          ? () => {
              void openSessionProviderPicker(container).catch((error: unknown) => {
                container.diagnosticsService.record({
                  category: "ui",
                  message: "Provider recovery picker failed",
                  context: { error: error instanceof Error ? error.message : String(error) },
                });
              });
            }
          : undefined
      }
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
  return (
    <OfflineModeProvider value={ctx.offlineMode}>
      {renderRootContentBody(resolved, ctx)}
    </OfflineModeProvider>
  );
}

function renderRootContentBody(
  resolved: ResolvedRootContent,
  ctx: RootContentRendererContext,
): React.ReactElement | null {
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
