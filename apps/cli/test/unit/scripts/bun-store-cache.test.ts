import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { storageRootEnv } from "../../helpers/storage-env";

type SetupStep = {
  name: string;
  if?: string;
  run?: string;
  uses?: string;
  "continue-on-error"?: boolean;
  with?: { path?: string; key?: string; "restore-keys"?: string };
};
const root = resolve(import.meta.dir, "../../../../..");

async function setupSteps(): Promise<SetupStep[]> {
  // SAFETY: repository-owned composite action; only its step contract is consumed.
  const action = Bun.YAML.parse(
    await Bun.file(join(root, ".github/actions/setup-bun-monorepo/action.yml")).text(),
  ) as { runs: { steps: SetupStep[] } };
  return action.runs.steps;
}

test("Windows CI opts out of restored global dependency links before installation", async () => {
  const steps = await setupSteps();
  const isolationIndex = steps.findIndex((step) => step.name === "Use project-local Windows store");
  expect(isolationIndex).toBeGreaterThanOrEqual(0);
  const isolation = steps[isolationIndex]!;
  expect(isolation.if).toBe("runner.os == 'Windows'");
  expect(isolationIndex).toBeLessThan(
    steps.findIndex((step) => step.name === "Install dependencies"),
  );
  expect(isolation.run).toBeDefined();
  const directory = await mkdtemp(join(tmpdir(), "kunai-bun-store-env-"));
  try {
    const environmentFile = join(directory, "github-env");
    const child = Bun.spawn(["bash", "-e", "-o", "pipefail", "-c", isolation.run!], {
      cwd: directory,
      env: { ...process.env, ...storageRootEnv(directory), GITHUB_ENV: environmentFile },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(child.stderr).text();
    expect(await child.exited, stderr).toBe(0);
    expect(await Bun.file(environmentFile).text()).toBe("BUN_INSTALL_GLOBAL_STORE=0\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store archives exclude old generations and partition Bun install configuration", async () => {
  const steps = await setupSteps();
  const restored = steps.find((step) => step.name === "Restore Bun install store")!;
  const saved = steps.find((step) => step.name === "Save Bun install store")!;
  const partition =
    "${{ runner.os }}-bun-store-v4-${{ hashFiles('package.json', 'bunfig.toml') }}-";
  expect(restored.with?.key).toStartWith(partition);
  expect(restored.with?.["restore-keys"]?.trim()).toBe(partition);
  expect(restored.with?.key).toContain("hashFiles('bun.lock', 'patches/*.patch')");
  expect(saved.with?.key).toBe(restored.with?.key);
  expect(saved.with?.path).toBe(restored.with?.path);
});

test("frozen install and executable patch verification remain required before cache save", async () => {
  const steps = await setupSteps();
  const install = steps.findIndex((step) => step.name === "Install dependencies");
  const verification = steps.findIndex(
    (step) => step.name === "Verify installed dependency patches",
  );
  const save = steps.findIndex((step) => step.name === "Save Bun install store");
  expect(steps[install]?.run).toBe("bun install --frozen-lockfile");
  expect(verification).toBeGreaterThan(install);
  expect(save).toBeGreaterThan(verification);
  expect(steps[verification]?.run).toBe("bun run verify:dependency-patches");
  expect(steps[verification]?.if).toBeUndefined();
  expect(steps[verification]?.["continue-on-error"]).not.toBe(true);
  const probe = steps.find((step) => step.name === "Verify Bun install store")!;
  expect(probe.run).toContain("bunx --no-install oxfmt --version");
  expect(probe.run).not.toContain("bun x oxfmt");
});
