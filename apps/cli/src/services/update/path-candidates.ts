import { posix, win32 } from "node:path";

export interface KunaiPathCandidate {
  readonly path: string;
  readonly directory: string;
  readonly rank: number;
  readonly extension: string;
}

export function findKunaiPathCandidates(input: {
  readonly pathValue: string;
  readonly platform: NodeJS.Platform;
  readonly pathExt?: string;
  readonly fileExists: (path: string) => boolean;
}): readonly KunaiPathCandidate[] {
  const isWindows = input.platform === "win32";
  const path = isWindows ? win32 : posix;
  const extensions = isWindows
    ? (input.pathExt ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .filter(Boolean)
        .map((extension) => extension.toLowerCase())
    : [""];
  const candidates: KunaiPathCandidate[] = [];
  const seenCandidates = new Set<string>();
  const seenDirectories = new Set<string>();

  for (const directory of input.pathValue.split(isWindows ? ";" : ":")) {
    if (!directory) continue;

    const normalizedDirectory = path.normalize(directory);
    const directoryKey = isWindows ? normalizedDirectory.toLowerCase() : normalizedDirectory;
    if (seenDirectories.has(directoryKey)) continue;
    seenDirectories.add(directoryKey);

    for (const extension of extensions) {
      const candidatePath = path.join(normalizedDirectory, `kunai${extension}`);
      const candidateKey = isWindows ? candidatePath.toLowerCase() : candidatePath;
      if (seenCandidates.has(candidateKey) || !input.fileExists(candidatePath)) continue;
      seenCandidates.add(candidateKey);

      candidates.push({
        path: candidatePath,
        directory: normalizedDirectory,
        rank: candidates.length,
        extension,
      });
    }
  }

  return candidates;
}
