// =============================================================================
// bounded-body.ts — hard byte ceilings on untrusted response bodies
//
// Every response read off a provider or CDN is sized by whatever the remote
// chooses to send. A chunked body with no Content-Length is bounded only by
// the request timeout: on a fast link a hostile or broken host streams
// hundreds of MB into a single in-memory string — per candidate, per probe.
// Range headers are advisory; a server that ignores them returns the whole
// resource as a 200.
//
// These readers treat the cap as a hard bound: cancel the stream past it and
// return null, so the caller fails the body the same way it fails an absent
// one. Callers decide what null means — most already have an unreachable or
// parse-failed branch.
// =============================================================================

/**
 * Read a stream into memory up to `maxBytes`. Returns the bytes — possibly
 * empty, matching `Response.text()` on a body that never arrived — when the
 * stream completes within the cap. Null means over-cap or a read error: the
 * reader is cancelled so the socket frees promptly, and the caller fails the
 * body instead of trusting a partial page.
 */
export async function readStreamBytesCapped(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let overCap = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        overCap = true;
        break;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    if (overCap) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (overCap) return null;
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Response body with a Content-Length precheck: a declared oversize is refused
 * before a single chunk is consumed, and an undeclared/chunked oversize trips
 * the stream cap mid-read.
 */
export async function readResponseBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  return readStreamBytesCapped(response.body, maxBytes);
}

export async function readResponseTextCapped(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const bytes = await readResponseBodyCapped(response, maxBytes);
  if (!bytes) return null;
  return new TextDecoder().decode(bytes);
}

/** Byte cap on a piped stream (e.g. a spawned process's stdout). */
export async function readStreamTextCapped(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxBytes: number,
): Promise<string | null> {
  const bytes = await readStreamBytesCapped(stream, maxBytes);
  if (!bytes) return null;
  return new TextDecoder().decode(bytes);
}

/**
 * Read until at least `neededBytes` have arrived, then cancel and return the
 * prefix. For probes that only need proof of a non-empty body — the Range
 * header asks politely, this enforces it when the server answers a Range
 * request with a full 200 anyway. Returns whatever arrived when the stream
 * ends short (the caller reads the byte count), null on a read error.
 */
export async function readResponseBodyPrefix(
  response: Response,
  neededBytes: number,
): Promise<Uint8Array | null> {
  const stream = response.body;
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let satisfied = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (received >= neededBytes) {
        satisfied = true;
        break;
      }
    }
  } catch {
    return null;
  } finally {
    if (satisfied) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
