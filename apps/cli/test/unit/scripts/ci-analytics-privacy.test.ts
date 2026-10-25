import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

type Environment = Readonly<Record<string, string | number | boolean | null>>;
type Workflow = {
  env?: Environment;
  jobs: Record<string, { env?: Environment; steps?: { env?: Environment }[] }>;
};

const root = resolve(import.meta.dir, "../../../../..");

function hostedWorkflowPaths(directory: string): string[] {
  return Array.from(new Bun.Glob(".github/workflows/*.{yml,yaml}").scanSync(directory)).sort();
}

test("workflow discovery covers both GitHub YAML suffixes", () => {
  const directory = mkdtempSync(join(tmpdir(), "kunai-workflow-suffixes-"));
  try {
    mkdirSync(join(directory, ".github/workflows"), { recursive: true });
    for (const name of ["one.yml", "two.yaml", "README.md"])
      writeFileSync(join(directory, ".github/workflows", name), "");
    expect(hostedWorkflowPaths(directory)).toEqual([
      ".github/workflows/one.yml",
      ".github/workflows/two.yaml",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("every hosted workflow disables analytics through job and step inheritance", async () => {
  const paths = hostedWorkflowPaths(root);
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) {
    // SAFETY: repository-owned YAML; validate effective overrides as GitHub Actions does.
    const workflow = Bun.YAML.parse(await Bun.file(resolve(root, path)).text()) as Workflow;
    expect(workflow.env?.DO_NOT_TRACK, path).toBe("1");
    for (const [name, job] of Object.entries(workflow.jobs)) {
      const jobEnv = { ...workflow.env, ...job.env };
      expect(jobEnv.DO_NOT_TRACK, `${path}: ${name}`).toBe("1");
      for (const step of job.steps ?? []) {
        expect({ ...jobEnv, ...step.env }.DO_NOT_TRACK, `${path}: ${name} step`).toBe("1");
      }
    }
  }
});

test("Turbo strict tasks retain analytics suppression even outside CI", async () => {
  // SAFETY: repository-owned configuration; retain only the two environment declarations.
  const config = Bun.JSON5.parse(await Bun.file(resolve(root, "turbo.json")).text()) as {
    globalPassThroughEnv?: string[];
    globalEnv?: string[];
  };
  const fixture = mkdtempSync(join(tmpdir(), "kunai-turbo-privacy-"));
  try {
    writeFileSync(
      join(fixture, "package.json"),
      JSON.stringify({
        name: "privacy-fixture",
        private: true,
        packageManager: "bun@1.4.2",
        scripts: { "privacy-probe": "bun privacy.ts" },
      }),
    );
    writeFileSync(
      join(fixture, "bun.lock"),
      JSON.stringify({ lockfileVersion: 1, workspaces: { "": { name: "privacy-fixture" } } }),
    );
    writeFileSync(
      join(fixture, "turbo.json"),
      JSON.stringify({
        globalPassThroughEnv: config.globalPassThroughEnv,
        globalEnv: config.globalEnv,
        tasks: { "privacy-probe": { cache: false } },
      }),
    );
    writeFileSync(
      join(fixture, "privacy.ts"),
      'console.log("privacy-probe:" + (process.env.DO_NOT_TRACK ?? "missing"))',
    );
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(root, "node_modules/turbo/bin/turbo"),
        "run",
        "privacy-probe",
        "--env-mode=strict",
        "--force",
      ],
      {
        cwd: fixture,
        env: { ...process.env, CI: "0", DO_NOT_TRACK: "1", TURBO_TELEMETRY_DISABLED: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toContain("privacy-probe:1");
    expect(stdout).not.toContain("privacy-probe:missing");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
