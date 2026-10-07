/** The Node errno code (`ENOENT`, `EEXIST`, …) of a caught filesystem error. */
export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}
