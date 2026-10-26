import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Shallow checkout boundaries are not evidence that every file changed then. */
export function createDocLastModified(root: string) {
  async function git(args: string[]) {
    // Next also loads this config under Node; do not require a Bun global here.
    return (await run("git", args, { cwd: root, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
  }
  let history: Promise<Map<string, Date>> | undefined;
  async function loadHistory() {
    const dates = new Map<string, Date>();
    try {
      if ((await git(["rev-parse", "--is-shallow-repository"])) !== "false") return dates;
      const output = await git([
        "-c",
        "core.quotepath=false",
        "log",
        "--format=commit:%cI",
        "--name-only",
        "--",
        "docs",
      ]);
      let date: Date | undefined;
      for (const line of output?.split("\n") ?? []) {
        if (line.startsWith("commit:")) {
          const parsed = new Date(line.slice(7));
          date = Number.isFinite(parsed.getTime()) ? parsed : undefined;
        } else if (line && date && !dates.has(line)) dates.set(line, date);
      }
    } catch {
      // A source archive without Git still builds; unknown dates stay omitted.
    }
    return dates;
  }
  return async (file: string) => {
    history ??= loadHistory();
    const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
    return (await history).get(relative);
  };
}
