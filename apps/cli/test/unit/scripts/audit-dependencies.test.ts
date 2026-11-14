import { expect, test } from "bun:test";

import { ACCEPTED_ADVISORIES, auditArguments } from "../../../../../scripts/audit-dependencies";

test("dependency audit ignores only the two advisories with no safe upgrade", () => {
  expect(ACCEPTED_ADVISORIES.map((advisory) => advisory.id)).toEqual([
    "GHSA-rmxm-3fg6-px4f",
    "GHSA-gcqx-w48m-w2h4",
  ]);
  expect(auditArguments()).toEqual([
    "audit",
    "--ignore",
    "GHSA-rmxm-3fg6-px4f",
    "--ignore",
    "GHSA-gcqx-w48m-w2h4",
  ]);
});
