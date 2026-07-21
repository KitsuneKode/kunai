import { afterEach, describe, expect, test } from "bun:test";

import type { ExternalOpenRuntime } from "@/infra/os/external-open";
import {
  defaultKunaiDocsUrl,
  isExternalUrlOpeningDisabled,
  openExternalUrl,
  openExternalUrlAndWait,
} from "@/infra/shell/open-external-url";

const ORIGINAL_DISABLE = process.env.KUNAI_DISABLE_EXTERNAL_URL;
const ORIGINAL_DOCS_URL = process.env.KUNAI_DOCS_URL;

afterEach(() => {
  if (ORIGINAL_DISABLE === undefined) {
    delete process.env.KUNAI_DISABLE_EXTERNAL_URL;
  } else {
    process.env.KUNAI_DISABLE_EXTERNAL_URL = ORIGINAL_DISABLE;
  }
  if (ORIGINAL_DOCS_URL === undefined) {
    delete process.env.KUNAI_DOCS_URL;
  } else {
    process.env.KUNAI_DOCS_URL = ORIGINAL_DOCS_URL;
  }
});

function runtime(
  overrides: Partial<ExternalOpenRuntime> & Pick<ExternalOpenRuntime, "platform">,
): ExternalOpenRuntime {
  return {
    which: () => null,
    spawn: () => {
      throw new Error("spawn not stubbed");
    },
    isDisabled: () => false,
    ...overrides,
  };
}

describe("open-external-url", () => {
  test("preload disables external URL opening during tests", () => {
    // Guards a real safety property: tests must never launch a browser. The var
    // is set by test/preload.ts, wired through apps/cli/bunfig.toml — which Bun
    // only loads when the run starts in apps/cli. A bare `bun test` from the
    // repo root skips it and fails here with a bare `undefined`, so say so.
    if (process.env.KUNAI_DISABLE_EXTERNAL_URL === undefined) {
      throw new Error(
        "KUNAI_DISABLE_EXTERNAL_URL is unset, which means apps/cli/bunfig.toml " +
          "preload did not run. Use `bun run test` (turbo, per package) rather " +
          "than `bun test` from the repo root.",
      );
    }
    expect(process.env.KUNAI_DISABLE_EXTERNAL_URL).toBe("1");
    expect(isExternalUrlOpeningDisabled()).toBe(true);
  });

  test("openExternalUrlAndWait is a typed no-op when disabled", async () => {
    process.env.KUNAI_DISABLE_EXTERNAL_URL = "1";
    await expect(openExternalUrlAndWait(defaultKunaiDocsUrl())).resolves.toMatchObject({
      ok: false,
      reason: "disabled",
      target: { kind: "url", url: defaultKunaiDocsUrl() },
    });
    await expect(openExternalUrl(defaultKunaiDocsUrl())).resolves.toMatchObject({
      ok: false,
      reason: "disabled",
    });
  });

  test("default docs URL respects KUNAI_DOCS_URL override", () => {
    process.env.KUNAI_DOCS_URL = "https://example.com/docs";
    expect(defaultKunaiDocsUrl()).toBe("https://example.com/docs");
  });

  test("Linux uses only xdg-open", async () => {
    const LINUX_RUNTIME = runtime({
      platform: "linux",
      which: (cmd) => (cmd === "xdg-open" ? "/usr/bin/xdg-open" : null),
      spawn: (command) => {
        expect(command).toEqual(["/usr/bin/xdg-open", "https://example.com"]);
        return { exited: Promise.resolve(0) };
      },
    });

    await expect(openExternalUrl("https://example.com", LINUX_RUNTIME)).resolves.toMatchObject({
      ok: true,
      command: ["/usr/bin/xdg-open", "https://example.com"],
    });
  });

  test("spawn exception becomes typed failure", async () => {
    const THROWING_RUNTIME = runtime({
      platform: "linux",
      which: (cmd) => (cmd === "xdg-open" ? "/usr/bin/xdg-open" : null),
      spawn: () => {
        throw new Error("boom");
      },
    });

    expect(await openExternalUrl("https://example.com", THROWING_RUNTIME)).toMatchObject({
      ok: false,
      reason: "spawn-failed",
    });
  });
});
