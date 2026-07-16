import { expect, test } from "bun:test";

import {
  createMpvIpcEndpoint,
  ipcServerCliArg,
  mpvIpcTransportTag,
  shouldUnlinkUnixSocket,
} from "@/infra/player/mpv-ipc-endpoint";

const windowsTest = process.platform === "win32" ? test : test.skip;

windowsTest("creates an mpv-compatible Windows named-pipe endpoint", () => {
  const endpoint = createMpvIpcEndpoint("session:with / unsafe\\characters");

  expect(endpoint).toEqual({
    kind: "windows_pipe",
    path: "//./pipe/kunai-mpv-sessionwithunsafecharacters",
  });
  expect(ipcServerCliArg(endpoint)).toBe(endpoint.path);
  expect(mpvIpcTransportTag(endpoint)).toBe("pipe");
  expect(shouldUnlinkUnixSocket(endpoint)).toBe(false);
});
