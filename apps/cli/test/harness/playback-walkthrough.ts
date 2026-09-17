/**
 * Isolated launcher for the playback walkthrough.
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

const sandbox = join(tmpdir(), `kunai-vhs-playback-${process.pid}`);
mkdirSync(sandbox, { recursive: true });
applyStorageRootEnv(sandbox);

process.env.KUNAI_POSTER = "0";
process.env.KUNAI_PET = "off";

const { createElement } = await import("react");
const { bindShutdownRequestHandler } = await import("@/app/session/shutdown-request");
const { render } = await import("ink");
const { PLAYBACK_WALKTHROUGH_WATCHDOG_MS } = await import("./playback-walkthrough-scenes");
const { PlaybackWalkthroughApp } = await import("./playback-walkthrough-app.tsx");

let unmount = (): void => undefined;
let exiting = false;

function finish(code = 0): void {
  if (exiting) return;
  exiting = true;
  unmount();
  process.exit(code);
}

bindShutdownRequestHandler((intent) => {
  finish(intent.exitCode);
});

const handle = render(createElement(PlaybackWalkthroughApp));
unmount = () => {
  handle.unmount();
};

setTimeout(() => finish(0), PLAYBACK_WALKTHROUGH_WATCHDOG_MS);
