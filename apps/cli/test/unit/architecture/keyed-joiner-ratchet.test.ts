import { describe, expect, test } from "bun:test";

import { collectSourceFiles, readRepoFile } from "../../support/repo-scan";

/**
 * "Join a running request by key" has one implementation:
 * `apps/cli/src/infra/concurrency/keyed-joiner.ts`. Hand-rolled copies kept
 * re-growing the same cancellation and cache-poisoning bugs (#730, #731), so a
 * new one fails here. Use `createKeyedJoiner` instead.
 *
 * Each allowlisted file states why it is not a join. The list may only shrink.
 */
const ALLOWED_PROMISE_MAPS = new Map<string, string>([
  [
    "apps/cli/src/app-shell/image-pane.ts",
    "Supersession, not dedup: a signalled caller starts its own render and takes over the slot, because the render commits a terminal placement for the caller that asked; only signal-less callers join.",
  ],
  [
    "apps/cli/src/services/providers/provider-hotfix-manifest.ts",
    "A mutex tail chain: callers queue behind one another to serialize manifest writes; nobody shares a result.",
  ],
  [
    "apps/cli/src/services/update/native-installer/activation-lock.ts",
    "A lock acquisition queue (tails chained per lock path); serializes, never shares a result.",
  ],
  [
    "apps/cli/src/container/dispose-container.ts",
    "An idempotent teardown latch keyed by container object: disposal must never be cancelled or cleared.",
  ],
  [
    "packages/providers/src/miruro/direct.ts",
    "A process-lifetime memo of a curl feature probe, not an in-flight join: the settled answer is the cache.",
  ],
  [
    "packages/providers/src/rivestream/direct.ts",
    "A prefetch table local to one resolve call; it is never shared across callers or outlives the resolve.",
  ],
]);

const HELPER = "apps/cli/src/infra/concurrency/keyed-joiner.ts";
const SCAN_ROOTS = [
  "apps/cli/src",
  "apps/mobile/src",
  "apps/relay-server/src",
  "apps/analytics-ingest/src",
  ...["config", "core", "providers", "relay", "schemas", "storage", "types"].map(
    (name) => `packages/${name}/src`,
  ),
];

/** A Map or WeakMap whose value type is a Promise: the in-flight table shape. */
const PROMISE_MAP = /new\s+(?:Weak)?Map\s*<[^;]*?Promise\s*</;
/** Waiter counting on a shared entry: the hand-rolled "abort when last leaves" shape. */
const WAITER_COUNT = /\bwaiters\s*(?::\s*number|:\s*0\b|\+=|-=|\+\+|--)/;

function offendingLines(file: string): string[] {
  return readRepoFile(file)
    .split("\n")
    .flatMap((line, index) =>
      PROMISE_MAP.test(line) || WAITER_COUNT.test(line) ? [`${file}:${index + 1}`] : [],
    );
}

describe("keyed joiner ratchet", () => {
  const files = SCAN_ROOTS.flatMap((root) => collectSourceFiles(root)).filter(
    (file) => file !== HELPER,
  );

  test("no new hand-rolled in-flight Promise map or waiter count outside the joiner", () => {
    const offenders = files
      .filter((file) => !ALLOWED_PROMISE_MAPS.has(file))
      .flatMap(offendingLines);
    expect(offenders).toEqual([]);
  });

  test("every allowlisted file still holds the shape it is excused for", () => {
    // A stale entry would silently excuse a future copy in that file.
    const stale = [...ALLOWED_PROMISE_MAPS.keys()].filter(
      (file) => !files.includes(file) || offendingLines(file).length === 0,
    );
    expect(stale).toEqual([]);
  });

  test("the patterns catch the shapes they are for", () => {
    expect(PROMISE_MAP.test("const inflight = new Map<string, Promise<JsonValue>>();")).toBe(true);
    expect(PROMISE_MAP.test("private readonly x = new WeakMap<object, Promise<void>>();")).toBe(
      true,
    );
    expect(PROMISE_MAP.test("const cache = new Map<string, number>();")).toBe(false);
    expect(WAITER_COUNT.test("  waiters: number;")).toBe(true);
    expect(WAITER_COUNT.test("    shared.waiters -= 1;")).toBe(true);
    expect(WAITER_COUNT.test("const waitersLabel = 'x';")).toBe(false);
  });
});
