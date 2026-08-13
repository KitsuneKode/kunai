import { describe, expect, test } from "bun:test";

import {
  classifyVideasyHttpFailure,
  getPhaseAVidkingFlavorIds,
  isVidkingFlavorDeprecated,
  listDeprecatedVidkingEndpoints,
  listEligibleVidkingFlavorIds,
  listVidkingFlavors,
} from "../src/videasy";

describe("classifyVideasyHttpFailure", () => {
  test("only permanent route removal is route-dead", () => {
    expect(classifyVideasyHttpFailure(404)).toBe("route-dead");
    expect(classifyVideasyHttpFailure(410)).toBe("route-dead");
  });

  /**
   * Intentional: speedracelight returns 500 "No streams available" per title
   * while the endpoint stays healthy for others. Quarantining on 500 would take
   * a working route offline.
   */
  test("HTTP 500 stays transient", () => {
    expect(classifyVideasyHttpFailure(500)).toBe("transient");
    expect(classifyVideasyHttpFailure(502)).toBe("transient");
    expect(classifyVideasyHttpFailure(503)).toBe("transient");
  });

  test("client errors other than removal are transient", () => {
    expect(classifyVideasyHttpFailure(403)).toBe("transient");
    expect(classifyVideasyHttpFailure(429)).toBe("transient");
  });
});

describe("deprecated Videasy routes stay inert", () => {
  test("wings-tejo is a deprecated endpoint and is not an active flavor", () => {
    expect(listDeprecatedVidkingEndpoints()).toContain("wings-tejo");
    expect(isVidkingFlavorDeprecated("wingsdb-titanium")).toBe(true);
    expect(listVidkingFlavors().some((flavor) => flavor.endpoint === "wings-tejo")).toBe(false);
  });

  test("no deprecated flavor is eligible or scheduled in phase A", () => {
    const eligible = listEligibleVidkingFlavorIds();
    const phaseA = getPhaseAVidkingFlavorIds();

    expect(eligible).not.toContain("wingsdb-titanium");
    expect(phaseA).not.toContain("wingsdb-titanium");
    for (const id of [...eligible, ...phaseA]) {
      expect(isVidkingFlavorDeprecated(id)).toBe(false);
    }
  });

  test("the active flavor list never contains a deprecated definition", () => {
    for (const flavor of listVidkingFlavors()) {
      expect(flavor.deprecated).not.toBe(true);
    }
  });
});
