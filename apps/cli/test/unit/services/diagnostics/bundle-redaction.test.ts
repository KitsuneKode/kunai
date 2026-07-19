import { describe, expect, test } from "bun:test";

import { redactBundleText, redactBundleValue } from "@/services/diagnostics/bundle-redaction";

describe("bundle-redaction", () => {
  test("redacts home paths, URL query/auth, and usernames from a mixed fixture", () => {
    const fixture = [
      "log: opened /home/kitsune/Videos/show.mkv",
      "log: opened /Users/kitsune/Library/Caches/tmp",
      "USER=kitsune HOME=/home/kitsune",
      "fetch https://cdn.streamhost.example/play.m3u8?token=super-secret&sig=abc",
      "auth https://kitsune:pass@api.example/v1/meta?access_token=tok",
      "proc argv includes /home/kitsune/.config/kunai/config.json for kitsune",
    ].join("\n");

    const redacted = redactBundleText(fixture, {
      homeDir: "/home/kitsune",
      username: "kitsune",
    });

    expect(redacted).not.toContain("/home/kitsune");
    expect(redacted).not.toContain("/Users/kitsune");
    expect(redacted).toContain("~/Videos/show.mkv");
    expect(redacted).toContain("~/Library/Caches/tmp");
    expect(redacted).not.toContain("token=super-secret");
    expect(redacted).not.toContain("sig=abc");
    expect(redacted).not.toContain("access_token=tok");
    expect(redacted).not.toContain("kitsune:pass@");
    expect(redacted).not.toMatch(/(^|[^@\w])kitsune([^@\w]|$)/);
    expect(redacted.toLowerCase()).not.toContain("super-secret");
  });

  test("redacts nested values recursively", () => {
    const redacted = redactBundleValue(
      {
        path: "/Users/ada/Movies/clip.mp4",
        url: "https://edge.example/stream.mp4?auth=secret",
        env: "USER=ada SHELL=/bin/zsh",
      },
      { username: "ada", homeDir: "/Users/ada" },
    );

    expect(redacted).toEqual({
      path: "~/Movies/clip.mp4",
      url: expect.stringMatching(/^https:\/\/.*stream\.mp4$/),
      env: expect.stringMatching(/USER=~/),
    });
    expect(JSON.stringify(redacted)).not.toContain("ada");
    expect(JSON.stringify(redacted)).not.toContain("auth=secret");
  });
});
