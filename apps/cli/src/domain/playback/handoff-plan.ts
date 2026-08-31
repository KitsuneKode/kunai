import type { PlayerCapabilities } from "@/domain/playback/player-capabilities";
import type { DetachedPlayerTarget } from "@/domain/playback/player-choice";
import type { StreamInfo } from "@/domain/types";

export type HandoffBlocker =
  | "custom-headers-required"
  | "cookies-required"
  | "yt-dlp-required"
  | "deferred-source"
  | "unsupported-scheme"
  | "external-subtitle-unsupported"
  | "local-source-unsupported";

export type HandoffPlan =
  | {
      readonly ok: true;
      readonly url: string;
      readonly player: DetachedPlayerTarget;
    }
  | {
      readonly ok: false;
      readonly blockers: readonly HandoffBlocker[];
    };

interface HandoffPlanInput {
  readonly stream: StreamInfo;
  readonly player: DetachedPlayerTarget;
  readonly capabilities: PlayerCapabilities;
  readonly localSource: boolean;
}

function hasSupportedProtocol(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hasExternalSubtitle(stream: StreamInfo): boolean {
  if (stream.subtitle?.trim()) return true;
  return Boolean(
    stream.subtitleList?.some(
      (subtitle) => subtitle.url.trim().length > 0 && subtitle.sourceKind !== "embedded",
    ),
  );
}

export function createHandoffPlan(input: HandoffPlanInput): HandoffPlan {
  const { stream, capabilities } = input;
  const headerEntries = Object.entries(stream.headers).filter(([, value]) => value.trim());
  const hasCookies = headerEntries.some(([name]) => name.toLowerCase() === "cookie");
  const hasOtherHeaders = headerEntries.some(([name]) => name.toLowerCase() !== "cookie");
  const blockers: HandoffBlocker[] = [];

  if (!capabilities.customHeaders && hasOtherHeaders) blockers.push("custom-headers-required");
  if (!capabilities.customHeaders && hasCookies) blockers.push("cookies-required");
  if (stream.requiresYtdl === true) blockers.push("yt-dlp-required");
  if (stream.deferredLocator?.trim()) blockers.push("deferred-source");
  if (!hasSupportedProtocol(stream.url)) blockers.push("unsupported-scheme");
  if (!capabilities.externalSubtitles && hasExternalSubtitle(stream)) {
    blockers.push("external-subtitle-unsupported");
  }
  if (!capabilities.localFiles && input.localSource) blockers.push("local-source-unsupported");

  if (blockers.length > 0) return { ok: false, blockers };
  return { ok: true, url: stream.url, player: input.player };
}
