import { createContainer } from "@/container";
import type { TitleInfo } from "@/domain/types";

import { buildProviderSmokePayload, providerSmokeError } from "./provider-smoke";

const season = Number(process.argv[2] ?? "1");
const episode = Number(process.argv[3] ?? "1");
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("rivestream");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_rivestream" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
}

const title: TitleInfo = {
  id: "1396",
  type: "series",
  name: "Breaking Bad",
};

let resolveError: unknown = null;
const stream = await provider
  .resolveStream({
    title,
    episode: { season, episode },
    subLang: container.config.subLang,
  })
  .catch((error) => {
    resolveError = error;
    return null;
  });

const payload = {
  ...buildProviderSmokePayload({
    provider: "rivestream",
    title,
    season,
    episode,
    stream,
  }),
  ...(resolveError ? providerSmokeError(resolveError) : {}),
  cacheCleared: clearCache,
};

console.log(JSON.stringify(payload, null, 2));

if (!stream?.url) {
  process.exit(1);
}
