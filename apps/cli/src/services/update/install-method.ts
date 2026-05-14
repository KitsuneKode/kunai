import { join, normalize } from "node:path";

export type InstallMethodKind = "source" | "bun-global" | "npm-global" | "binary" | "unknown";

export type InstallMethod = {
  readonly kind: InstallMethodKind;
  readonly label: string;
};

export type DetectInstallMethodInput = {
  readonly cwd?: string;
  readonly entrypoint?: string;
  readonly packagedBinary?: boolean;
  readonly fileExists?: (path: string) => boolean;
};

export function detectInstallMethod(input: DetectInstallMethodInput = {}): InstallMethod {
  const cwd = normalize(input.cwd ?? process.cwd());
  const entrypoint = normalize(input.entrypoint ?? process.argv[1] ?? "");
  const fileExists = input.fileExists ?? (() => false);

  if (
    fileExists(join(cwd, "package.json")) &&
    fileExists(join(cwd, "apps/cli/src/main.ts")) &&
    fileExists(join(cwd, ".git"))
  ) {
    return { kind: "source", label: "Source checkout" };
  }

  if (entrypoint.includes("/.bun/install/global/")) {
    return { kind: "bun-global", label: "Bun global" };
  }

  if (entrypoint.includes("/node_modules/@kitsunekode/kunai/")) {
    return { kind: "npm-global", label: "npm global" };
  }

  if (input.packagedBinary || (!entrypoint.endsWith(".js") && !entrypoint.endsWith(".ts"))) {
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
      return "Packaged binary detected. Download the latest Kunai release from the project release page.";
    case "unknown":
      return "Unknown install method. Check how Kunai was installed before updating manually.";
  }
}
