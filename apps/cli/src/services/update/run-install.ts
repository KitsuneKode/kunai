import packageJson from "../../../package.json" with { type: "json" };
import { writeInstallManifest } from "./install-manifest";
import { checkInstall, getInstallDiagnostics, installLatest } from "./native-installer";
import { DEFAULT_DL_BASE } from "./native-installer/install-layout";
import { normalizeRequestedVersion } from "./version";

const PKG = "@kitsunekode/kunai";

function resolveInstallVersion(positional: string | undefined): string {
  if (positional && positional !== "latest") {
    const parsed = normalizeRequestedVersion(positional);
    if (parsed) return parsed;
  }
  const fromPackage = normalizeRequestedVersion(packageJson.version);
  if (fromPackage) return fromPackage;
  throw new Error(
    `Could not resolve a stable install version from ${positional ?? packageJson.version}`,
  );
}

export type RunInstallArgv = readonly string[];

/**
 * `kunai install` — bootstrap or reinstall via the active channel (binary default).
 */
export async function runInstall(argv: RunInstallArgv): Promise<number> {
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

    const ver = result.status === "installed" ? result.version : result.version;
    console.log(`kunai ${ver} installed. Run \`kunai\` to start.`);
    return 0;
  }

  if (method === "npm") {
    const proc = Bun.spawn(["npm", "install", "-g", `${PKG}@latest`], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) return code;
    await writeInstallManifest({
      method: "npm-global",
      activeVersion: resolveInstallVersion(positional),
      launcherPath: Bun.which("kunai") ?? "kunai",
      downloadBaseUrl: DEFAULT_DL_BASE,
    });
    return 0;
  }

  if (method === "bun") {
    const proc = Bun.spawn(["bun", "install", "-g", `${PKG}@latest`], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) return code;
    await writeInstallManifest({
      method: "bun-global",
      activeVersion: resolveInstallVersion(positional),
      launcherPath: Bun.which("kunai") ?? "kunai",
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
