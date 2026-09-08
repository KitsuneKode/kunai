import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

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

type ImportEdge = {
  readonly file: string;
  readonly specifier: string;
};

function importsUnder(root: string): ImportEdge[] {
  return sourceFiles(root).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return Array.from(source.matchAll(IMPORT_SPECIFIER_REGEX), (match) => {
      return {
        file: relative(REPO_ROOT, file).replaceAll("\\", "/"),
        specifier: match[1] ?? match[2] ?? "",
      };
    });
  });
}

function resolvesUnderApplication(edge: ImportEdge, applicationRoot: string): boolean {
  const target = edge.specifier.startsWith(".")
    ? relative(REPO_ROOT, resolve(REPO_ROOT, dirname(edge.file), edge.specifier)).replaceAll(
        "\\",
        "/",
      )
    : edge.specifier.replaceAll("\\", "/");
  return target === applicationRoot || target.startsWith(`${applicationRoot}/`);
}

function describeEdge(edge: ImportEdge): string {
  return `${edge.file} -> ${edge.specifier}`;
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
    expect(
      resolvesUnderApplication(
        {
          file: "apps/mobile/src/runtime/example.ts",
          specifier: "../../../cli/src/main",
        },
        "apps/cli",
      ),
    ).toBe(true);
    expect(
      resolvesUnderApplication(
        {
          file: "apps/cli/src/app/example.ts",
          specifier: "../../../mobile/src/entry",
        },
        "apps/mobile",
      ),
    ).toBe(true);

    const offenders = [
      ...importsUnder("apps/mobile/src")
        .filter((edge) => resolvesUnderApplication(edge, "apps/cli"))
        .map(describeEdge),
      ...importsUnder("apps/cli/src")
        .filter((edge) => resolvesUnderApplication(edge, "apps/mobile"))
        .map(describeEdge),
    ];

    expect(offenders).toEqual([]);
  });

  test("has exactly one runtime entrypoint", () => {
    const entrypoints = sourceFiles("apps/mobile/src")
      .map((file) => relative(REPO_ROOT, file).replaceAll("\\", "/"))
      .filter((file) => file.endsWith("/entry.ts") || file.endsWith("/main.ts"));

    expect(entrypoints).toEqual(["apps/mobile/src/entry.ts"]);
  });

  test("keeps the Android runtime free of Bun APIs and Bun imports", () => {
    const violations = sourceFiles("apps/mobile/src/runtime/android").flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return /\bBun\.|(?:from\s+|import\s*\()["']bun:/u.test(source)
        ? [relative(REPO_ROOT, file).replaceAll("\\", "/")]
        : [];
    });

    expect(violations).toEqual([]);
  });

  test("keeps the a-Shell runtime free of desktop and native runtime imports", () => {
    const forbiddenImport = /^(?:bun:|node:|ink(?:\/|$)|react(?:\/|$))/;
    const offenders = importsUnder("apps/mobile/src/runtime/ashell")
      .filter((edge) => forbiddenImport.test(edge.specifier))
      .map(describeEdge);

    expect(offenders).toEqual([]);
  });
});
