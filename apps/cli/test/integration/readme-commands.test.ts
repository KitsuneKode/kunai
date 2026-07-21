import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extractReadmeQuickStart, README_QUICK_START_IDS } from "./helpers/readme-command-harness";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const README_PATH = join(REPO_ROOT, "README.md");

/** Canonical Quick Start Install sequence — must match README order/text. */
const EXPECTED_QUICK_START = [
  "curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash",
  "kunai --version",
  "mpv --version",
  "kunai --setup",
  'kunai -S "Dune"',
] as const;

describe("README quick-start extraction", () => {
  test("extracts the Quick Start Install block in exact order", () => {
    const readme = readFileSync(README_PATH, "utf8");
    const commands = extractReadmeQuickStart(readme);
    expect([...commands]).toEqual([...EXPECTED_QUICK_START]);
    expect(commands).toHaveLength(README_QUICK_START_IDS.length);
  });

  test("fails when Install block order or text drifts", () => {
    const readme = readFileSync(README_PATH, "utf8");
    // Drift the Quick Start Install fence specifically (not only the hero copy).
    const drifted = readme.replace(
      /### Install([\s\S]*?)kunai -S "Dune"/,
      '### Install$1kunai -S "Frieren"',
    );
    const commands = extractReadmeQuickStart(drifted);
    expect([...commands]).not.toEqual([...EXPECTED_QUICK_START]);
    expect(commands.at(-1)).toBe('kunai -S "Frieren"');
  });

  test("throws when the canonical install curl line is missing", () => {
    const broken = [
      "## Quick Start",
      "",
      "### Install",
      "",
      "```bash",
      "bun install -g @kitsunekode/kunai",
      "kunai --version",
      "```",
      "",
    ].join("\n");
    expect(() => extractReadmeQuickStart(broken)).toThrow(/canonical curl\|bash install/);
  });

  test("hero and Quick Start Install blocks stay aligned", () => {
    const readme = readFileSync(README_PATH, "utf8");
    const heroFence = readme.match(/```bash\n([\s\S]*?)```/);
    expect(heroFence).not.toBeNull();
    const heroLines = heroFence![1]!
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0 && !line.trimStart().startsWith("#"));
    expect(heroLines).toEqual([...EXPECTED_QUICK_START]);
    expect([...extractReadmeQuickStart(readme)]).toEqual(heroLines);
  });
});
