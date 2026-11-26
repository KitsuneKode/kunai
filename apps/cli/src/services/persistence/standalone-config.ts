import { FileStorage } from "@/infra/storage/FileStorage";
import { getKunaiPaths } from "@kunai/storage";

import { persistedAnalyticsConsent } from "./analytics-consent";
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
  const storage = new FileStorage(undefined, (message) => {
    process.stderr.write(`kunai: ${message}\n`);
  });
  const vault = await createCredentialVault({ paths: getKunaiPaths() });
  return ConfigServiceImpl.load(new ConfigStoreImpl(storage), vault);
}

/**
 * Whether the user has said yes to usage analytics, read from config.json
 * alone. For a command that only needs the answer (release markers): no vault,
 * no migrations, no writes. Any read failure means no consent.
 */
export async function readStandaloneAnalyticsConsented(): Promise<boolean> {
  try {
    const loaded = await new ConfigStoreImpl(new FileStorage()).load();
    return persistedAnalyticsConsent(loaded).analytics === "enabled";
  } catch {
    return false;
  }
}
