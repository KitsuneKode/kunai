#!/usr/bin/env bun

import { resolve } from "node:path";

type OxlintJsonReport = {
  readonly diagnostics: readonly {
    readonly code: string;
  }[];
};

export type RuleCounts = Record<string, number>;

export type RuleDelta = {
  readonly rule: string;
  readonly was: number;
  readonly now: number;
};

export type BaselineDrift = {
  readonly increases: readonly RuleDelta[];
  readonly decreases: readonly RuleDelta[];
  readonly zeroed: readonly string[];
};

const REPO_ROOT = resolve(import.meta.dirname, "..");
const BASELINE_PATH = resolve(REPO_ROOT, "tools/oxlint/anti-slop/baseline.json");
const ANTI_SLOP_CODE = /^anti-slop\(.+\)$/;

export function countByRule(codes: readonly string[]) {
  const counts: RuleCounts = {};
  for (const code of codes) {
    if (!ANTI_SLOP_CODE.test(code)) continue;
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

export function diffBaseline(baseline: RuleCounts, current: RuleCounts): BaselineDrift {
  const increases: RuleDelta[] = [];
  const decreases: RuleDelta[] = [];
  const zeroed: string[] = [];
  const rules = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort(
    (left, right) => left.localeCompare(right),
  );
  for (const rule of rules) {
    const was = baseline[rule] ?? 0;
    const now = current[rule] ?? 0;
    if (now > was) {
      increases.push({ rule, was, now });
    } else if (now < was) {
      decreases.push({ rule, was, now });
      if (now === 0) zeroed.push(rule);
    }
  }
  return { increases, decreases, zeroed };
}

async function collectRuleCodes(): Promise<readonly string[]> {
  const child = Bun.spawn(
    [
      process.execPath,
      "x",
      "oxlint",
      "--config",
      ".oxlintrc.anti-slop.json",
      "--format",
      "json",
      ".",
    ],
    { cwd: REPO_ROOT, stdout: "pipe", stderr: "inherit" },
  );
  const stdout = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`anti-slop oxlint exited ${exitCode}`);
  }
  // SAFETY: oxlint's documented JSON formatter owns this subprocess output.
  const report = JSON.parse(stdout) as OxlintJsonReport;
  return report.diagnostics.map((diagnostic) => diagnostic.code);
}

async function readBaseline(): Promise<RuleCounts> {
  const file = Bun.file(BASELINE_PATH);
  if (!(await file.exists())) {
    throw new Error(
      `[anti-slop] no baseline at ${BASELINE_PATH} — create one with \`bun run lint:anti-slop:baseline:update\``,
    );
  }
  // SAFETY: baseline.json is a checked-in flat rule->count map this script writes.
  return JSON.parse(await file.text()) as RuleCounts;
}

async function writeBaseline(counts: RuleCounts): Promise<void> {
  const sorted = Object.fromEntries(
    Object.keys(counts)
      .sort((left, right) => left.localeCompare(right))
      .map((rule) => [rule, counts[rule] ?? 0]),
  );
  await Bun.write(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

function reportDrift(drift: BaselineDrift, total: number): void {
  const annotate = process.env.GITHUB_ACTIONS === "true";
  for (const delta of drift.increases) {
    const line = `[anti-slop] INCREASED ${delta.rule}: ${delta.was} -> ${delta.now} (+${delta.now - delta.was})`;
    if (annotate) {
      console.log(
        `::error title=anti-slop-baseline::${delta.rule} rose ${delta.was} -> ${delta.now}`,
      );
    }
    console.log(line);
  }
  for (const delta of drift.decreases) {
    console.log(
      `[anti-slop] decreased ${delta.rule}: ${delta.was} -> ${delta.now} — ratchet with \`bun run lint:anti-slop:baseline:update\``,
    );
  }
  for (const rule of drift.zeroed) {
    console.log(`[anti-slop] clean ${rule} — promotable to .oxlintrc.json`);
  }
  console.log(
    `[anti-slop] ${total} finding(s) against baseline at tools/oxlint/anti-slop/baseline.json`,
  );
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update") || process.argv.includes("--write");
  const current = countByRule(await collectRuleCodes());
  const total = Object.values(current).reduce((sum, count) => sum + count, 0);

  if (update) {
    const previous = await readBaseline().catch(() => ({}));
    const drift = diffBaseline(previous, current);
    await writeBaseline(current);
    reportDrift(drift, total);
    console.log(`[anti-slop] baseline written to ${BASELINE_PATH}`);
    return;
  }

  const drift = diffBaseline(await readBaseline(), current);
  reportDrift(drift, total);
  if (drift.increases.length > 0) {
    console.error(
      `[anti-slop] FAIL: ${drift.increases.length} rule(s) increased above baseline — fix the new findings or justify them to a human`,
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
