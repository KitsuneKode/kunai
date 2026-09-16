import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../../..");
const ids = [
  "changes",
  "fmt",
  "lint",
  "typecheck",
  "test",
  "analytics-postgres",
  "windows-cli",
  "macos-cli",
  "installer-lint",
  "build-cli",
  "checks-docs",
  "checks-doc-coverage",
  "build-binaries",
  "installer-docker",
  "installer-scenarios",
];

function fixture() {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        result: ["changes", "fmt", "lint", "typecheck", "test"].includes(id)
          ? "success"
          : "skipped",
        outputs:
          id === "changes"
            ? {
                cli: "false",
                installer: "false",
                docs: "false",
                "doc-coverage": "false",
                analytics: "false",
              }
            : {},
      },
    ]),
  );
}

function check(needs: ReturnType<typeof fixture>, event = "pull_request") {
  return Bun.spawnSync([process.execPath, "scripts/ci-ready.mjs"], {
    cwd: root,
    env: { ...process.env, CI_NEEDS: JSON.stringify(needs), GITHUB_EVENT_NAME: event },
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("accepts an unrelated PR with only expected conditional skips", () => {
  expect(check(fixture()).exitCode).toBe(0);
});

for (const result of ["failure", "cancelled", "skipped", "unknown"]) {
  test(`rejects required test result ${result}`, () => {
    const needs = fixture();
    needs.test!.result = result;
    expect(check(needs).exitCode).toBe(1);
  });
}

test("rejects an unexpected skip after CLI changes", () => {
  const needs = fixture();
  needs.changes!.outputs.cli = "true";
  const result = check(needs);
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("windows-cli");
});

test("does not forgive failures in an optional job", () => {
  const needs = fixture();
  needs["installer-docker"]!.result = "failure";
  expect(check(needs).exitCode).toBe(1);
});

test("fails closed on missing filter output or dependency", () => {
  const needs = fixture();
  delete needs.changes!.outputs.cli;
  expect(check(needs).exitCode).toBe(1);
  delete needs.test;
  expect(check(needs).exitCode).toBe(1);
});

test("main requires native, docs and analytics even without matching paths", () => {
  expect(check(fixture(), "push").exitCode).toBe(1);
  const needs = fixture();
  for (const id of [
    "analytics-postgres",
    "windows-cli",
    "macos-cli",
    "build-cli",
    "checks-docs",
    "checks-doc-coverage",
  ])
    needs[id]!.result = "success";
  expect(check(needs, "push").exitCode).toBe(0);
});

test("aggregate waits for every job and runs after upstream failures", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(resolve(root, ".github/workflows/ci.yml")).text(),
  ) as { jobs: Record<string, { needs?: string[]; if?: string }> };
  expect(workflow.jobs["ci-ready"]?.needs?.toSorted()).toEqual(
    Object.keys(workflow.jobs)
      .filter((id) => id !== "ci-ready")
      .sort(),
  );
  expect(workflow.jobs["ci-ready"]?.if).toContain("always()");
});

for (const [path, expected] of [
  ["apps/cli/src/main.ts", ["cli", "doc-coverage"]],
  ["docs/users/quickstart.mdx", ["docs"]],
  ["apps/cli/src/container/bootstrap-providers.ts", ["cli", "docs", "doc-coverage"]],
  ["install.sh", ["installer"]],
  ["package.json", ["cli", "docs", "installer", "analytics"]],
  ["scripts/ci-ready.mjs", ["cli"]],
  [".github/workflows/ci.yml", ["cli", "docs", "installer", "analytics", "doc-coverage"]],
] as const) {
  test(`changed path selects required lanes: ${path}`, async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file(resolve(root, ".github/workflows/ci.yml")).text(),
    ) as { jobs: { changes: { steps: Array<{ id?: string; with?: { filters?: string } }> } } };
    const filters = Bun.YAML.parse(
      workflow.jobs.changes.steps.find((step) => step.id === "filter")?.with?.filters ?? "",
    ) as Record<string, string[]>;
    for (const lane of expected)
      expect(filters[lane]?.some((glob) => new Bun.Glob(glob).match(path))).toBe(true);
  });
}

test("release guard emits a check for docs-only PRs", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(resolve(root, ".github/workflows/release-guard.yml")).text(),
  ) as { on: { pull_request: unknown } };
  expect(workflow.on.pull_request).toBeNull();
});
