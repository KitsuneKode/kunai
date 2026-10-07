import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("three processes recover one dead config owner and preserve every merged write", async () => {
  const root = await mkdtemp(join(tmpdir(), "kunai-config-processes-"));
  const path = join(root, "config.json");
  const source = fileURLToPath(new URL("../../src/infra/storage/FileStorage.ts", import.meta.url));
  const ready = [
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
  ];
  const script = `
    import { FileStorage } from ${JSON.stringify(source)};
    const storage = new FileStorage({ config: ${JSON.stringify(path)} });
    const begin = Promise.withResolvers();
    process.on("message", (message) => { if (message === "begin") begin.resolve(); });
    process.send("ready");
    await begin.promise;
    for (let index = 0; index < 5; index++) {
      await storage.withLock("config", async () => {
        const state = await storage.read("config");
        await storage.write("config", { count: state.count + 1 });
      });
    }
    process.disconnect();
  `;
  const children: ReturnType<typeof Bun.spawn>[] = [];
  try {
    await writeFile(path, JSON.stringify({ count: 0 }));
    await writeFile(`${path}.lock`, "999999999");
    for (const barrier of ready) {
      const child = Bun.spawn({
        cmd: [process.execPath, "--eval", script],
        stdout: "ignore",
        stderr: "pipe",
        ipc: (message) => {
          if (message === "ready") barrier.resolve();
        },
      });
      children.push(child);
      // Startup failure rejects the barrier rather than hanging the parent.
      void child.exited.then((code) => {
        if (code !== 0) barrier.reject(new Error("Lock worker failed"));
      });
    }
    await Promise.all(ready.map((barrier) => barrier.promise));
    for (const child of children) child.send("begin");
    expect(await Promise.all(children.map((child) => child.exited))).toEqual([0, 0, 0]);
    expect(await Bun.file(path).json()).toEqual({ count: 15 });
    expect(await readdir(root)).toEqual(["config.json"]);
  } finally {
    for (const child of children) {
      if (child.exitCode === null) child.kill();
    }
    await Promise.all(children.map((child) => child.exited));
    await rm(root, { recursive: true, force: true });
  }
});
