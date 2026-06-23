import type { IncomingMessage, ServerResponse } from "node:http";

import { handleRpcRequest } from "@kunai/relay";

import { relayRegistry } from "../../src/provider-registry";

interface VercelLikeRequest extends IncomingMessage {
  readonly query?: Readonly<Record<string, string | readonly string[]>>;
}

export default async function handler(req: VercelLikeRequest, res: ServerResponse): Promise<void> {
  const providerId = firstQueryValue(req.query?.providerId);
  if (!providerId) {
    await writeWebResponse(res, Response.json({ error: { code: "bad-request" } }, { status: 400 }));
    return;
  }

  const request = await nodeRequestToWebRequest(req, providerId);
  const response = await handleRpcRequest(request, {
    providerId,
    registry: relayRegistry,
    token: process.env.RELAY_TOKEN,
  });
  await writeWebResponse(res, response);
}

function firstQueryValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

async function nodeRequestToWebRequest(req: IncomingMessage, providerId: string): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value !== undefined) headers.set(key, value);
  }

  const body = await readNodeBody(req);
  return new Request(`https://kunai-relay.local/rpc/${encodeURIComponent(providerId)}`, {
    method: req.method ?? "POST",
    headers,
    body:
      body.length > 0 && req.method !== "GET" && req.method !== "HEAD"
        ? new TextDecoder().decode(body)
        : undefined,
  });
}

async function readNodeBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}
