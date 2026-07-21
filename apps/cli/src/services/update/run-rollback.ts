import { getInstallLayoutPaths, type InstallLayoutPaths } from "./native-installer/install-layout";
import {
  executeRollback,
  listRollbackCandidates,
  type RollbackExecuteResult,
} from "./native-installer/rollback";

export type RunRollbackOptions = {
  readonly list?: boolean;
  readonly to?: string;
  readonly dryRun?: boolean;
  readonly layout?: InstallLayoutPaths;
};

function formatRefusal(result: Extract<RollbackExecuteResult, { status: "refused" }>): string {
  return `Rollback refused (${result.code}): ${result.reason}`;
}

/**
 * `kunai rollback` — local verified activation only; never downloads history.
 */
export async function runRollback(opts: RunRollbackOptions = {}): Promise<number> {
  const layout = opts.layout ?? getInstallLayoutPaths();

  if (opts.list) {
    const candidates = await listRollbackCandidates(layout);
    for (const candidate of candidates) {
      console.log(JSON.stringify(candidate));
    }
    if (candidates.length === 0) {
      console.log("No local verified rollback candidates.");
    }
    return 0;
  }

  const result = await executeRollback({
    layout,
    ...(opts.to !== undefined ? { to: opts.to } : {}),
    ...(opts.dryRun ? { dryRun: true } : {}),
  });

  if (result.status === "dry-run") {
    console.log(
      `dry-run: would roll back ${result.fromVersion} → ${result.toVersion} (local verified)`,
    );
    return 0;
  }

  if (result.status === "rolled-back") {
    console.log(`Rolled back ${result.fromVersion} → ${result.toVersion}.`);
    return 0;
  }

  if (result.status === "refused") {
    console.error(formatRefusal(result));
    return 1;
  }

  console.error(`Rollback failed: ${result.error}`);
  return 1;
}
