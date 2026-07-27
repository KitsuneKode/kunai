/** User arguments for smoke files launched directly with `bun path/to/smoke.ts`. */
export function directSmokeArgs(argv: readonly string[] = process.argv): string[] {
  return argv.slice(2);
}
