import path from "node:path";

const ROOT_DIR = path.resolve(import.meta.dir, "../../..");

/**
 * Run the repo formatter over a file a generator just wrote.
 *
 * Every generated file is committed, so it has to satisfy `fmt:check` like any
 * hand-written one. Shared by `sync-code-metadata.ts` and `sync-repo-content.ts`
 * so the two cannot drift into formatting their output differently.
 */
export function formatGeneratedFile(filePath: string) {
  const result = Bun.spawnSync(["oxfmt", "--write", filePath], {
    cwd: ROOT_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`Failed to format ${filePath}${stderr ? `: ${stderr}` : ""}`);
  }
}
