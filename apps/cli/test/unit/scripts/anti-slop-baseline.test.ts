import { describe, expect, test } from "bun:test";

import { countByRule, diffBaseline } from "../../../../../scripts/anti-slop-baseline";

describe("anti-slop count baseline", () => {
  test("counts only anti-slop diagnostic codes", () => {
    expect(
      countByRule([
        "anti-slop(no-runtime-typeof)",
        "eslint(no-console)",
        "anti-slop(no-runtime-typeof)",
        "anti-slop(require-safety-comment-for-type-assertion)",
        "typescript-eslint(no-explicit-any)",
      ]),
    ).toEqual({
      "anti-slop(no-runtime-typeof)": 2,
      "anti-slop(require-safety-comment-for-type-assertion)": 1,
    });
  });

  test("flags a count increase over the baseline", () => {
    const drift = diffBaseline(
      { "anti-slop(rule-a)": 3, "anti-slop(rule-b)": 5 },
      { "anti-slop(rule-a)": 3, "anti-slop(rule-b)": 6 },
    );

    expect(drift.increases).toEqual([{ rule: "anti-slop(rule-b)", was: 5, now: 6 }]);
    expect(drift.decreases).toEqual([]);
    expect(drift.zeroed).toEqual([]);
  });

  test("treats findings on a rule missing from the baseline as an increase", () => {
    const drift = diffBaseline({ "anti-slop(rule-a)": 3 }, { "anti-slop(rule-c)": 1 });

    expect(drift.increases).toEqual([{ rule: "anti-slop(rule-c)", was: 0, now: 1 }]);
  });

  test("reports decreases and flags rules that reached zero", () => {
    const drift = diffBaseline(
      { "anti-slop(rule-a)": 4, "anti-slop(rule-b)": 2 },
      { "anti-slop(rule-a)": 1 },
    );

    expect(drift.increases).toEqual([]);
    expect(drift.decreases).toEqual([
      { rule: "anti-slop(rule-a)", was: 4, now: 1 },
      { rule: "anti-slop(rule-b)", was: 2, now: 0 },
    ]);
    expect(drift.zeroed).toEqual(["anti-slop(rule-b)"]);
  });

  test("an unchanged baseline produces no drift", () => {
    const counts = { "anti-slop(rule-a)": 7, "anti-slop(rule-b)": 0 };
    const drift = diffBaseline(counts, counts);

    expect(drift.increases).toEqual([]);
    expect(drift.decreases).toEqual([]);
    expect(drift.zeroed).toEqual([]);
  });
});
