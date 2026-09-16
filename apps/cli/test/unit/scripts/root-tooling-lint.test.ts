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

async function graph(command: string, affected = false) {
  const args = command.trim().split(/\s+/);
  if (args[0] === "bunx") args.shift();
  expect(args.shift()).toBe("turbo");
  const child = Bun.spawn([process.execPath, turbo, ...args, "--dry=json"], {
    cwd: root,
    env: {
      ...process.env,
      TURBO_TELEMETRY_DISABLED: "1",
      ...(affected ? { TURBO_SCM_BASE: "HEAD", TURBO_SCM_HEAD: "HEAD" } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, error, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ exit, error: exit === 0 ? "" : error }).toEqual({ exit: 0, error: "" });
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
