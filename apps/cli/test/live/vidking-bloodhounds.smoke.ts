import { createContainer } from "@/container";
import type { TitleInfo } from "@/domain/types";

const season = Number(process.argv[2] ?? "1");
const episode = Number(process.argv[3] ?? "2");
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("vidking");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_vidking" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
}

const title: TitleInfo = {
  id: "127529",
  type: "series",
  name: "Bloodhounds",
};

const stream = await provider.resolveStream({
  title,
  episode: { season, episode },
  subLang: container.config.subLang,
});

console.log(`[TEST] VidKing stream resolution result: ${stream?.url ? "SUCCESS" : "FAILURE"}`);

console.log("\n[TEST] full stream response", stream);

const payload = {
  ok: Boolean(stream?.url),
  title: title.name,
  titleId: title.id,
  provider: "vidking",
  season,
  episode,
  streamResolved: Boolean(stream?.url),
  streamHost: stream?.url ? new URL(stream.url).host : null,
  subtitleUrl: stream?.subtitle ?? null,
  subtitleTracks: stream?.subtitleList?.length ?? 0,
  subtitleSource: stream?.subtitleSource ?? null,
  subtitleEvidence: stream?.subtitleEvidence ?? null,
  headerKeys: Object.keys(stream?.headers ?? {}),
  cacheCleared: clearCache,
};

console.log(JSON.stringify(payload, null, 2));

if (!stream?.url) {
  process.exit(1);
}
