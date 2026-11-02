import { expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startKittySession } from "../../agent/kitty-session";

test.skipIf(process.platform === "win32")(
  "Kitty spawn failure removes the profile created before launch",
  async () => {
    const scratch = mkdtempSync(join(tmpdir(), "kunai-kitty-startup-test-"));
    const priorDisplay = process.env.DISPLAY;
    process.env.DISPLAY = "kunai-fixture:0";
    const which = spyOn(Bun, "which").mockImplementation((name) =>
      name === "mpv" ? null : process.execPath,
    );
    let profileRoot: string | undefined;
    const spawn = spyOn(Bun, "spawn").mockImplementation(
      (
        command: readonly string[] | { readonly cwd?: string | URL },
        options?: { readonly cwd?: string | URL },
      ) => {
        const cwd = options?.cwd ?? ("cwd" in command ? command.cwd : undefined);
        profileRoot = cwd === undefined ? undefined : String(cwd);
        throw new Error("Injected terminal spawn failure");
      },
    );
    try {
      await expect(
        startKittySession({ evidenceDir: join(scratch, "evidence"), fixture: true }),
      ).rejects.toThrow("Injected terminal spawn failure");
      expect(profileRoot).toBeDefined();
      expect(existsSync(profileRoot!)).toBe(false);
    } finally {
      spawn.mockRestore();
      which.mockRestore();
      if (priorDisplay === undefined) delete process.env.DISPLAY;
      else process.env.DISPLAY = priorDisplay;
      if (profileRoot) rmSync(profileRoot, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "real mpv wrapper never enables a shared player log",
  async () => {
    const scratch = mkdtempSync(join(tmpdir(), "kunai-kitty-log-test-"));
    const display = process.env.DISPLAY;
    process.env.DISPLAY = "kunai-fixture:0";
    const which = spyOn(Bun, "which").mockReturnValue(process.execPath);
    let wrapper = "";
    const spawn = spyOn(Bun, "spawn").mockImplementation(
      (
        command: readonly string[] | { readonly cwd?: string | URL },
        options?: { readonly cwd?: string | URL },
      ) => {
        const cwd = options?.cwd ?? ("cwd" in command ? command.cwd : undefined);
        wrapper = readFileSync(join(String(cwd), "bin", "mpv"), "utf8");
        throw new Error("Injected terminal refusal");
      },
    );
    try {
      await expect(
        startKittySession({ evidenceDir: join(scratch, "evidence"), fixture: true }),
      ).rejects.toThrow("Injected terminal refusal");
      expect(wrapper).toContain("--mute=yes");
      expect(wrapper).not.toContain("--log-file");
    } finally {
      spawn.mockRestore();
      which.mockRestore();
      if (display === undefined) delete process.env.DISPLAY;
      else process.env.DISPLAY = display;
      rmSync(scratch, { recursive: true, force: true });
    }
  },
);
