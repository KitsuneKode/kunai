import { detectPlayerPlatform } from "@/domain/playback/player-choice";
import { isPlayerPreference } from "@kunai/config";

import type { EnumOption, SettingRowDef, SettingsRegistryContext } from "../types";
import {
  AUTO_CLEANUP_GRACE_DAY_OPTIONS,
  CONTINUE_SOURCE_PREFERENCE_OPTIONS,
  HDR_MODE_OPTIONS,
  MPV_HWDEC_MODE_OPTIONS,
  PRE_PLAY_CONFIRM_SETTINGS_OPTIONS,
  PROVIDER_QUALITY_SETTINGS_OPTIONS,
  QUIT_NEAR_END_BEHAVIOR_OPTIONS,
  QUIT_THRESHOLD_MODE_OPTIONS,
  RECOVERY_MODE_OPTIONS,
  STARTUP_PRIORITY_OPTIONS,
} from "./shared";

export function playbackSettingsRows(_ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:playback",
      label: "Playback & Offline",
      tabLabel: "Playback",
      detail: "Playback recovery, autoplay, intro skip, downloads, and offline library",
    },
    {
      kind: "subheading",
      id: "subheading:playback-recovery",
      label: "Playback & Recovery",
    },
    {
      kind: "enum",
      id: "recoveryMode",
      effectTiming: "next-playback",
      configKeys: ["recoveryMode"],
      label: "Recovery mode",
      detail: "Choose how aggressively Kunai retries and switches providers",
      options: RECOVERY_MODE_OPTIONS,
      presentation: "submenu",
      read: (config) => config.recoveryMode,
      write: (config, value) => ({ ...config, recoveryMode: value as typeof config.recoveryMode }),
    },
    {
      kind: "enum",
      id: "startupPriority",
      effectTiming: "next-playback",
      configKeys: ["startupPriority"],
      label: "Startup priority",
      detail: "Choose how long provider startup waits for richer stream choices",
      options: STARTUP_PRIORITY_OPTIONS,
      presentation: "submenu",
      read: (config) => config.startupPriority,
      write: (config, value) => ({
        ...config,
        startupPriority: value as typeof config.startupPriority,
      }),
    },
    {
      kind: "enum",
      id: "player",
      effectTiming: "next-launch",
      configKeys: ["player"],
      label: "Player",
      detail: "Used when --player is not given · takes effect the next time Kunai starts",
      options: playerOptions(),
      presentation: "submenu",
      read: (config) => (isPlayerPreference(config.player) ? config.player : "auto"),
      write: (config, value) => ({
        ...config,
        player: isPlayerPreference(value) ? value : "auto",
      }),
    },
    {
      kind: "enum",
      id: "hdrMode",
      effectTiming: "next-playback",
      configKeys: ["hdrMode"],
      label: "HDR playback",
      detail: "How mpv handles HDR10, HLG, and Dolby Vision streams",
      options: HDR_MODE_OPTIONS,
      presentation: "submenu",
      read: (config) => config.hdrMode,
      write: (config, value) => ({
        ...config,
        // SAFETY: the row's options are HDR_MODE_OPTIONS, the same union HdrMode declares.
        hdrMode: value as typeof config.hdrMode,
      }),
    },
    {
      kind: "enum",
      id: "mpvHwdec",
      effectTiming: "next-playback",
      configKeys: ["mpvHwdec"],
      label: "Hardware decoding",
      detail:
        "Probe-select hardware decoding, use an mpv automatic mode/backend, or force software",
      options: MPV_HWDEC_MODE_OPTIONS,
      presentation: "submenu",
      read: (config) => config.mpvHwdec,
      write: (config, value) => ({
        ...config,
        // SAFETY: the row's options are MPV_HWDEC_MODE_OPTIONS, the same union the config field declares.
        mpvHwdec: value as typeof config.mpvHwdec,
      }),
    },
    {
      kind: "boolean",
      id: "mpvAvsyncRecovery",
      effectTiming: "next-playback",
      configKeys: ["mpvAvsyncRecovery"],
      label: "A/V sync recovery",
      detail:
        "When mpv reports sustained audio/video drift, seek once to the current position to resync",
      read: (config) => config.mpvAvsyncRecovery,
      write: (config, value) => ({ ...config, mpvAvsyncRecovery: value }),
    },
    {
      kind: "enum",
      id: "prePlayConfirm",
      effectTiming: "next-playback",
      configKeys: ["prePlayConfirm"],
      label: "Confirm before play",
      detail: "Show the Tracks sheet (source · quality · audio · subs) before mpv launches",
      options: PRE_PLAY_CONFIRM_SETTINGS_OPTIONS,
      presentation: "submenu",
      read: (config) => config.prePlayConfirm,
      write: (config, value) => ({
        ...config,
        // SAFETY: the row's options are PRE_PLAY_CONFIRM_SETTINGS_OPTIONS, the
        // same union the config field declares.
        prePlayConfirm: value as typeof config.prePlayConfirm,
      }),
    },
    {
      kind: "boolean",
      id: "resumeStartChoicePrompt",
      effectTiming: "next-playback",
      configKeys: ["resumeStartChoicePrompt"],
      label: "Resume vs start-over prompt",
      detail: "When autoplay resumes mid-episode, show mpv overlay (R/O) before seeking",
      read: (config) => config.resumeStartChoicePrompt,
      write: (config, value) => ({ ...config, resumeStartChoicePrompt: value }),
    },
    {
      kind: "subheading",
      id: "subheading:autoplay-skip",
      label: "Autoplay & Skip",
    },
    {
      kind: "boolean",
      id: "autoNext",
      effectTiming: "next-playback",
      configKeys: ["autoNext"],
      label: "Autoplay next",
      detail: "Close mpv on EOF and continue through the next available released episode",
      read: (config) => config.autoNext,
      write: (config, value) => ({ ...config, autoNext: value }),
    },
    {
      kind: "enum",
      id: "quitNearEndBehavior",
      effectTiming: "next-playback",
      configKeys: ["quitNearEndBehavior"],
      label: "Quit near end",
      detail: "Whether quitting mpv near the natural end can still trigger auto-next",
      options: QUIT_NEAR_END_BEHAVIOR_OPTIONS,
      presentation: "submenu",
      read: (config) => config.quitNearEndBehavior,
      write: (config, value) => ({
        ...config,
        quitNearEndBehavior: value as typeof config.quitNearEndBehavior,
      }),
    },
    {
      kind: "enum",
      id: "quitNearEndThresholdMode",
      effectTiming: "next-playback",
      configKeys: ["quitNearEndThresholdMode"],
      label: "Near-end detection",
      detail: "How Kunai decides you were close enough to the end for quit + completion",
      options: QUIT_THRESHOLD_MODE_OPTIONS,
      presentation: "submenu",
      read: (config) => config.quitNearEndThresholdMode,
      write: (config, value) => ({
        ...config,
        quitNearEndThresholdMode: value as typeof config.quitNearEndThresholdMode,
      }),
    },
    {
      kind: "boolean",
      id: "skipRecap",
      effectTiming: "next-playback",
      configKeys: ["skipRecap"],
      label: "Skip recaps",
      detail: "Auto-skip recap segments when IntroDB timing exists",
      read: (config) => config.skipRecap,
      write: (config, value) => ({ ...config, skipRecap: value }),
    },
    {
      kind: "boolean",
      id: "skipIntro",
      effectTiming: "next-playback",
      configKeys: ["skipIntro"],
      label: "Skip intros",
      detail: "Auto-skip intro segments when IntroDB timing exists",
      read: (config) => config.skipIntro,
      write: (config, value) => ({ ...config, skipIntro: value }),
    },
    {
      kind: "boolean",
      id: "skipCredits",
      effectTiming: "next-playback",
      configKeys: ["skipCredits"],
      label: "Skip credits",
      detail: "Auto-skip credits segments when IntroDB or AniSkip timing exists",
      read: (config) => config.skipCredits,
      write: (config, value) => ({ ...config, skipCredits: value }),
    },
    {
      kind: "subheading",
      id: "subheading:offline-continuation",
      label: "Downloads & Offline",
      detail: "Enable Keep watching offline per title; streaming never downloads automatically",
    },
    {
      kind: "boolean",
      id: "downloadsEnabled",
      effectTiming: "immediate",
      configKeys: ["downloadsEnabled"],
      label: "Offline downloads",
      detail: "Enable local completed downloads and the offline library surface",
      read: (config) => config.downloadsEnabled,
      write: (config, value) => ({ ...config, downloadsEnabled: value }),
    },
    {
      kind: "boolean",
      id: "offlineMode",
      effectTiming: "immediate",
      configKeys: ["offlineMode"],
      label: "Offline mode",
      detail: "Stay local-only: open the library surface and skip online provider/search work",
      read: (config) => config.offlineMode,
      write: (config, value) => ({ ...config, offlineMode: value }),
    },
    {
      kind: "enum",
      id: "defaultDownloadQuality",
      effectTiming: "immediate",
      configKeys: ["defaultDownloadQuality"],
      label: "Default download quality",
      detail: "Quality ceiling used when queuing downloads (independent of playback profile)",
      options: PROVIDER_QUALITY_SETTINGS_OPTIONS,
      presentation: "submenu",
      read: (config) => config.defaultDownloadQuality,
      write: (config, value) => ({ ...config, defaultDownloadQuality: value }),
    },
    {
      kind: "boolean",
      id: "powerSaverMode",
      effectTiming: "immediate",
      configKeys: ["powerSaverMode"],
      label: "Power Saver",
      detail: "Pause speculative prefetch, passive refresh, artwork warming, and runway refills",
      read: (config) => config.powerSaverMode,
      write: (config, value) => ({ ...config, powerSaverMode: value }),
    },
    {
      kind: "boolean",
      id: "autoCleanupWatched",
      effectTiming: "next-launch",
      configKeys: ["autoCleanupWatched"],
      label: "Auto-cleanup",
      detail: "Flag watched completed downloads for explicit cleanup after the grace period",
      read: (config) => config.autoCleanupWatched,
      write: (config, value) => ({ ...config, autoCleanupWatched: value }),
    },
    {
      kind: "enum",
      id: "autoCleanupGraceDays",
      effectTiming: "next-launch",
      configKeys: ["autoCleanupGraceDays"],
      label: "Cleanup grace",
      detail: "How long watched downloads stay before they appear as cleanup candidates",
      options: AUTO_CLEANUP_GRACE_DAY_OPTIONS,
      presentation: "submenu",
      read: (config) => String(config.autoCleanupGraceDays),
      write: (config, value) => ({
        ...config,
        autoCleanupGraceDays: Number(value) || config.autoCleanupGraceDays,
      }),
    },
    {
      kind: "text",
      id: "downloadPath",
      effectTiming: "immediate",
      configKeys: ["downloadPath"],
      label: "Download path",
      detail: "Absolute path override for completed download files",
      placeholder: "Type an absolute download path, then press Enter",
      read: (config) => config.downloadPath,
      apply: (config, value) => ({ ...config, downloadPath: value.trim() }),
      validate: (value) =>
        !value.trim() || value.trim().startsWith("/")
          ? null
          : "Type an absolute download path, or clear to use default.",
    },
    {
      kind: "enum",
      id: "continueSourcePreference",
      effectTiming: "next-playback",
      configKeys: ["continueSourcePreference"],
      label: "Continue source",
      detail:
        "Local copy or stream when you continue (Home, History, Calendar, --continue). Ask streams when nobody can answer",
      options: CONTINUE_SOURCE_PREFERENCE_OPTIONS,
      presentation: "submenu",
      read: (config) => config.continueSourcePreference,
      write: (config, value) => ({
        ...config,
        continueSourcePreference: value as typeof config.continueSourcePreference,
      }),
    },
  ];
}

/**
 * VLC is an Android handoff target; desktop playback is mpv, so it is not
 * offered there. On Android a saved VLC or mpv-android is also what external
 * subtitles need — the system chooser cannot pass them.
 */
export function playerOptions(platform = detectPlayerPlatform()): readonly EnumOption[] {
  const android = platform === "android";
  return [
    {
      value: "auto",
      label: "Auto",
      detail: android ? "Ask Android which app plays each stream" : "mpv",
    },
    { value: "mpv", label: android ? "mpv-android" : "mpv", detail: "Always this player" },
    ...(android
      ? [{ value: "vlc", label: "VLC", detail: "Always VLC; keeps external subtitles" }]
      : []),
  ];
}
