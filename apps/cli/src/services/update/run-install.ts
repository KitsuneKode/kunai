import { homedir } from "node:os";
import { join } from "node:path";

import { writeInstallManifest, type WriteInstallManifestInput } from "./install-manifest";
import { checkInstall, getInstallDiagnostics, installLatest } from "./native-installer";
import { DEFAULT_DL_BASE } from "./native-installer/install-layout";
import { normalizeRequestedVersion, type CanonicalVersion } from "./version";

const PKG = "@kitsunekode/kunai";

type PackageInstallMethod = "npm" | "bun";
type PackageInstallVersion = "latest" | CanonicalVersion;

export type RunInstallArgv = readonly string[];

export interface RunInstallPorts {
  readonly runCommand: (command: readonly string[]) => Promise<number>;
  readonly inspectPackageInstall: (
    method: PackageInstallMethod,
  ) => Promise<PackageInstallEvidence | null>;
  readonly writeInstallManifest: (manifest: WriteInstallManifestInput) => Promise<void>;
}

export interface PackageInstallEvidence {
  readonly version: string;
  readonly launcherPath: string;
}

export interface PackageInspectionPorts {
  readonly captureCommand: (
    command: readonly string[],
  ) => Promise<{ readonly code: number; readonly stdout: string }>;
  readonly readText: (path: string) => Promise<string>;
  readonly bunGlobalDir: () => string;
  readonly bunGlobalBinDir: () => string;
  readonly platform: NodeJS.Platform;
}

const defaultPorts: RunInstallPorts = {
  async runCommand(command) {
    const proc = Bun.spawn([...command], {
      stdout: "inherit",
      stderr: "inherit",
    });
    return proc.exited;
  },
  inspectPackageInstall,
  writeInstallManifest,
};

function parsePackageInstallVersion(value: string | undefined): PackageInstallVersion | null {
  if (value === undefined || value === "latest") return "latest";
  return normalizeRequestedVersion(value);
}

export function buildPackageInstallCommand(
  method: PackageInstallMethod,
  requestedVersion: string | undefined,
): readonly string[] {
  const version = parsePackageInstallVersion(requestedVersion);
  if (!version) {
    throw new Error(
      `Invalid version: ${requestedVersion} (expected latest or exact major.minor.patch).`,
    );
  }
  const specifier = version === "latest" ? PKG : `${PKG}@${version}`;
  return method === "npm"
    ? ["npm", "install", "-g", specifier]
    : ["bun", "install", "-g", specifier];
}

const defaultInspectionPorts: PackageInspectionPorts = {
  async captureCommand(command) {
    const proc = Bun.spawn([...command], { stdout: "pipe", stderr: "ignore" });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { code, stdout };
  },
  readText: (path) => Bun.file(path).text(),
  bunGlobalDir: () =>
    Bun.env.BUN_INSTALL_GLOBAL_DIR ??
    join(Bun.env.BUN_INSTALL ?? join(homedir(), ".bun"), "install", "global"),
  bunGlobalBinDir: () =>
    Bun.env.BUN_INSTALL_BIN ?? join(Bun.env.BUN_INSTALL ?? join(homedir(), ".bun"), "bin"),
  platform: process.platform,
};

export async function inspectPackageInstall(
  method: PackageInstallMethod,
  ports: PackageInspectionPorts = defaultInspectionPorts,
): Promise<PackageInstallEvidence | null> {
  if (!isPackageInspectionPorts(ports)) return null;
  try {
    let packageRoot: string;
    let launcherPath: string;
    if (method === "npm") {
      const [rootResult, prefixResult] = await Promise.all([
        ports.captureCommand(["npm", "root", "-g"]),
        ports.captureCommand(["npm", "prefix", "-g"]),
      ]);
      if (rootResult.code !== 0 || prefixResult.code !== 0) return null;
      packageRoot = rootResult.stdout.trim();
      const prefix = prefixResult.stdout.trim();
      if (!packageRoot || !prefix) return null;
      launcherPath =
        ports.platform === "win32" ? join(prefix, "kunai.cmd") : join(prefix, "bin", "kunai");
    } else {
      packageRoot = join(ports.bunGlobalDir(), "node_modules");
      launcherPath = join(
        ports.bunGlobalBinDir(),
        ports.platform === "win32" ? "kunai.exe" : "kunai",
      );
    }

    const packagePath = join(packageRoot, "@kitsunekode", "kunai", "package.json");
    const metadata = JSON.parse(await ports.readText(packagePath)) as {
      readonly name?: unknown;
      readonly version?: unknown;
    };
    if (metadata.name !== PKG || typeof metadata.version !== "string") return null;
    const version = normalizeRequestedVersion(metadata.version);
    return version ? { version, launcherPath } : null;
  } catch {
    return null;
  }
}

