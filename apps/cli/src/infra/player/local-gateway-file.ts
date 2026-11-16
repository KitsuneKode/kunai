import { constants, type Stats } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";

/** Only constructed from a trusted offline source, never from a request URL. */
export type LocalGatewayFile = {
  readonly path: string;
  readonly identity: Stats;
  readonly contentType: string;
};

const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export async function authorizeLocalGatewayFile(
  path: string,
  expectedSize?: number,
): Promise<LocalGatewayFile> {
  if (!isAbsolute(path) || path.includes("\0")) throw new Error("invalid local playback file");
  const file = await open(path, READ_FLAGS);
  try {
    const identity = await file.stat();
    if (
      !identity.isFile() ||
      identity.size <= 0 ||
      (expectedSize !== undefined && expectedSize !== identity.size)
    )
      throw new Error("invalid local playback file");
    return { path, identity, contentType: Bun.file(path).type || "application/octet-stream" };
  } finally {
    await file.close();
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return (
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function rangeBounds(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if (
    (first !== undefined && !Number.isSafeInteger(first)) ||
    (last !== undefined && !Number.isSafeInteger(last))
  )
    return null;
  if (first === undefined) {
    if (!last || last <= 0) return null;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== undefined && last < first)) return null;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

/** Open before checking identity; bytes come from this descriptor, not a raced path reopen. */
export async function serveLocalGatewayFile(
  req: Request,
  authorized: LocalGatewayFile,
): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  let file;
  try {
    file = await open(authorized.path, READ_FLAGS);
  } catch {
    return new Response("local file unavailable", { status: 404 });
  }
  let streaming = false;
  try {
    const current = await file.stat();
    if (!sameFile(authorized.identity, current)) {
      return new Response("local file changed", { status: 409 });
    }
    const size = current.size;
    const headers = new Headers({
      "content-type": authorized.contentType,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "content-length": String(size),
      "last-modified": current.mtime.toUTCString(),
    });
    // An If-Range validator cannot match a strong validator we did not issue.
    // Returning the complete representation is the safe HTTP fallback.
    const range =
      req.method === "GET" && !req.headers.has("if-range") ? req.headers.get("range") : null;
    let start = 0;
    let end = size - 1;
    if (range !== null) {
      const bounds = rangeBounds(range, size);
      if (!bounds) {
        headers.set("content-range", `bytes */${size}`);
        headers.set("content-length", "0");
        return new Response(null, { status: 416, headers });
      }
      ({ start, end } = bounds);
      headers.set("content-range", `bytes ${start}-${end}/${size}`);
      headers.set("content-length", String(end - start + 1));
    }
    if (req.method === "HEAD") return new Response(null, { headers });
    const body = Readable.toWeb(file.createReadStream({ start, end, autoClose: true }));
    streaming = true;
    // SAFETY: createReadStream has no encoding and emits Buffer bytes; toWeb preserves those chunks.
    return new Response(body as ReadableStream<Uint8Array>, {
      status: range === null ? 200 : 206,
      headers,
    });
  } finally {
    if (!streaming) await file.close();
  }
}
