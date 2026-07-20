import { posix, win32 } from "node:path";

export type InstallMethodKind = "source" | "bun-global" | "npm-global" | "binary" | "unknown";

export type InstallMethod = {
  readonly kind: InstallMethodKind;
  readonly label: string;
};

export type DetectInstallMethodInput = {
  readonly cwd?: string;
  readonly entrypoint?: string;
  readonly packagedBinary?: boolean;
  readonly platform?: NodeJS.Platform;
  readonly fileExists?: (path: string) => boolean;
};

export function detectInstallMethod(input: DetectInstallMethodInput = {}): InstallMethod {
  const path = input.platform === "win32" ? win32 : posix;
  const cwd = path.normalize(input.cwd ?? process.cwd());
  const entrypoint = path.normalize(input.entrypoint ?? process.argv[1] ?? "");
  const normalizedEntrypoint = entrypoint.replaceAll("\\", "/");
  const fileExists = input.fileExists ?? (() => false);

  if (
    fileExists(path.join(cwd, "package.json")) &&
    fileExists(path.join(cwd, "apps/cli/src/main.ts")) &&
    fileExists(path.join(cwd, ".git"))
  ) {
    return { kind: "source", label: "Source checkout" };
  }

  if (normalizedEntrypoint.includes("/.bun/install/global/")) {
    return { kind: "bun-global", label: "Bun global" };
  }

  if (normalizedEntrypoint.includes("/node_modules/@kitsunekode/kunai/")) {
    return { kind: "npm-global", label: "npm global" };
  }

  if (
    input.packagedBinary ||
    (!normalizedEntrypoint.endsWith(".js") && !normalizedEntrypoint.endsWith(".ts"))
  ) {
    return { kind: "binary", label: "Packaged binary" };
  }

  return { kind: "unknown", label: "Unknown install method" };
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
    case "unknown":
      return "Unknown install method. Check how Kunai was installed before updating manually.";
  }
}
