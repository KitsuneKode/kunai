import { langMatches } from "@/subtitle";

import type { StreamInfo } from "./types";

export function selectedHardSubLanguage(stream: StreamInfo): string | null {
  if (stream.hardSubLanguage) return stream.hardSubLanguage;

  const result = stream.providerResolveResult;
  if (!result?.selectedStreamId) return null;
  const selected = result.streams.find((candidate) => candidate.id === result.selectedStreamId);
  return selected?.hardSubLanguage ?? null;
}

export function hardSubInventory(stream: StreamInfo): readonly string[] {
  const values = [
    stream.hardSubLanguage,
    ...(stream.providerResolveResult?.streams.map((candidate) => candidate.hardSubLanguage) ?? []),
  ];
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function hardSubSatisfiesSubtitlePreference(
  stream: StreamInfo,
  preferredSubtitleLanguage: string,
): boolean {
  if (
    preferredSubtitleLanguage === "none" ||
    preferredSubtitleLanguage === "interactive" ||
    preferredSubtitleLanguage === "fzf"
  )
    return false;
  const hardSubLanguage = selectedHardSubLanguage(stream);
  return hardSubLanguage ? langMatches(hardSubLanguage, preferredSubtitleLanguage) : false;
}
