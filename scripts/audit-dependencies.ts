/**
 * Locked-tree advisory scan used by the release guard and the release candidate.
 *
 * `bun audit` exits non-zero when any advisory remains. One of them has no
 * upgrade that this repo can take:
 *
 * - GHSA-gcqx-w48m-w2h4 — `deepmerge` 4.3.1. There is no patched release, and
 *   VulnCheck rejected the CVE. It is dev-only through shadcn.
 *
 * Anything else still fails the guard. Do not add an id here to clear a
 * finding that has a compatible release.
 */

export const ACCEPTED_ADVISORIES = [
  {
    id: "GHSA-gcqx-w48m-w2h4",
    packageName: "deepmerge",
  },
] as const;

export function auditArguments(): string[] {
  return ["audit", ...ACCEPTED_ADVISORIES.flatMap((advisory) => ["--ignore", advisory.id])];
}

if (import.meta.main) {
  const child = Bun.spawn(["bun", ...auditArguments()], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await child.exited);
}
