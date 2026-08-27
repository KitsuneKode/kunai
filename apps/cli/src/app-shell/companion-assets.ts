import goPng from "./brand/pets/go.png" with { type: "file" };
import idlePng from "./brand/pets/idle.png" with { type: "file" };
import waitPng from "./brand/pets/wait.png" with { type: "file" };
import watchPng from "./brand/pets/watch.png" with { type: "file" };
import type { CompanionPose } from "./companion-policy";

const PET_FILES = {
  idle: idlePng,
  watch: watchPng,
  go: goPng,
  wait: waitPng,
} satisfies Record<CompanionPose, string>;

/** Filesystem or `/$bunfs/` path; `Bun.file()` reads both. */
export function companionPetPath(pose: CompanionPose): string {
  return PET_FILES[pose];
}
