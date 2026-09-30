import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../../..");
const manifest = await Bun.file(join(root, "package.json")).json();
const turbo = join(root, "node_modules/turbo/bin/turbo");
const oxlint = join(root, "node_modules/oxlint/bin/oxlint");
const packageLintIds: string[] = [];
for (const workspace of manifest.workspaces.packages) {
  for await (const path of new Bun.Glob(`${workspace}/package.json`).scan(root)) {
    const workspaceManifest = await Bun.file(join(root, path)).json();
    if (workspaceManifest.scripts?.lint) packageLintIds.push(`${workspaceManifest.name}#lint`);
  }
}

/**
 * `bun run scripts/ci-affected-run.ts <task> [selectors...]` wraps a turbo run:
 * when `--affected` selects zero tasks the wrapper falls back to a full run.
 * Either way the effective invocation is `turbo run <task> <selectors>`, so
 * this extracts the `<task>` segment matching `wanted` from a script (which may
 * be an `&&` chain) and returns it in plain turbo form.
 */
function unwrapAffectedRun(command: string, wanted: string): string | undefined {
  for (const segment of command.split("&&")) {
    const args = segment.trim().split(/\s+/);
    const wrapperIndex = args.indexOf("scripts/ci-affected-run.ts");
    const task = args[wrapperIndex + 1];
    if (wrapperIndex === -1 || task !== wanted) continue;
    return ["turbo", "run", task, ...args.slice(wrapperIndex + 2)].join(" ").replaceAll('"', "");
  }
  return undefined;
}

async function graph(command: string, affected = false) {
  // Only the first `&&` segment is a turbo invocation; anything after it is a
  // plain script step the dry-run graph cannot model.
  const source = unwrapAffectedRun(command, "lint") ?? command.split("&&")[0];
  const args = (source ?? "").trim().split(/\s+/);
  if (args[0] === "bunx") args.shift();
  expect(args.shift()).toBe("turbo");
  const env: NodeJS.ProcessEnv = { ...process.env, TURBO_TELEMETRY_DISABLED: "1" };
  if (affected) {
    env.TURBO_SCM_BASE = "HEAD";
    env.TURBO_SCM_HEAD = "HEAD";
  }
  const child = Bun.spawn([process.execPath, turbo, ...args, "--dry=json"], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, error, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ exit, error: exit === 0 ? "" : error }).toEqual({ exit: 0, error: "" });
  // SAFETY: turbo's `--dry=json` contract; the exit check above guarantees a
  // successful run, so `tasks` is present and shaped as declared.
  return JSON.parse(output).tasks as {
    taskId: string;
    command: string;
    resolvedTaskDefinition: { cache: boolean };
  }[];
}

describe("root tooling lint", () => {
  test("local lint and CI graphs include a nonrecursive uncached tooling task", async () => {
    for (const name of ["lint", "ci", "ci:affected", "check"]) {
      const tasks = await graph(manifest.scripts[name], name === "ci:affected");
      const task = tasks.find((entry) => entry.taskId === "//#lint:root");
      expect(task?.command).toBe("oxlint scripts tools");
      expect(task?.resolvedTaskDefinition.cache).toBe(false);
      if (name !== "ci:affected") {
        expect(
          tasks
            .filter((entry) => entry.taskId.endsWith("#lint"))
            .map((entry) => entry.taskId)
            .sort(),
        ).toEqual(packageLintIds.toSorted());
      }
    }
  });

  test("both hosted lint lanes select tooling, including an empty affected range", async () => {
    // SAFETY: the workflow is this repo's own ci.yml; the filter below no-ops if
    // the lint lanes were renamed, which the length assertion then catches.
    const workflow = Bun.YAML.parse(
      await Bun.file(join(root, ".github/workflows/ci.yml")).text(),
    ) as {
      jobs: { lint: { steps: { name?: string; run?: string }[] } };
    };
    const lanes = workflow.jobs.lint.steps.filter((step) => step.name?.startsWith("Lint ("));
    expect(lanes).toHaveLength(2);
    for (const lane of lanes) {
      const tasks = await graph(lane.run!, lane.name!.includes("affected"));
      expect(tasks.some((entry) => entry.taskId === "//#lint:root")).toBe(true);
    }
  });

  for (const dirtyRoot of [null, "scripts", "tools"]) {
    test(`tooling scope ${dirtyRoot ? `rejects debugger in ${dirtyRoot}` : "accepts clean tooling without scanning unrelated content"}`, async () => {
      const fixture = mkdtempSync(join(tmpdir(), "kunai-root-lint-"));
      try {
        for (const directory of [
          "scripts",
          "tools",
          "apps/other",
          "packages/other",
          ".worktrees/other",
        ]) {
          mkdirSync(join(fixture, directory), { recursive: true });
          const source =
            directory === "scripts" || directory === "tools"
              ? directory === dirtyRoot
                ? "debugger;\n"
                : "export const value = 1;\n"
              : "debugger;\n";
          writeFileSync(join(fixture, directory, "sample.ts"), source);
        }
        writeFileSync(join(fixture, "unrelated.ts"), "debugger;\n");
        expect(manifest.scripts["lint:root"]).toBeDefined();
        const [binary, ...args] = manifest.scripts["lint:root"].split(/\s+/);
        expect(binary).toBe("oxlint");
        const child = Bun.spawn(
          [process.execPath, oxlint, ...args, "--config", join(root, ".oxlintrc.json")],
          {
            cwd: fixture,
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [output, error, exit] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(exit).toBe(dirtyRoot ? 1 : 0);
        if (dirtyRoot) expect(output + error).toContain("no-debugger");
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }
});
