import { describe, expect, test } from "bun:test";

import { copyToClipboard, readClipboard, type ClipboardRuntime } from "@/infra/clipboard";

describe("clipboard", () => {
  test("Windows sends exact copy text through PowerShell and reads raw clipboard text", async () => {
    const commands: string[][] = [];
    let copiedText = "";
    const runtime: ClipboardRuntime = {
      platform: "win32" as NodeJS.Platform,
      env: {},
      spawn(command: readonly string[]) {
        commands.push([...command]);
        return {
          exitCode: 0,
          exited: Promise.resolve(0),
          stdin: {
            write(text: string) {
              copiedText = text;
            },
            end() {},
          },
          stdout: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("日本語 • café 🦊"));
              controller.close();
            },
          }),
        };
      },
    };
    const copied = "日本語 • café 🦊\n";

    expect(await copyToClipboard(copied, runtime)).toBe(true);
    expect(await readClipboard(runtime)).toBe("日本語 • café 🦊");
    expect(copiedText).toBe(copied);
    expect(commands).toEqual([
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())",
      ],
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [Console]::Out.Write((Get-Clipboard -Raw))",
      ],
    ]);
  });
});
