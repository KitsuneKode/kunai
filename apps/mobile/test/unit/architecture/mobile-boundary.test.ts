import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../../../..");
const IMPORT_SPECIFIER_REGEX = /(?:from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\))/g;

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory, { encoding: "utf8" })) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        if (name !== "node_modules" && name !== "dist") walk(path);
      } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
        files.push(path);
      }
    }
  };
  walk(join(REPO_ROOT, root));
  return files;
}

function importsUnder(root: string): string[] {
  return sourceFiles(root).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return Array.from(source.matchAll(IMPORT_SPECIFIER_REGEX), (match) => {
      const specifier = match[1] ?? match[2] ?? "";
      return `${relative(REPO_ROOT, file).replaceAll("\\", "/")} -> ${specifier}`;
    });
  });
}

describe("mobile application boundary", () => {
  test("is a private declared workspace", () => {
    const rootPackage = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      workspaces: { packages: string[] };
    };
    const mobilePackage = JSON.parse(
      readFileSync(join(REPO_ROOT, "apps/mobile/package.json"), "utf8"),
    ) as { name?: string; private?: boolean };

    expect(rootPackage.workspaces.packages).toContain("apps/mobile");
    expect(mobilePackage.name).toBe("@kunai/mobile");
    expect(mobilePackage.private).toBe(true);
  });

  test("does not couple desktop and mobile application sources", () => {
    expect(importsUnder("apps/mobile/src").filter((edge) => edge.includes("apps/cli"))).toEqual([]);
    expect(importsUnder("apps/cli/src").filter((edge) => edge.includes("apps/mobile"))).toEqual([]);
  });

  test("has exactly one runtime entrypoint", () => {
    const entrypoints = sourceFiles("apps/mobile/src")
      .map((file) => relative(REPO_ROOT, file).replaceAll("\\", "/"))
      .filter((file) => file.endsWith("/entry.ts") || file.endsWith("/main.ts"));

    expect(entrypoints).toEqual(["apps/mobile/src/entry.ts"]);
  });
});
