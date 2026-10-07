import { closeSync, createReadStream, fstatSync, fsync, openSync, write } from "node:fs";
import { promisify } from "node:util";

export interface FileReservation {
  readonly fd: number;
  readonly device: string;
  readonly inode: string;
}

/** Reserve a new name synchronously so ownership can be fenced by the caller. */
export function reserveFile(path: string): FileReservation {
  const fd = openSync(path, "wx", 0o600);
  try {
    const info = fstatSync(fd, { bigint: true });
    if (info.ino === 0n)
      throw new Error("Download filesystem does not expose stable file identity");
    return { fd, device: String(info.dev), inode: String(info.ino) };
  } catch (cause) {
    closeSync(fd);
    throw cause;
  }
}

/** Copy through the reserved descriptor, never reopening or replacing the destination name. */
export async function copyToReservedFile(
  source: string,
  destination: FileReservation,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  // Stream destruction on abort can close a supplied fd even with autoClose
  // disabled. Keep descriptor ownership outside streams, and join each bounded
  // write before cancellation returns so the caller can close it exactly once.
  for await (const chunk of createReadStream(source, { signal })) {
    signal?.throwIfAborted();
    let offset = 0;
    while (offset < chunk.byteLength) {
      const written = await new Promise<number>((resolve, reject) => {
        write(destination.fd, chunk, offset, chunk.byteLength - offset, null, (cause, count) => {
          if (cause) reject(cause);
          else resolve(count);
        });
      });
      if (written <= 0) throw new Error("Download copy could not make progress");
      offset += written;
      signal?.throwIfAborted();
    }
  }
  signal?.throwIfAborted();
  await promisify(fsync)(destination.fd);
}
