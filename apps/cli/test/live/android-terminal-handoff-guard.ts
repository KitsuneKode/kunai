import { isAbsolute, relative, resolve } from "node:path";

import { detectPlayerPlatform } from "@/domain/playback/player-choice";

export type AndroidHandoffSmokePlayer = "mpv" | "vlc";

export type AndroidHandoffSmokeGuardResult =
  | {
      readonly ok: true;
      readonly player: AndroidHandoffSmokePlayer;
      readonly url: string;
      readonly binaryPath: string;
      readonly storageRoot: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "not-android"
        | "player-required"
        | "url-required"
        | "invalid-url"
        | "storage-root-required"
        | "storage-root-not-isolated"
        | "binary-required"
        | "binary-not-found";
      readonly message: string;
    };

function isWithin(candidate: string, parent: string): boolean {
  const offset = relative(parent, candidate);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

export function validateAndroidHandoffSmoke(input: {
  readonly platform?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly realHome: string;
  readonly fileExists?: (path: string) => boolean;
}): AndroidHandoffSmokeGuardResult {
  if (detectPlayerPlatform({ platform: input.platform, env: input.env }) !== "android") {
    return {
      ok: false,
      reason: "not-android",
      message: "The Android handoff smoke must run inside Android or Termux.",
    };
  }

  const player = input.env["KUNAI_ANDROID_HANDOFF_PLAYER"];
  if (player !== "mpv" && player !== "vlc") {
    return {
      ok: false,
      reason: "player-required",
      message: "Set KUNAI_ANDROID_HANDOFF_PLAYER to mpv or vlc explicitly.",
    };
  }

  const rawUrl = input.env["KUNAI_ANDROID_HANDOFF_URL"];
  if (!rawUrl) {
    return {
      ok: false,
      reason: "url-required",
      message: "Set KUNAI_ANDROID_HANDOFF_URL to a direct test media URL.",
    };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      reason: "invalid-url",
      message: "KUNAI_ANDROID_HANDOFF_URL must be an absolute HTTP or HTTPS URL.",
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: "invalid-url",
      message: "KUNAI_ANDROID_HANDOFF_URL must be an absolute HTTP or HTTPS URL.",
    };
  }

  const rawStorageRoot = input.env["KUNAI_ANDROID_SMOKE_ROOT"];
  if (!rawStorageRoot || !isAbsolute(rawStorageRoot)) {
    return {
      ok: false,
      reason: "storage-root-required",
      message: "KUNAI_ANDROID_SMOKE_ROOT must be an absolute temporary directory.",
    };
  }

  const storageRoot = resolve(rawStorageRoot);
  const realHome = resolve(input.realHome);
  if (isWithin(storageRoot, realHome)) {
    return {
      ok: false,
      reason: "storage-root-not-isolated",
      message: "The Android smoke root must not resolve inside the real user profile.",
    };
  }

  const rawBinaryPath = input.env["KUNAI_ANDROID_HANDOFF_BINARY"];
  if (!rawBinaryPath || !isAbsolute(rawBinaryPath)) {
    return {
      ok: false,
      reason: "binary-required",
      message: "KUNAI_ANDROID_HANDOFF_BINARY must be an absolute compiled Kunai binary path.",
    };
  }
  const binaryPath = resolve(rawBinaryPath);
  if (!(input.fileExists ?? (() => false))(binaryPath)) {
    return {
      ok: false,
      reason: "binary-not-found",
      message: "KUNAI_ANDROID_HANDOFF_BINARY does not exist.",
    };
  }

  return { ok: true, player, url: url.toString(), binaryPath, storageRoot };
}
