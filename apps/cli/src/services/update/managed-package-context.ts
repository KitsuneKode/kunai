import { posix, win32 } from "node:path";

export type ManagedPackageManager = "npm" | "bun";

export interface ManagedPackageContext {
  manager: ManagedPackageManager;
  packageRoot: string;
}

export function readManagedPackageContext(
  env: Record<string, string | undefined> = process.env,
): ManagedPackageContext | null {
  const manager = env.KUNAI_MANAGED_PACKAGE_MANAGER;
  const packageRoot = env.KUNAI_MANAGED_PACKAGE_ROOT;

  if (manager !== "npm" && manager !== "bun") return null;
  if (!packageRoot || (!posix.isAbsolute(packageRoot) && !win32.isAbsolute(packageRoot))) {
    return null;
  }

  return { manager, packageRoot };
}
