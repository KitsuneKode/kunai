import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  COMPANION_MOMENTS,
  momentForBrowseEmpty,
  momentForLoading,
  poseForMoment,
  voiceForMoment,
  type CompanionMoment,
} from "@/app-shell/companion-moment";
import type { CompanionPose } from "@/app-shell/companion-policy";

const SHELL = path.resolve(import.meta.dir, "../../../src/app-shell");
const read = (rel: string) => readFileSync(path.join(SHELL, rel), "utf8");

describe("poses", () => {
  test("every moment resolves to a pose that exists", () => {
    const poses = new Set<CompanionPose>([
      "idle",
      "wait",
      "seek",
      "go",
      "watch",
      "oops",
      "nap",
      "peek",
    ]);
    for (const moment of COMPANION_MOMENTS) expect(poses).toContain(poseForMoment(moment));
  });

  test("every pose the CLI embeds is reachable from some moment", () => {
    // The dead-weight guard. `companion-assets.ts` embeds each pose in the
    // compiled binary with `with { type: "file" }`, so a pose no moment can
    // reach is bytes shipped to every user that no code path can draw.
    const embedded = [...read("companion-assets.ts").matchAll(/^\s{2}(\w+):/gmu)].map((m) => m[1]);
    const reachable = new Set(COMPANION_MOMENTS.map((moment) => poseForMoment(moment)));
    expect(embedded.length).toBeGreaterThan(0);
    for (const pose of embedded) {
      // SAFETY: the assertion only satisfies `Set<CompanionPose>.has`, which
      // compares the captured string at runtime. A key that is not a pose fails
      // the assertion rather than being smuggled through by the cast.
      expect(reachable).toContain(pose as CompanionPose);
    }
  });
});

describe("the hunt", () => {
  test("she leans in while providers race, and keeps leaning while it goes badly", () => {
    // The wait is hers. A dead provider and a dragging race are the same wait,
    // so the pose holds and only the line changes.
    for (const moment of ["searching", "seeking", "rerouting", "dragging"] as const) {
      expect(poseForMoment(moment), moment).toBe("seek");
    }
  });

  test("failure is oops, empty is peek or nap, success is never drawn", () => {
    expect(poseForMoment("stuck")).toBe("oops");
    expect(poseForMoment("trouble")).toBe("oops");
    expect(poseForMoment("missing")).toBe("peek");
    expect(poseForMoment("empty")).toBe("nap");
    // `handoff` is the last beat of the wait, not a success screen: the player
    // has not taken the terminal yet. Nothing after it draws her.
    expect(poseForMoment("handoff")).toBe("go");
  });

  test("she is silent while someone is watching or reading", () => {
    // `watching` is someone watching; the settled screens have a StateBlock or
    // a summary that already speaks.
    for (const moment of ["watching", "settled", "trouble", "missing", "empty"] as const) {
      expect(voiceForMoment(moment), moment).toBeNull();
    }
  });

  test("a healthy session meets at most four of her lines", () => {
    // search → resolve → handoff → quit. More than four and she is chattering.
    const healthy: CompanionMoment[] = ["searching", "seeking", "handoff", "farewell"];
    expect(healthy.filter((moment) => voiceForMoment(moment) !== null).length).toBeLessThanOrEqual(
      4,
    );
  });
});

describe("momentForLoading", () => {
  const base = { hasPoster: false, failed: false } as const;

  test("the poster wins the picture, but not the line", () => {
    // Two images on one surface is how the social card ended up drawing its
    // type row across her face. The line is one dim row and competes with
    // nothing, so it stays.
    expect(momentForLoading({ ...base, operation: "resolving", hasPoster: true })).toEqual({
      moment: "seeking",
      picture: false,
    });
    expect(momentForLoading({ ...base, operation: "playing", hasPoster: true })).toBeNull();
  });

  test("she fills an empty frame during a resolve", () => {
    expect(momentForLoading({ ...base, operation: "resolving" })).toEqual({
      moment: "seeking",
      picture: true,
    });
  });

  test("a provider dying moves the line on, not the pose", () => {
    expect(
      momentForLoading({ ...base, operation: "resolving", issue: "allanime timed out" })?.moment,
    ).toBe("rerouting");
  });

  test("a race past the stall threshold says so, once", () => {
    expect(momentForLoading({ ...base, operation: "resolving", elapsed: 9 })?.moment).toBe(
      "seeking",
    );
    expect(momentForLoading({ ...base, operation: "resolving", elapsed: 10 })?.moment).toBe(
      "dragging",
    );
  });

  test("and while playback is running", () => {
    expect(momentForLoading({ ...base, operation: "playing" })?.moment).toBe("watching");
  });

  test("a `loading` bootstrap is the race too", () => {
    // The presenter reports a race whose playback status is `loading` under
    // that operation. Reading it as "nothing happening" left her off the
    // longest wait in the product — caught on a real kitty run.
    expect(momentForLoading({ ...base, operation: "loading" })).toEqual({
      moment: "seeking",
      picture: true,
    });
  });

  test("metadata without artwork is not a poster", () => {
    // The regression: the shell passed its side-panel gate as `hasPoster`, and
    // that panel also opens for a title detail or video metadata with no
    // artwork — silencing her on exactly the surface she exists for.
    expect(momentForLoading({ ...base, operation: "resolving", hasPoster: false })?.picture).toBe(
      true,
    );
    expect(read("loading-shell.tsx")).toContain("Boolean(state.posterUrl)");
    expect(read("loading-shell.tsx")).not.toMatch(/hasPoster: showSidePanel/u);
  });

  test("the handoff stage outranks the operation it happens during", () => {
    expect(
      momentForLoading({ ...base, operation: "resolving", stage: "starting-playback" })?.moment,
    ).toBe("handoff");
    expect(
      momentForLoading({
        ...base,
        operation: "resolving",
        stage: "starting-playback",
        issue: "first provider failed",
      })?.moment,
    ).toBe("recovered");
  });

  test("failure outranks everything, poster included", () => {
    // The one moment worth crowding artwork for: the surface is telling someone
    // something went wrong.
    expect(momentForLoading({ operation: "resolving", hasPoster: true, failed: true })).toEqual({
      moment: "stuck",
      picture: true,
    });
    expect(
      momentForLoading({
        operation: "playing",
        stage: "starting-playback",
        hasPoster: true,
        failed: true,
      })?.moment,
    ).toBe("stuck");
  });
});

