import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { describePosixOnly as describe } from "../helpers/platform-gates";

// A signal must not strand her in the terminal. The process uploads the real
// `seek` strip, is interrupted, and the last thing it writes has to be the
// delete for exactly the id it uploaded.

const fixture = resolve(import.meta.dir, "fixtures/kanna-sprite-signal.ts");

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    const end = text.indexOf("\n");
    if (end !== -1) return text.slice(0, end);
  }
  return text;
}

describe("kanna sprite on a signal", () => {
  test("SIGINT deletes every uploaded id before the process exits", async () => {
    const child = Bun.spawn([process.execPath, fixture], {
      cwd: resolve(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, KUNAI_REDUCED_MOTION: "" },
    });
    const stdout = new Response(child.stdout).text();
    const ready = await firstLine(child.stderr);
    expect(ready).toMatch(/^ready \d+$/u);
    const id = ready.split(" ")[1];

    child.kill("SIGINT");
    expect(await child.exited).toBe(130);

    const out = await stdout;
    // Uploaded as a loop: transmit, virtual placement, frames, run.
    expect(out).toContain(`a=t,f=32,s=92,v=92,i=${id},q=2,o=z,t=d,`);
    expect(out).toContain(`\x1b_Ga=p,U=1,i=${id},c=9,r=4,z=-1,q=2;\x1b\\`);
    expect(out).toContain(`\x1b_Ga=a,i=${id},s=3,v=1,q=2;\x1b\\`);
    expect(out.endsWith(`\x1b_Ga=d,d=I,i=${id},q=2;\x1b\\`)).toBe(true);
  });
});
