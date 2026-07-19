import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Locate this module's directory across both runtimes the docs app is built by.
 *
 * Bun exposes `import.meta.dir`. Next/Turbopack does not, and `import.meta.url`
 * broke the Turbopack build (7240282c) — so cwd is the fallback there, never
 * `fileURLToPath`.
 */
function thisDir(): string {
  if (typeof import.meta.dir === "string" && import.meta.dir.length > 0) {
    return import.meta.dir;
  }
  return process.cwd();
}

/**
 * Resolve the monorepo root by probing for a marker that only exists there.
 *
 * Deriving it from cwd alone is what made the docs tests cwd-dependent: they
 * pass under `bun run test` (cwd `apps/docs`) and fail under a root-level
 * `bun test`, because `../..` then points above the repo. Trying the
 * module-relative path first makes the lookup work from any cwd, and the marker
 * check keeps the fallbacks honest instead of silently returning a wrong path.
 *
 * @param marker repo-root-relative path that proves a candidate is the root.
 */
export function repoRoot(marker: string): string {
  const candidates = [
    // apps/docs/lib → monorepo root
    resolve(thisDir(), "../../.."),
    // Next's usual cwd (apps/docs)
    resolve(process.cwd(), "../.."),
    // already at the root
    process.cwd(),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, marker))) return candidate;
  }
  return candidates[0] ?? process.cwd();
}
