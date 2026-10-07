import { describe, expect, test } from "bun:test";

import { scrubbedChildEnv } from "../src/shared/child-env";

describe("scrubbedChildEnv", () => {
  test("drops secret-shaped names, keeps tool env", () => {
    const env = scrubbedChildEnv({
      PATH: "/usr/bin",
      HOME: "/home/u",
      DISPLAY: ":0",
      https_proxy: "http://proxy:8080",
      KUNAI_CONFIG_DIR: "/tmp/kunai",
      KUNAI_FAKE_MPV_MODE: "1",
      AWS_SECRET_ACCESS_KEY: "x",
      AWS_SESSION_TOKEN: "x",
      GITHUB_TOKEN: "x",
      KUNAI_VIDEASY_SESSION_TOKEN: "x",
      KUNAI_WYZIE_API_KEY: "x",
      MY_PASSWORD: "x",
      SIGNING_KEY: "x",
    });

    expect(env.PATH).toBe("/usr/bin");
    expect(env.DISPLAY).toBe(":0");
    expect(env.https_proxy).toBe("http://proxy:8080");
    expect(env.KUNAI_CONFIG_DIR).toBe("/tmp/kunai");
    expect(env.KUNAI_FAKE_MPV_MODE).toBe("1");
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.KUNAI_VIDEASY_SESSION_TOKEN).toBeUndefined();
    expect(env.KUNAI_WYZIE_API_KEY).toBeUndefined();
    expect(env.MY_PASSWORD).toBeUndefined();
    expect(env.SIGNING_KEY).toBeUndefined();
  });

  test("drops undefined values instead of stringifying them", () => {
    const env = scrubbedChildEnv({ KEEP: "yes", GONE: undefined });
    expect(env.KEEP).toBe("yes");
    expect("GONE" in env).toBe(false);
  });
});
