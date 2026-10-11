import { realpathSync } from "node:fs";
import { posix, win32 } from "node:path";

import { readManagedPackageContext } from "./managed-package-context";

export type InstallMethodKind =
  | "source"
  | "bun-global"
  | "npm-global"
  | "binary"
  | "homebrew"
  | "scoop"
  | "system-package"
  | "unknown";

export type InstallMethod = {
  readonly kind: InstallMethodKind;
  readonly label: string;
  /** Validated package-manager root when ownership crossed the launcher boundary. */
  readonly packageRoot?: string;
};

export type DetectInstallMethodInput = {
  readonly cwd?: string;
  readonly entrypoint?: string;
  readonly packagedBinary?: boolean;
  readonly platform?: NodeJS.Platform;
  /**
   * Compiled-binary path on disk (defaults to `process.execPath`). Used to tell
   * a package-manager-owned binary — Homebrew Cellar, Scoop app dir, distro
   * /usr/bin — from a flat self-managed one so `kunai upgrade` does not
   * self-replace a file a package manager owns.
   */
  readonly execPath?: string;
  /**
   * Symlink resolver applied to `execPath` before classification. Homebrew
   * (and Scoop-style shims) launch through a `bin/kunai` symlink or stub, so
   * the raw path can hide package-manager ownership; defaults to
   * `realpathSync` and falls back to the raw path when resolution fails.
   */
  readonly realpath?: (path: string) => string;
  readonly fileExists?: (path: string) => boolean;
  readonly env?: Record<string, string | undefined>;
};

export function detectInstallMethod(input: DetectInstallMethodInput = {}): InstallMethod {
  // Default to the host, not to posix. Falling back to posix meant that on
  // Windows — where `platform` is usually not passed — `path.join` produced
  // `C:\repo/package.json`, so the source-checkout probes below never matched a
  // real checkout and every source install reported as "unknown".
  const platform = input.platform ?? process.platform;
  const path = platform === "win32" ? win32 : posix;
  const cwd = path.normalize(input.cwd ?? process.cwd());
  const entrypoint = path.normalize(input.entrypoint ?? process.argv[1] ?? "");
  const normalizedEntrypoint = entrypoint.replaceAll("\\", "/");
  const comparableEntrypoint =
    platform === "win32" ? normalizedEntrypoint.toLowerCase() : normalizedEntrypoint;
  const fileExists = input.fileExists ?? (() => false);
  const env = input.env ?? {};
  const managedContext = readManagedPackageContext(env);

  if (managedContext) {
    return managedContext.manager === "bun"
      ? { kind: "bun-global", label: "Bun global", packageRoot: managedContext.packageRoot }
      : { kind: "npm-global", label: "npm global", packageRoot: managedContext.packageRoot };
  }

  const isScriptEntrypoint =
    comparableEntrypoint.endsWith(".js") || comparableEntrypoint.endsWith(".ts");
  if (
    isSourceCheckout(cwd, path, fileExists) ||
    (isScriptEntrypoint && isSourceCheckout(entrypoint, path, fileExists))
  ) {
    return { kind: "source", label: "Source checkout" };
  }

  if (comparableEntrypoint.includes("/.bun/install/global/")) {
    return { kind: "bun-global", label: "Bun global" };
  }

  if (comparableEntrypoint.includes("/node_modules/@kitsunekode/kunai/")) {
    return { kind: "npm-global", label: "npm global" };
  }

  // A `bun build --compile` binary presents its virtual entrypoint as
  // `/$bunfs/root/…main.js` (POSIX) or `B:\~BUN\root\main.js` (Windows) — the
  // `.js` suffix below would otherwise misclassify a flat release binary as
  // "unknown" and degrade `kunai upgrade` to manual guidance.
  const bunfsEntrypoint =
    comparableEntrypoint.startsWith("/$bunfs/") || comparableEntrypoint.includes("/~bun/");

  if (
    input.packagedBinary ||
    bunfsEntrypoint ||
    (!comparableEntrypoint.endsWith(".js") && !comparableEntrypoint.endsWith(".ts"))
  ) {
    // A compiled binary can still be package-manager-owned: resolve the
    // executable's real path before falling back to self-managed "binary".
    // `process.execPath` may be the Homebrew `bin/kunai` symlink rather than
    // the Cellar target, so realpath comes first; a dangling link keeps the
    // raw path rather than aborting detection.
    const realpath = input.realpath ?? ((candidate: string) => realpathSync(candidate));
    const rawExecPath = input.execPath ?? process.execPath;
    let resolvedExecPath = rawExecPath;
    try {
      resolvedExecPath = realpath(rawExecPath);
    } catch {
      resolvedExecPath = rawExecPath;
    }
    const execPath = path.normalize(resolvedExecPath).replaceAll("\\", "/");
    const comparableExecPath = platform === "win32" ? execPath.toLowerCase() : execPath;
    const execPathLower = comparableExecPath.toLowerCase();
    if (execPathLower.includes("/cellar/kunai/")) {
      return { kind: "homebrew", label: "Homebrew" };
    }
    // Scoop also lives outside a literal `scoop` directory when SCOOP /
    // SCOOP_GLOBAL point at a custom root — match the env-declared roots too.
    const scoopRoots = [env.SCOOP, env.SCOOP_GLOBAL]
      .filter((value): value is string => value !== undefined && value.length > 0)
      .map((value) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase());
    if (
      execPathLower.includes("/scoop/apps/kunai/") ||
      scoopRoots.some((root) => execPathLower.startsWith(`${root}/apps/kunai/`))
    ) {
      return { kind: "scoop", label: "Scoop" };
    }
    if (platform === "linux" && comparableExecPath === "/usr/bin/kunai") {
      return { kind: "system-package", label: "System package" };
    }
    return { kind: "binary", label: "Packaged binary" };
  }

  return { kind: "unknown", label: "Unknown install method" };
}

/**
 * True when `start` is this checkout, or a file/directory under it.
 *
 * `cwd` used to have to be the repo root (`cwd/apps/cli/src/main.ts`).
 * `bun run src/main.ts --version` from `apps/cli` therefore reported unknown.
 * Walk parents so a source run from any package directory still detects.
 */
function isSourceCheckout(
  start: string,
  path: typeof posix | typeof win32,
  fileExists: (path: string) => boolean,
): boolean {
  if (!start) return false;
  // Entrypoints are files (`…/src/main.ts`). Start at the containing directory
  // so the first probe is a real directory rather than `main.ts/package.json`.
  let current = path.extname(start) ? path.dirname(start) : start;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (
      fileExists(path.join(current, "package.json")) &&
      fileExists(path.join(current, "apps/cli/src/main.ts")) &&
      fileExists(path.join(current, ".git"))
    ) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}

export function updateGuidanceForInstallMethod(method: InstallMethod): string {
  switch (method.kind) {
    case "source":
      return "Source checkout detected. Update with git pull, then run bun install and bun run build if needed.";
    case "bun-global":
      return "Bun global install detected. Update manually with bun update --global @kitsunekode/kunai.";
    case "npm-global":
      return "npm global install detected. Update manually with npm install -g @kitsunekode/kunai.";
    case "binary":
      return "Packaged binary detected. Update with `kunai upgrade`.";
    case "homebrew":
      return "Homebrew install detected. Update with `brew upgrade kunai`.";
    case "scoop":
      return "Scoop install detected. Update with `scoop update kunai`.";
    case "system-package":
      return "Installed by your system package manager — update with it (Arch: `yay -Syu kunai-bin` or your AUR helper).";
    case "unknown":
      return "Unknown install method. Check how Kunai was installed before updating manually.";
  }
}
