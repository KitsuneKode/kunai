import { describe, expect, test } from "bun:test";

import { scrubbedChildEnv } from "@/infra/os/child-env";

describe("scrubbedChildEnv", () => {
  test("mpv children do not inherit shell tokens but keep display/proxy env", () => {
    const env = scrubbedChildEnv({
      PATH: "/usr/bin",
      WAYLAND_DISPLAY: "wayland-0",
      XAUTHORITY: "/run/xauth",
      http_proxy: "http://127.0.0.1:8080",
      RELAY_TOKEN: "x",
      OPENAI_API_KEY: "x",
      NPM_TOKEN: "x",
      KUNAI_COMPILED_SMOKE_PHASE: "probe",
    });

    expect(env.PATH).toBe("/usr/bin");
    expect(env.WAYLAND_DISPLAY).toBe("wayland-0");
    expect(env.http_proxy).toBe("http://127.0.0.1:8080");
    expect(env.KUNAI_COMPILED_SMOKE_PHASE).toBe("probe");
    expect(env.RELAY_TOKEN).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
  });
});
