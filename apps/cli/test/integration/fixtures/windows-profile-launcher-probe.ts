import { renameSync, writeSync } from "node:fs";

import { prepareCliProfile } from "../../../src/infra/storage/desktop-profile-startup";

async function main(): Promise<void> {
  if (await prepareCliProfile(["--version"], new Set(), true)) {
    const { KUNAI_TEST_PROFILE_LAUNCHER: launcher, KUNAI_TEST_MOVED_LAUNCHER: moved } = process.env;
    if (launcher && moved) renameSync(launcher, moved);
    writeSync(
      1,
      JSON.stringify({ profile: process.env.KUNAI_CONFIG_DIR, args: process.argv.slice(2) }) + "\n",
    );
    process.exitCode = Number(process.env.KUNAI_TEST_PROFILE_STATUS ?? "37");
  }
}

await main();
