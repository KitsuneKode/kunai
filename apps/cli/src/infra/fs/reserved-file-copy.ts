import {
  closeSync,
  createReadStream,
  createWriteStream,
  fstatSync,
  fsync,
  openSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
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
  await pipeline(
    createReadStream(source),
    createWriteStream("", { fd: destination.fd, autoClose: false }),
    { signal },
  );
  await promisify(fsync)(destination.fd);
}
