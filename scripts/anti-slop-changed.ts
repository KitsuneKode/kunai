#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type AntiSlopDiagnostic = {
  readonly filename: string;
  readonly code: string;
  readonly message: string;
  readonly labels?: readonly {
    readonly span?: {
      readonly line?: number;
      readonly column?: number;
    };
  }[];
};

type OxlintJsonReport = {
  readonly diagnostics: readonly AntiSlopDiagnostic[];
};

const REPO_ROOT = resolve(import.meta.dirname, "..");
const LINTABLE_SOURCE = /\.(?:[cm]?[jt]sx?)$/i;
const MAX_ANNOTATIONS = 50;

export function selectChangedLintPaths(
  paths: readonly string[],
  fileExists: (path: string) => boolean = existsSync,
): string[] {
  return [...new Set(paths)]
    .filter((path) => LINTABLE_SOURCE.test(path) && fileExists(path))
    .sort((left, right) => left.localeCompare(right));
}

export function formatGitHubWarning(diagnostic: AntiSlopDiagnostic): string {
  const span = diagnostic.labels?.[0]?.span;
  const properties = [
    `file=${escapeWorkflowProperty(diagnostic.filename)}`,
    ...(span?.line ? [`line=${span.line}`] : []),
    ...(span?.column ? [`col=${span.column}`] : []),
    `title=${escapeWorkflowProperty(diagnostic.code)}`,
  ].join(",");
  return `::warning ${properties}::${escapeWorkflowData(diagnostic.message)}`;
}

async function changedPaths(base: string): Promise<string[]> {
  const child = Bun.spawn(
    ["git", "diff", "--name-only", "--diff-filter=ACMR", "-z", `${base}...HEAD`, "--"],
    { cwd: REPO_ROOT, stdout: "pipe", stderr: "inherit" },
  );
  const stdout = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`git diff exited ${exitCode}`);
  return stdout.split("\0").filter(Boolean);
}

async function collectDiagnostics(
  paths: readonly string[],
): Promise<readonly AntiSlopDiagnostic[]> {
  if (paths.length === 0) return [];
  const child = Bun.spawn(
    [
      process.execPath,
      "x",
      "oxlint",
      "--config",
      ".oxlintrc.anti-slop.json",
      "--format",
      "json",
      ...paths,
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
  return report.diagnostics;
}

async function main(): Promise<void> {
  const base = process.argv[2] || process.env.TURBO_SCM_BASE || "origin/main";

  const paths = selectChangedLintPaths(await changedPaths(base), (path) =>
    existsSync(resolve(REPO_ROOT, path)),
  );
  const diagnostics = await collectDiagnostics(paths);
  const inGitHubActions = process.env.GITHUB_ACTIONS === "true";

  for (const diagnostic of diagnostics.slice(0, MAX_ANNOTATIONS)) {
    if (inGitHubActions) {
      console.log(formatGitHubWarning(diagnostic));
      continue;
    }
    const span = diagnostic.labels?.[0]?.span;
    console.log(
      `${diagnostic.filename}:${span?.line ?? 1}:${span?.column ?? 1}: ${diagnostic.code} ${diagnostic.message}`,
    );
  }
  if (diagnostics.length > MAX_ANNOTATIONS) {
    console.log(
      `[anti-slop] ${diagnostics.length - MAX_ANNOTATIONS} additional finding(s) omitted`,
    );
  }
  console.log(
    `[anti-slop] advisory: ${diagnostics.length} finding(s) across ${paths.length} changed source file(s)`,
  );
}

function escapeWorkflowData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeWorkflowProperty(value: string): string {
  return escapeWorkflowData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

if (import.meta.main) {
  await main();
}
