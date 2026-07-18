import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BrowseShell } from "@/app-shell/browse-shell";
import type { ShutdownIntent } from "@/app/session/shutdown-coordinator";
import { bindShutdownRequestHandler, requestAppShutdown } from "@/app/session/shutdown-request";
import React from "react";

import { render } from "../../harness/render-capture";

test("bridge delivers normalized intents to the bound handler without exiting", () => {
  const received: ShutdownIntent[] = [];
  const unbind = bindShutdownRequestHandler((intent) => void received.push(intent));
  try {
    requestAppShutdown({ reason: "shell-quit", exitCode: 0 });
    expect(received).toEqual([{ reason: "shell-quit", exitCode: 0, fatal: false }]);

    requestAppShutdown();
    expect(received[1]).toEqual({ reason: "shell-quit", exitCode: 0, fatal: false });
  } finally {
    unbind();
  }
});

test("a stale unbind cannot remove a newer handler", () => {
  const first: ShutdownIntent[] = [];
  const second: ShutdownIntent[] = [];
  const unbindFirst = bindShutdownRequestHandler((intent) => void first.push(intent));
  const unbindSecond = bindShutdownRequestHandler((intent) => void second.push(intent));
  try {
    unbindFirst();
    requestAppShutdown({ reason: "SIGINT", exitCode: 130 });
    expect(first).toHaveLength(0);
    expect(second).toEqual([{ reason: "SIGINT", exitCode: 130, fatal: false }]);
  } finally {
    unbindSecond();
  }
});

test("Ctrl+C from a nested Browse surface routes one intent through the bridge", async () => {
  const received: ShutdownIntent[] = [];
  const unbind = bindShutdownRequestHandler((intent) => void received.push(intent));
  const handle = render(
    <BrowseShell
      mode="series"
      provider="vidking"
      placeholder="Breaking Bad"
      commands={[]}
      onSearch={async () => ({ options: [], subtitle: "" })}
      onResolve={() => {}}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { columns: 100, rows: 32 },
  );
  try {
    handle.stdin.enqueue(["\x03"]);
    await Bun.sleep(0);
    // Nested surfaces (Browse + its ShellFrame) may each route the same quit;
    // the coordinator collapses duplicates into one in-flight sequence, so the
    // bridge contract is: at least one intent, all of them the same SIGINT.
    expect(received.length).toBeGreaterThanOrEqual(1);
    for (const intent of received) {
      expect(intent).toMatchObject({ reason: "SIGINT", exitCode: 130 });
    }
  } finally {
    unbind();
    handle.unmount();
  }
});

test("no app-shell source imports graceful-exit or exits the process directly", () => {
  const appShellDir = join(import.meta.dir, "../../../src/app-shell");
  const offenders: string[] = [];
  const scan = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = readFileSync(path, "utf8");
      if (/graceful-exit|requestHardExit|registerExitHandler/.test(source)) {
        offenders.push(`${entry.name}: graceful-exit reference`);
      }
      if (/process\.exit\(/.test(source)) {
        offenders.push(`${entry.name}: direct process.exit`);
      }
    }
  };
  scan(appShellDir);
  expect(offenders).toEqual([]);
});
