import { readFile } from "node:fs/promises";

/**
 * Detect musl-based Linux (Alpine, etc.) for selecting musl release assets.
 * Best-effort: false on non-Linux or when detection is inconclusive.
 */
export async function isMuslEnvironment(
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform !== "linux") return false;

  const report = (process as NodeJS.Process & { report?: { getReport?: () => unknown } }).report;
  const glibc = (report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined)
    ?.header?.glibcVersionRuntime;
  if (glibc !== undefined) return false;

  try {
    const exe = await readFile("/proc/self/exe");
    // If we can read /proc/self/exe as file content, that's wrong — use ldd instead.
    void exe;
  } catch {
    // expected for symlink read in some environments
  }

  try {
    const proc = Bun.spawn(["ldd", "--version"], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    const combined = `${stdout}\n${stderr}`.toLowerCase();
    if (combined.includes("musl")) return true;
    if (combined.includes("glibc") || combined.includes("gnu")) return false;
  } catch {
    // ldd missing
  }

  try {
    const maps = await readFile("/proc/self/maps", "utf8");
    if (maps.includes("musl")) return true;
    if (maps.includes("libc.so") || maps.includes("glibc")) return false;
  } catch {
    // unreadable
  }

  return false;
}

/** Sync heuristic for hot paths (platform detection during upgrade planning). */
export function isMuslEnvironmentSync(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "linux") return false;
  const report = (process as NodeJS.Process & { report?: { getReport?: () => unknown } }).report;
  const glibc = (report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined)
    ?.header?.glibcVersionRuntime;
  return glibc === undefined;
}
