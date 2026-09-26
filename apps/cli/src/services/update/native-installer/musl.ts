import { open, readFile } from "node:fs/promises";

// The ELF PT_INTERP segment holds the loader path (e.g.
// `/lib/ld-musl-x86_64.so.1` vs `/lib64/ld-linux-x86-64.so.2`) and always sits
// in the file's first page. Reading the whole binary — which the previous
// version did — cost a full copy of a ~100 MB executable to answer this.
const ELF_HEAD_PROBE_BYTES = 8192;

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

  if (await exeLinkedAgainstMusl()) return true;

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

/**
 * Bounded read of the running binary's ELF head; true when the PT_INTERP loader
 * name says musl. A glibc or statically-linked binary returns false and falls
 * through to the ldd/maps heuristics, which stay the deciding signal — this is
 * a fast path for the positive case only.
 */
async function exeLinkedAgainstMusl(): Promise<boolean> {
  try {
    const handle = await open("/proc/self/exe", "r");
    try {
      const buf = Buffer.alloc(ELF_HEAD_PROBE_BYTES);
      const { bytesRead } = await handle.read(buf, 0, ELF_HEAD_PROBE_BYTES, 0);
      const head = buf.subarray(0, bytesRead).toString("latin1");
      return head.includes("ld-musl") || head.includes("libc.musl");
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

/** Sync heuristic for hot paths (platform detection during upgrade planning). */
export function isMuslEnvironmentSync(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "linux") return false;
  const report = (process as NodeJS.Process & { report?: { getReport?: () => unknown } }).report;
  const glibc = (report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined)
    ?.header?.glibcVersionRuntime;
  return glibc === undefined;
}
