import { debugImage } from "./debug";
import { getProbedGraphicsSupport } from "./probe";
import type { ImageCapability, ImageProtocol, ImageRendererId, TerminalId } from "./types";

const DISABLE_VALUES = new Set(["0", "false"]);
const PROTOCOL_VALUES = new Set(["auto", "none", "kitty", "iterm", "sixel", "half-block"] as const);

type ProtocolOverride = "auto" | "none" | "kitty" | "iterm" | "sixel" | "half-block";

type CapabilityInput = {
  readonly terminal: TerminalId;
  readonly protocol: ImageProtocol;
  readonly renderer: ImageRendererId;
  readonly available: boolean;
  readonly reason: string;
};

function buildCapability(input: CapabilityInput): ImageCapability {
  return {
    terminal: input.terminal,
    protocol: input.protocol,
    renderer: input.renderer,
    available: input.available,
    reason: input.reason,
  };
}

/**
 * The universal fallback: two pixels per cell using truecolour SGR, decoded in
 * process. Needs no external binary, which is what makes posters work on
 * Windows at all — `chafa` is effectively never installed there.
 */
function halfBlockCapability(terminal: TerminalId, reason: string): ImageCapability {
  return buildCapability({
    terminal,
    protocol: "half-block",
    renderer: "half-block",
    available: true,
    reason,
  });
}

function noneCapability(terminal: TerminalId, reason: string): ImageCapability {
  return buildCapability({
    terminal,
    protocol: "none",
    renderer: "none",
    available: false,
    reason,
  });
}

export function detectTerminal(env: NodeJS.ProcessEnv = process.env): TerminalId {
  if (env.KITTY_WINDOW_ID) return "kitty";
  if (env.TERM_PROGRAM?.toLowerCase() === "ghostty") return "ghostty";
  if (env.WT_SESSION) return "windows-terminal";
  // iTerm2 forwards LC_TERMINAL through ssh, where TERM_PROGRAM is lost — and a
  // remote session renders inline images just as well as a local one. Checked
  // after the kitty-compatible names so an inherited LC_TERMINAL cannot outrank
  // the terminal actually in front of the user.
  if (
    env.TERM_PROGRAM?.toLowerCase() === "iterm.app" ||
    env.LC_TERMINAL?.toLowerCase() === "iterm2"
  ) {
    return "iterm2";
  }
  if (env.TERM_PROGRAM?.toLowerCase() === "wezterm") return "wezterm";
  if (env.WEZTERM_EXECUTABLE) return "wezterm";
  // Konsole answers the kitty graphics probe but has no Unicode placeholder
  // support — naming it keeps the app shell off the placeholder path there.
  if (env.KONSOLE_VERSION) return "konsole";
  if (env.TERM_PROGRAM?.toLowerCase() === "vscode") return "vscode";
  return "unknown";
}

export function isKittyCompatible(env: NodeJS.ProcessEnv = process.env): boolean {
  const terminal = detectTerminal(env);
  return terminal === "kitty" || terminal === "ghostty";
}

/**
 * Inside tmux or screen the graphics escapes must be wrapped in the
 * multiplexer's passthrough sequence, which we do not emit. Detection cannot
 * rely on the probe to catch this: `KITTY_WINDOW_ID` is inherited into tmux
 * panes, so the name check would claim kitty-native and every poster would be
 * swallowed by tmux, leaving blank cells where the placeholder grid expects an
 * image. Text renderers pass through a multiplexer untouched, so prefer them.
 */
export function isMultiplexed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TMUX || env.STY) return true;
  return /^(?:screen|tmux)(?:-|$)/i.test(env.TERM ?? "");
}

/** VSCode's integrated terminal learned the iTerm2 inline-image protocol in 1.80. */
const VSCODE_INLINE_IMAGE_MINIMUM = { major: 1, minor: 80 } as const;

