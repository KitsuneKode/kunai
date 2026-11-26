import pin from "./provider-manifest-pin.json";

/**
 * The project's own signed hotfix channel: a fixed URL on the repository's
 * `provider-manifest` prerelease and the Ed25519 keys allowed to sign it.
 *
 * Until `scripts/setup-signing-keys.ts` writes a key here, `publicKeysById` is
 * empty and nothing is fetched. An operator's own channel still wins:
 * `KUNAI_PROVIDER_MANIFEST_PUBKEYS` (and `KUNAI_PROVIDER_MANIFEST_URL`) replace
 * the pin entirely, so a fork never mixes its keys with this URL.
 */
export function pinnedManifestPublicKeys(): Readonly<Record<string, string>> {
  const keys: Readonly<Record<string, string>> = pin.publicKeysById;
  return Object.fromEntries(Object.entries(keys).filter(([, pem]) => pem.trim().length > 0));
}

/**
 * Where background and urgent refreshes fetch from: the operator's
 * `KUNAI_PROVIDER_MANIFEST_URL`, else the pinned URL, but only while the pinned
 * keys are the ones in force (an operator's own keys never verify this URL).
 */
export function defaultManifestUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const configured = env.KUNAI_PROVIDER_MANIFEST_URL?.trim();
  if (configured) return configured;
  if (env.KUNAI_PROVIDER_MANIFEST_PUBKEYS?.trim()) return undefined;
  return Object.keys(pinnedManifestPublicKeys()).length > 0 ? pin.url : undefined;
}
