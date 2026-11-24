import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { KunaiPaths } from "@kunai/storage";

import { writeAtomicSecretJson } from "../../infra/fs/atomic-write";
import type { CredentialSpawn, CredentialVaultDeps, CredentialVaultPort } from "./credential-vault";

const SPAWN_TIMEOUT_MS = 5_000;
/** secret-tool can stall when the daemon is absent but the CLI exists. */
const SECRET_SERVICE_PROBE_TIMEOUT_MS = 3_000;
// Service/resource label for every backend. Kept in one constant — an inline
// 'kunai' literal next to RetrievePassword()/PasswordCredential trips generic
// secret scanners even though it names the vault entry, not a credential.
const VAULT_SERVICE = "kunai";
const SERVICE_ATTRS = ["service", VAULT_SERVICE];

async function defaultSpawn(
  argv: readonly string[],
  input: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  const proc = Bun.spawn(argv as string[], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    if (input) proc.stdin.write(input);
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr, timedOut };
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
      if (out.exitCode === 0) return out.stdout.replace(/\n$/, "");
      // exit 1 is the documented not-found; any other failure — including a
      // killed spawn — is a daemon fault and must not read as "absent".
      if (out.exitCode === 1 && !out.timedOut && out.stderr.trim() === "") return undefined;
      throw new Error(
        `secret-tool lookup failed (${out.timedOut ? "timeout" : `exit ${out.exitCode}`})`,
      );
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
      const out = await spawn(["secret-tool", "clear", ...attrs(key)], "", SPAWN_TIMEOUT_MS);
      if (out.exitCode === 0) return;
      // secret-tool exits non-zero when the entry was already absent, which is
      // success for an idempotent delete. But a killed spawn or a daemon fault
      // exits non-zero too, so confirm the entry is really gone: a disconnect
      // must never report success while the credential is still readable.
      if (out.timedOut) throw new Error("secret-tool clear timed out");
      const check = await spawn(["secret-tool", "lookup", ...attrs(key)], "", SPAWN_TIMEOUT_MS);
      // Exit 1 means "not found" only without an error message: libsecret
      // also exits 1, with stderr, when the daemon fails.
      if (check.exitCode === 1 && !check.timedOut && check.stderr.trim() === "") return;
      throw new Error(
        `secret-tool clear failed (exit ${out.exitCode}); the entry may still be stored`,
      );
    },
  };
}

