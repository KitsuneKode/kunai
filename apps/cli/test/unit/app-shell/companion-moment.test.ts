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
import { KANNA_MOMENTS } from "@/app-shell/kanna-voice";

const SHELL = path.resolve(import.meta.dir, "../../../src/app-shell");
const read = (rel: string) => readFileSync(path.join(SHELL, rel), "utf8");

describe("poses", () => {
  const POSES: readonly CompanionPose[] = [
    "idle",
    "wait",
    "seek",
    "go",
    "watch",
    "oops",
    "nap",
    "peek",
  ];

  test("every moment resolves to a pose that exists", () => {
    for (const moment of COMPANION_MOMENTS) expect(POSES).toContain(poseForMoment(moment));
  });

  test("every pose the CLI embeds is reachable from some moment", () => {
    // The dead-weight guard. `companion-assets.ts` embeds each pose in the
    // compiled binary with `with { type: "file" }`, so a pose no moment can
    // reach is bytes shipped to every user that no code path can draw.
    const embedded = [...read("companion-assets.ts").matchAll(/^\s{2}(\w+): \{ still:/gmu)].map(
      (m) => m[1] ?? "",
    );
    const reachable = new Set<string>(COMPANION_MOMENTS.map((moment) => poseForMoment(moment)));
    expect(embedded.toSorted()).toEqual([...POSES].toSorted());
    for (const pose of embedded) expect(reachable, pose).toContain(pose);
  });

  test("the hunt draws the pose for each of its beats", () => {
    // Wait, wait, carry, wait, failure — and the two empty frames that are
    // nothing like each other.
    expect(poseForMoment("seeking")).toBe("seek");
    expect(poseForMoment("rerouting")).toBe("seek");
    expect(poseForMoment("dragging")).toBe("seek");
    expect(poseForMoment("carrying")).toBe("go");
    expect(poseForMoment("handoff")).toBe("watch");
    expect(poseForMoment("stuck")).toBe("oops");
    expect(poseForMoment("missing")).toBe("peek");
    expect(poseForMoment("empty")).toBe("nap");
  });
});

describe("what she says at each moment", () => {
  test("every spoken moment names a real pool", () => {
    for (const moment of COMPANION_MOMENTS) {
      const voice = voiceForMoment(moment);
      if (voice !== null) expect(KANNA_MOMENTS, moment).toContain(voice);
    }
  });

  test("she is silent beside a surface that already speaks", () => {
    // `StateBlock` carries her line on these; a second one under it is the same
    // thought twice.
    for (const moment of ["trouble", "missing", "empty"] as const) {
      expect(voiceForMoment(moment), moment).toBeNull();
    }
  });

  test("a healthy session hears four lines and no more", () => {
    // Launch → search → resolve → play → quit. Searching is the loader's
    // sublabel; the other three are moments. The carry between them is silent,
    // and so is everything while playback runs.
    const spoken = (["seeking", "carrying", "handoff", "farewell"] as const)
      .map((moment) => voiceForMoment(moment))
      .filter((voice) => voice !== null);
    expect(spoken).toEqual(["resolving", "handoff", "goodbye"]);
    expect(spoken.length + 1).toBeLessThanOrEqual(4);
  });
});

describe("momentForLoading", () => {
  const base = { hasPoster: false, failed: false } as const;

  test("the poster takes the picture and leaves her the line", () => {
    // Two images on one surface is how the social card ended up drawing its
    // type row across her face. Content artwork is what the reader came for —
    // but one dim row of text competes with nothing.
    expect(momentForLoading({ ...base, operation: "resolving", hasPoster: true })).toEqual({
      moment: "seeking",
      picture: false,
    });
  });

  test("she leans in while providers race", () => {
    expect(momentForLoading({ ...base, operation: "resolving" })).toEqual({
      moment: "seeking",
      picture: true,
    });
  });

  test("the stage, not the operation, is what says providers are being tried", () => {
    // The shell reports `loading` for most of a resolve. Keying on `resolving`
    // alone drew her for a few frames and then never again.
    for (const stage of ["finding-stream", "preparing-provider"]) {
      expect(momentForLoading({ ...base, operation: "loading", stage })?.moment).toBe("seeking");
    }
  });

  test("a provider that died is a detour, not a failure", () => {
    expect(
      momentForLoading({ ...base, operation: "loading", stage: "preparing-provider", issue: "x" })
        ?.moment,
    ).toBe("rerouting");
  });

  test("she says it is dragging when the shell does", () => {
    const racing = { ...base, operation: "loading", stage: "preparing-provider" } as const;
    expect(momentForLoading({ ...racing, elapsed: 19 })?.moment).toBe("seeking");
    expect(momentForLoading({ ...racing, elapsed: 20 })?.moment).toBe("dragging");
  });

  test("a found stream is carried, then handed over", () => {
    expect(
      momentForLoading({ ...base, operation: "loading", stage: "preparing-player" })?.moment,
    ).toBe("carrying");
    expect(
      momentForLoading({ ...base, operation: "loading", stage: "starting-playback" })?.moment,
    ).toBe("handoff");
  });

  test("a stream found after a dead provider is the one she remarks on", () => {
    expect(
      momentForLoading({ ...base, operation: "loading", stage: "preparing-player", issue: "x" })
        ?.moment,
    ).toBe("recovered");
  });

  test("playback running is not a moment — it worked, and someone is watching", () => {
    expect(momentForLoading({ ...base, operation: "playing" })).toBeNull();
    expect(
      momentForLoading({ ...base, operation: "playing", stage: "starting-playback" }),
    ).toBeNull();
  });

  test("a generic load says nothing, so she says nothing", () => {
    expect(momentForLoading({ ...base, operation: "loading" })).toBeNull();
  });

  test("metadata without artwork is not a poster", () => {
    // The regression: the shell passed its side-panel gate as `hasPoster`, and
    // that panel also opens for a title detail or video metadata with no
    // artwork — silencing her on exactly the surface she exists for.
    expect(read("loading-shell.tsx")).toContain("Boolean(state.posterUrl)");
    expect(read("loading-shell.tsx")).not.toMatch(/hasPoster: showSidePanel/u);
  });

  test("the shell hands her the structured problem, never advisory prose", () => {
    // `latestIssue` carries healthy-path notes; reading it would have her call
    // a dead end on a resolve that is going fine.
    expect(read("loading-shell.tsx")).toContain("issue: state.problem?.cause");
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

  test("she is asleep on a frame nothing has been asked of", () => {
    expect(momentForBrowseEmpty({ ...base, mode: "graphics" })).toBe("empty");
  });

  test("a search that found nothing is a different frame, and she looks for it", () => {
    expect(momentForBrowseEmpty({ ...base, kind: "no-results", mode: "graphics" })).toBe("missing");
    expect(read("browse-shell.tsx")).toContain('kind: "no-results"');
  });

  test("failure leads here too — an error surface outranks an empty frame", () => {
    expect(momentForBrowseEmpty({ ...base, kind: "error", mode: "graphics" })).toBe("trouble");
  });

  test("content artwork wins — she does not crowd a full frame", () => {
    expect(momentForBrowseEmpty({ ...base, hasArtwork: true, mode: "graphics" })).toBeNull();
  });

  test("the glyph tier already speaks on these surfaces — no lone emoji row", () => {
    // StateBlock's voice line carries a 🦊 of its own; a second glyph standing
    // alone under it is noise, not presence.
    for (const mode of ["glyph", "off"] as const) {
      expect(momentForBrowseEmpty({ ...base, mode })).toBeNull();
      expect(momentForBrowseEmpty({ ...base, kind: "error", mode })).toBeNull();
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
    ]
      .map((file) => read(file))
      .join("\n");
    // Only the deciding functions count. The type and the pose and voice maps
    // above them name every moment by construction, which proves nothing.
    const momentModule = read("companion-moment.ts");
    const deciders = momentModule.slice(momentModule.indexOf("export function momentForLoading"));
    for (const moment of COMPANION_MOMENTS) {
      const named = new RegExp(`"${moment}"`, "u");
      const reported = named.test(sources) || named.test(deciders);
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
    expect(host).toContain('if (moment === null || companionMode() === "off") return null;');
    // And a cue with neither a picture nor a line is nothing too.
    expect(host).toContain("if (!picture && line === null) return null;");
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
      if (/<Box[^>]*>\s*<Companion(?:Cue)?Host[^/]*\/>\s*<\/Box>/u.test(read(file))) {
        offenders.push(file);
      }
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
      "seeking",
      "rerouting",
      "dragging",
      "carrying",
      "recovered",
      "handoff",
      "stuck",
      "trouble",
      "missing",
      "empty",
      "farewell",
    ];
    expect([...COMPANION_MOMENTS].sort()).toEqual([...named].sort());
  });
});
