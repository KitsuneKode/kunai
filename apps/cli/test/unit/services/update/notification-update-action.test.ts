import { describe, expect, test } from "bun:test";

import { resolveNotificationUpdateAction } from "@/services/update/notification-update-action";

describe("resolveNotificationUpdateAction", () => {
  test("a native install updates in place instead of opening a web page", () => {
    // The regression this exists for: the inbox handed native users to a browser
    // while a transactional in-place upgrade with rollback sat one call away.
    expect(
      resolveNotificationUpdateAction({
        channel: "binary",
        currentVersion: "0.3.0",
        latestVersion: "0.4.0",
      }),
    ).toEqual({ kind: "self-update" });
  });

  test("package-manager installs get the exact command, never a self-update", () => {
    const npm = resolveNotificationUpdateAction({
      channel: "npm-global",
      currentVersion: "0.3.0",
      latestVersion: "0.4.0",
    });
    expect(npm.kind).toBe("run-command");
    expect(npm.kind === "run-command" && npm.command).toBe("npm i -g @kitsunekode/kunai@latest");

    const bun = resolveNotificationUpdateAction({
      channel: "bun-global",
      currentVersion: "0.3.0",
      latestVersion: "0.4.0",
    });
    expect(bun.kind).toBe("run-command");
    expect(bun.kind === "run-command" && bun.command).toBe("bun i -g @kitsunekode/kunai@latest");
  });

  test("a source checkout is told what to run, not silently mutated", () => {
    const action = resolveNotificationUpdateAction({
      channel: "source",
      currentVersion: "0.3.0",
      latestVersion: "0.4.0",
    });
    expect(action.kind).toBe("open-release-page");
    expect(action.kind === "open-release-page" && action.message).toContain("git pull");
  });

  test("already-current versions do nothing", () => {
    expect(
      resolveNotificationUpdateAction({
        channel: "binary",
        currentVersion: "0.4.0",
        latestVersion: "0.4.0",
      }),
    ).toEqual({ kind: "up-to-date" });
    expect(
      resolveNotificationUpdateAction({
        channel: "npm-global",
        currentVersion: "0.5.0",
        latestVersion: "0.4.0",
      }),
    ).toEqual({ kind: "up-to-date" });
  });

  test("an unresolved target version falls back to the release page", () => {
    const action = resolveNotificationUpdateAction({
      channel: "binary",
      currentVersion: "0.3.0",
      latestVersion: null,
    });
    expect(action.kind).toBe("open-release-page");
  });

  test("an unknown install method never self-updates", () => {
    const action = resolveNotificationUpdateAction({
      channel: "unknown",
      currentVersion: "0.3.0",
      latestVersion: "0.4.0",
    });
    expect(action.kind).toBe("open-release-page");
  });
});
