import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  COMPANION_MOMENTS,
  momentForLoading,
  poseForMoment,
  type CompanionMoment,
} from "@/app-shell/companion-moment";
import type { CompanionPose } from "@/app-shell/companion-policy";

const SHELL = path.resolve(import.meta.dir, "../../../src/app-shell");
const read = (rel: string) => readFileSync(path.join(SHELL, rel), "utf8");

describe("poses", () => {
  test("every moment resolves to a pose that exists", () => {
    const poses = new Set<CompanionPose>(["idle", "watch", "go", "wait", "oops", "nap"]);
    for (const moment of COMPANION_MOMENTS) expect(poses).toContain(poseForMoment(moment));
  });

  test("every pose the CLI embeds is reachable from some moment", () => {
    // The dead-weight guard. `companion-assets.ts` embeds each pose in the
    // compiled binary with `with { type: "file" }`, so a pose no moment can
    // reach is bytes shipped to every user that no code path can draw.
    const embedded = [...read("companion-assets.ts").matchAll(/^\s{2}(\w+):/gmu)].map((m) => m[1]);
    const reachable = new Set(COMPANION_MOMENTS.map((moment) => poseForMoment(moment)));
    // `seek` is held back for a redraw, so `seeking` draws `go` for now.
    expect(embedded.length).toBeGreaterThan(0);
    for (const pose of embedded) {
      // SAFETY: the assertion only satisfies `Set<CompanionPose>.has`, which
      // compares the captured string at runtime. A key that is not a pose fails
      // the assertion rather than being smuggled through by the cast.
      expect(reachable).toContain(pose as CompanionPose);
    }
  });
});

describe("momentForLoading", () => {
  const base = { hasPoster: false, failed: false } as const;

  test("the poster wins wherever there is one", () => {
    // Two images on one surface is how the social card ended up drawing its
    // type row across her face. Content artwork is what the reader came for.
    for (const operation of ["resolving", "playing", "loading"] as const) {
      expect(momentForLoading({ ...base, operation, hasPoster: true })).toBeNull();
    }
  });

  test("she fills an empty frame during a resolve", () => {
    expect(momentForLoading({ ...base, operation: "resolving" })).toBe("seeking");
  });

  test("and while playback is running", () => {
    expect(momentForLoading({ ...base, operation: "playing" })).toBe("watching");
  });

  test("a generic load says nothing, so she says nothing", () => {
    expect(momentForLoading({ ...base, operation: "loading" })).toBeNull();
  });

  test("metadata without artwork is not a poster", () => {
    // The regression: the shell passed its side-panel gate as `hasPoster`, and
    // that panel also opens for a title detail or video metadata with no
    // artwork — silencing her on exactly the surface she exists for.
    expect(momentForLoading({ ...base, operation: "resolving", hasPoster: false })).toBe("seeking");
    expect(read("loading-shell.tsx")).toContain("Boolean(state.posterUrl)");
    expect(read("loading-shell.tsx")).not.toMatch(/hasPoster: showSidePanel/u);
  });

  test("the handoff stage outranks the operation it happens during", () => {
    expect(momentForLoading({ ...base, operation: "resolving", stage: "starting-playback" })).toBe(
      "handoff",
    );
  });

  test("failure outranks everything, poster included", () => {
    // The one moment worth crowding artwork for: the surface is telling someone
    // something went wrong.
    expect(momentForLoading({ operation: "resolving", hasPoster: true, failed: true })).toBe(
      "trouble",
    );
    expect(
      momentForLoading({
        operation: "playing",
        stage: "starting-playback",
        hasPoster: true,
        failed: true,
      }),
    ).toBe("trouble");
  });
});

describe("no moment is a dead letter", () => {
  test("every moment has a reporter in the shell", () => {
    // A moment nothing reports is the same shape of bug as a pose nothing
    // draws: a declaration with no reader.
    const sources = [
      "loading-shell.tsx",
      "setup-shell.tsx",
      "setup/SetupScreens.tsx",
      "exit-shell.tsx",
    ]
      .map((file) => read(file))
      .join("\n");
    const momentModule = read("companion-moment.ts");
    for (const moment of COMPANION_MOMENTS) {
      const reported =
        sources.includes(`"${moment}"`) || momentModule.includes(`return "${moment}"`);
      expect(reported).toBe(true);
    }
  });
});

describe("single ownership", () => {
  test("CompanionHost is the only thing that mounts a pet", () => {
    // The invariant the whole module exists for. Sixteen `StateBlock` sites and
    // three shells that render several each mean per-surface pets are several
    // components each believing they own the one Kitty placement slot — which
    // is the bug the setup wizard shipped, twice.
    const offenders: string[] = [];
    for (const file of [
      "setup/SetupFrame.tsx",
      "setup/SetupScreens.tsx",
      "exit-shell.tsx",
      "loading-shell.tsx",
      "primitives/StateBlock.tsx",
    ]) {
      if (/<CompanionPet\b/u.test(read(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("only one placement slot is declared for the companion", () => {
    const slots = [...read("kitty-placement-registry.ts").matchAll(/\|\s*"(companion[a-z-]*)"/gu)];
    expect(slots.map((m) => m[1])).toEqual(["companion"]);
  });

  test("a surface with nothing to say draws nothing, margin included", () => {
    // An Ink `Box` with a margin around a null child still lays out its margin,
    // so a caller that wraps the companion and forgets to gate the wrapper
    // leaves an empty row behind under `KUNAI_PET=off`. Three of four call
    // sites remembered the guard; one did not. The host owns the margin now, so
    // there is no wrapper left to forget.
    const host = readFileSync(path.join(SHELL, "CompanionHost.tsx"), "utf8");
    expect(host).toContain('if (moment === null || companionMode() === "off") return null;');
  });

  test("no call site wraps the companion in its own spacing Box", () => {
    // The regression this replaced: a `<Box marginTop={1}>` around the host in
    // `loading-shell.tsx` that no `KUNAI_PET=off` check gated.
    const offenders: string[] = [];
    for (const file of [
      "setup/SetupFrame.tsx",
      "setup/SetupScreens.tsx",
      "exit-shell.tsx",
      "loading-shell.tsx",
    ]) {
      // A Box whose *only* child is the host exists to space it. A Box that
      // also holds siblings — the summary screen's row, which carries the text
      // column beside her — is layout, and correctly stays.
      if (/<Box[^>]*>\s*<CompanionHost[^/]*\/>\s*<\/Box>/u.test(read(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("the setup frame stands down where the screen inside draws its own", () => {
    expect(read("setup-shell.tsx")).toMatch(/companion=\{screen === "done" \? null : "setup"\}/u);
  });
});

describe("moment vocabulary", () => {
  test("names what the session is doing, not what is drawn", () => {
    // A moment that named a pose would put the mapping back at the call site,
    // which is the coupling this replaced.
    const named: CompanionMoment[] = [
      "setup",
      "settled",
      "seeking",
      "handoff",
      "watching",
      "trouble",
      "farewell",
    ];
    expect([...COMPANION_MOMENTS].sort()).toEqual([...named].sort());
  });
});
