import { expect, test } from "bun:test";

import {
  buildLinuxProtocolDesktopEntry,
  buildProtocolHandlerInstallPlan,
  resolveLinuxProtocolHandlerPaths,
} from "@/infra/os/protocol-handler";

test("buildLinuxProtocolDesktopEntry registers kunai handoff URLs without shell interpolation", () => {
  const entry = buildLinuxProtocolDesktopEntry("/home/user/bin/kunai");

  expect(entry).toContain("MimeType=x-scheme-handler/kunai;");
  expect(entry).toContain('Exec="/home/user/bin/kunai" --handoff-url %u');
});

test("resolveLinuxProtocolHandlerPaths uses XDG data home when available", () => {
  expect(
    resolveLinuxProtocolHandlerPaths({
      home: "/home/user",
      xdgDataHome: "/tmp/xdg-data",
    }),
  ).toEqual({
    applicationsDir: "/tmp/xdg-data/applications",
    desktopPath: "/tmp/xdg-data/applications/kunai-protocol-handler.desktop",
  });
});

test("buildProtocolHandlerInstallPlan describes inspectable dry-run steps", () => {
  const plan = buildProtocolHandlerInstallPlan({
    platform: "linux",
    executable: "/home/user/bin/kunai",
    home: "/home/user",
    xdgDataHome: "/tmp/xdg-data",
    // The preload exports a dedicated profile; opt back out explicitly.
    profileRoot: null,
  });

  expect(plan.supported).toBe(true);
  expect(plan.writes.map((write) => write.path)).toEqual([
    "/tmp/xdg-data/applications/kunai-protocol-handler.desktop",
  ]);
  expect(plan.commands).toEqual([
    ["xdg-mime", "default", "kunai-protocol-handler.desktop", "x-scheme-handler/kunai"],
  ]);
  expect(plan.notes.join(" ")).toContain("local confirmation");
});

test.each(["darwin", "win32"] as const)("registration is unavailable on %s", (platform) => {
  const plan = buildProtocolHandlerInstallPlan({ platform, profileRoot: null });
  expect(plan.supported).toBe(false);
  expect(plan.writes).toEqual([]);
  expect(plan.commands).toEqual([]);
  expect(plan.notes.join(" ")).toContain("implemented on Linux only");
});

test("a dedicated profile cannot register the account-wide handler", () => {
  // The association is machine-wide by definition: a run pointed at a
  // dedicated profile must refuse rather than install it.
  const plan = buildProtocolHandlerInstallPlan({
    platform: "linux",
    executable: "/home/user/bin/kunai",
    home: "/home/user",
    xdgDataHome: "/tmp/xdg-data",
    profileRoot: "/srv/kunai-profile",
  });

  expect(plan.supported).toBe(false);
  expect(plan.writes).toEqual([]);
  expect(plan.commands).toEqual([]);
  expect(plan.notes.join(" ")).toContain("Unset it and use the default profile");
});

test("an explicit null profileRoot leaves the plan unchanged", () => {
  const plan = buildProtocolHandlerInstallPlan({
    platform: "linux",
    executable: "/home/user/bin/kunai",
    home: "/home/user",
    xdgDataHome: "/tmp/xdg-data",
    profileRoot: null,
  });

  expect(plan.supported).toBe(true);
});

test("buildProtocolHandlerInstallPlan gives manual guidance for unsupported platforms", () => {
  const plan = buildProtocolHandlerInstallPlan({
    platform: "darwin",
    executable: "/Applications/Kunai.app/Contents/MacOS/kunai",
    home: "/Users/user",
    xdgDataHome: undefined,
    profileRoot: null,
  });

  expect(plan.supported).toBe(false);
  expect(plan.writes).toEqual([]);
  expect(plan.commands).toEqual([]);
  expect(plan.notes.join(" ")).toContain("packaged installer");
});
