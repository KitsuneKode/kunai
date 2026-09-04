import { createMobileEnvironment, exitMobile, mobileArgv, mobileVersion } from "mobile:runtime";

import { runMobileApplication } from "./application/run-mobile-application";

/**
 * Owns the host lifecycle end to end. Composition can fail before the
 * application runs, and the terminal port holds a host input handle that keeps
 * the host alive until it is released, so every path out of here closes the
 * environment and yields exactly one exit code.
 */
async function main(): Promise<number> {
  let environment;
  try {
    environment = createMobileEnvironment();
  } catch {
    return 1;
  }

  try {
    const result = await runMobileApplication({
      argv: mobileArgv(),
      environment,
      version: mobileVersion(),
    });
    return result.code;
  } catch {
    return 1;
  } finally {
    try {
      await environment.terminal.close();
    } catch {
      // The exit code stays the final observable when teardown itself fails.
    }
  }
}

void main().then(exitMobile, () => exitMobile(1));
