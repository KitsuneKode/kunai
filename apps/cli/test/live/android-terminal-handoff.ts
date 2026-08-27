import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

import { HandoffPlayerService } from "@/infra/player/HandoffPlayerService";
import { getKunaiPaths } from "@kunai/storage";

import packageJson from "../../package.json" with { type: "json" };
import { storageRootEnv } from "../helpers/storage-env";
import { validateAndroidHandoffSmoke } from "./android-terminal-handoff-guard";

const realHome = process.env.HOME ?? homedir();
const storageRoot = mkdtempSync(join(tmpdir(), "kunai-live-android-handoff-"));
const smokeEnv = {
  ...process.env,
  ...storageRootEnv(storageRoot),
  KUNAI_ANDROID_SMOKE_ROOT: storageRoot,
};

process.on("exit", () => {
  rmSync(storageRoot, { force: true, recursive: true });
});

const guard = validateAndroidHandoffSmoke({ env: smokeEnv, realHome });
if (!guard.ok) {
  console.error(
    JSON.stringify({ ok: false, skipped: true, reason: guard.reason, error: guard.message }),
  );
  process.exit(1);
}

Object.assign(process.env, storageRootEnv(storageRoot));
const paths = getKunaiPaths({ platform: "linux", env: smokeEnv, homeDir: storageRoot });
mkdirSync(paths.configDir, { recursive: true });
mkdirSync(paths.dataDir, { recursive: true });
mkdirSync(paths.cacheDir, { recursive: true });

const databaseBefore = {
  data: await Bun.file(paths.dataDbPath).exists(),
  cache: await Bun.file(paths.cacheDbPath).exists(),
};

try {
  const result = await new HandoffPlayerService({ target: guard.player }).play(
    {
      url: guard.url,
      headers: {},
      timestamp: Date.now(),
    },
    {
      url: guard.url,
      displayTitle: "Kunai Android handoff smoke",
    },
  );
  const databaseAfter = {
    data: await Bun.file(paths.dataDbPath).exists(),
    cache: await Bun.file(paths.cacheDbPath).exists(),
  };

  console.log(
    JSON.stringify({
      ok: true,
      skipped: false,
      version: packageJson.version,
      executable: basename(process.execPath),
      runtime: `bun-${Bun.version}`,
      platform: "android-termux",
      tty: {
        stdin: process.stdin.isTTY === true,
        stdout: process.stdout.isTTY === true,
      },
      isolatedProfile: true,
      profileRoot: storageRoot,
      streamHost: new URL(guard.url).host,
      player: guard.player,
      launcher: result.handoff?.launcher ?? null,
      accepted: result.handoff?.accepted === true,
      sqlite: {
        dataPathInsideProfile: paths.dataDbPath.startsWith(storageRoot),
        cachePathInsideProfile: paths.cacheDbPath.startsWith(storageRoot),
        existedBefore: databaseBefore,
        existsAfter: databaseAfter,
      },
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      skipped: false,
      version: packageJson.version,
      executable: basename(process.execPath),
      isolatedProfile: true,
      profileRoot: storageRoot,
      streamHost: new URL(guard.url).host,
      player: guard.player,
      error: error instanceof Error ? error.message : "Android handoff smoke failed",
    }),
  );
  process.exitCode = 1;
}
