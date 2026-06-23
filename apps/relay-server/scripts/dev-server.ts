import { handleRelayRequest } from "../src/relay-app";

const port = Number(process.env.PORT ?? 8787);

Bun.serve({
  port,
  fetch(request) {
    return handleRelayRequest(request, {
      relayToken: process.env.RELAY_TOKEN,
    });
  },
});

console.log(`kunai relay dev server listening on http://127.0.0.1:${port}`);
