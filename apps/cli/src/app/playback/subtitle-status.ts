import { hardSubInventory, selectedHardSubLanguage } from "@/domain/subtitle-policy";
import type { StreamInfo } from "@/domain/types";

export type PlaybackSubtitleStatusTone = "success" | "info" | "warning";
export type PlaybackSubtitleStateKind =
  | "disabled"
  | "selected"
  | "attached"
  | "available"
  | "late-lookup-pending"
  | "lookup-failed"
  | "missing";

export type PlaybackSubtitleState = {
  readonly kind: PlaybackSubtitleStateKind;
  readonly label: string;
  readonly tone: PlaybackSubtitleStatusTone;
  readonly detail?: string;
};

export type PlaybackSubtitleStateOptions = {
  readonly attached?: boolean;
  readonly lateLookup?: "pending" | "failed";
};

export function describePlaybackSubtitleStatus(
  stream: StreamInfo | null | undefined,
  subLang: string,
  options: PlaybackSubtitleStateOptions = {},
): string {
  return projectPlaybackSubtitleState(stream, subLang, options).label;
}

export function projectPlaybackSubtitleState(
  stream: StreamInfo | null | undefined,
  subLang: string,
  options: PlaybackSubtitleStateOptions = {},
): PlaybackSubtitleState {
  if (options.attached) {
    return { kind: "attached", label: "subtitle attached", tone: "success" };
  }

  if (stream?.subtitle) {
    return {
      kind: "selected",
      label: subLang === "none" ? "subtitle selected · preference off" : "subtitle selected",
      tone: "success",
      detail: stream.subtitle,
    };
  }

  const selectedHardSub = stream ? selectedHardSubLanguage(stream) : undefined;
  if (selectedHardSub) {
    return {
      kind: "selected",
      label: `hardsub ${selectedHardSub}`,
      tone: "success",
      detail: selectedHardSub,
    };
  }

  if (subLang === "none") {
    return { kind: "disabled", label: "subtitles disabled", tone: "warning" };
  }

  if (!stream) {
    return { kind: "missing", label: "subtitles not resolved yet", tone: "info" };
  }

  const hardSubLanguages = hardSubInventory(stream);
  if (hardSubLanguages.length > 0) {
    return {
      kind: "available",
      label: `hardsub available ${hardSubLanguages.slice(0, 3).join("/")}`,
      tone: "success",
    };
  }

  if (stream.subtitleList?.length) {
    return {
      kind: "available",
      label: `${stream.subtitleList.length} subtitle tracks available`,
      tone: "success",
    };
  }

  if (options.lateLookup === "pending") {
    return { kind: "late-lookup-pending", label: "subtitle lookup pending", tone: "info" };
  }

  if (options.lateLookup === "failed") {
    return { kind: "lookup-failed", label: "subtitle lookup failed", tone: "warning" };
  }

  return { kind: "missing", label: "subtitles not found", tone: "warning" };
}

export function playbackSubtitleStatusTone(status: string): PlaybackSubtitleStatusTone {
  const normalized = status.toLowerCase();
  if (
    normalized.includes("attached") ||
    normalized.includes("selected") ||
    normalized.startsWith("hardsub") ||
    normalized.includes("available")
  ) {
    return "success";
  }
  if (normalized.includes("not resolved")) return "info";
  return "warning";
}

export function compactPlaybackSubtitleStatus(status: string): string {
  if (status === "subtitle attached") return "subs ready";
  if (status === "subtitle selected") return "subs selected";
  if (status === "subtitles disabled") return "subs off";
  if (status === "subtitles not found") return "subs missing";
  if (status.endsWith(" subtitle tracks available")) {
    return status.replace(" subtitle tracks available", " subs");
  }
  return status;
}
