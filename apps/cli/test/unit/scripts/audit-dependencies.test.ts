import { expect, test } from "bun:test";

import { ACCEPTED_ADVISORIES, auditArguments } from "../../../../../scripts/audit-dependencies";

test("dependency audit ignores only the advisory with no safe upgrade", () => {
  expect(ACCEPTED_ADVISORIES.map((advisory) => advisory.id)).toEqual(["GHSA-gcqx-w48m-w2h4"]);
  expect(auditArguments()).toEqual(["audit", "--ignore", "GHSA-gcqx-w48m-w2h4"]);
});
