/**
 * Isolated launcher for the README UI walkthrough.
 *
 * Storage roots are redirected before any shell module loads, matching
 * `test/helpers/storage-env.ts`. This process never boots the container, so it
 * cannot create an installId or send analytics. The VHS tape drives the
 * session; the watchdog is only a hung-process cap.
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyStorageRootEnv } from "../helpers/storage-env";

function isolateDemoProcess(): void {
  const sandbox = join(tmpdir(), `kunai-vhs-ui-demo-${process.pid}`);
  mkdirSync(sandbox, { recursive: true });
  applyStorageRootEnv(sandbox);
  process.env.KUNAI_POSTER = "0";
  process.env.KUNAI_PET = "off";
}

// Must run before the dynamic imports below: shell modules read these at load.
isolateDemoProcess();

const { createElement } = await import("react");
const { bindShutdownRequestHandler } = await import("@/app/session/shutdown-request");
const { render } = await import("ink");
const { UiDemoApp } = await import("./ui-demo-app.tsx");

let unmount = (): void => undefined;
let exiting = false;

function finish(code = 0): void {
  if (exiting) return;
  exiting = true;
  unmount();
  process.exit(code);
}

bindShutdownRequestHandler((intent) => finish(intent.exitCode));

// Alternate screen, as the real app renders, so the recording shows only the UI.
const handle = render(createElement(UiDemoApp), { exitOnCtrlC: false, alternateScreen: true });
unmount = () => handle.unmount();

setTimeout(() => finish(0), 120_000);
