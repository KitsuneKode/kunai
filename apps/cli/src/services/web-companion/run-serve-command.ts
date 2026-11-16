import { createContainer, disposeContainer } from "@/container";
import {
  CompanionRunState,
  createCompanionFetchHandler,
} from "@/services/web-companion/companion-server";
import {
  companionLocalUrl,
  mintCompanionRunSecret,
} from "@/services/web-companion/companion-session";
import { parseServeArgs, type ServeCommandOptions } from "@/services/web-companion/serve-args";

export { parseServeArgs, type ServeCommandOptions };

export async function runServeCommand(argv: readonly string[]): Promise<number> {
  const { port, host } = parseServeArgs(argv);
  const runSecret = mintCompanionRunSecret();
  const run = new CompanionRunState();
  const container = await createContainer();

  let server;
  try {
    server = Bun.serve({
      port,
      hostname: host,
      fetch: createCompanionFetchHandler({
        container,
        run,
        runSecret,
        bindHost: host,
        bindPort: port,
      }),
    });
  } catch (error) {
    run.close();
    await disposeContainer(container);
    throw error;
  }

  const boundPort = server.port ?? port;
  const openUrl = companionLocalUrl(boundPort, runSecret);

  console.log(`
  Kunai Web Companion is live on this device.

  Local: ${openUrl}

  Open the URL above once to authenticate this browser session.
  Press Ctrl+C to stop.
  `);

  return new Promise<number>((resolve) => {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log("\nStopping Kunai Web Companion...");
      run.close();
      server.stop(true);
      disposeContainer(container)
        .catch(() => {})
        .finally(() => {
          process.removeListener("SIGINT", shutdown);
          process.removeListener("SIGTERM", shutdown);
          resolve(0);
        });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
