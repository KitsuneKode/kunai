import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDocLastModified } from "../scripts/doc-last-modified";

test("full history preserves file dates; shallow boundaries and source archives omit them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kunai-doc-history-"));
  const full = path.join(root, "full");
  const shallow = path.join(root, "shallow");
  async function git(cwd: string, args: string[], date = "2025-01-01T00:00:00Z") {
    const child = Bun.spawn(["git", ...args], {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(0);
  }
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
    await git(root, ["clone", "--depth=1", `file://${full}`, shallow]);
    expect(await createDocLastModified(shallow)(path.join(shallow, "docs/a.mdx"))).toBeUndefined();
    expect(await createDocLastModified(root)(path.join(root, "docs/a.mdx"))).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
