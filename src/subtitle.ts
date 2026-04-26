// Wyzie subtitle API: the player makes a search request to sub.wyzie.io with an
// embedded API key. We capture the request URL, then fetch it ourselves so we
// control language selection instead of relying on what the player auto-picks.

export type SubtitleEntry = {
  id: string;
  url: string;
  display: string;
  language: string;
  release: string;
};

export async function fetchSubtitlesFromWyzie(
  searchUrl: string,
  preferredLang: string,
): Promise<{ list: SubtitleEntry[]; selected: string | null; failed: boolean }> {
  try {
    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(5000) });
    const list = (await res.json()) as SubtitleEntry[];
    if (!Array.isArray(list) || list.length === 0) {
      return { list: [], selected: null, failed: false };
    }

    const pick =
      list.find((s) => s.language === preferredLang) ||
      (preferredLang !== "en" ? list.find((s) => s.language === "en") : null) ||
      list[0];

    return { list, selected: pick?.url ?? null, failed: false };
  } catch {
    return { list: [], selected: null, failed: true };
  }
}
