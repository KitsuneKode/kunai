import type { JsonValue } from "@kunai/types";

/** Read at most 16 KiB, cancelling oversized streams before JSON allocation. */
export async function readCompanionBody(request: Request): Promise<JsonValue> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Invalid JSON");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        throw new RangeError("Payload too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  // SAFETY: JSON.parse accepts only JSON; endpoint schemas validate its shape before use.
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonValue;
}
