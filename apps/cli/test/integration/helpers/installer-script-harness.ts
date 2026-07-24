import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * install.ps1 is a Windows script: it resolves its default directories from
 * LOCALAPPDATA/APPDATA, which PowerShell defines only on Windows. Supplying
 * them lets the identical suite run under Linux pwsh (the local Docker
 * harness) without teaching the production installer about a platform it does
 * not target. On Windows the real values are already present, so this is empty.
 */
export function windowsShellEnvDefaults(root: string): NodeJS.ProcessEnv {
  if (process.platform === "win32") return {};
  return {
    LOCALAPPDATA: join(root, "localappdata"),
    APPDATA: join(root, "appdata"),
    USERPROFILE: join(root, "userprofile"),
  };
}

/**
 * Return `env` with `dirs` prepended to the command search path.
 *
 * Windows environment variables are case-insensitive, so writing `Path` there
 * updates the real `PATH`. POSIX ones are not: `Path` and `PATH` are separate
 * variables, so setting the former while clearing the latter leaves the child
 * with no search path at all and every shim silently unreachable. Pick the key
 * the host actually reads, and join with the host's delimiter rather than a
 * hardcoded semicolon.
 */
export function withCommandPath(
  env: NodeJS.ProcessEnv,
  ...dirs: readonly string[]
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  const existing = Object.entries(next)
    .filter(([key]) => key.toLowerCase() === "path")
    .map(([, value]) => value)
    .find((value) => value !== undefined);
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === "path") delete next[key];
  }
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  next[pathKey] = [...dirs, ...(existing ? [existing] : [])].join(delimiter);
  return next;
}

export function createInstallerSandbox(name: string) {
  const root = mkdtempSync(join(tmpdir(), `kunai-${name}-`));
  const binDir = join(root, "bin");
  const dataDir = join(root, "data");
  const configDir = join(root, "config");
  const cacheDir = join(root, "cache");
  return {
    root,
    binDir,
    dataDir,
    configDir,
    cacheDir,
    env: {
      ...process.env,
      ...windowsShellEnvDefaults(root),
      KUNAI_BIN_DIR: binDir,
      KUNAI_DATA_DIR: dataDir,
      KUNAI_CONFIG_DIR: configDir,
      KUNAI_CACHE_DIR: cacheDir,
    } as NodeJS.ProcessEnv,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Route definition for the local release fixture HTTP server. */
export type ReleaseFixtureRoute = {
  readonly body?: string | Uint8Array;
  readonly status?: number;
  readonly headers?: Record<string, string>;
  /** Respond with failureStatus this many times, then serve body/status/headers. */
  readonly failuresBeforeSuccess?: number;
  readonly failureStatus?: number;
  /** Stream body in chunks with this delay between chunks (ms). */
  readonly chunkDelayMs?: number;
  /** Chunk size in bytes when chunkDelayMs is set (default 1). */
  readonly chunkSize?: number;
};

export type ReleaseFixtureEvidence = {
  readonly requests: readonly string[];
};

function toBytes(body: string | Uint8Array | undefined): Uint8Array {
  if (body === undefined) return new Uint8Array();
  if (typeof body === "string") return new TextEncoder().encode(body);
  return body;
}

function buildResponse(route: ReleaseFixtureRoute): Response {
  const status = route.status ?? 200;
  const headers = route.headers ? { ...route.headers } : undefined;
  const bytes = toBytes(route.body);
  const chunkDelayMs = route.chunkDelayMs;

  if (chunkDelayMs !== undefined && chunkDelayMs >= 0) {
    const chunkSize = Math.max(1, route.chunkSize ?? 1);
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (offset >= bytes.byteLength) {
          controller.close();
          return;
        }
        if (offset > 0 && chunkDelayMs > 0) {
          await Bun.sleep(chunkDelayMs);
        }
        const end = Math.min(offset + chunkSize, bytes.byteLength);
        controller.enqueue(bytes.subarray(offset, end));
        offset = end;
      },
    });
    return new Response(body, { status, headers });
  }

  return new Response(bytes, { status, headers });
}

export async function withReleaseFixture(
  routes: Readonly<Record<string, ReleaseFixtureRoute>>,
  run: (baseUrl: string, evidence: ReleaseFixtureEvidence) => Promise<void>,
): Promise<void> {
  const hitCounts = new Map<string, number>();
  const requests: string[] = [];

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      requests.push(pathname);
      const route = routes[pathname];
      if (!route) {
        return new Response("not found", { status: 404 });
      }

      const hits = (hitCounts.get(pathname) ?? 0) + 1;
      hitCounts.set(pathname, hits);

      const failures = route.failuresBeforeSuccess ?? 0;
      if (failures > 0 && hits <= failures) {
        return new Response("temporary failure", {
          status: route.failureStatus ?? 503,
          headers: route.headers,
        });
      }

      return buildResponse(route);
    },
  });
  try {
    await run(`http://127.0.0.1:${server.port}`, {
      requests,
    });
  } finally {
    server.stop(true);
  }
}

export function withoutKunaiPathOverrides(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of [
    "KUNAI_BIN_DIR",
    "KUNAI_CONFIG_DIR",
    "KUNAI_DATA_DIR",
    "KUNAI_CACHE_DIR",
    "KUNAI_SOURCE_DIR",
    "KUNAI_INSTALL_DIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
  ])
    delete env[key];
  return env;
}

export function installCommandShim(
  root: string,
  name: string,
  contents = "#!/bin/sh\nexit 0\n",
): void {
  if (process.platform === "win32") {
    writeFileSync(join(root, `${name}.cmd`), "@echo off\r\nexit /b 0\r\n");
    return;
  }
  writeFileSync(join(root, name), contents, { mode: 0o755 });
}

/** Asset name the Bash installer would pick on this host. */
export function hostInstallShAsset(): string {
  const os =
    process.platform === "linux" ? "linux" : process.platform === "darwin" ? "darwin" : "unknown";
  const arch = process.arch === "x64" || process.arch === "arm64" ? process.arch : "unknown";
  if (os === "unknown" || arch === "unknown") {
    throw new Error(`unsupported host for install.sh fixture: ${process.platform}/${process.arch}`);
  }
  if (os === "linux" && isMuslHost()) {
    return `kunai-linux-${arch}-musl`;
  }
  return `kunai-${os}-${arch}`;
}

function isMuslHost(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const ldd = Bun.spawnSync(["ldd", "--version"], { stdout: "pipe", stderr: "pipe" });
    const out = `${ldd.stdout.toString()}${ldd.stderr.toString()}`.toLowerCase();
    return out.includes("musl");
  } catch {
    return false;
  }
}
