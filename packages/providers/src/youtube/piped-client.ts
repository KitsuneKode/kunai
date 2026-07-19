export type PipedSearchItem = {
  readonly url?: string;
  readonly title?: string;
  readonly thumbnail?: string;
  readonly uploaderName?: string;
  readonly uploaderUrl?: string;
  readonly duration?: number;
  readonly views?: number;
  readonly uploaded?: number;
  readonly shortDescription?: string;
  readonly isShort?: boolean;
};

export type PipedSearchResponse = {
  readonly items?: readonly PipedSearchItem[];
  readonly nextpage?: string | null;
};

export type PipedClientOptions = {
  readonly apiBaseUrl: string;
  readonly signal?: AbortSignal;
};

export async function pipedSearch(
  query: string,
  options: PipedClientOptions,
): Promise<PipedSearchResponse> {
  let baseEnd = options.apiBaseUrl.length;
  while (baseEnd > 0 && options.apiBaseUrl.charCodeAt(baseEnd - 1) === 47) baseEnd -= 1;
  const base = options.apiBaseUrl.slice(0, baseEnd);
  const params = new URLSearchParams({ q: query, filter: "videos" });
  const response = await fetch(`${base}/search?${params.toString()}`, {
    signal: options.signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Piped search failed (${response.status})`);
  }
  return (await response.json()) as PipedSearchResponse;
}

export function extractPipedVideoId(item: PipedSearchItem): string | null {
  const url = item.url?.trim();
  if (!url) return null;
  const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match?.[1] ?? null;
}
