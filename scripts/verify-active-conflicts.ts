import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".archive",
  "node_modules",
  "dist",
  ".next",
  "coverage",
  ".turbo",
]);

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".md", ".json", ".yml", ".yaml"]);

const MARKER = /^(<{7}|={7}|>{7})(?: |$)/;

export function findConflictMarkers(root: string): readonly string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRECTORIES.has(entry)) continue;
      const path = join(dir, entry);
      let info;
      try {
        info = statSync(path);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        walk(path);
        continue;
      }
      if (path.endsWith(".patch")) continue;
      const dot = entry.lastIndexOf(".");
      if (dot < 0 || !TEXT_EXTENSIONS.has(entry.slice(dot))) continue;
      const text = readFileSync(path, "utf8");
      for (const line of text.split("\n")) {
        if (MARKER.test(line)) {
          hits.push(relative(root, path).split(sep).join("/"));
          break;
        }
      }
    }
  };
  walk(root);
  return hits;
}

function main(): void {
  const hits = findConflictMarkers(process.cwd());
  if (hits.length > 0) {
    console.error(`Unresolved conflict markers:\n${hits.join("\n")}`);
    process.exit(1);
  }
}

if (import.meta.main) main();
