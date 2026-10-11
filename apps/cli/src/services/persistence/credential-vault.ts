import type { KunaiPaths } from "@kunai/storage";

/**
 * OS credential vault port — one entry per secret, keyed by a stable name.
 *
 * Key naming: `<domain>.<field>` — `anilist.tokens` / `tmdb.tokens` hold a JSON
 * blob of the tracker's credential record (one entry per tracker, not one per
 * field), `videasy.sessionToken` holds the bare token. New secrets get their
 * own key; do not nest unrelated values into an existing blob.
 */
export type CredentialBackendId = "keychain" | "wincred" | "secret-service" | "file";

export interface CredentialVaultPort {
  readonly backend: CredentialBackendId;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const CREDENTIAL_KEYS = {
  anilistTokens: "anilist.tokens",
  tmdbTokens: "tmdb.tokens",
  videasySessionToken: "videasy.sessionToken",
} as const;

export type CredentialVaultDeps = {
  readonly paths: KunaiPaths;
  /** Injectable for tests — defaults to Bun.which + Bun.spawn. */
  readonly spawn?: CredentialSpawn;
  readonly which?: (cmd: string) => string | null;
  readonly platform?: NodeJS.Platform;
  readonly env?: Record<string, string | undefined>;
  /** Fires once when a platform backend is unavailable and file fallback engages. */
  readonly onFallback?: (backend: CredentialBackendId, reason: string) => void;
};

/** Spawn shape the CLI backends need: argv array, secret on stdin, timed out. */
export type CredentialSpawn = (
  argv: readonly string[],
  input: string,
  timeoutMs: number,
) => Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the timeout killed the process — a stall, not an answer. */
  readonly timedOut: boolean;
}>;
