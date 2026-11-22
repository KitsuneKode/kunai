import type { Container } from "@/container";
import type { ShellMode } from "@/domain/types";
import type { SearchRegistry } from "@/services/search/SearchRegistry";
import { searchTitles } from "@/services/search/SearchRoutingService";

export interface HeadlessSearchContainer {
  readonly config: Pick<
    Container["config"],
    "offlineMode" | "provider" | "animeProvider" | "youtubeProvider" | "animeLanguageProfile"
  >;
  readonly providerRegistry: Container["providerRegistry"];
  readonly searchRegistry: Pick<SearchRegistry, "getDefault" | "getForProvider">;
}

export interface HeadlessSearchOptions {
  readonly container: HeadlessSearchContainer;
  readonly query: string;
  readonly mode: ShellMode;
  readonly write?: (text: string) => void;
  readonly signal?: AbortSignal;
}

export async function runHeadlessSearchJson(options: HeadlessSearchOptions): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const { config } = options.container;
  if (config.offlineMode) {
    const payload = {
      ok: false,
      schemaVersion: 1 as const,
      mode: options.mode,
      query: options.query,
      error: "Offline mode is enabled; headless search requires network access",
      count: 0,
      results: [],
      failures: [],
    };
    write(`${JSON.stringify(payload, null, 2)}\n`);
    return 2;
  }

  const providerId =
    options.mode === "anime"
      ? config.animeProvider
      : options.mode === "youtube"
        ? config.youtubeProvider
        : config.provider;

  try {
    const outcome = await searchTitles(options.query, {
      mode: options.mode,
      providerId,
      animeLanguageProfile: config.animeLanguageProfile,
      providerRegistry: options.container.providerRegistry,
      searchRegistry: options.container.searchRegistry,
      signal: options.signal,
      enrichAnimeMetadata: false,
    });

    const payload = {
      ok: outcome.results.length > 0 || (outcome.providerSearchFailures?.length ?? 0) === 0,
      schemaVersion: 1 as const,
      mode: options.mode,
      query: options.query,
      count: outcome.results.length,
      results: outcome.results.map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        year: item.year ?? null,
        rating: item.rating ?? null,
        posterPath: item.posterPath ?? null,
      })),
      failures: outcome.providerSearchFailures ?? [],
    };

    write(`${JSON.stringify(payload, null, 2)}\n`);
    return payload.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload = {
      ok: false,
      schemaVersion: 1 as const,
      mode: options.mode,
      query: options.query,
      error: message,
      count: 0,
      results: [],
      failures: [{ providerId, message }],
    };
    write(`${JSON.stringify(payload, null, 2)}\n`);
    return 1;
  }
}
