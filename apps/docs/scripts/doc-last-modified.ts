import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Read authorship per file: directory-wide logs can omit merge-resolution edits. */
export function createDocLastModified(root: string) {
  async function git(args: string[]) {
    // Next also loads this config under Node; do not require a Bun global here.
    return (await run("git", args, { cwd: root, maxBuffer: 64 * 1024 })).stdout.trim();
  }
  let fullHistory: Promise<boolean> | undefined;
  const dates = new Map<string, Promise<Date | undefined>>();
  async function hasFullHistory() {
    try {
      return (await git(["rev-parse", "--is-shallow-repository"])) === "false";
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
