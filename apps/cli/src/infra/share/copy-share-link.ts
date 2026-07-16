import { encodePlaybackTargetRef } from "@/domain/share/playback-target-ref";
import { buildShareRefFromTitleContext } from "@/domain/share/share-ref-from-title-context";
import type { ShellMode, TitleInfo } from "@/domain/types";
import { copyToClipboard } from "@/infra/clipboard";

export async function copyShareLinkForContext(input: {
  readonly title: Pick<TitleInfo, "id" | "type" | "name" | "externalIds" | "isAnime">;
  readonly mode: ShellMode;
  readonly episode?: { readonly season: number; readonly episode: number };
  readonly startSeconds?: number;
  readonly providerId?: string;
}): Promise<{ readonly url: string; readonly copied: boolean } | null> {
  const ref = buildShareRefFromTitleContext(input);
  if (!ref) return null;
  const url = encodePlaybackTargetRef(ref);
  const copied = await copyToClipboard(url);
  return { url, copied };
}
