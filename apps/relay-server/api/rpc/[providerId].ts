import type { IncomingMessage, ServerResponse } from "node:http";

import { DEFAULT_MAX_REQUEST_BODY_BYTES, handleRpcRequest } from "@kunai/relay";

import { relayRegistry } from "../../src/provider-registry";

/**
 * The shared handler enforces the same ceiling, but only once it holds a
 * `Request` — by which point this adapter has already buffered the whole
 * upload. A limit checked after the memory is spent does not bound anything,
 * so the read stops here instead. Vercel caps request size on the deployed
 * path; a self-hosted `bun run dev:relay` has no such backstop.
 */
const MAX_BODY_BYTES = DEFAULT_MAX_REQUEST_BODY_BYTES;

interface VercelLikeRequest extends IncomingMessage {
  readonly query?: Readonly<Record<string, string | readonly string[]>>;
}

export default async function handler(req: VercelLikeRequest, res: ServerResponse): Promise<void> {
  const providerId = firstQueryValue(req.query?.providerId);
  if (!providerId) {
    await writeWebResponse(res, Response.json({ error: { code: "bad-request" } }, { status: 400 }));
    return;
  }

  const body = await readNodeBody(req, MAX_BODY_BYTES);
  if (body === "too-large") {
    // Matches the shared handler's own refusal, so both entry points answer a
    // caller the same way.
    res.setHeader("Connection", "close");
    await writeWebResponse(
      res,
      Response.json(
        { error: { code: "body-too-large", message: "Relay envelope is too large" } },
        { status: 413 },
      ),
    );
    // Only after the reply is written: destroying first strands the response.
    req.destroy();
    return;
  }

  const request = nodeRequestToWebRequest(req, providerId, body);
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

function nodeRequestToWebRequest(
  req: IncomingMessage,
  providerId: string,
  body: Uint8Array,
): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value !== undefined) headers.set(key, value);
  }

  return new Request(`https://kunai-relay.local/rpc/${encodeURIComponent(providerId)}`, {
    method: req.method ?? "POST",
    headers,
    body:
      body.length > 0 && req.method !== "GET" && req.method !== "HEAD"
        ? new TextDecoder().decode(body)
        : undefined,
  });
}

/**
 * Read at most `maxBytes`, then stop.
 *
 * Listeners rather than `for await`: returning early from that loop calls the
 * iterator's `return()`, which destroys the request *and its socket* before
 * the caller can reply, so the refusal never reaches the client. Pausing holds
 * the connection open long enough to answer.
 */
function readNodeBody(req: IncomingMessage, maxBytes: number): Promise<Uint8Array | "too-large"> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;

    const settle = (result: Uint8Array | "too-large"): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on("data", (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      total += bytes.length;
      if (total > maxBytes) {
        req.pause();
        settle("too-large");
        return;
      }
      chunks.push(bytes);
    });

    req.on("end", () => settle(Buffer.concat(chunks)));
    // A truncated upload is not a body worth forwarding upstream.
    req.on("error", () => settle("too-large"));
    req.on("aborted", () => settle("too-large"));
  });
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
