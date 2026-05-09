import { debugImage } from "./debug";
import type { ImageCapability, ImageProtocol, ImageRendererId, TerminalId } from "./types";

const DISABLE_VALUES = new Set(["0", "false"]);
const PROTOCOL_VALUES = new Set(["auto", "none", "kitty", "sixel", "symbols"] as const);

type ProtocolOverride = "auto" | "none" | "kitty" | "sixel" | "symbols";

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
  if (env.TERM_PROGRAM?.toLowerCase() === "vscode") return "vscode";
  return "unknown";
}

export function isKittyCompatible(env: NodeJS.ProcessEnv = process.env): boolean {
  const terminal = detectTerminal(env);
  return terminal === "kitty" || terminal === "ghostty";
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

export function detectImageCapability(env: NodeJS.ProcessEnv = process.env): ImageCapability {
  if (!runtime.isStdoutTty()) {
    return noneCapability("unknown", "stdout is not a TTY");
  }

  if (DISABLE_VALUES.has(env.KUNAI_POSTER?.toLowerCase() ?? "")) {
    return noneCapability("unknown", "poster rendering disabled by KUNAI_POSTER");
  }

  const terminal = detectTerminal(env);
  const hasChafa = Boolean(runtime.which("chafa"));
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

  if (terminal === "windows-terminal") {
    if (hasChafa) {
      return buildCapability({
        terminal,
        protocol: "sixel",
        renderer: "chafa-sixel",
        available: true,
        dependency: "chafa",
        reason: "Windows Terminal detected with chafa",
      });
    }
    return noneCapability(terminal, "Windows Terminal detected but chafa is missing");
  }

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

  if (hasChafa) {
    return buildCapability({
      terminal,
      protocol: "symbols",
      renderer: "chafa-symbols",
      available: true,
      dependency: "chafa",
      reason: "chafa available for symbol fallback",
    });
  }

  return noneCapability(terminal, "no supported image protocol detected");
}

export const __testing = {
  runtime,
};
