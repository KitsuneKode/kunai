import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const SHELL = path.resolve(import.meta.dir, "../../../src/app-shell");

function read(rel: string): string {
  return readFileSync(path.join(SHELL, rel), "utf8");
}

/**
 * Two companions on screen at once need two placement slots.
 *
 * `registerKittyPlacement` deletes the previous image when a different one
 * claims a slot, so a shared slot makes concurrent companions erase each other
 * on every render. The setup wizard is where this bites: `SetupFrame` renders
 * its own pet and then its children, and the summary screen — which is one of
 * those children — renders a second one.
 */
describe("companion placement slots", () => {
  test("the summary screen does not share the frame's slot", () => {
    const frame = read("setup/SetupFrame.tsx");
    const screens = read("setup/SetupScreens.tsx");

    const framePet = /<CompanionPet\b([^/]*)\/>/u.exec(frame);
    const summaryPet = /<CompanionPet\b([^/]*)\/>/u.exec(screens);
    expect(framePet).not.toBeNull();
    expect(summaryPet).not.toBeNull();

    const frameSlot = /slot="([^"]+)"/u.exec(framePet?.[1] ?? "")?.[1] ?? "companion";
    const summarySlot = /slot="([^"]+)"/u.exec(summaryPet?.[1] ?? "")?.[1] ?? "companion";
    expect(summarySlot).not.toBe(frameSlot);
  });

  test("every slot a companion asks for is declared in the registry", () => {
    const registry = read("kitty-placement-registry.ts");
    const declared = new Set(
      [...registry.matchAll(/\|\s*"([a-z-]+)"/gu)].map((match) => match[1] as string),
    );

    const used = new Set<string>(["companion"]);
    for (const file of ["setup/SetupFrame.tsx", "setup/SetupScreens.tsx", "exit-shell.tsx"]) {
      for (const match of read(file).matchAll(/<CompanionPet\b[^/]*slot="([^"]+)"/gu)) {
        used.add(match[1] as string);
      }
    }

    for (const slot of used) expect(declared).toContain(slot);
  });

  test("the setup frame stands down where a screen draws its own companion", () => {
    // Two Kannas on one screen is not twice the character — it reads as a
    // rendering fault. The frame renders its pet for every screen except the
    // summary, which draws its own in a pose that means the waiting is over.
    const shell = read("setup-shell.tsx");
    expect(shell).toMatch(/companion=\{screen !== "done"\}/u);

    const frame = read("setup/SetupFrame.tsx");
    // The prop has to actually gate the render, not just exist.
    expect(frame).toMatch(/\{companion && companionMode\(\) !== "off" \?/u);
  });

  test("CompanionPet defaults to the shared slot rather than inventing one", () => {
    // A mount that does not name a slot is the single-companion case, which is
    // every surface outside setup. Defaulting keeps those call sites unchanged.
    expect(read("CompanionPet.tsx")).toContain('slot = "companion"');
  });
});
