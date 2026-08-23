import { afterAll, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const DOCS_ROOT = path.resolve(import.meta.dir, "..");
const LIB_DIR = path.join(DOCS_ROOT, "lib");

/**
 * Every generated file that is committed. The gitignored provenance sidecar is
 * deliberately absent: it carries `syncedAt` and the CLI revision, which move
 * on every run by design. That is the whole point of it being a sidecar.
 */
const COMMITTED_GENERATED_FILES = [
  "generated-metadata.json",
  "generated-mascot.json",
  "generated-release-notes.json",
  "generated-troubleshooting-faq.json",
] as const;

function snapshot(): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of COMMITTED_GENERATED_FILES) {
    const file = path.join(LIB_DIR, name);
    files.set(name, fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "");
  }
  return files;
}

function runGenerate(): void {
  const result = Bun.spawnSync(["bun", "run", "generate"], {
    cwd: DOCS_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `generate exited ${result.exitCode}\n${result.stderr.toString()}\n${result.stdout.toString()}`,
    );
  }
}

/**
 * Restore whatever was on disk when the test started.
 *
 * The test has to actually run the generator to observe its output, and a
 * working tree with legitimately stale generated files would otherwise be
 * silently rewritten by running the suite. Leave it exactly as found.
 */
const original = snapshot();

afterAll(() => {
  for (const [name, content] of original) {
    const file = path.join(LIB_DIR, name);
    if (content === "") continue;
    fs.writeFileSync(file, content, "utf-8");
  }
});

/**
 * A committed generated file must be a pure function of committed inputs. If
 * regenerating twice produces different bytes, it is not generated — it is a
 * log, and every pair of branches that runs the generator will conflict on it.
 *
 * That is not hypothetical here. `generated-metadata.json` used to carry
 * `syncedAt` (wall clock) and `cliSourceRevision` (git HEAD), so four
 * consecutive PRs conflicted on this one file and each needed a manual
 * regenerate to land — including, eventually, the PR that fixed it.
 *
 * `check-codegen-freshness.ts` asks a different question: *is the committed
 * file up to date with its inputs?* This asks whether generating is
 * deterministic at all. Both matter, and neither implies the other.
 *
 * Deliberately compares run N against run N+1 rather than against the committed
 * bytes, so a merely stale checkout fails freshness — its own gate — instead of
 * being misreported here as nondeterminism.
 */
test("generating twice in a row produces byte-identical committed files", () => {
  runGenerate();
  const first = snapshot();

  runGenerate();
  const second = snapshot();

  for (const name of COMMITTED_GENERATED_FILES) {
    const before = first.get(name) ?? "";
    const after = second.get(name) ?? "";
    if (before === after) continue;

    // Name the drifting keys rather than dumping two large JSON blobs, since
    // the failure is almost always one or two fields.
    const drifted: string[] = [];
    try {
      const a = JSON.parse(before) as Record<string, unknown>;
      const b = JSON.parse(after) as Record<string, unknown>;
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
          drifted.push(`${key}: ${JSON.stringify(a[key])} -> ${JSON.stringify(b[key])}`);
        }
      }
    } catch {
      // Not JSON, or unparseable — fall through to the raw failure below.
    }

    throw new Error(
      `${name} changed between two consecutive generate runs.\n` +
        (drifted.length > 0 ? `Drifting keys:\n  ${drifted.join("\n  ")}\n\n` : "") +
        "A committed generated file must not depend on the clock, the git revision, " +
        "hostname, absolute paths, locale-dependent sorting, or iteration order. " +
        "Move run-specific values into lib/generated-provenance.json, which is gitignored.",
    );
  }

  expect(second).toEqual(first);
});

/** The sidecar is the escape hatch, so it must stay uncommitted. */
test("the provenance sidecar is gitignored", () => {
  const result = Bun.spawnSync(["git", "check-ignore", "apps/docs/lib/generated-provenance.json"], {
    cwd: path.resolve(DOCS_ROOT, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
});