function isPackageInspectionPorts(value: unknown): value is PackageInspectionPorts {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PackageInspectionPorts>;
  return (
    typeof candidate.captureCommand === "function" &&
    typeof candidate.readText === "function" &&
    typeof candidate.bunGlobalDir === "function" &&
    typeof candidate.bunGlobalBinDir === "function" &&
    typeof candidate.platform === "string"
  );
}

function isRunInstallPorts(value: unknown): value is RunInstallPorts {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RunInstallPorts>;
  return (
    typeof candidate.runCommand === "function" &&
    typeof candidate.inspectPackageInstall === "function" &&
    typeof candidate.writeInstallManifest === "function"
  );
}

/**
 * `kunai install` — bootstrap or reinstall via the active channel (binary default).
 */
export async function runInstall(
  argv: RunInstallArgv,
  ports: RunInstallPorts = defaultPorts,
): Promise<number> {
  if (!isRunInstallPorts(ports)) {
    console.error("Installer ports are incomplete; refusing to run install commands.");
    return 1;
  }
  const force = argv.includes("--force");
  const skipDeps = argv.includes("--skip-deps");
  const methodIdx = argv.indexOf("--method");
  const method = methodIdx >= 0 ? argv[methodIdx + 1] : "binary";
  const positional = argv.find((a) => !a.startsWith("-") && a !== method);

  if (method === "binary") {
    const version = positional ?? "latest";
    console.log(`Installing kunai (${version})…`);
    const result = await installLatest({
      version: version === "latest" ? undefined : version,
      force,
    });
    if (result.status === "failed") {
      console.error(result.error);
      return 1;
    }
    if (result.status === "skipped") {
      console.error("Install skipped: another install is in progress.");
      return 1;
    }

    const setup = await checkInstall();
    for (const msg of setup) {
      const fn =
        msg.level === "error" ? console.error : msg.level === "warn" ? console.warn : console.log;
      fn(msg.message);
    }

    for (const diagnostic of await getInstallDiagnostics()) {
      const output =
        diagnostic.level === "error"
          ? console.error
          : diagnostic.level === "warn"
            ? console.warn
            : console.log;
      output(diagnostic.message);
    }

    if (!skipDeps) {
      console.log("Optional: install mpv, yt-dlp, and chafa for full functionality.");
    }

    console.log(`kunai ${result.version} installed. Run \`kunai\` to start.`);
    return 0;
  }

  if (method === "npm" || method === "bun") {
    const requestedVersion = parsePackageInstallVersion(positional);
    if (!requestedVersion) {
      console.error(`Invalid version: ${positional} (expected latest or exact major.minor.patch).`);
      return 1;
    }

    const command = buildPackageInstallCommand(method, requestedVersion);
    const code = await ports.runCommand(command);
    if (code !== 0) return code;

    const evidence = await ports.inspectPackageInstall(method);
    const normalizedObserved = evidence ? normalizeRequestedVersion(evidence.version) : null;
    if (!evidence || !normalizedObserved) {
      console.error("Could not verify the installed Kunai version; install manifest not written.");
      return 1;
    }
    if (requestedVersion !== "latest" && normalizedObserved !== requestedVersion) {
      console.error(
        `Installed Kunai version ${normalizedObserved} does not match requested ${requestedVersion}; install manifest not written.`,
      );
      return 1;
    }

    await ports.writeInstallManifest({
      method: method === "npm" ? "npm-global" : "bun-global",
      activeVersion: normalizedObserved,
      launcherPath: evidence.launcherPath,
      downloadBaseUrl: DEFAULT_DL_BASE,
    });
    return 0;
  }

  if (method === "source") {
    console.log(
      "Source install: clone the repo and run `bun install && bun run build && bun run link:global`.",
    );
    return 0;
  }

  console.error(`Unknown --method ${method}. Use binary, npm, bun, or source.`);
  return 1;
}
