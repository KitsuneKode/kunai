import { createContainer } from "@/container";
import type { TitleInfo } from "@/domain/types";

import { buildProviderSmokePayload, providerSmokeError } from "./provider-smoke";

const episode = Number(process.argv[2] ?? "1");
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("miruro");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_miruro" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
}

const title: TitleInfo = {
  id: "101922",
  type: "series",
  name: "Demon Slayer: Kimetsu no Yaiba",
};

let resolveError: unknown = null;
const stream = await provider
  .resolveStream({
    title,
    episode: { season: 1, episode },
    subLang: container.config.subLang,
    animeLang: container.config.animeLang,
  })
  .catch((error) => {
    resolveError = error;
    return null;
  });

const payload = {
  ...buildProviderSmokePayload({
    provider: "miruro",
    title,
    season: 1,
    episode,
    stream,
  }),
  ...(resolveError ? providerSmokeError(resolveError) : {}),
  animeLang: container.config.animeLang,
  cacheCleared: clearCache,
};

console.log(JSON.stringify(payload, null, 2));

if (!stream?.url) {
  process.exit(1);
}