/**
 * Whether this terminal can be trusted with an iTerm2 inline image.
 *
 * iTerm2 owns the protocol, so it is unconditional there. VSCode is gated on a
 * reported version: emitting the escape to a build that does not understand it
 * dumps raw bytes across the UI, which is the same reason Windows Terminal sixel
 * stays off without a probe answer. An unreported version is treated as too old.
 */
function supportsItermInlineImages(terminal: TerminalId, env: NodeJS.ProcessEnv): boolean {
  if (terminal === "iterm2") return true;
  if (terminal !== "vscode") return false;
  const [major, minor] = (env.TERM_PROGRAM_VERSION ?? "")
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if ((major as number) !== VSCODE_INLINE_IMAGE_MINIMUM.major) {
    return (major as number) > VSCODE_INLINE_IMAGE_MINIMUM.major;
  }
  return (minor as number) >= VSCODE_INLINE_IMAGE_MINIMUM.minor;
}

function normalizeProtocol(value: string | undefined): ProtocolOverride | "invalid" {
  if (!value) return "auto";
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "auto";
  if (PROTOCOL_VALUES.has(normalized as ProtocolOverride)) return normalized as ProtocolOverride;
  return "invalid";
}

const runtime = {
  isStdoutTty: (): boolean => Boolean(process.stdout.isTTY),
  which: (command: string): string | null => Bun.which(command),
};

const capabilityMemo = new Map<string, ImageCapability>();

function capabilityMemoKey(env: NodeJS.ProcessEnv): string {
  const probe = getProbedGraphicsSupport();
  return JSON.stringify([
    // Part of the key, not just an input: detection runs before the probe
    // answers, so without this the pre-probe result would stay cached forever
    // and the probe would change nothing.
    probe ? `${String(probe.sixel)}:${String(probe.kittyGraphics)}` : "unprobed",
    runtime.isStdoutTty(),
    env.KUNAI_POSTER ?? "",
    env.KUNAI_IMAGE_PROTOCOL ?? "",
    env.KITTY_WINDOW_ID ?? "",
    env.TERM_PROGRAM ?? "",
    // Both feed inline-image routing: LC_TERMINAL identifies iTerm2 over ssh and
    // the version gates VSCode, so a result cached without them would be wrong.
    env.TERM_PROGRAM_VERSION ?? "",
    env.LC_TERMINAL ?? "",
    env.WT_SESSION ?? "",
    env.WEZTERM_EXECUTABLE ?? "",
    env.KONSOLE_VERSION ?? "",
    // Multiplexer detection feeds the result, so it has to feed the key too.
    env.TMUX ?? "",
    env.STY ?? "",
    env.TERM ?? "",
  ]);
}

