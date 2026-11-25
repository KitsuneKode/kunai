export const MAX_PROBE_BODY_BYTES = 256 * 1024;

/**
 * Read a full body as text only when it fits `maxBytes`; returns `null` on
 * overflow — a truncated M3U can still parse as valid markup, so the caller
 * must see "too large" rather than half a playlist. Mid-body errors rethrow
 * into the caller's classifier, matching `readPrefixBytes`.
 */
export async function readBoundedTextBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number = MAX_PROBE_BODY_BYTES,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!body) return null;
  const reader = body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  try {
    while (seen <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        seen += value.byteLength;
      }
    }
    if (seen > maxBytes) {
      await reader.cancel("too-large").catch(() => {});
      return null;
    }
    if (signal?.aborted) return null;
    return new TextDecoder().decode(concatBytes(chunks, seen));
  } catch (error) {
    await reader.cancel("probe-failed").catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
