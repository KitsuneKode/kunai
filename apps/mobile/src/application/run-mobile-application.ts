import type { MobileEnvironment, MobileExit, MobileState } from "./contracts";
import { parseMobileArgs } from "./parse-mobile-args";

const HELP_LINES = [
  "Usage: kunai-mobile --host-proof --probe-url <https-url> --media-url <https-url>",
  "       kunai-mobile --help",
  "       kunai-mobile --version",
] as const;
const FAILURE_COPY = "Mobile host proof failed.";
const MAX_PROBE_BYTES = 65_536;

async function renderFailure(environment: MobileEnvironment): Promise<void> {
  try {
    await environment.terminal.render([FAILURE_COPY]);
  } catch {
    // The exit code remains the final observable when the terminal itself fails.
  }
}

async function commitFailure(
  environment: MobileEnvironment,
  current: MobileState,
  nextRunCount: number,
): Promise<void> {
  try {
    await environment.state.commit({
      ...current,
      hostProofRuns: nextRunCount,
      lastResult: "failed",
    });
  } catch {
    // Preserve the original failure classification when persistence is unavailable.
  }
}

export async function runMobileApplication(input: {
  readonly argv: readonly string[];
  readonly environment: MobileEnvironment;
  readonly version: string;
}): Promise<MobileExit> {
  let command;
  try {
    command = parseMobileArgs(input.argv);
  } catch {
    await input.environment.terminal.render(["Invalid mobile command.", ...HELP_LINES]);
    return { code: 2, reason: "invalid-input" };
  }

  if (command.kind === "help") {
    await input.environment.terminal.render(HELP_LINES);
    return { code: 0, reason: "completed" };
  }
  if (command.kind === "version") {
    await input.environment.terminal.render([`Kunai mobile ${input.version}`]);
    return { code: 0, reason: "completed" };
  }

  let current: MobileState;
  try {
    current = await input.environment.state.load();
  } catch {
    await renderFailure(input.environment);
    return { code: 1, reason: "failed" };
  }

  const nextRunCount = current.hostProofRuns + 1;
  try {
    await input.environment.terminal.render([
      "Kunai mobile host proof",
      "No playback progress will be recorded.",
    ]);
    const decision = await input.environment.terminal.choose({
      prompt: "Continue?",
      choices: [
        { value: "continue", label: "Run proof" },
        { value: "cancel", label: "Cancel" },
      ],
    });
    if (decision.kind === "cancelled" || decision.value === "cancel") {
      await input.environment.state.commit({
        ...current,
        hostProofRuns: nextRunCount,
        lastResult: "cancelled",
      });
      return { code: 0, reason: "cancelled" };
    }
    if (decision.value !== "continue") throw new Error("invalid terminal selection");

    const response = await input.environment.http.request({
      method: "GET",
      url: command.probeUrl,
      timeoutMs: 8_000,
      maxBytes: MAX_PROBE_BYTES,
    });
    if (response.status < 200 || response.status >= 300 || response.bytes > MAX_PROBE_BYTES) {
      throw new Error("probe rejected");
    }
    await input.environment.state.commit({
      ...current,
      hostProofRuns: nextRunCount,
      lastResult: "http-ok",
    });

    const handoff = await input.environment.player.handoff({
      player: "vlc",
      url: command.mediaUrl,
    });
    if (handoff.kind === "rejected") throw new Error("handoff rejected");
    await input.environment.state.commit({
      ...current,
      hostProofRuns: nextRunCount,
      lastResult: "handoff-accepted",
    });
    await input.environment.terminal.render([
      "VLC handoff was accepted. Playback progress cannot be observed.",
    ]);
    return { code: 0, reason: "handoff" };
  } catch {
    await commitFailure(input.environment, current, nextRunCount);
    await renderFailure(input.environment);
    return { code: 1, reason: "failed" };
  }
}
