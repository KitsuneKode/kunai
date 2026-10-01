import { describe, expect, test } from "bun:test";

import { collectSourceFiles, readRepoFile } from "../../support/repo-scan";

/**
 * Declaration → reader, applied to the persisted config surface.
 *
 * `KitsuneConfig` is the contract every settings screen, migration, and
 * feature gate consumes — and Kunai's recurring failure mode is a field that
 * is declared, normalized, and even exposed through `ConfigService` getters,
 * yet consulted by no code path. That field is a silent no-op: it saves, it
 * survives edits, and it changes nothing.
 *
 * This test walks the interface's top-level keys and requires each to have a
 * dotted reader (`config.key`, `this.effective().key`, `{ key } = config`)
 * somewhere in production source *outside* the package that declares it and
 * the persistence layer that persists it — reads inside those two layers are
 * plumbing, not consumption.
 *
 * The baseline below is a debt record in the style of
 * contract-conformance.test.ts: fixing a key means deleting its entry, never
 * widening the set.
 */

/** Layers that declare, default, sanitize, or persist config — never count as readers. */
const DEFINER_PREFIXES = ["packages/config/src/", "apps/cli/src/services/persistence/"] as const;

const PRODUCTION_ROOTS = [
  "apps/cli/src",
  "packages/core/src",
  "packages/relay/src",
  "packages/schemas/src",
  "packages/storage/src",
  "packages/providers/src",
  "packages/types/src",
];

/**
 * Top-level `KitsuneConfig` keys that currently have no consumer outside the
 * declaration/persistence layers. Each entry must name why the field survives
 * unread — "nobody reads it" without a reason is a bug to fix, not a baseline.
 */
const KNOWN_UNREAD_CONFIG_KEYS = new Set<string>([
  // Loader-internal migration marker: `readProviderDefaultsRevision` in
  // ConfigServiceImpl reads it at load to decide which inherited defaults to
  // re-point. No feature reads the value directly, by design.
  "providerDefaultsRevision",
  // Debt: `get headless` exists on ConfigService but nothing calls it —
  // headless operation is driven by argv in main.ts, not by this field.
  "headless",
  // Consumed inside ConfigServiceImpl itself to gate the session token
  // (isExpiredVideasySession) — the exposed getter is unused, but the field
  // drives behavior through the service, so this is baseline-not-bug.
  "videasySessionExpiresAt",
  // Debt: written by the update-check cache, never read to change behavior.
  "lastUpdateCheckFailedAt",
]);

/** Parse the top-level keys of `KitsuneConfig` out of the type declaration. */
function declaredConfigKeys(): string[] {
  const text = readRepoFile("packages/config/src/types.ts");
  const start = text.indexOf("export interface KitsuneConfig");
  const body = text.slice(start);
  const end = body.indexOf("\n}");
  return body
    .slice(0, end)
    .split("\n")
    .flatMap((line) => {
      const match = /^  ([a-zA-Z0-9_]+)\??:/.exec(line);
      return match?.[1] ? [match[1]] : [];
    });
}

const PRODUCTION_SOURCES: readonly { file: string; text: string }[] = PRODUCTION_ROOTS.flatMap(
  (root) => collectSourceFiles(root, { skipDirs: ["experiments"] }),
)
  .filter((file) => !DEFINER_PREFIXES.some((prefix) => file.startsWith(prefix)))
  .map((file) => ({ file, text: readRepoFile(file) }));

/**
 * A field counts as read when production code dereferences it — `x.key`,
 * `x .key`, or `{ key } = x` destructuring. Bare mentions are deliberately not
 * enough: comments and write-side object literals name the field without ever
 * consulting it.
 */
function readerFilesFor(key: string): string[] {
  const dotted = new RegExp(`\\.\\s*${key}\\b`);
  const destructured = new RegExp(`\\{\\s*[^{}\\n]*\\b${key}\\b[^{}\\n]*\\}\\s*=`);
  return PRODUCTION_SOURCES.filter(({ text }) => dotted.test(text) || destructured.test(text)).map(
    ({ file }) => file,
  );
}

describe("config reader contract", () => {
  const keys = declaredConfigKeys();

  test("the KitsuneConfig surface is parseable and non-trivial", () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  test("every declared config field has a production reader", () => {
    const unread = keys.filter(
      (key) => readerFilesFor(key).length === 0 && !KNOWN_UNREAD_CONFIG_KEYS.has(key),
    );
    expect(unread, "config fields declared but never consumed — silent no-ops").toEqual([]);
  });

  test("the unread baseline only contains fields that are still unread", () => {
    const stale = [...KNOWN_UNREAD_CONFIG_KEYS].filter(
      (key) => readerFilesFor(key).length > 0 || !keys.includes(key),
    );
    expect(
      stale,
      "fields gained a real reader or left the interface — remove them from KNOWN_UNREAD_CONFIG_KEYS",
    ).toEqual([]);
  });
});
