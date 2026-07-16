import {
  encodePlaybackTargetRef,
  parseKunaiShareUrl,
  type CatalogNs,
  type KunaiShareAction,
  type PlaybackTargetRef,
  type ShareAnchor,
} from "@/domain/share/playback-target-ref";
import { buildShareRefFromTitleContext } from "@/domain/share/share-ref-from-title-context";
import type { ShellMode, TitleInfo } from "@/domain/types";

export { buildShareRefFromTitleContext } from "@/domain/share/share-ref-from-title-context";

export type KunaiHandoffLaunch = {
  readonly action: KunaiShareAction;
  readonly ref: PlaybackTargetRef;
  readonly requiresConfirmation: true;
};

export const KUNAI_INSTALL_URL = "https://github.com/KitsuneKode/kunai#install";
export const KUNAI_INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh";

export function parseKunaiHandoffUrl(value: string): KunaiHandoffLaunch | null {
  const parsed = parseKunaiShareUrl(value);
  if (!parsed) return null;
  return { action: parsed.action, ref: parsed.ref, requiresConfirmation: true };
}

export function buildKunaiPlaybackHandoffUrl(input: {
  readonly title: Pick<TitleInfo, "id" | "type" | "name" | "externalIds" | "isAnime">;
  readonly mode: ShellMode;
  readonly episode?: { readonly season: number; readonly episode: number };
  readonly startSeconds?: number;
  readonly providerId?: string;
}): string | null {
  const ref = buildShareRefFromTitleContext(input);
  return ref ? encodePlaybackTargetRef(ref) : null;
}

export function describeKunaiHandoffLaunch(handoff: KunaiHandoffLaunch): string {
  const target = describeShareAnchor(handoff.ref.anchor, handoff.ref.kind);
  const episode =
    handoff.ref.season !== undefined && handoff.ref.episode !== undefined
      ? ` S${handoff.ref.season}E${handoff.ref.episode}`
      : handoff.ref.absoluteEpisode !== undefined
        ? ` ep ${handoff.ref.absoluteEpisode}`
        : "";
  const timestamp = handoff.ref.startSeconds !== undefined ? ` @ ${handoff.ref.startSeconds}s` : "";
  const mode =
    handoff.ref.kind === "anime"
      ? "anime mode"
      : handoff.ref.kind === "video"
        ? "youtube mode"
        : "default mode";
  return handoff.action === "download"
    ? `Queue a download for ${target}${episode} in ${mode}`
    : `Open playback for ${target}${episode}${timestamp} in ${mode}`;
}

function describeShareAnchor(anchor: ShareAnchor, kind: PlaybackTargetRef["kind"]): string {
  if (anchor.by === "search") return `search "${anchor.query}"`;
  return `${kind} ${anchor.ns}:${anchor.id}`;
}

export type { CatalogNs, PlaybackTargetRef, ShareAnchor };
