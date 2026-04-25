import { createContainer } from "@/container";
import { searchTitles } from "@/app/search-routing";

const container = await createContainer({ debug: true });
const { searchRegistry, providerRegistry, config } = container;

const query = process.argv[2] ?? "Kimetsu no Yaiba";

const search = await searchTitles(query, {
  mode: "anime",
  providerId: config.animeProvider,
  animeLang: config.animeLang,
  searchRegistry,
});

const selected =
  search.results.find((result) => result.type === "series" && (result.episodeCount ?? 0) > 1) ??
  search.results.find((result) => result.type === "series") ??
  search.results[0];

if (!selected) {
  console.error(
    JSON.stringify({ ok: false, stage: "search", query, reason: "no_results" }, null, 2),
  );
  process.exit(1);
}

const provider = providerRegistry.get(config.animeProvider);
if (!provider) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage: "provider",
        provider: config.animeProvider,
        reason: "missing_provider",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const title = {
  id: selected.id,
  type: selected.type,
  name: selected.title,
  year: selected.year,
  overview: selected.overview,
  posterUrl: selected.posterPath ?? undefined,
  episodeCount: selected.episodeCount,
};

const episodes = provider.listEpisodes ? await provider.listEpisodes({ title }) : null;
const stream = await provider.resolveStream({
  title,
  episode: { season: 1, episode: 1 },
  subLang: config.subLang,
});

const payload = {
  ok: true,
  query,
  sourceName: search.sourceName,
  title: title.name,
  titleId: title.id,
  episodeCount: title.episodeCount ?? null,
  episodeOptions: episodes?.length ?? 0,
  firstEpisodes: episodes?.slice(0, 3).map((episode) => episode.label) ?? [],
  streamResolved: Boolean(stream?.url),
  subtitleUrl: stream?.subtitle ?? null,
  subtitleTracks: stream?.subtitleList?.length ?? 0,
  headerKeys: Object.keys(stream?.headers ?? {}),
  streamHost: stream?.url ? new URL(stream.url).host : null,
};

console.log(JSON.stringify(payload, null, 2));

if (!stream?.url) {
  process.exit(1);
}
