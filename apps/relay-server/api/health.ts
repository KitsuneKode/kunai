import type { ServerResponse } from "node:http";

import { relayRegistry } from "../src/provider-registry";

export default function handler(_req: unknown, res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      service: "kunai-relay",
      providers: relayRegistry.providers.length,
    }),
  );
}
