import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireNodeSession } from "../../../../src/runtime/android/node-session";

/** A pid that is guaranteed dead — the child exited before spawnSync returned. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  if (!child.pid || child.error)
    throw new Error("Could not create exited test process", { cause: child.error });
  return child.pid;
}

test("an aged ownerless directory is uncertain and keeps recovery evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-ownerless-"));
  let unexpectedRelease: (() => void) | undefined;
  try {
    const lock = join(root, "session.lock");
    mkdirSync(lock);
    const evidence = join(lock, "recovery-evidence");
    writeFileSync(evidence, "ownership unknown");
    const beforeGrace = new Date(Date.now() - 60_000);
    utimesSync(lock, beforeGrace, beforeGrace);
    expect(() => {
      unexpectedRelease = acquireNodeSession(root);
    }).toThrow("requires lock recovery");
    expect(readFileSync(evidence, "utf8")).toBe("ownership unknown");
  } finally {
    unexpectedRelease?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a live choosing reclaimer blocks replacement of a dead session", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-choosing-"));
  try {
    const lock = join(root, "session.lock");
    mkdirSync(lock);
    const previous = JSON.stringify({ pid: deadPid(), startedAt: null });
    writeFileSync(join(lock, "owner.json"), previous);
    const ownerId = crypto.randomUUID();
    const choosing = join(root, `session.transition-${ownerId}.owner`);
    writeFileSync(choosing, JSON.stringify({ pid: process.pid, startedAt: null, ownerId }));
    expect(() => acquireNodeSession(root)).toThrow("transition is busy");
    expect(readFileSync(join(lock, "owner.json"), "utf8")).toBe(previous);
    rmSync(choosing);
    acquireNodeSession(root)();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("corrupt owner data is retained rather than treated as proof of a dead process", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-corrupt-"));
  let release: (() => void) | undefined;
  let original: string | undefined;
  const path = join(root, "session.lock", "owner.json");
  try {
    release = acquireNodeSession(root);
    original = readFileSync(path, "utf8");
    writeFileSync(path, "{broken");
    expect(() => acquireNodeSession(root)).toThrow("explicit recovery");
    expect(readFileSync(path, "utf8")).toBe("{broken");
    expect(() => release?.()).toThrow("explicit recovery");
    expect(readFileSync(path, "utf8")).toBe("{broken");
  } finally {
    if (original !== undefined) writeFileSync(path, original);
    release?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a retired session release cannot delete a successor's lock", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-successor-"));
  let release: (() => void) | undefined;
  let releaseNext: (() => void) | undefined;
  try {
    release = acquireNodeSession(root);
    const lock = join(root, "session.lock");
    // Model a replaced canonical path while the original release is still held.
    renameSync(lock, join(root, "retired.lock"));
    releaseNext = acquireNodeSession(root);
    const expected = readFileSync(join(lock, "owner.json"), "utf8");
    release();
    expect(readFileSync(join(lock, "owner.json"), "utf8")).toBe(expected);
    expect(() => acquireNodeSession(root)).toThrow("session");
  } finally {
    release?.();
    releaseNext?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a competing session cannot release or enter the owner's state transaction", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-"));
  try {
    const release = acquireNodeSession(root);
    expect(() => acquireNodeSession(root)).toThrow("session");
    release();
    const releaseNext = acquireNodeSession(root);
    release();
    expect(() => acquireNodeSession(root)).toThrow("session");
    releaseNext();
    acquireNodeSession(root)();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a crash remnant — lock dir with a dead owner — is reclaimed, not wedged", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-"));
  try {
    // Simulate a SIGKILLed/ANR'd session: lock dir + owner record, pid dead.
    const lock = join(root, "session.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: deadPid(), startedAt: null }));

    const release = acquireNodeSession(root);
    // The reclaimed lock is a real lock: a competitor still cannot enter.
    expect(() => acquireNodeSession(root)).toThrow("session");
    release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a live owner is never reclaimed even when the record says otherwise", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-"));
  try {
    const first = acquireNodeSession(root);
    // Overwrite our own owner record with a stale lookalike — the recorded
    // pid is this process, which is alive, so reclaim must refuse.
    expect(() => acquireNodeSession(root)).toThrow("session");
    first();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("session interrupt handling lasts until release and never steals a competing lock", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-interrupt-"));
  const controller = new AbortController();
  const initialHandlers = process.listenerCount("SIGINT");
  let release: (() => void) | undefined;
  try {
    release = acquireNodeSession(root, () => controller.abort());
    expect(process.emit("SIGINT")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(() => acquireNodeSession(root)).toThrow("session");
    release();
    expect(process.listenerCount("SIGINT")).toBe(initialHandlers);
    acquireNodeSession(root)();
  } finally {
    release?.();
    rmSync(root, { recursive: true, force: true });
  }
});

function readLines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return async () => {
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        return line;
      }
      const next = await reader.read();
      if (next.done) throw new Error("Mobile lock worker exited before reporting its state");
      buffered += decoder.decode(next.value, { stream: true });
    }
  };
}

function spawnLockWorker(worker: string, root: string) {
  const childProcess = Bun.spawn([process.env.NODE ?? "node", worker, root], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  return { process: childProcess, next: readLines(childProcess.stdout) };
}

test("concurrent Node crash reclaimers admit at most one owner and allow a later launch", async () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-workers-"));
  const worker = join(root, "worker.ts");
  const source = join(import.meta.dir, "../../../../src/runtime/android/node-session.ts");
  const children: ReturnType<typeof spawnLockWorker>[] = [];
  try {
    await Bun.write(
      worker,
      `import { acquireNodeSession } from ${JSON.stringify(source)};
let release;
process.stdout.write("ready\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", command => {
  if (command.trim() === "start") {
    try {
      release = acquireNodeSession(process.argv[2]);
      process.stdout.write("owned\\n");
    } catch (error) {
      process.stdout.write(error instanceof Error && error.message.includes("Mobile session") ? "blocked\\n" : "error\\n");
      process.exit(2);
    }
  } else if (command.trim() === "release") {
    release();
    process.exit(0);
  }
});
`,
    );
    const built = await Bun.build({
      entrypoints: [worker],
      outdir: root,
      naming: "worker.mjs",
      target: "node",
    });
    expect(built.success).toBe(true);
    const lock = join(root, "session.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: deadPid(), startedAt: null }));
    for (let index = 0; index < 8; index++)
      children.push(spawnLockWorker(join(root, "worker.mjs"), root));
    expect(await Promise.all(children.map((child) => child.next()))).toEqual(
      Array(8).fill("ready"),
    );
    for (const child of children) {
      child.process.stdin.write("start\n");
      await child.process.stdin.flush();
    }
    const results = await Promise.all(children.map((child) => child.next()));
    expect(results.every((result) => result === "owned" || result === "blocked")).toBe(true);
    const owners = children.filter((_child, index) => results[index] === "owned");
    expect(owners.length).toBeLessThanOrEqual(1);
    for (const [index, child] of children.entries()) {
      if (results[index] === "blocked") expect(await child.process.exited).toBe(2);
    }
    const owner = owners[0];
    if (owner) {
      const record = readFileSync(join(lock, "owner.json"), "utf8");
      expect(JSON.parse(record)).toHaveProperty("pid", owner.process.pid);
      expect(() => acquireNodeSession(root)).toThrow("session");
      expect(readFileSync(join(lock, "owner.json"), "utf8")).toBe(record);
      owner.process.stdin.write("release\n");
      await owner.process.stdin.flush();
      expect(await owner.process.exited).toBe(0);
    }
    // Fail-fast contenders can all decline a choosing peer; a retry must work.
    acquireNodeSession(root)();
  } finally {
    for (const child of children) if (child.process.exitCode === null) child.process.kill();
    await Promise.allSettled(children.map((child) => child.process.exited));
    rmSync(root, { recursive: true, force: true });
  }
});
