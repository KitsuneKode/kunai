import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createDocLastModified } from "../scripts/doc-last-modified";

async function git(cwd: string, args: string[], date = "2025-01-01T00:00:00Z", expectedExit = 0) {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
      GIT_AUTHOR_NAME: "Fixture",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_DATE: date,
      // Rebase-like history: recording the commit later must not re-date its guide.
      GIT_COMMITTER_DATE: "2025-06-01T00:00:00Z",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  expect(await child.exited).toBe(expectedExit);
}

test("full history preserves author dates; shallow boundaries and source archives omit them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kunai-doc-history-"));
  const full = path.join(root, "full");
  const shallow = path.join(root, "shallow");
  try {
    await mkdir(path.join(full, "docs"), { recursive: true });
    await git(full, ["init"]);
    await Bun.write(path.join(full, "docs/a.mdx"), "A");
    await git(full, ["add", "."]);
    await git(full, ["-c", "commit.gpgsign=false", "commit", "-m", "First guide"]);
    await Bun.write(path.join(full, "docs/b.mdx"), "B");
    await git(full, ["add", "."]);
    await git(
      full,
      ["-c", "commit.gpgsign=false", "commit", "-m", "Second guide"],
      "2025-02-01T00:00:00Z",
    );
    const lookup = createDocLastModified(full);
    expect((await lookup(path.join(full, "docs/a.mdx")))?.toISOString()).toBe(
      "2025-01-01T00:00:00.000Z",
    );
    expect((await lookup(path.join(full, "docs/b.mdx")))?.toISOString()).toBe(
      "2025-02-01T00:00:00.000Z",
    );
    const alias = path.join(root, "symlink");
    await symlink(full, alias, process.platform === "win32" ? "junction" : "dir");
    expect(
      (await createDocLastModified(alias)(path.join(alias, "docs/a.mdx")))?.toISOString(),
    ).toBe("2025-01-01T00:00:00.000Z");
    const worktree = path.join(root, "worktree");
    await git(full, ["worktree", "add", "--detach", worktree, "HEAD"]);
    expect(
      (await createDocLastModified(worktree)(path.join(worktree, "docs/a.mdx")))?.toISOString(),
    ).toBe("2025-01-01T00:00:00.000Z");
    await git(full, ["branch", "fixture-feature"]);
    await git(full, ["checkout", "-b", "fixture-main"]);
    await Bun.write(path.join(full, "docs/a.mdx"), "Main edit");
    await git(full, ["add", "."]);
    await git(
      full,
      ["-c", "commit.gpgsign=false", "commit", "-m", "Main edit"],
      "2025-03-01T00:00:00Z",
    );
    await git(full, ["checkout", "fixture-feature"]);
    await Bun.write(path.join(full, "docs/a.mdx"), "Feature edit");
    await git(full, ["add", "."]);
    await git(
      full,
      ["-c", "commit.gpgsign=false", "commit", "-m", "Feature edit"],
      "2025-03-02T00:00:00Z",
    );
    await git(full, ["merge", "--no-commit", "fixture-main"], undefined, 1);
    await Bun.write(path.join(full, "docs/a.mdx"), "Resolution authored during merge");
    await git(full, ["add", "."]);
    await git(
      full,
      ["-c", "commit.gpgsign=false", "commit", "-m", "Resolve guide"],
      "2025-03-03T00:00:00Z",
    );
    const mergedLookup = createDocLastModified(full);
    expect((await mergedLookup(path.join(full, "docs/a.mdx")))?.toISOString()).toBe(
      "2025-03-03T00:00:00.000Z",
    );
    expect((await mergedLookup(path.join(full, "docs/b.mdx")))?.toISOString()).toBe(
      "2025-02-01T00:00:00.000Z",
    );
    await git(root, ["clone", "--depth=1", pathToFileURL(full).href, shallow]);
    expect(await createDocLastModified(shallow)(path.join(shallow, "docs/a.mdx"))).toBeUndefined();
    expect(await createDocLastModified(root)(path.join(root, "docs/a.mdx"))).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("guide dates ignore inherited repository-location overrides", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kunai-doc-env-"));
  const full = path.join(root, "full");
  const foreign = path.join(root, "foreign");
  try {
    for (const [dir, date] of [
      [full, "2025-01-01T00:00:00Z"],
      [foreign, "2025-04-01T00:00:00Z"],
    ] as const) {
      await mkdir(path.join(dir, "docs"), { recursive: true });
      await git(dir, ["init"]);
      await Bun.write(path.join(dir, "docs/a.mdx"), "Guide");
      await git(dir, ["add", "."]);
      await git(dir, ["-c", "commit.gpgsign=false", "commit", "-m", "Guide"], date);
    }
    const script = `import { createDocLastModified } from ${JSON.stringify(pathToFileURL(path.resolve(import.meta.dir, "../scripts/doc-last-modified.ts")).href)};
      console.log((await createDocLastModified(${JSON.stringify(full)})(${JSON.stringify(path.join(full, "docs/a.mdx"))}))?.toISOString());`;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      env: { ...process.env, GIT_DIR: path.join(foreign, ".git"), GIT_WORK_TREE: foreign },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, error, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(error).toBe("");
    expect(exit).toBe(0);
    expect(output.trim()).toBe("2025-01-01T00:00:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a source archive nested in another repository has no guide dates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kunai-doc-ancestor-"));
  const archive = path.join(root, "archive");
  try {
    await mkdir(path.join(archive, "docs"), { recursive: true });
    await git(root, ["init"]);
    await Bun.write(path.join(archive, "docs/a.mdx"), "Archived guide");
    await git(root, ["add", "."]);
    await git(root, ["-c", "commit.gpgsign=false", "commit", "-m", "Import archive"]);
    expect(await createDocLastModified(archive)(path.join(archive, "docs/a.mdx"))).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
