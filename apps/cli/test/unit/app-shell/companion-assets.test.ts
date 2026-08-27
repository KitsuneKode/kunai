import { describe, expect, test } from "bun:test";

import { companionPetPath } from "@/app-shell/companion-assets";

describe("companion assets", () => {
  test("each pose PNG is bundled next to the shell", () => {
    for (const pose of ["idle", "watch", "go", "wait"] as const) {
      const file = Bun.file(companionPetPath(pose));
      expect(file.size).toBeGreaterThan(500);
    }
  });
});
