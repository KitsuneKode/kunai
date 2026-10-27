import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { storageRootEnv } from "../../helpers/storage-env";

type WorkflowStep = { name?: string; run?: string; env?: Record<string, string> };
type Workflow = { jobs: Record<string, { steps?: WorkflowStep[] }> };
const root = resolve(import.meta.dir, "../../../../..");
// SAFETY: repository-owned YAML; the test consumes only job steps, runs and env.
const workflow = Bun.YAML.parse(
  readFileSync(join(root, ".github/workflows/release.yml"), "utf8"),
) as Workflow;

test("release dispatch inputs never enter generated shell source", () => {
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (step.run) expect(step.run, step.name).not.toMatch(/\$\{\{\s*inputs\./);
    }
  }
});

test.skipIf(process.platform === "win32")(
  "Linux release version check treats hostile input as data",
  () => {
    const step = workflow.jobs.candidate?.steps?.find(
      (step) => step.name === "Check dispatch version matches package.json",
    );
    if (!step?.run) throw new Error("missing release version-check step");
    const bash = Bun.which("bash");
    if (!bash) throw new Error("Bash is required to exercise the Linux release step");
    const fixture = mkdtempSync(join(tmpdir(), "kunai-release-input-"));
    try {
      mkdirSync(join(fixture, "apps/cli"), { recursive: true });
      writeFileSync(join(fixture, "apps/cli/package.json"), JSON.stringify({ version: "9.9.9" }));
      const marker = join(fixture, "injected");
      for (const requested of ["9.9.9", '9.9.9"; printf injected > "$FIXTURE_MARKER"; #']) {
        const output = join(fixture, "github-output");
        writeFileSync(output, "");
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          ...storageRootEnv(fixture),
          GITHUB_OUTPUT: output,
          FIXTURE_MARKER: marker,
        };
        for (const [name, value] of Object.entries(step.env ?? {})) {
          env[name] = value.replaceAll("${{ inputs.version }}", requested);
        }
        const result = Bun.spawnSync(
          [bash, "-c", step.run.replaceAll("${{ inputs.version }}", requested)],
          {
            cwd: fixture,
            env,
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        expect({ injected: existsSync(marker), code: result.exitCode }).toEqual({
          injected: false,
          code: requested === "9.9.9" ? 0 : 1,
        });
        if (requested === "9.9.9") expect(readFileSync(output, "utf8")).toContain("version=9.9.9");
        else expect(readFileSync(output, "utf8")).toBe("");
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);
