import { createMobileEnvironment, exitMobile, mobileArgv, mobileVersion } from "mobile:runtime";

import { runMobileApplication } from "./application/run-mobile-application";

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
      // The exit code remains the final observable when terminal teardown fails.
    }
  }
}

function finalizeMobileExit(code: number): void {
  try {
    exitMobile(code);
  } catch {
    if (code === 1) return;
    try {
      exitMobile(1);
    } catch {
      // A missing host status is the launcher's fail-closed signal.
    }
  }
}

void main().then(finalizeMobileExit, () => finalizeMobileExit(1));
