import { writeSync } from "node:fs";

import { FileStorage } from "@/infra/storage/FileStorage";
import { getKunaiPaths } from "@kunai/storage";

import { ConfigServiceImpl } from "./ConfigServiceImpl";
import { ConfigStoreImpl } from "./ConfigStoreImpl";
import { createCredentialVault } from "./credential-vault-backends";

/**
 * The user's config for a maintenance command that runs without the shell.
 *
 * It is opened the way startup opens it — same store, same lock, same
 * credential vault, same load-time migrations — so a command that changes one
 * key cannot skip a migration or put a vaulted secret back on disk. Callers
 * `update()`, `save()`, then `flushPending()` before exiting.
 */
export async function openStandaloneConfig(): Promise<ConfigServiceImpl> {
  const trace = (phase: string) => {
    if (process.env.KUNAI_TEST_ADDONS_TRACE === "1") writeSync(2, `[addons-ci-trace] ${phase}\n`);
  };
  const storage = new FileStorage(undefined, (message) => {
    process.stderr.write(`kunai: ${message}\n`);
  });
  trace("before vault");
  const vault = await createCredentialVault({ paths: getKunaiPaths() });
  trace("after vault");
  const config = await ConfigServiceImpl.load(new ConfigStoreImpl(storage), vault);
  trace("after config load");
  return config;
}