describe("momentForBrowseEmpty", () => {
  const base = { kind: "empty", hasArtwork: false, ultraCompact: false } as const;

  test("she sleeps on the bare launch frame", () => {
    expect(momentForBrowseEmpty({ ...base, mode: "graphics" })).toEqual({
      moment: "empty",
      picture: true,
    });
  });

  test("a search that found nothing gets her peeking, not asleep", () => {
    expect(momentForBrowseEmpty({ ...base, kind: "no-results", mode: "graphics" })?.moment).toBe(
      "missing",
    );
  });

  test("a search in flight is a wait, in every tier", () => {
    // The surface says "searching" and nothing else, so her line is the only
    // voice on it — the glyph tier included.
    expect(momentForBrowseEmpty({ ...base, kind: "searching", mode: "graphics" })).toEqual({
      moment: "searching",
      picture: true,
    });
    expect(momentForBrowseEmpty({ ...base, kind: "searching", mode: "glyph" })).toEqual({
      moment: "searching",
      picture: false,
    });
    expect(momentForBrowseEmpty({ ...base, kind: "searching", mode: "off" })).toBeNull();
  });

  test("failure leads here too — an error surface outranks an empty frame", () => {
    expect(momentForBrowseEmpty({ ...base, kind: "error", mode: "graphics" })?.moment).toBe(
      "trouble",
    );
  });

  test("content artwork wins — she does not crowd a full frame", () => {
    expect(momentForBrowseEmpty({ ...base, hasArtwork: true, mode: "graphics" })).toBeNull();
  });

  test("the glyph tier already speaks on settled surfaces — no lone emoji row", () => {
    // StateBlock's voice line carries a 🦊 of its own; a second glyph standing
    // alone under it is noise, not presence.
    for (const mode of ["glyph", "off"] as const) {
      for (const kind of ["empty", "no-results", "error"] as const) {
        expect(momentForBrowseEmpty({ ...base, kind, mode })).toBeNull();
      }
    }
  });

  test("ultra-compact has no spare rows — the voice line still reaches it", () => {
    expect(momentForBrowseEmpty({ ...base, ultraCompact: true, mode: "graphics" })).toBeNull();
  });
});

describe("no moment is a dead letter", () => {
  test("every moment has a reporter in the shell", () => {
    // A moment nothing reports is the same shape of bug as a pose nothing
    // draws: a declaration with no reader.
    const sources = [
      "browse-shell.tsx",
      "loading-shell.tsx",
      "setup-shell.tsx",
      "setup/SetupScreens.tsx",
      "exit-shell.tsx",
      "root-status-shells.tsx",
    ]
      .map((file) => read(file))
      .join("\n");
    // The deciders, not the tables: a moment named only in the pose and voice
    // maps is exactly the dead letter this looks for.
    const module = read("companion-moment.ts");
    const deciders = module.slice(module.indexOf("export function momentForLoading"));
    for (const moment of COMPANION_MOMENTS) {
      const quoted = new RegExp(`"${moment}"`, "u");
      const reported = quoted.test(sources) || quoted.test(deciders);
      expect(reported, moment).toBe(true);
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
      "browse-shell.tsx",
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
    expect(host).toContain('if (moment === null || mode === "off") return null;');
    expect(host).toContain("if (!drawn && line === null) return null;");
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
      "root-status-shells.tsx",
    ]) {
      // A Box whose *only* child is the host exists to space it. A Box that
      // also holds siblings — the summary screen's row, which carries the text
      // column beside her — is layout, and correctly stays.
      if (/<Box[^>]*>\s*<CompanionHost[^/]*\/>\s*<\/Box>/u.test(read(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("the setup frame stands down where the screen inside draws its own", () => {
    expect(read("setup-shell.tsx")).toMatch(/companion=\{screen === "deps" \? "setup" : null\}/u);
  });
});

describe("moment vocabulary", () => {
  test("names what the session is doing, not what is drawn", () => {
    // A moment that named a pose would put the mapping back at the call site,
    // which is the coupling this replaced.
    const named: CompanionMoment[] = [
      "setup",
      "settled",
      "searching",
      "seeking",
      "rerouting",
      "dragging",
      "handoff",
      "recovered",
      "watching",
      "stuck",
      "trouble",
      "missing",
      "empty",
      "farewell",
    ];
    expect([...COMPANION_MOMENTS].sort()).toEqual([...named].sort());
  });
});
