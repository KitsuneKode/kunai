import { expect, test } from "bun:test";

import { planUpgrade } from "@/services/update/upgrade-planner";

const base = {
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  binPath: "/x/kunai",
  dlBase: "https://dl",
};

test("npm channel plans a global npm install command", () => {
  const p = planUpgrade({ ...base, channel: "npm-global" });
  expect(p.kind).toBe("exec");
  if (p.kind === "exec") expect(p.command).toEqual(["npm", "i", "-g", "@kitsunekode/kunai@latest"]);
});

test("bun channel plans a global bun install command", () => {
  const p = planUpgrade({ ...base, channel: "bun-global" });
  expect(p.kind).toBe("exec");
  if (p.kind === "exec") expect(p.command).toEqual(["bun", "i", "-g", "@kitsunekode/kunai@latest"]);
});

test("binary channel plans a self-replace from dlBase with the right asset", () => {
  const p = planUpgrade({ ...base, channel: "binary", os: "linux", arch: "x64" });
  expect(p.kind).toBe("self-replace");
  if (p.kind === "self-replace") {
    expect(p.assetName).toBe("kunai-linux-x64");
    expect(p.downloadUrl).toBe("https://dl/download/v1.1.0/kunai-linux-x64");
    expect(p.checksumUrl).toBe("https://dl/download/v1.1.0/SHA256SUMS");
  }
});

test("windows binary uses the .exe asset name", () => {
  const p = planUpgrade({ ...base, channel: "binary", os: "windows", arch: "x64" });
  expect(p.kind).toBe("self-replace");
  if (p.kind === "self-replace") expect(p.assetName).toBe("kunai-windows-x64.exe");
});

test("source channel plans manual guidance", () => {
  const p = planUpgrade({ ...base, channel: "source" });
  expect(p.kind).toBe("manual");
});

test("already-latest plans a no-op", () => {
  const p = planUpgrade({
    ...base,
    latestVersion: "1.0.0",
    channel: "binary",
    os: "linux",
    arch: "x64",
  });
  expect(p.kind).toBe("up-to-date");
});

test("older latest than current is a no-op (no downgrade)", () => {
  const p = planUpgrade({
    ...base,
    currentVersion: "2.0.0",
    latestVersion: "1.9.9",
    channel: "npm-global",
  });
  expect(p.kind).toBe("up-to-date");
});
