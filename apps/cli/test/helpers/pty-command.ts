export function buildPtyCommand(
  command: string,
  transcript: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "darwin") {
    return ["script", "-qe", transcript, "/bin/sh", "-c", command];
  }
  return ["script", "-qec", command, transcript];
}
