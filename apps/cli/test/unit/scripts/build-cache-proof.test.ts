import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertBuildCacheHits,
  assertBuildCacheSummary,
} from "../../../../../scripts/build-cache-proof";
import { assertTurboCacheHit } from "../../../../../scripts/verify-build-pipeline";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function summaryOutput(tasks: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "kunai-build-cache-proof-"));
  directories.push(directory);
  const file = join(directory, "this run.json");
  writeFileSync(file, JSON.stringify({ tasks }));
  return `Summary:    ${file}\n`;
}

const BUILD_HIT = { taskId: "@kitsunekode/kunai#build", cache: { status: "HIT" } };
const HOST_HIT = { taskId: "@kitsunekode/kunai#build:binary:host", cache: { status: "HIT" } };

test("dependency cache hits cannot qualify two missed build tasks", () => {
  const output = summaryOutput([
    { taskId: "@kunai/types#typecheck", cache: { status: "HIT" } },
    { taskId: "@kunai/core#typecheck", cache: { status: "HIT" } },
    { taskId: "@kitsunekode/kunai#build", cache: { status: "MISS" } },
    { taskId: "@kitsunekode/kunai#build:binary:host", cache: { status: "MISS" } },
  ]);
  expect(() =>
    assertTurboCacheHit(
      () => `@kunai/types:typecheck: cache hit\n@kunai/core:typecheck: cache hit\n${output}`,
    ),
  ).toThrow(/@kitsunekode\/kunai#build.*MISS/);
});

test("the real caller requests a summary and qualifies both exact tasks", () => {
  const output = summaryOutput([BUILD_HIT, HOST_HIT]);
  const commands: unknown[] = [];
  assertTurboCacheHit((command, args) => {
    commands.push([command, args]);
    return output;
  });
  expect(commands).toEqual([
    [
      "bunx",
      ["turbo", "run", "build", "build:binary:host", "--filter=@kitsunekode/kunai", "--summarize"],
    ],
  ]);
});

test.each([
  { tasks: [HOST_HIT], taskId: "@kitsunekode/kunai#build", count: 0 },
  { tasks: [BUILD_HIT], taskId: "@kitsunekode/kunai#build:binary:host", count: 0 },
  { tasks: [BUILD_HIT, BUILD_HIT, HOST_HIT], taskId: "@kitsunekode/kunai#build", count: 2 },
  {
    tasks: [BUILD_HIT, HOST_HIT, HOST_HIT],
    taskId: "@kitsunekode/kunai#build:binary:host",
    count: 2,
  },
])("rejects $count entries for $taskId", ({ tasks, taskId, count }) => {
  expect(() => assertBuildCacheHits({ tasks })).toThrow(
    `expected exactly one summary entry for ${taskId}, got ${count}`,
  );
});

test.each([
  {
    tasks: [{ ...BUILD_HIT, cache: { status: "MISS" } }, HOST_HIT],
    taskId: "@kitsunekode/kunai#build",
  },
  {
    tasks: [BUILD_HIT, { ...HOST_HIT, cache: { status: "MISS" } }],
    taskId: "@kitsunekode/kunai#build:binary:host",
  },
])("rejects a cache miss for $taskId even if the other build hits", ({ tasks, taskId }) => {
  expect(() => assertBuildCacheHits({ tasks })).toThrow(
    `expected cache HIT for ${taskId}, got MISS`,
  );
});

test.each(
  [null, [], {}, { tasks: null }, { tasks: [{}] }, { tasks: [null] }].map((summary) => ({
    summary,
  })),
)("rejects malformed summaries: %j", ({ summary }) => {
  expect(() => assertBuildCacheHits(summary)).toThrow(/malformed Turbo summary/);
});

test.each([undefined, null, {}, { status: 1 }, { status: "hit" }, { status: "UNKNOWN" }])(
  "rejects malformed or unrecognized build cache status: %j",
  (cache) => {
    expect(() => assertBuildCacheHits({ tasks: [{ ...BUILD_HIT, cache }, HOST_HIT] })).toThrow(
      /@kitsunekode\/kunai#build/,
    );
  },
);

test("dependency misses do not invalidate two actual build hits", () => {
  expect(() =>
    assertBuildCacheHits({
      tasks: [{ taskId: "@kunai/types#typecheck", cache: { status: "MISS" } }, HOST_HIT, BUILD_HIT],
    }),
  ).not.toThrow();
});

test("reads the ANSI-decorated CRLF summary path, preserving spaces", () => {
  const output = summaryOutput([BUILD_HIT, HOST_HIT]);
  const decorated = `\u001b[32m${output.trimEnd()}\u001b[0m\r\n`;
  expect(() => assertBuildCacheSummary(decorated, process.cwd())).not.toThrow();
});

test("reads the indicated run even when a different passing summary exists", () => {
  const otherOutput = summaryOutput([BUILD_HIT, HOST_HIT]);
  const output = summaryOutput([BUILD_HIT]);
  expect(() => assertBuildCacheSummary(output, process.cwd())).toThrow(/build:binary:host/);
  expect(() => assertBuildCacheSummary(otherOutput, process.cwd())).not.toThrow();
});

test.each(["", "@kunai/types:typecheck: Summary: /tmp/not-the-run.json\n"])(
  "rejects output without an unprefixed summary announcement: %j",
  (output) => {
    expect(() => assertBuildCacheSummary(output, process.cwd())).toThrow(/got 0/);
  },
);

test("rejects ambiguous summary announcements", () => {
  const output = summaryOutput([BUILD_HIT, HOST_HIT]);
  expect(() => assertBuildCacheSummary(output + output, process.cwd())).toThrow(/got 2/);
});

test("fails closed if this invocation's summary file is missing", () => {
  const directory = mkdtempSync(join(tmpdir(), "kunai-build-cache-missing-"));
  directories.push(directory);
  expect(() =>
    assertBuildCacheSummary(`Summary: ${join(directory, "missing.json")}\n`, process.cwd()),
  ).toThrow(/could not read Turbo summary/);
});

test("rejects malformed JSON from this invocation's summary", () => {
  const directory = mkdtempSync(join(tmpdir(), "kunai-build-cache-malformed-"));
  directories.push(directory);
  writeFileSync(join(directory, "broken.json"), "{");
  expect(() => assertBuildCacheSummary("Summary: broken.json\n", directory)).toThrow(
    /malformed Turbo summary JSON/,
  );
});
