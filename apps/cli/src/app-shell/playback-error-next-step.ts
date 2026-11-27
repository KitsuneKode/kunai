// The one next step a failed playback names
//
// The failure panel said what broke and listed every key it had, which left a
// first-time user to work out which key applied. A problem already carries its
// cause; this turns the cause into a single instruction, and into the one
// command for this machine when the fix is an install.
//
// Board: `.reference/design/cli/kunai-onboarding-v4.html`.

import type { PlaybackProblem } from "@/domain/playback/playback-problem";

export type ErrorNextStepExtra = {
  readonly text: string;
  /** `command` is something to run; `note` introduces it. */
  readonly kind: "note" | "command";
};

export type ErrorNextStep = {
  readonly text: string;
  readonly extra: readonly ErrorNextStepExtra[];
};

export type ErrorNextStepInput = {
  readonly problem: PlaybackProblem | null | undefined;
  readonly canRetry: boolean;
  readonly canPickProvider: boolean;
  /** The single install command for this machine, per tool; absent when unknown. */
  readonly commands?: {
    readonly player?: string | null;
    readonly ytDlp?: string | null;
    readonly curlImpersonate?: string | null;
  };
  /** False when anime requests leave here without a browser-like handshake. */
  readonly curlImpersonates?: boolean | undefined;
};

const step = (text: string, extra: readonly ErrorNextStepExtra[] = []): ErrorNextStep => ({
  text,
  extra,
});

const command = (text: string | null | undefined): ErrorNextStepExtra[] =>
  text ? [{ kind: "command", text }] : [];

/** "press r to try again", in whichever form the panel's keys allow. */
function retryOrBack(input: ErrorNextStepInput, withProvider = true): string {
  if (input.canRetry && withProvider && input.canPickProvider) {
    return "press r to try again, or p to pick another source";
  }
  if (input.canRetry) return "press r to try again";
  return "press Enter to go back and try again";
}

function pickAnotherSource(input: ErrorNextStepInput): string {
  return input.canPickProvider ? "press p and pick another source" : retryOrBack(input, false);
}

export function buildErrorNextStep(input: ErrorNextStepInput): ErrorNextStep {
  const afterInstall = input.canRetry ? "then press r" : "then try again";
  switch (input.problem?.cause) {
    case "mpv-missing":
      return step(`install mpv, ${afterInstall}`, command(input.commands?.player));
    case "vlc-missing":
      return step(`install VLC, ${afterInstall}`, command(input.commands?.player));
    case "android-intent-launcher-missing":
      return step(`run pkg install termux-am, ${afterInstall}`);
    case "yt-dlp-missing":
      return step(`install yt-dlp, ${afterInstall}`, command(input.commands?.ytDlp));
    case "network":
    case "network-offline":
      return step(
        input.canRetry
          ? "check your connection, then press r to try again"
          : "check your connection, then try again",
      );
    case "provider-access": {
      const fix = input.curlImpersonates === false ? input.commands?.curlImpersonate : null;
      return step(
        pickAnotherSource(input),
        fix
          ? [
              { kind: "note", text: "To fix it for good, install curl-impersonate:" },
              { kind: "command", text: fix },
            ]
          : [],
      );
    }
    case "provider-session":
      return step(
        input.canPickProvider
          ? "press p for another source, or add the session in /settings"
          : "add the session in /settings",
      );
    case "no-stream":
      return step(pickAnotherSource(input));
    case "expired-stream":
    case "seek-stuck":
    case "ipc-stuck":
    case "player-exited":
    case "network-buffering":
      return step(
        input.canRetry ? "press r — Kunai fetches a fresh stream" : retryOrBack(input, false),
      );
    case "offline-file-unavailable":
      return step("open /library and check the download");
    case "local-playback-failed":
    case "runtime-missing":
      return step("open /diagnostics for the exact error");
    default:
      return step(retryOrBack(input));
  }
}

/** The sentence under "Playback failed" when nothing more specific is known. */
export const UNEXPLAINED_FAILURE_MESSAGE = "The stream did not start.";