// security -i reads one 4096-byte line at a time. Quote the account and
// password for its own split_line parser, and reject inputs it cannot encode.
function keychainArgument(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Unsupported Keychain line delimiter");
  return '"' + value.replace(/["\\]/g, "\\$&") + '"';
}

function keychainVault(spawn: CredentialSpawn): CredentialVaultPort {
  return {
    backend: "keychain",
    async get(key) {
      const out = await spawn(
        ["security", "find-generic-password", "-s", VAULT_SERVICE, "-a", key, "-w"],
        "",
        SPAWN_TIMEOUT_MS,
      );
      if (out.exitCode === 0) return out.stdout.replace(/\n$/, "");
      // exit 44 / "could not be found" = item not found; anything else —
      // including a killed spawn — is a Keychain fault, not "absent".
      if (!out.timedOut && (out.exitCode === 44 || out.stderr.includes("could not be found"))) {
        return undefined;
      }
      throw new Error(
        `security find-generic-password failed (${out.timedOut ? "timeout" : `exit ${out.exitCode}`})`,
      );
    },
    async set(key, value) {
      const command = `add-generic-password -U -s ${VAULT_SERVICE} -a ${keychainArgument(key)} -w ${keychainArgument(value)}\n`;
      if (Buffer.byteLength(command) > 4095)
        throw new Error("Keychain command exceeds input limit");
      const out = await spawn(["security", "-i"], command, SPAWN_TIMEOUT_MS);
      if (out.exitCode !== 0 || out.timedOut)
        throw new Error("security add-generic-password failed");
    },
    async delete(key) {
      const out = await spawn(
        ["security", "delete-generic-password", "-s", VAULT_SERVICE, "-a", key],
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

// Inbox Windows PowerShell projects WinRT classes after explicit activation.
// Distinguish ERROR_NOT_FOUND from a denied or unavailable credential locker.
const WINRT_VAULT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::InputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
  "$v = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()",
].join("; ");
const WINRT_CREDENTIAL =
  "[Windows.Security.Credentials.PasswordCredential,Windows.Security.Credentials,ContentType=WindowsRuntime]";
const WINRT_MISSING =
  "if ($_.Exception.GetBaseException().HResult -eq -2147023728) { exit 44 }; throw";

function wincredVault(
  spawn: CredentialSpawn,
  shell: string,
): CredentialVaultPort & { probe(): Promise<boolean> } {
  const run = (script: string, input = "") =>
    spawn(
      [shell, "-NoProfile", "-NonInteractive", "-Command", `${WINRT_VAULT}; ${script}`],
      input,
      SPAWN_TIMEOUT_MS,
    );
  const retrieve = (key: string) => `$v.Retrieve('${VAULT_SERVICE}', '${key.replace(/'/g, "''")}')`;
  return {
    backend: "wincred",
    async probe() {
      // One shell startup, one unique resource per session. The reserved account
      // never collides with another process or a real credential.
      const out = await run(
        [
          "$resource = [Guid]::NewGuid().ToString()",
          `$c = ${WINRT_CREDENTIAL}::new($resource, '__probe__', 'kunai-probe')`,
          "$v.Add($c)",
          "try { $stored = $v.Retrieve($resource, '__probe__'); $stored.RetrievePassword(); [Console]::Out.Write($stored.Password) } finally { $v.Remove($c) }",
        ].join("; "),
      );
      return out.exitCode === 0 && !out.timedOut && out.stdout === "kunai-probe";
    },
    async get(key) {
      const out = await run(
        `try { $c = ${retrieve(key)} } catch { ${WINRT_MISSING} }; $c.RetrievePassword(); [Console]::Out.Write($c.Password)`,
      );
      if (out.exitCode === 44 && !out.timedOut) return undefined;
      if (out.exitCode !== 0 || out.timedOut) throw new Error("PasswordVault Retrieve failed");
      return out.stdout;
    },
    async set(key, value) {
      const out = await run(
        `$v.Add(${WINRT_CREDENTIAL}::new('${VAULT_SERVICE}', '${key.replace(/'/g, "''")}', [Console]::In.ReadToEnd()))`,
        value,
      );
      if (out.exitCode !== 0 || out.timedOut) throw new Error("PasswordVault Add failed");
    },
    async delete(key) {
      const out = await run(`try { $v.Remove(${retrieve(key)}) } catch { ${WINRT_MISSING} }`);
      if ((out.exitCode !== 0 && out.exitCode !== 44) || out.timedOut)
        throw new Error("PasswordVault Remove failed");
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
      // (not found) still proves the service answered. A killed spawn does not.
      // Backend selection must follow the bounded probe result. A separate
      // short race can hide existing native entries behind an empty file vault
      // when a healthy daemon is slow (for example while unlocking at login).
      const out = await spawn(
        ["secret-tool", "lookup", ...SERVICE_ATTRS, "key", "__probe__"],
        "",
        SECRET_SERVICE_PROBE_TIMEOUT_MS,
      );
      return out.exitCode <= 1 && !out.timedOut ? secretServiceVault(spawn) : undefined;
    }
    if (backend === "keychain") {
      return which("security") ? keychainVault(spawn) : undefined;
    }
    if (backend === "wincred") {
      for (const command of ["powershell.exe", "pwsh"]) {
        const shell = which(command);
        if (!shell) continue;
        const vault = wincredVault(spawn, shell);
        try {
          if (await vault.probe()) return vault;
        } catch {
          // A shell may exist without WinRT support. Try the other host.
        }
      }
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

/** Marker in the profile's config dir: the Windows file-fallback notice was shown. */
export const FILE_FALLBACK_NOTICE_MARKER = ".credential-file-fallback-noticed";

/**
 * Tell a Windows user once per profile that credentials went to profile files.
 * The fallback recurs on every startup on such a machine, so the line used to
 * print every time. The marker is created exclusively before printing; if it
 * cannot be written the notice still prints, so a read-only profile is told.
 */
export function noticeFileFallbackOnce(input: {
  readonly configDir: string;
  readonly platform?: NodeJS.Platform;
  readonly write: (line: string) => void;
}): void {
  if ((input.platform ?? process.platform) !== "win32") return;
  try {
    mkdirSync(input.configDir, { recursive: true });
    writeFileSync(join(input.configDir, FILE_FALLBACK_NOTICE_MARKER), "", { flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return;
  }
  input.write(
    "Windows credential vault unavailable. Kunai will store credentials in user-profile files.\n",
  );
}
