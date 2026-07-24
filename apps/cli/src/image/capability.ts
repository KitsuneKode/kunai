import { debugImage } from "./debug";
import { getProbedGraphicsSupport } from "./probe";
import type { ImageCapability, ImageProtocol, ImageRendererId, TerminalId } from "./types";

const DISABLE_VALUES = new Set(["0", "false"]);
const PROTOCOL_VALUES = new Set([
  "auto",
  "none",
  "kitty",
  "sixel",
  "symbols",
  "half-block",
] as const);

type ProtocolOverride = "auto" | "none" | "kitty" | "sixel" | "symbols" | "half-block";

type CapabilityInput = {
  readonly terminal: TerminalId;
  readonly protocol: ImageProtocol;
  readonly renderer: ImageRendererId;
  readonly available: boolean;
  readonly dependency: "chafa" | "none";
  readonly reason: string;
};

function buildCapability(input: CapabilityInput): ImageCapability {
  return {
    terminal: input.terminal,
    protocol: input.protocol,
    renderer: input.renderer,
    available: input.available,
    dependency: input.dependency,
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
    dependency: "none",
    reason,
  });
}

function noneCapability(terminal: TerminalId, reason: string): ImageCapability {
  return buildCapability({
    terminal,
    protocol: "none",
    renderer: "none",
    available: false,
    dependency: "none",
    reason,
  });
}

export function detectTerminal(env: NodeJS.ProcessEnv = process.env): TerminalId {
  if (env.KITTY_WINDOW_ID) return "kitty";
  if (env.TERM_PROGRAM?.toLowerCase() === "ghostty") return "ghostty";
  if (env.WT_SESSION) return "windows-terminal";
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

let chafaAvailableMemo: boolean | undefined;
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
    env.WT_SESSION ?? "",
    env.WEZTERM_EXECUTABLE ?? "",
    env.KONSOLE_VERSION ?? "",
    // Multiplexer detection feeds the result, so it has to feed the key too.
    env.TMUX ?? "",
    env.STY ?? "",
    env.TERM ?? "",
  ]);
}

/** True when `chafa` resolves on PATH. Uses the same injectable `runtime.which` as `detectImageCapability` (see `__testing`). */
export function isChafaAvailable(): boolean {
  chafaAvailableMemo ??= Boolean(runtime.which("chafa"));
  return chafaAvailableMemo;
}

function computeImageCapability(env: NodeJS.ProcessEnv): ImageCapability {
  if (!runtime.isStdoutTty()) {
    return noneCapability("unknown", "stdout is not a TTY");
  }

  if (DISABLE_VALUES.has(env.KUNAI_POSTER?.toLowerCase() ?? "")) {
    return noneCapability("unknown", "poster rendering disabled by KUNAI_POSTER");
  }

  const terminal = detectTerminal(env);
  const hasChafa = isChafaAvailable();
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
        dependency: "none",
        reason: "kitty-compatible terminal requested",
      });
    }
    return noneCapability(
      terminal,
      "KUNAI_IMAGE_PROTOCOL=kitty requires a kitty-compatible terminal",
    );
  }

  if (override === "sixel") {
    if (!hasChafa) {
      return noneCapability(terminal, "KUNAI_IMAGE_PROTOCOL=sixel requires chafa");
    }
    return buildCapability({
      terminal,
      protocol: "sixel",
      renderer: "chafa-sixel",
      available: true,
      dependency: "chafa",
      reason: "forced sixel output via chafa",
    });
  }

  if (override === "symbols") {
    if (!hasChafa) {
      return noneCapability(terminal, "KUNAI_IMAGE_PROTOCOL=symbols requires chafa");
    }
    return buildCapability({
      terminal,
      protocol: "symbols",
      renderer: "chafa-symbols",
      available: true,
      dependency: "chafa",
      reason: "forced symbols output via chafa",
    });
  }

  if (override === "half-block") {
    return halfBlockCapability(terminal, "forced half-block output");
  }

  // Past this point every branch picks a graphics protocol, and none of them
  // survive a multiplexer without passthrough wrapping. Explicit
  // KUNAI_IMAGE_PROTOCOL overrides are handled above and still win.
  if (isMultiplexed(env)) {
    return isChafaAvailable()
      ? buildCapability({
          terminal,
          protocol: "symbols",
          renderer: "chafa-symbols",
          available: true,
          dependency: "chafa",
          reason: "tmux/screen detected; graphics escapes need passthrough, using text output",
        })
      : halfBlockCapability(
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
      dependency: "none",
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
      dependency: "none",
      reason: "terminal answered the kitty graphics query",
    });
  }
  if (probe?.sixel && hasChafa) {
    return buildCapability({
      terminal,
      protocol: "sixel",
      renderer: "chafa-sixel",
      available: true,
      dependency: "chafa",
      reason: "terminal reported sixel support (DA1)",
    });
  }
  if (probe?.sixel && !hasChafa) {
    // Detection found sixel but the encoder is missing. Say so explicitly:
    // "unverifiable" would be a lie now, and chafa is the one thing to install.
    return halfBlockCapability(terminal, "terminal reports sixel, but chafa is not installed");
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

  // WezTerm's sixel support is long-standing and version-independent, so it is
  // safe to prefer the higher-fidelity path when chafa is present.
  if (terminal === "wezterm" && hasChafa) {
    return buildCapability({
      terminal,
      protocol: "sixel",
      renderer: "chafa-sixel",
      available: true,
      dependency: "chafa",
      reason: "WezTerm detected with chafa",
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
  chafaAvailableMemo = undefined;
  capabilityMemo.clear();
}

export const __testing = {
  runtime,
  resetMemo,
};
