export function extractExternalSubtitleIds(trackList: unknown): number[] {
  if (!Array.isArray(trackList)) return [];

  return trackList
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const track = entry as Record<string, unknown>;
      if (track.type !== "sub" || !track.external) return null;
      return typeof track.id === "number" ? track.id : null;
    })
    .filter((id): id is number => id !== null);
}
