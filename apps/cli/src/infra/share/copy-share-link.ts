import {
  encodePlaybackTargetRef,
  encodePlaybackTargetShortCode,
  encodePlaybackTargetWebUrl,
  KUNAI_WEB_SHARE_ORIGIN,
  type PlaybackTargetRef,
} from "@/domain/share/playback-target-ref";
import { buildShareRefFromTitleContext } from "@/domain/share/share-ref-from-title-context";
import type { ShellMode, TitleInfo } from "@/domain/types";
import { copyToClipboard } from "@/infra/clipboard";

export type ShareLinkContext = {
  readonly title: Pick<TitleInfo, "id" | "type" | "name" | "externalIds" | "isAnime" | "posterUrl">;
  readonly mode: ShellMode;
  readonly episode?: { readonly season: number; readonly episode: number };
  readonly startSeconds?: number;
  readonly providerId?: string;
};

export type ShareLinkArtifacts = {
  readonly url: string;
  readonly webUrl: string;
  readonly appUrl: string;
  readonly shortCode: string | null;
  readonly qrUrl: string;
};

export function buildShareLinkArtifactsForContext(
  input: ShareLinkContext,
): ShareLinkArtifacts | null {
  const ref = buildShareRefFromTitleContext(input);
  if (!ref) return null;
  const appUrl = encodePlaybackTargetRef(ref);
  const webUrl = encodePlaybackTargetWebUrl(ref, "play", { posterUrl: input.title.posterUrl });
  const qrRef = stripOptionalQrMetadata(ref);
  const shortCode = tryEncodePlaybackTargetShortCode(qrRef);
  const qrUrl = shortCode
    ? `${KUNAI_WEB_SHARE_ORIGIN}/w/${shortCode}`
    : encodePlaybackTargetWebUrl(qrRef);
  return { url: webUrl, webUrl, appUrl, shortCode, qrUrl };
}

function tryEncodePlaybackTargetShortCode(ref: PlaybackTargetRef): string | null {
  try {
    return encodePlaybackTargetShortCode(ref);
  } catch {
    // A provider-specific catalog identity can be longer than the deliberately
    // bounded compact codec. The canonical HTTPS form remains shareable.
    return null;
  }
}

export async function copyShareLinkForContext(
  input: ShareLinkContext,
  // Injected rather than mock.module'd: Bun's mock.module is process-global and
  // poisons later clipboard unit contracts when this file loads first.
  copy: (text: string) => Promise<boolean> = copyToClipboard,
): Promise<{
  readonly url: string;
  readonly webUrl: string;
  readonly appUrl: string;
  readonly shortCode: string | null;
  readonly qrUrl: string;
  readonly copied: boolean;
} | null> {
  const artifacts = buildShareLinkArtifactsForContext(input);
  if (!artifacts) return null;
  const copied = await copy(artifacts.webUrl);
  return { ...artifacts, copied };
}

function stripOptionalQrMetadata(ref: PlaybackTargetRef): PlaybackTargetRef {
  const compactRef: MutablePlaybackTargetRef = {
    anchor: ref.anchor,
    kind: ref.kind,
  };
  if (ref.season !== undefined) compactRef.season = ref.season;
  if (ref.episode !== undefined) compactRef.episode = ref.episode;
  if (ref.absoluteEpisode !== undefined) compactRef.absoluteEpisode = ref.absoluteEpisode;
  if (ref.startSeconds !== undefined) compactRef.startSeconds = ref.startSeconds;
  return compactRef;
}

type MutablePlaybackTargetRef = {
  -readonly [Key in keyof PlaybackTargetRef]: PlaybackTargetRef[Key];
};
