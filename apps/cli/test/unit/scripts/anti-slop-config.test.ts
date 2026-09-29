import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../../..");
const executable = join(root, "node_modules", "oxlint", "bin", "oxlint");
const violations = [
  ["no-chained-type-assertions", "export const value = 1 as unknown as string;"],
  ["no-object-parameters", "export function identity(value: object) { return value; }"],
  ["no-reflect-apply", "export const value = Reflect.apply(Math.abs, null, [-1]);"],
  ["no-reflect-get", 'export const value = Reflect.get({ name: "value" }, "name");'],
] as const;

async function lint(cwd: string, file: string, advisory = false) {
  const child = Bun.spawn(
    [
      process.execPath,
      executable,
      "-c",
      join(root, advisory ? ".oxlintrc.anti-slop.json" : ".oxlintrc.json"),
      file,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, output: stdout + stderr };
}

test("real workspace lint blocks each ratcheted production rule and preserves test exemptions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kunai-lint-config-"));
  try {
    for (const [rule, source] of violations) {
      const production = join(directory, "src", `${rule}.ts`);
      await mkdir(dirname(production), { recursive: true });
      await Bun.write(production, source);
      for (const cwd of [root, join(root, "apps/cli")]) {
        const result = await lint(cwd, production);
        expect(result.exitCode).not.toBe(0);
        expect(result.output).toContain(`anti-slop(${rule})`);
      }
      for (const relative of [
        `test/${rule}.ts`,
        `src/${rule}.test.ts`,
        `src/${rule}.spec.ts`,
        `__mocks__/${rule}.ts`,
      ]) {
        const exempt = join(directory, relative);
        await mkdir(dirname(exempt), { recursive: true });
        await Bun.write(exempt, source);
        const result = await lint(join(root, "apps/cli"), exempt);
        expect(result.exitCode).toBe(0);
        const advisory = await lint(root, exempt, true);
        expect(advisory.exitCode).not.toBe(0);
        expect(advisory.output).toContain(`anti-slop(${rule})`);
      }
    }
    const clean = join(directory, "src", "clean.ts");
    await Bun.write(
      clean,
      'export const value: number = 1; export function identity(value: {name: string}) { return value.name; } export const result = Math.abs(-1); export const name = {name: "value"}.name;',
    );
    expect((await lint(root, clean)).exitCode).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
