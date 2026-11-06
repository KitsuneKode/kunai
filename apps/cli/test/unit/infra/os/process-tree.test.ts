import { describe, expect, test } from "bun:test";

import { windowsTaskkillArgs } from "@/infra/os/process-tree";

describe("windows process-tree teardown", () => {
  test("SIGTERM asks the tree to exit without forcing", () => {
    expect(windowsTaskkillArgs(4242, "SIGTERM")).toEqual(["/pid", "4242", "/T"]);
  });

  test("SIGKILL force-kills the tree", () => {
    expect(windowsTaskkillArgs(4242, "SIGKILL")).toEqual(["/pid", "4242", "/T", "/F"]);
  });
});
