const DEBUG_FLAG = "KUNAI_IMAGE_DEBUG";

export function debugImage(message: string): void {
  if (process.env[DEBUG_FLAG] !== "1") return;
  console.log(`[kunai:image] ${message}`);
}
