import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(import.meta.dir, "../../../../src");

const allowedWritableStoreFiles = new Set([
  "services/diagnostics/DiagnosticsServiceImpl.ts",
  "services/diagnostics/DiagnosticsStoreImpl.ts",
]);

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
}

function findActiveRuntimeWritableDiagnosticsStoreCalls(): readonly string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(SRC_ROOT)) {
    const relativePath = relative(SRC_ROOT, file);
    if (allowedWritableStoreFiles.has(relativePath)) continue;
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (/\bdiagnosticsStore\??\.record\s*\(/.test(line)) {
        violations.push(`${relativePath}:${index + 1}`);
      }
    });
  }
  return violations;
}

describe("diagnostic recorder boundary", () => {
  test("active runtime writes go through DiagnosticsService", () => {
    expect(findActiveRuntimeWritableDiagnosticsStoreCalls()).toEqual([]);
  });
});
