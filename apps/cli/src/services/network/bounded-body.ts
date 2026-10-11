/**
 * Reads a body stream into memory under a hard byte ceiling. `arrayBuffer()`
 * and `Buffer.concat` pull the whole body first and let the caller object
 * later — a mis-sized or hostile body is fully buffered before anyone sees its
 * length. Content-Length is attacker-controlled and only ever an early reject,
 * so the stream itself is bounded independently here.
 *
 * Returns `null` on overflow, abort, or a dropped stream — matching the
 * null-means-skip convention of the artwork/poster call sites. Never throws.
 */
export async function readBoundedBody(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const onAbort = () => void reader.cancel("aborted").catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (signal?.aborted) return null;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("too-large").catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // A dropped connection mid-body is not a usable payload.
    return null;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  if (signal?.aborted) return null;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}
