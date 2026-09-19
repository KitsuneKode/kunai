import { join } from "node:path";

import type { KunaiPaths } from "@kunai/storage";

import { writeAtomicSecretJson } from "../../infra/fs/atomic-write";
import type { CredentialSpawn, CredentialVaultDeps, CredentialVaultPort } from "./credential-vault";

const SPAWN_TIMEOUT_MS = 5_000;
/** secret-tool can stall when the daemon is absent but the CLI exists. */
const SECRET_SERVICE_PROBE_TIMEOUT_MS = 3_000;
const SERVICE_ATTRS = ["service", "kunai"];

async function defaultSpawn(
  argv: readonly string[],
  input: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(argv as string[], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => proc.kill(), timeoutMs);
  try {
    if (input) proc.stdin.write(input);
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * File backend — owner-only JSON map under the config dir. This is the
 * fallback lane and carries the same guarantees `sync-tokens.json` had
 * (0600 / user-only ACL); it is plaintext at rest by definition.
 */
function fileVault(paths: KunaiPaths): CredentialVaultPort {
  const file = join(paths.configDir, "secrets.json");

  async function readAll(): Promise<Record<string, string>> {
    try {
      const raw = await Bun.file(file).json();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return raw as Record<string, string>;
    } catch {
      return {};
    }
  }

  return {
    backend: "file",
    async get(key) {
      return (await readAll())[key];
    },
    async set(key, value) {
      await writeAtomicSecretJson(file, { ...(await readAll()), [key]: value });
    },
    async delete(key) {
      const all = await readAll();
      if (!(key in all)) return;
      delete all[key];
      await writeAtomicSecretJson(file, all);
    },
  };
}

/**
 * Linux Secret Service via `secret-tool` (libsecret CLI). Value goes on stdin —
 * argv is world-readable via `ps`, so the secret never appears there.
 */
function secretServiceVault(spawn: CredentialSpawn): CredentialVaultPort {
  const attrs = (key: string) => [...SERVICE_ATTRS, "key", key];
  return {
    backend: "secret-service",
    async get(key) {
      const out = await spawn(
        ["secret-tool", "lookup", ...attrs(key)],
        "",
        SECRET_SERVICE_PROBE_TIMEOUT_MS,
      );
      return out.exitCode === 0 ? out.stdout.replace(/\n$/, "") : undefined;
    },
    async set(key, value) {
      const out = await spawn(
        ["secret-tool", "store", "--label", `kunai ${key}`, ...attrs(key)],
        value,
        SPAWN_TIMEOUT_MS,
      );
      if (out.exitCode !== 0) throw new Error(`secret-tool store failed (${out.exitCode})`);
    },
    async delete(key) {
      // secret-tool exits non-zero when the entry was already absent —
      // deletion is idempotent, so that is a success, not a failure.
      await spawn(["secret-tool", "clear", ...attrs(key)], "", SPAWN_TIMEOUT_MS);
    },
  };
}

/**
 * macOS Keychain via the `security` CLI. `add-generic-password` has no stdin
 * secret channel — `-w` is argv — which is a brief `ps` exposure documented
 * here deliberately; a native Keychain binding is the follow-up that removes
 * it. Lookup/delete carry only attribute names in argv.
 */
function keychainVault(spawn: CredentialSpawn): CredentialVaultPort {
  return {
    backend: "keychain",
    async get(key) {
      const out = await spawn(
        ["security", "find-generic-password", "-s", "kunai", "-a", key, "-w"],
        "",
        SPAWN_TIMEOUT_MS,
      );
      // exit 44 = item not found; anything else non-zero is also "absent".
      return out.exitCode === 0 ? out.stdout.replace(/\n$/, "") : undefined;
    },
    async set(key, value) {
      const out = await spawn(
        ["security", "add-generic-password", "-U", "-s", "kunai", "-a", key, "-w", value],
        "",
        SPAWN_TIMEOUT_MS,
      );
      if (out.exitCode !== 0) throw new Error(`security add-generic-password failed`);
    },
    async delete(key) {
      const out = await spawn(
        ["security", "delete-generic-password", "-s", "kunai", "-a", key],
        "",
        SPAWN_TIMEOUT_MS,
      );
      // exit 44 (not found) is a successful delete.
      if (out.exitCode !== 0 && !out.stderr.includes("could not be found")) {
        throw new Error(`security delete-generic-password failed`);
      }
    },
  };
}

/**
 * Windows Credential Manager via WinRT `PasswordVault` through `pwsh`
 * (`-NoProfile -NonInteractive -Command`). The secret arrives on stdin and is
 * read inside the script — `cmdkey` is not used because it cannot store
 * arbitrary secrets for arbitrary targets.
 */
function wincredVault(spawn: CredentialSpawn): CredentialVaultPort {
  const run = (script: string, input: string) =>
    spawn(["pwsh", "-NoProfile", "-NonInteractive", "-Command", script], input, SPAWN_TIMEOUT_MS);
  return {
    backend: "wincred",
    async get(key) {
      const out = await run(
        [
          `$v = New-Object Windows.Security.Credentials.PasswordVault`,
          `try { $c = $v.Retrieve('kunai', '${key.replace(/'/g, "''")}'); $c.RetrievePassword(); [Console]::Out.Write($c.Password) } catch { exit 1 }`,
        ].join("; "),
        "",
      );
      return out.exitCode === 0 ? out.stdout : undefined;
    },
    async set(key, value) {
      const out = await run(
        [
          `$pw = [Console]::In.ReadToEnd()`,
          `$v = New-Object Windows.Security.Credentials.PasswordVault`,
          `$c = New-Object Windows.Security.Credentials.PasswordCredential('kunai', '${key.replace(/'/g, "''")}', $pw)`,
          `$v.Add($c)`,
        ].join("; "),
        value,
      );
      if (out.exitCode !== 0) throw new Error("PasswordVault Add failed");
    },
    async delete(key) {
      const out = await run(
        [
          `$v = New-Object Windows.Security.Credentials.PasswordVault`,
          `try { $v.Remove($v.Retrieve('kunai', '${key.replace(/'/g, "''")}')) } catch { }`,
        ].join("; "),
        "",
      );
      if (out.exitCode !== 0) throw new Error("PasswordVault Remove failed");
    },
  };
}

/** Probe: does the platform's CLI backend answer? Absent CLI → absent backend. */
async function probeBackend(
  backend: "keychain" | "wincred" | "secret-service",
  deps: CredentialVaultDeps,
): Promise<CredentialVaultPort | undefined> {
  const which = deps.which ?? ((cmd: string) => Bun.which(cmd));
  const spawn = deps.spawn ?? defaultSpawn;
  try {
    if (backend === "secret-service") {
      if (!which("secret-tool")) return undefined;
      // A lookup on a nonexistent key exercises the daemon round-trip; exit 1
      // (not found) still proves the service answered.
      const out = await spawn(
        ["secret-tool", "lookup", ...SERVICE_ATTRS, "key", "__probe__"],
        "",
        SECRET_SERVICE_PROBE_TIMEOUT_MS,
      );
      return out.exitCode <= 1 ? secretServiceVault(spawn) : undefined;
    }
    if (backend === "keychain") {
      return which("security") ? keychainVault(spawn) : undefined;
    }
    if (backend === "wincred") {
      return which("pwsh") || which("powershell") ? wincredVault(spawn) : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Pick the vault backend: `KUNAI_CREDENTIAL_BACKEND` env override first
 * (`file` forces the file lane for debugging/tests), then the platform
 * backend, then the file fallback — which always works and matches the
 * guarantees the plaintext stores had before.
 */
export async function createCredentialVault(
  deps: CredentialVaultDeps,
): Promise<CredentialVaultPort> {
  const env = deps.env ?? process.env;
  const forced = env["KUNAI_CREDENTIAL_BACKEND"];
  if (forced === "file") return fileVault(deps.paths);
  if (forced === "secret-service" || forced === "keychain" || forced === "wincred") {
    const picked = await probeBackend(forced, deps);
    if (picked) return picked;
    deps.onFallback?.("file", `forced backend ${forced} unavailable`);
    return fileVault(deps.paths);
  }

  const platform = deps.platform ?? process.platform;
  const wanted =
    platform === "darwin" ? "keychain" : platform === "win32" ? "wincred" : "secret-service";
  const picked = await probeBackend(wanted, deps);
  if (picked) return picked;
  deps.onFallback?.("file", `${wanted} backend unavailable on ${platform}`);
  return fileVault(deps.paths);
}
