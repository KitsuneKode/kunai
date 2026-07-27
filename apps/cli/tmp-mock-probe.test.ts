import { expect, mock, test } from "bun:test";

mock.module("@/infra/clipboard", () => ({
  copyToClipboard: mock(async () => true),
}));

const clipboard = await import("@/infra/clipboard");

test("probe mocked clipboard exports", async () => {
  console.log("keys", Object.keys(clipboard));
  console.log("readClipboard type", typeof clipboard.readClipboard);
  const writes: string[] = [];
  const result = await clipboard.copyToClipboard("hello\n", {
    platform: "win32",
    env: {},
    spawn() {
      console.log("SPAWN");
      return {
        exited: Promise.resolve(0),
        stdin: {
          write(text: string) {
            writes.push(text);
          },
          end() {},
        },
      };
    },
  });
  console.log("result", result, "writes", writes);
  expect(result).toBe(true);
});
