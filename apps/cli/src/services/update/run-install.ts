import { writeInstallManifest } from "./install-manifest";
import {
  checkInstall,
  cleanupNpmInstallations,
  getInstallDiagnostics,
  installLatest,
} from "./native-installer";
import { DEFAULT_DL_BASE } from "./native-installer/install-layout";

const PKG = "@kitsunekode/kunai";

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

    const npmCleanup = await cleanupNpmInstallations();
    if (npmCleanup.removed > 0) {
      console.log("Removed stale npm global install.");
    }
    for (const err of npmCleanup.errors) {
      console.warn(err);
    }

    const setup = await checkInstall();
    for (const msg of setup) {
      const fn =
        msg.level === "error" ? console.error : msg.level === "warn" ? console.warn : console.log;
      fn(msg.message);
    }

    const diagnostics = await getInstallDiagnostics();
    for (const d of diagnostics) {
      if (d.code === "ok") console.log(d.message);
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
      channel: "npm-global",
      version: positional ?? "latest",
      binPath: Bun.which("kunai") ?? "kunai",
      dlBase: DEFAULT_DL_BASE,
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
      channel: "bun-global",
      version: positional ?? "latest",
      binPath: Bun.which("kunai") ?? "kunai",
      dlBase: DEFAULT_DL_BASE,
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
