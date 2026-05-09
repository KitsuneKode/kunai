import { dirname } from "node:path";

/**
 * Opens the parent directory of `absolutePathToReveal` using the OS file manager.
 */
export async function revealPathInOsFileManager(
  absolutePathToReveal: string,
): Promise<{ ok: boolean; stderr?: string }> {
  const dir = dirname(absolutePathToReveal);

  const args: readonly string[] =
    process.platform === "darwin"
      ? ["open", dir]
      : process.platform === "win32"
        ? ["explorer", dir]
        : ["xdg-open", dir];

  const proc = Bun.spawn([...args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });

  let stderrText = "";
  if (proc.stderr) {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      const { value } = await reader.read();
      if (value) stderrText += decoder.decode(value);
    } finally {
      reader.releaseLock();
    }
  }

  const exitCode = await proc.exited;
  if (exitCode === 0) {
    return { ok: true };
  }

  const tail = stderrText.trim().slice(0, 400);
  return { ok: false, stderr: tail.length > 0 ? tail : `exit ${exitCode}` };
}
