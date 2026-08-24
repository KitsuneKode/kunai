/**
 * Read-only relay diagnostic for the user's configured relay.
 *
 *   bun run test:relay
 *   bun run test:relay "Frieren"
 *
 * Explicit KUNAI_RELAY_* values override stored values. The full validated URL
 * and token are passed only to the isolated child smoke and are never logged.
 */
import { getKunaiPaths } from "@kunai/storage";

import {
  relayAllAnimeSmokePath,
  resolveRelayDiagnosticConfig,
  type RawRelayDiagnosticConfig,
} from "./relay-config";

function skip(reason: string): never {
  console.log(JSON.stringify({ ok: true, skipped: true, reason }, null, 2));
  process.exit(0);
}

function fail(reason: string): never {
  console.error(JSON.stringify({ ok: false, stage: "relay-config", reason }, null, 2));
  process.exit(1);
}

const configPath = getKunaiPaths().configPath;
let config: RawRelayDiagnosticConfig | undefined;
try {
  config = (await Bun.file(configPath).json()) as RawRelayDiagnosticConfig;
} catch {
  config = undefined;
}

let resolution;
try {
  resolution = resolveRelayDiagnosticConfig({ env: process.env, config, configPath });
} catch (error) {
  fail(error instanceof Error ? error.message : "relay URL validation failed");
}

if (resolution.kind === "skip") skip(resolution.reason);

console.log(
  JSON.stringify(
    {
      ok: true,
      stage: "relay-config",
      source: resolution.source,
      relayOrigin: resolution.displayOrigin,
      tokenPresent: resolution.tokenPresent,
      forcesAllAnime: resolution.forcesAllAnime,
      configPath,
    },
    null,
    2,
  ),
);

const child = Bun.spawn({
  cmd: [process.execPath, relayAllAnimeSmokePath(import.meta.url), ...process.argv.slice(2)],
  cwd: import.meta.dir,
  env: {
    ...process.env,
    KUNAI_RELAY_BASE_URL: resolution.baseUrl,
    ...(resolution.token ? { KUNAI_RELAY_TOKEN: resolution.token } : {}),
  },
  stdio: ["inherit", "inherit", "inherit"],
});

process.exit(await child.exited);
