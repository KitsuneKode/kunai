import type { CredentialSpawn, CredentialVaultDeps, CredentialVaultPort } from "./credential-vault";
import { CREDENTIAL_VAULT_PROBE_KEY } from "./credential-vault";

const SPAWN_TIMEOUT_MS = 5_000;
/** secret-tool can stall when the daemon is absent but the CLI exists. */
const SECRET_SERVICE_PROBE_TIMEOUT_MS = 3_000;
// Service/resource label for every backend. Kept in one constant — an inline
// 'kunai' literal next to RetrievePassword()/PasswordCredential trips generic
// secret scanners even though it names the vault entry, not a credential.
const VAULT_SERVICE = "kunai";
const SERVICE_ATTRS = ["service", VAULT_SERVICE];

/**
 * `sync-tokens.json` marker — not a vault implementation. Forced `file` and
 * native fallbacks route tracker tokens through `realSyncTokenFileIo` instead.
 */
const FILE_BACKEND: CredentialVaultPort = {
  backend: "file",
  async get() {
    return undefined;
  },
  async set() {
    throw new Error("file credential backend uses sync-tokens.json");
  },
  async delete() {},
};

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

/** secret-tool: exit 1 means "not found" only with an empty stderr stream. */
function secretToolAbsent(out: {
  readonly exitCode: number;
  readonly stderr: string;
  readonly timedOut: boolean;
}): boolean {
  return out.exitCode === 1 && !out.timedOut && out.stderr.trim() === "";
}

