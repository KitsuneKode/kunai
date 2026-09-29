/**
 * Detect musl-based Linux (Alpine, etc.) for selecting musl release assets.
 * Best-effort: false on non-Linux or when detection is inconclusive.
 *
 * The signal is `process.report.getReport().header.glibcVersionRuntime`: Bun
 * and Node populate it on glibc builds and omit it on musl, which is the one
 * check that does not depend on `ldd`, `/proc`, or the ELF layout. The older
 * async multi-probe (ELF head → `ldd --version` → `/proc/self/maps`) was
 * removed: nothing called it, and every runtime this ships on reports glibc
 * presence this way.
 */
export function isMuslEnvironmentSync(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "linux") return false;
  const report = (process as NodeJS.Process & { report?: { getReport?: () => unknown } }).report;
  const glibc = (report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined)
    ?.header?.glibcVersionRuntime;
  return glibc === undefined;
}
