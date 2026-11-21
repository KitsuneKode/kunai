import { afterEach, describe, expect, test } from "bun:test";

import {
  clearBrowseHomeReturn,
  isBrowseAtHome,
  leaveForBrowseHome,
  pushBrowseHomeReturn,
  returnFromBrowseHome,
  setBrowseAtHome,
  subscribeBrowseHome,
} from "@/app-shell/browse-home-request";

afterEach(() => {
  clearBrowseHomeReturn();
  setBrowseAtHome(false);
});

describe("browse home return trip", () => {
  test("leaving home remembers a restore, and the next return runs it once", () => {
    const order: string[] = [];
    const unsubscribe = subscribeBrowseHome(() => {
      order.push("leave");
      return () => {
        order.push("restore-browse");
      };
    });

    expect(leaveForBrowseHome()).toBe(true);
    pushBrowseHomeReturn(() => {
      order.push("restore-overlay");
    });
    expect(order).toEqual(["leave"]);

    expect(returnFromBrowseHome()).toBe(true);
    expect(order).toEqual(["leave", "restore-browse", "restore-overlay"]);
    expect(returnFromBrowseHome()).toBe(false);

    unsubscribe();
  });

  test("an idle home does not replace a saved return", () => {
    const unsubscribe = subscribeBrowseHome(() => null);
    expect(leaveForBrowseHome()).toBe(false);
    expect(returnFromBrowseHome()).toBe(false);
    unsubscribe();
  });

  test("the shell can see whether browse is already home", () => {
    expect(isBrowseAtHome()).toBe(false);
    setBrowseAtHome(true);
    expect(isBrowseAtHome()).toBe(true);
  });
});
