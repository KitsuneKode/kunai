import { expect, test } from "bun:test";

import { directSmokeArgs } from "../../live/smoke-argv";

test("direct live-smoke launchers retain every user argument", () => {
  expect(
    directSmokeArgs([
      "C:\\bun.exe",
      "C:\\repo\\test\\live\\allanime-demonslayer.smoke.ts",
      "Kimetsu no Yaiba",
      "SJms742bSTrcyJZay",
      "--json",
    ]),
  ).toEqual(["Kimetsu no Yaiba", "SJms742bSTrcyJZay", "--json"]);
});
