import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { collectSourceFiles, readRepoFile, REPO_ROOT } from "../../support/repo-scan";

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
    "apps/cli/src/app/playback/PlaybackPhase.ts",
    "A memo local to one playback start (`episodeLoadCache`): each season's episode list is fetched once for that start and the settled answer is the point; fetchEpisodes takes no signal and the table dies with the start.",
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

/**
 * Every workspace's `src` root, discovered rather than listed: a hand-written
 * list missed `packages/design/src`, and would miss the next package too.
 */
function workspaceSourceRoots(): string[] {
  return ["apps", "packages"].flatMap((group) => {
    let names: string[];
    try {
      names = readdirSync(join(REPO_ROOT, group));
    } catch {
      return [];
    }
    return names
      .filter((name) => {
        try {
          return statSync(join(REPO_ROOT, group, name, "src")).isDirectory();
        } catch {
          return false;
        }
      })
      .map((name) => `${group}/${name}/src`);
  });
}

/** `Map<`, `WeakMap<` or `ReadonlyMap<`: a generic map type or construction. */
const MAP_GENERIC = /\b(?:Weak|Readonly)?Map\s*</g;
/** A value type that is a promise itself — not a function returning one. */
const PROMISE_VALUE = /^(?:Promise|PromiseLike)\s*</;
/** Waiter counting on a shared entry: the hand-rolled "abort when last leaves" shape. */
const WAITER_COUNT = /\bwaiters\s*(?::\s*number|:\s*0\b|\+=|-=|\+\+|--)/;

/**
 * The top-level type arguments of the generic whose `<` is at `open`, read
 * across lines. `=>` is an arrow, not a closing bracket. Null when the text is
 * not a generic after all (a statement ends first).
 */
function typeArguments(source: string, open: number): string[] | null {
  const args: string[] = [];
  let angle = 0;
  let nested = 0;
  let start = open + 1;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "<") angle += 1;
    else if (char === ">" && source[index - 1] !== "=") {
      angle -= 1;
      if (angle === 0) {
        args.push(source.slice(start, index).trim());
        return args;
      }
    } else if (char === "(" || char === "[" || char === "{") nested += 1;
    else if (char === ")" || char === "]" || char === "}") nested -= 1;
    else if (char === "," && angle === 1 && nested === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    } else if ((char === ";" && nested === 0) || nested < 0) return null;
  }
  return null;
}

/** 1-based lines declaring a map whose value type is a Promise. */
export function promiseMapLines(source: string): number[] {
  const lines = new Set<number>();
  for (const match of source.matchAll(MAP_GENERIC)) {
    const open = match.index + match[0].length - 1;
    const value = typeArguments(source, open)?.at(-1);
    if (value !== undefined && PROMISE_VALUE.test(value)) {
      lines.add(source.slice(0, match.index).split("\n").length);
    }
  }
  return [...lines];
}

function offendingLines(file: string): string[] {
  const source = readRepoFile(file);
  const waiterLines = source
    .split("\n")
    .flatMap((line, index) => (WAITER_COUNT.test(line) ? [index + 1] : []));
  return [...new Set([...promiseMapLines(source), ...waiterLines])]
    .sort((left, right) => left - right)
    .map((line) => `${file}:${line}`);
}

describe("keyed joiner ratchet", () => {
  const roots = workspaceSourceRoots();
  const files = roots.flatMap((root) => collectSourceFiles(root)).filter((file) => file !== HELPER);

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

  test("every workspace source root is scanned", () => {
    expect(roots).toContain("apps/cli/src");
    expect(roots).toContain("packages/design/src");
    expect(roots).toContain("packages/providers/src");
  });

  test("the patterns catch the shapes they are for", () => {
    const flagged = (source: string) => promiseMapLines(source).length > 0;
    expect(flagged("const inflight = new Map<string, Promise<JsonValue>>();")).toBe(true);
    expect(flagged("private readonly x = new WeakMap<object, Promise<void>>();")).toBe(true);
    expect(flagged("const cache = new Map<string, number>();")).toBe(false);
    // A declaration split across lines, as the formatter writes long ones.
    expect(
      promiseMapLines(
        "const a = 1;\nconst inflight = new Map<\n  string,\n  Promise<number>\n>();",
      ),
    ).toEqual([2]);
    // A type annotation is the same table.
    expect(flagged("let pending: Map<string, Promise<Result<T, E>> | undefined>;")).toBe(true);
    // Values that are functions returning a promise are a registry, not a join.
    expect(flagged("const handlers = new Map<string, () => Promise<void>>();")).toBe(false);
    // A `;` inside an inline object type does not end the declaration.
    expect(
      flagged("const inflight = new Map<string, Promise<{ id: string; title: string }>>();"),
    ).toBe(true);
    expect(
      flagged("const tasks = new Map<string, (signal: AbortSignal) => Promise<number>>();"),
    ).toBe(false);
    // A promise in the key or a nested generic is not the value type.
    expect(flagged("const seen = new Map<Promise<void>, number>();")).toBe(false);
    expect(flagged("const x = new Map<string, Array<Promise<void>>>();")).toBe(false);
    expect(WAITER_COUNT.test("  waiters: number;")).toBe(true);
    expect(WAITER_COUNT.test("    shared.waiters -= 1;")).toBe(true);
    expect(WAITER_COUNT.test("const waitersLabel = 'x';")).toBe(false);
  });
});