function computeImageCapability(env: NodeJS.ProcessEnv): ImageCapability {
  if (!runtime.isStdoutTty()) {
    return noneCapability("unknown", "stdout is not a TTY");
  }

  if (DISABLE_VALUES.has(env.KUNAI_POSTER?.toLowerCase() ?? "")) {
    return noneCapability("unknown", "poster rendering disabled by KUNAI_POSTER");
  }

  const terminal = detectTerminal(env);
  const override = normalizeProtocol(env.KUNAI_IMAGE_PROTOCOL);

  if (override === "invalid") {
    debugImage(`Invalid KUNAI_IMAGE_PROTOCOL value: ${env.KUNAI_IMAGE_PROTOCOL ?? ""}`);
  }

  if (override === "none") {
    return noneCapability(terminal, "poster rendering disabled by KUNAI_IMAGE_PROTOCOL");
  }

  if (override === "kitty") {
    if (terminal === "kitty" || terminal === "ghostty") {
      return buildCapability({
        terminal,
        protocol: "kitty",
        renderer: "kitty-native",
        available: true,
        reason: "kitty-compatible terminal requested",
      });
    }
    return noneCapability(
      terminal,
      "KUNAI_IMAGE_PROTOCOL=kitty requires a kitty-compatible terminal",
    );
  }

  if (override === "iterm") {
    return buildCapability({
      terminal,
      protocol: "iterm-inline",
      renderer: "iterm-inline",
      available: true,
      reason: "forced iTerm2 inline images",
    });
  }

  if (override === "sixel") {
    // Sixel is encoded in process now, so this no longer needs chafa on PATH.
    return buildCapability({
      terminal,
      protocol: "sixel",
      renderer: "sixel",
      available: true,
      reason: "forced sixel output",
    });
  }

  if (override === "half-block") {
    return halfBlockCapability(terminal, "forced half-block output");
  }

  // Past this point every branch picks a graphics protocol, and none of them
  // survive a multiplexer without passthrough wrapping. Explicit
  // KUNAI_IMAGE_PROTOCOL overrides are handled above and still win.
  if (isMultiplexed(env)) {
    return halfBlockCapability(
      terminal,
      "tmux/screen detected; graphics escapes need passthrough, using half-block",
    );
  }

  if (terminal === "kitty" || terminal === "ghostty") {
    return buildCapability({
      terminal,
      protocol: "kitty",
      renderer: "kitty-native",
      available: true,
      reason: "kitty-compatible terminal detected",
    });
  }

  // What the terminal *said*, when it was asked at startup, beats what its name
  // implies. This is the only way to know a Windows Terminal is >=1.22, or that
  // an unrecognised terminal (foot, contour, mlterm, xterm -ti vt340) does sixel
  // at all — the name heuristics below can never learn either.
  const probe = getProbedGraphicsSupport();
  if (probe?.kittyGraphics) {
    return buildCapability({
      terminal,
      protocol: "kitty",
      renderer: "kitty-native",
      available: true,
      reason: "terminal answered the kitty graphics query",
    });
  }
  // Inline images before sixel, deliberately. iTerm2 answers the sixel query
  // too, but sixel is quantised to 256 colours while an inline image is the
  // prepared PNG verbatim — so on a terminal that speaks both, sixel would be a
  // needless downgrade.
  if (supportsItermInlineImages(terminal, env)) {
    return buildCapability({
      terminal,
      protocol: "iterm-inline",
      renderer: "iterm-inline",
      available: true,
      reason:
        terminal === "iterm2"
          ? "iTerm2 inline images"
          : `inline images supported since VSCode 1.80 (reported ${env.TERM_PROGRAM_VERSION ?? "none"})`,
    });
  }

  if (probe?.sixel) {
    return buildCapability({
      terminal,
      protocol: "sixel",
      renderer: "sixel",
      available: true,
      reason: "terminal reported sixel support (DA1)",
    });
  }

  // No probe answer. Windows Terminal only gained sixel in 1.22, and nothing in
  // the environment reports its version. Emitting sixel to an older build dumps
  // raw escape bytes across the UI, so take the always-correct path and leave
  // sixel available through KUNAI_IMAGE_PROTOCOL=sixel for users who know.
  if (terminal === "windows-terminal") {
    return halfBlockCapability(
      terminal,
      "Windows Terminal detected; sixel support is unverifiable",
    );
  }

  // WezTerm supports sixel; app-shell placement reserves and redraws a measured
  // overlay after every Ink frame, so it no longer has to fall back to text.
  if (terminal === "wezterm") {
    return buildCapability({
      terminal,
      protocol: "sixel",
      renderer: "sixel",
      available: true,
      reason: "WezTerm detected",
    });
  }

  return halfBlockCapability(terminal, "half-block fallback for truecolour terminals");
}

export function detectImageCapability(env: NodeJS.ProcessEnv = process.env): ImageCapability {
  const key = capabilityMemoKey(env);
  const cached = capabilityMemo.get(key);
  if (cached) return cached;

  const capability = computeImageCapability(env);
  capabilityMemo.set(key, capability);
  return capability;
}

function resetMemo(): void {
  capabilityMemo.clear();
}

export const __testing = {
  runtime,
  resetMemo,
};