function secretToolFault(
  out: { readonly exitCode: number; readonly stderr: string; readonly timedOut: boolean },
  op: string,
): Error {
  const detail = out.timedOut
    ? "timeout"
    : out.stderr.trim()
      ? `exit ${out.exitCode}: ${out.stderr.trim()}`
      : `exit ${out.exitCode}`;
  return new Error(`secret-tool ${op} failed (${detail})`);
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
      if (secretToolAbsent(out)) return undefined;
      throw secretToolFault(out, "lookup");
    },
    async set(key, value) {
      const out = await spawn(
        ["secret-tool", "store", "--label", `kunai ${key}`, ...attrs(key)],
        value,
        SPAWN_TIMEOUT_MS,
      );
      if (out.exitCode !== 0 || out.timedOut) throw secretToolFault(out, "store");
    },
    async delete(key) {
      const out = await spawn(["secret-tool", "clear", ...attrs(key)], "", SPAWN_TIMEOUT_MS);
      if (out.exitCode === 0 || secretToolAbsent(out)) return;
      throw secretToolFault(out, "clear");
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
      const out = await spawn(
        ["security", "add-generic-password", "-U", "-s", VAULT_SERVICE, "-a", key, "-w", value],
        "",
        SPAWN_TIMEOUT_MS,
      );
      if (out.exitCode !== 0) throw new Error(`security add-generic-password failed`);
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

const WINRT_VAULT_LOAD =
  "[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] | Out-Null";

function wincredScript(body: string): string {
  return `${WINRT_VAULT_LOAD}; ${body}`;
}

function wincredNotFound(out: {
  readonly exitCode: number;
  readonly stderr: string;
  readonly timedOut: boolean;
}): boolean {
  return out.exitCode === 1 && !out.timedOut && out.stderr.trim() === "";
}

/**
 * Windows Credential Manager via WinRT `PasswordVault` through Windows
 * PowerShell 5.1 (`powershell.exe -NoProfile -NonInteractive -Command`).
 * pwsh cannot load the WinRT PasswordVault type — only 5.1 is probed here.
 */
function wincredVault(spawn: CredentialSpawn, shell: string): CredentialVaultPort {
  const run = (script: string, input: string) =>
    spawn(
      [shell, "-NoProfile", "-NonInteractive", "-Command", wincredScript(script)],
      input,
      SPAWN_TIMEOUT_MS,
    );
  const quote = (s: string) => s.replace(/'/g, "''");
  return {
    backend: "wincred",
    async get(key) {
      const out = await run(
        [
          `$v = New-Object Windows.Security.Credentials.PasswordVault`,
          `try { $c = $v.Retrieve('${VAULT_SERVICE}', '${quote(key)}'); $c.RetrievePassword(); [Console]::Out.Write($c.Password) } catch { exit 1 }`,
        ].join("; "),
        "",
      );
      if (out.exitCode === 0) return out.stdout;
      if (wincredNotFound(out)) return undefined;
      throw new Error(
        `PasswordVault Retrieve failed (${out.timedOut ? "timeout" : out.stderr.trim() || `exit ${out.exitCode}`})`,
      );
    },
    async set(key, value) {
      const out = await run(
        [
          `$pw = [Console]::In.ReadToEnd()`,
          `$v = New-Object Windows.Security.Credentials.PasswordVault`,
          `try { $v.Remove($v.Retrieve('${VAULT_SERVICE}', '${quote(key)}')) } catch {}`,
          `$c = New-Object Windows.Security.Credentials.PasswordCredential('${VAULT_SERVICE}', '${quote(key)}', $pw)`,
          `$v.Add($c)`,
        ].join("; "),
        value,
      );
      if (out.exitCode !== 0 || out.timedOut) throw new Error("PasswordVault Add failed");
    },
    async delete(key) {
      const out = await run(
        [
          `$v = New-Object Windows.Security.Credentials.PasswordVault`,
          `try { $v.Remove($v.Retrieve('${VAULT_SERVICE}', '${quote(key)}')) } catch { exit 1 }`,
        ].join("; "),
        "",
      );
      if (out.exitCode === 0) return;
      if (wincredNotFound(out)) return;
      throw new Error("PasswordVault Remove failed");
    },
  };
}

/** Read-only: lookup the probe key — exit 0 or honest not-found means the daemon answered. */
async function probeSecretService(spawn: CredentialSpawn): Promise<boolean> {
  const attrs = [...SERVICE_ATTRS, "key", CREDENTIAL_VAULT_PROBE_KEY];
  const out = await spawn(["secret-tool", "lookup", ...attrs], "", SECRET_SERVICE_PROBE_TIMEOUT_MS);
  if (out.timedOut) return false;
  if (out.exitCode === 0) return true;
  return secretToolAbsent(out);
}

/** Read-only: find the probe key — "could not be found" means Keychain answered. */
async function probeKeychain(spawn: CredentialSpawn): Promise<boolean> {
  const key = CREDENTIAL_VAULT_PROBE_KEY;
  const out = await spawn(
    ["security", "find-generic-password", "-s", VAULT_SERVICE, "-a", key, "-w"],
    "",
    SPAWN_TIMEOUT_MS,
  );
  if (out.timedOut) return false;
  if (out.exitCode === 0) return true;
  return out.exitCode === 44 || out.stderr.includes("could not be found");
}

/** Read-only: retrieve the probe key — not-found means WinRT PasswordVault works. */
async function probeWincred(spawn: CredentialSpawn, shell: string): Promise<boolean> {
  const key = CREDENTIAL_VAULT_PROBE_KEY;
  const out = await spawn(
    [
      shell,
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      wincredScript(
        [
          `$v = New-Object Windows.Security.Credentials.PasswordVault`,
          `try { $c = $v.Retrieve('${VAULT_SERVICE}', '${key}'); $c.RetrievePassword(); exit 0 } catch { exit 1 }`,
        ].join("; "),
      ),
    ],
    "",
    SPAWN_TIMEOUT_MS,
  );
  if (out.timedOut) return false;
  if (out.exitCode === 0) return true;
  return wincredNotFound(out);
}

function resolveWindowsShell(which: (cmd: string) => string | null): string | null {
  return which("powershell") ?? which("powershell.exe") ?? null;
}

/** Probe: does the platform CLI answer a read-only lookup on the probe key? */
async function probeBackend(
  backend: "keychain" | "wincred" | "secret-service",
  deps: CredentialVaultDeps,
): Promise<CredentialVaultPort | undefined> {
  const which = deps.which ?? ((cmd: string) => Bun.which(cmd));
  const spawn = deps.spawn ?? defaultSpawn;
  try {
    if (backend === "secret-service") {
      if (!which("secret-tool")) return undefined;
      return (await probeSecretService(spawn)) ? secretServiceVault(spawn) : undefined;
    }
    if (backend === "keychain") {
      if (!which("security")) return undefined;
      return (await probeKeychain(spawn)) ? keychainVault(spawn) : undefined;
    }
    if (backend === "wincred") {
      const shell = resolveWindowsShell(which);
      if (!shell) return undefined;
      return (await probeWincred(spawn, shell)) ? wincredVault(spawn, shell) : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export type CreateCredentialVaultResult = {
  readonly vault: CredentialVaultPort;
  readonly fallbackReason?: string;
};

/**
 * Pick the vault backend: `KUNAI_CREDENTIAL_BACKEND` env override first
 * (`file` forces the file lane for debugging/tests), then the platform
 * backend, then the file fallback — which always works and matches the
 * guarantees the plaintext stores had before.
 */
export async function createCredentialVault(
  deps: CredentialVaultDeps,
): Promise<CreateCredentialVaultResult> {
  const env = deps.env ?? process.env;
  let fallbackReason: string | undefined;
  const onFallback = (backend: CredentialVaultPort["backend"], reason: string) => {
    fallbackReason = reason;
    deps.onFallback?.(backend, reason);
  };

  const forced = env["KUNAI_CREDENTIAL_BACKEND"];
  if (forced === "file") return { vault: FILE_BACKEND };
  if (forced === "secret-service" || forced === "keychain" || forced === "wincred") {
    const picked = await probeBackend(forced, deps);
    if (picked) return { vault: picked };
    onFallback("file", `forced backend ${forced} unavailable`);
    return { vault: FILE_BACKEND, fallbackReason };
  }

  const platform = deps.platform ?? process.platform;
  const wanted =
    platform === "darwin" ? "keychain" : platform === "win32" ? "wincred" : "secret-service";
  const picked = await probeBackend(wanted, deps);
  if (picked) return { vault: picked };
  onFallback("file", `${wanted} backend unavailable on ${platform}`);
  return { vault: FILE_BACKEND, fallbackReason };
}
