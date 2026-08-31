import { describe, expect, test } from "bun:test";

import { createAShellCommandBridge } from "../../../../src/runtime/ashell/ashell-command-bridge";
import type { AShellJsc } from "../../../../src/runtime/ashell/ashell-globals";
import { createAShellPlayerPort } from "../../../../src/runtime/ashell/ashell-player-port";
import { toVlcXCallbackUrl } from "../../../../src/runtime/ashell/vlc-url";

const MEDIA_URL = "https://media.example/a b.m3u8?token=a&x=b";

function playerFixture(status: number | string = "0") {
  const files = new Map<string, string>();
  const systemCommands: string[] = [];
  let openedValue: string | undefined;
  const jsc: AShellJsc = {
    readFile: (path) => files.get(path) ?? "",
    writeFile(path, value) {
      files.set(path, value);
      return 0;
    },
    isFile: (path) => files.has(path),
    makeFolder: () => 0,
    deleteFile(path) {
      files.delete(path);
      return 0;
    },
    move: () => 0,
    system(command) {
      systemCommands.push(command);
      openedValue = files.get(".runtime/player-url");
      return status;
    },
  };
  return {
    files,
    systemCommands,
    openedValue: () => openedValue,
    port: createAShellPlayerPort({ jsc, bridge: createAShellCommandBridge(jsc) }),
  };
}

describe("a-Shell VLC player port", () => {
  test("encodes the complete HTTP URL for VLC x-callback", () => {
    expect(toVlcXCallbackUrl(MEDIA_URL)).toBe(
      "vlc-x-callback://x-callback-url/stream?url=https%3A%2F%2Fmedia.example%2Fa%20b.m3u8%3Ftoken%3Da%26x%3Db",
    );
    expect(() => toVlcXCallbackUrl("file:///private/video.mp4")).toThrow("HTTP(S)");
    expect(() => toVlcXCallbackUrl("https://x.example/a\r\nopenurl bad")).toThrow("HTTP(S)");
  });

  test("writes the scheme to a private file and runs only the fixed helper", async () => {
    const fixture = playerFixture();

    await expect(fixture.port.handoff({ player: "vlc", url: MEDIA_URL })).resolves.toEqual({
      kind: "accepted",
      launcher: "openurl",
    });
    expect(fixture.systemCommands).toEqual(["./kunai-mobile-open-vlc"]);
    expect(fixture.systemCommands[0]).not.toContain(MEDIA_URL);
    expect(fixture.openedValue()).toBe(toVlcXCallbackUrl(MEDIA_URL));
    expect(fixture.files.has(".runtime/player-url")).toBe(false);
  });

  test("returns a fixed rejection and still removes the URL file", async () => {
    const fixture = playerFixture(1);
    await expect(fixture.port.handoff({ player: "vlc", url: MEDIA_URL })).resolves.toEqual({
      kind: "rejected",
      reason: "openurl-rejected",
    });
    expect(fixture.files.has(".runtime/player-url")).toBe(false);
  });
});
