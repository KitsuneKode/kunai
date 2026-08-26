import type { Container } from "@/container";
import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { mountRootContent } from "./root-content-state";
import { ShellFooter, ViewportResizeGate } from "./shell-primitives";
import { palette } from "./shell-theme";
import { useShellDimensions } from "./use-viewport-policy";
import { connectNamedTracker, type TrackerConnectOutcome } from "./workflows/tracker-connect";

export type { TrackerConnectOutcome } from "./workflows/tracker-connect";

type TrackerConnect = (
  signal: AbortSignal,
  onPrompt: (message: string) => void,
) => Promise<TrackerConnectOutcome>;

type ConnectPhase =
  | { readonly kind: "connecting"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

export function TrackerConnectShell({
  trackerName,
  connect,
  finish,
}: {
  readonly trackerName: string;
  readonly connect: TrackerConnect;
  readonly finish: (outcome: TrackerConnectOutcome) => void;
}) {
  const { cols } = useShellDimensions();
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<ConnectPhase>({
    kind: "connecting",
    message: "Opening your browser…",
  });
  const controllerRef = useRef<AbortController | null>(null);
  const finishedRef = useRef(false);

  const finishOnce = useCallback(
    (outcome: TrackerConnectOutcome) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      finish(outcome);
    },
    [finish],
  );

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    let active = true;

    setPhase({ kind: "connecting", message: "Opening your browser…" });

    const run = async () => {
      try {
        const outcome = await connect(controller.signal, (message) => {
          if (active && !controller.signal.aborted) {
            setPhase({ kind: "connecting", message });
          }
        });
        if (!active) return;
        if (outcome.status === "failed") {
          setPhase({ kind: "failed", message: outcome.error });
          return;
        }
        finishOnce(outcome);
      } catch (error) {
        // A tracker adapter that *throws* rather than returning a failed
        // outcome must not escape as an unhandled rejection: `main.ts` treats
        // one as fatal and shuts the whole session down. Linking an account is
        // optional, so a thrown error becomes the same retryable failure a
        // returned one does.
        if (!active) return;
        setPhase({
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    void run();

    return () => {
      active = false;
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [attempt, connect, finishOnce]);

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === "q") {
      controllerRef.current?.abort();
      finishOnce({ status: "cancelled" });
      return;
    }
    if (phase.kind === "failed" && input.toLowerCase() === "r") {
      setAttempt((current) => current + 1);
    }
  });

  const failed = phase.kind === "failed";

  return (
    <ViewportResizeGate kind="picker" message="Resize terminal to connect an account">
      <Box flexDirection="column" flexGrow={1} paddingX={2}>
        <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
          <Box flexDirection="column" width={Math.min(68, Math.max(36, cols - 8))}>
            <Text color={failed ? palette.danger : palette.accent} bold>
              {failed ? `Could not connect ${trackerName}` : `Connecting ${trackerName}`}
            </Text>
            <Box marginTop={1}>
              <Text color={failed ? palette.text : palette.muted}>{phase.message}</Text>
            </Box>
            <Box marginTop={1}>
              <Text color={palette.dim}>
                {failed
                  ? "Retry here or close this screen. Your settings were not changed."
                  : "Complete approval in the browser. Kunai will continue here automatically."}
              </Text>
            </Box>
          </Box>
        </Box>
        <ShellFooter
          taskLabel={failed ? `${trackerName} sign-in failed` : `Waiting for ${trackerName}`}
          actions={
            failed
              ? [
                  { key: "r", label: "retry", primary: true },
                  { key: "esc", label: "close" },
                ]
              : [{ key: "esc", label: "cancel", primary: true }]
          }
          mode="minimal"
          terminalWidth={cols}
        />
      </Box>
    </ViewportResizeGate>
  );
}

export async function openTrackerConnectShell(
  container: Container,
  tracker: "anilist" | "tmdb",
): Promise<TrackerConnectOutcome> {
  const adapter = container.syncService.adapters.find((candidate) => candidate.id === tracker);
  if (!adapter || adapter.getConnection().state === "connected") {
    return connectNamedTracker(container, tracker, {
      signal: new AbortController().signal,
    });
  }

  const trackerName = adapter.displayName ?? (tracker === "anilist" ? "AniList" : "TMDB");
  const connect: TrackerConnect = (signal, onPrompt) =>
    connectNamedTracker(container, tracker, { signal, onPrompt });
  const fallbackValue: TrackerConnectOutcome = { status: "cancelled" };
  const session = mountRootContent<TrackerConnectOutcome>({
    kind: "picker",
    headerLabel: `Connect ${trackerName}`,
    renderContent: (finish) => (
      <TrackerConnectShell trackerName={trackerName} connect={connect} finish={finish} />
    ),
    fallbackValue,
  });
  return session.result;
}
