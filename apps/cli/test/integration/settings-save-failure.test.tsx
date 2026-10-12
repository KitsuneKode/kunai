import { expect, spyOn, test } from "bun:test";

import { SettingsShell } from "@/app-shell/settings/SettingsShell";
import { disposeContainer } from "@/container/dispose-container";
import React, { act } from "react";

import { render } from "../harness/render-capture";
import { waitUntil } from "../support/wait-until";
import { createIsolatedContainer } from "./helpers/isolated-container";

test("a settings save failure is visible and recorded without enabling analytics", async () => {
  const { container, dispose } = await createIsolatedContainer("settings-save-failure");
  const save = spyOn(container.config, "save").mockRejectedValue(new Error("disk write refused"));
  const diagnostics = spyOn(container.diagnosticsService, "record");
  const handle = render(
    <SettingsShell
      container={container}
      width={100}
      maxRows={20}
      commandMode={false}
      initialSectionId="section:playback"
      onClose={() => {}}
      onStatus={() => {}}
      onRedraw={() => {}}
    />,
    { columns: 100, rows: 30 },
  );
  try {
    expect(handle.lastFrame()).toContain("Memory panel");
    handle.stdin.enqueue("\r");
    await waitUntil(
      () => handle.lastFrame().includes("Couldn't save settings: disk write refused"),
      {
        label: "settings save error rendered",
        tick: async (ms) => {
          await act(async () => {
            await Bun.sleep(ms);
          });
        },
      },
    );
    expect(save).toHaveBeenCalled();
    expect(
      diagnostics.mock.calls.some(
        ([event]) =>
          event.message === "Settings persist failed" &&
          event.context?.error === "disk write refused",
      ),
    ).toBe(true);
    expect(container.config.getRaw().analytics).toBe("unset");
    expect(container.config.getRaw().installId).toBe("");
  } finally {
    save.mockRestore();
    diagnostics.mockRestore();
    handle.unmount();
    await disposeContainer(container);
    dispose();
  }
});
