import { expect, test } from "bun:test";

import {
  buildLinuxProtocolDesktopEntry,
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
