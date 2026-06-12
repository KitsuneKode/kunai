import { expect, test } from "bun:test";

import { planUninstall } from "@/services/update/run-uninstall";

test("npm channel plans a global npm uninstall", () => {
  const p = planUninstall({ channel: "npm-global", binPath: "/x/kunai" });
  expect(p.kind).toBe("exec");
  if (p.kind === "exec") {
    expect(p.command).toEqual(["npm", "uninstall", "-g", "@kitsunekode/kunai"]);
  }
});

test("bun channel plans a global bun uninstall", () => {
  const p = planUninstall({ channel: "bun-global", binPath: "/x/kunai" });
  expect(p.kind).toBe("exec");
  if (p.kind === "exec") {
    expect(p.command).toEqual(["bun", "uninstall", "-g", "@kitsunekode/kunai"]);
  }
});

test("binary channel plans a file removal at binPath", () => {
  const p = planUninstall({ channel: "binary", binPath: "/x/kunai" });
  expect(p.kind).toBe("remove-file");
  if (p.kind === "remove-file") expect(p.path).toBe("/x/kunai");
});

test("source channel plans manual guidance", () => {
  const p = planUninstall({ channel: "source", binPath: "/x/kunai" });
  expect(p.kind).toBe("manual");
});

test("unknown channel plans manual guidance", () => {
  const p = planUninstall({ channel: "unknown", binPath: "/x/kunai" });
  expect(p.kind).toBe("manual");
});
