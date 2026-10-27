import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Git's repository-local environment (rev-parse --local-env-vars), plus discovery
// controls, must not redirect a cwd-scoped query into the invoking hook's repo.
const repositoryOverrides = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
];

/** Read authorship per file: directory-wide logs can omit merge-resolution edits. */
export function createDocLastModified(root: string) {
  const env = { ...process.env };
  for (const key of repositoryOverrides) delete env[key];
  async function git(args: string[]) {
    // Next also loads this config under Node; do not require a Bun global here.
    return (await run("git", args, { cwd: root, env, maxBuffer: 64 * 1024 })).stdout.trim();
  }
  let fullHistory: Promise<boolean> | undefined;
  const dates = new Map<string, Promise<Date | undefined>>();
  async function hasFullHistory() {
    try {
      if ((await git(["rev-parse", "--is-shallow-repository"])) !== "false") return false;
      const [expected, discovered] = await Promise.all([
        realpath(root),
        git(["rev-parse", "--show-toplevel"]).then((top) => realpath(top)),
      ]);
      return expected === discovered;
    } catch {
      // A source archive without Git still builds; unknown dates stay omitted.
      return false;
    }
  }
  async function readAuthoredDate(file: string) {
    try {
      const value = await git(["log", "-1", "--format=%aI", "--", file]);
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date : undefined;
    } catch {
      // Unavailable history must never become a fabricated modification date.
      return undefined;
    }
  }

  return async (file: string) => {
    fullHistory ??= hasFullHistory();
    if (!(await fullHistory)) return undefined;
    const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
    let pending = dates.get(relative);
    if (!pending) {
      pending = readAuthoredDate(relative);
      dates.set(relative, pending);
    }
    return pending;
  };
}
