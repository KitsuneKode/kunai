import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createInstallerSandbox(name: string) {
  const root = mkdtempSync(join(tmpdir(), `kunai-${name}-`));
  const binDir = join(root, "bin");
  const dataDir = join(root, "data");
  const configDir = join(root, "config");
  return {
    root,
    binDir,
    dataDir,
    configDir,
    env: {
      ...process.env,
      KUNAI_BIN_DIR: binDir,
      KUNAI_DATA_DIR: dataDir,
      KUNAI_CONFIG_DIR: configDir,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export async function withReleaseFixture(
  routes: Readonly<Record<string, { readonly body: string; readonly status?: number }>>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const route = routes[new URL(request.url).pathname];
      return route
        ? new Response(route.body, { status: route.status ?? 200 })
        : new Response("not found", { status: 404 });
    },
  });
  try {
    await run(`http://127.0.0.1:${server.port}`);
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
