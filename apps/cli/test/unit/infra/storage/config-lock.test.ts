import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { withConfigLockTransition, type ConfigLockOptions } from "@/infra/storage/config-lock";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

async function makeRoot(): Promise<{ root: string; lockPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "kunai-config-lock-"));
  roots.push(root);
  return { root, lockPath: join(root, "config.json.lock") };
}

/** A live local contender: this test process's pid, so it is never reclaimed as dead. */
async function plantContender(lockPath: string, ticket: number, pid = process.pid) {
  const path = `${lockPath}.ticket-contender`;
  await writeFile(
    path,
    JSON.stringify({ pid, hostname: hostname(), ownerId: "contender", ticket: 0 }),
  );
  if (ticket > 0) await writeFile(`${path}.number`, JSON.stringify(ticket));
  return path;
}

function fakeClock() {
  let clock = 1_000;
  const options = {
    now: () => clock,
    wait: async (milliseconds: number) => {
      clock += milliseconds;
    },
  } satisfies ConfigLockOptions;
  return { options, advance: (ms: number) => (clock += ms), now: () => clock };
}

async function realText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("withConfigLockTransition ticket read errors", () => {
  test("a delete-pending-style refusal on Windows is not treated as a vanished contender", async () => {
    const { lockPath } = await makeRoot();
    const contender = await plantContender(lockPath, 1);
    const clock = fakeClock();
    let entered = false;
    await expect(
      withConfigLockTransition(
        lockPath,
        clock.now() + 200,
        {
          ...clock.options,
          platform: "win32",
          readText: async (path) => {
            if (path.startsWith(contender)) throw errno("EPERM");
            return realText(path);
          },
        },
        async () => {
          entered = true;
        },
      ),
    ).rejects.toThrow("config lock timed out");
    expect(entered).toBe(false);
  });

  test("the max(ticket) read waits for an unreadable record instead of skipping its number", async () => {
    const { root, lockPath } = await makeRoot();
    const contender = await plantContender(lockPath, 5);
    let waits = 0;
    let failures = 0;
    let ownTicket: number | undefined;
    await withConfigLockTransition(
      lockPath,
      Date.now() + 30_000,
      {
        platform: "win32",
        wait: async () => {
          waits += 1;
          // The contender leaves its transition once we are queued behind it.
          if (waits >= 3) {
            await unlink(`${contender}.number`).catch(() => {});
            await unlink(contender).catch(() => {});
          }
        },
        readText: async (path) => {
          if (path.startsWith(contender) && failures < 2) {
            failures += 1;
            throw errno(failures === 1 ? "EPERM" : "EACCES");
          }
          return realText(path);
        },
      },
      async () => {
        const own = (await readdir(root)).find(
          (name) => name.endsWith(".number") && !name.includes("contender"),
        );
        // SAFETY: the lock writes its .number record as a bare JSON integer.
        ownTicket = JSON.parse(await readFile(join(root, own!), "utf8")) as number;
      },
    );
    expect(failures).toBe(2);
    // Had the unreadable record been skipped, we would have drawn ticket 1.
    expect(ownTicket).toBe(6);
    expect(await readdir(root)).toEqual([]);
  });

  test("a record that is readable again proceeds once the contender has left", async () => {
    const { root, lockPath } = await makeRoot();
    const contender = await plantContender(lockPath, 1);
    let reads = 0;
    let ran = false;
    await withConfigLockTransition(
      lockPath,
      Date.now() + 30_000,
      {
        platform: "win32",
        wait: async () => {},
        readText: async (path) => {
          if (path.startsWith(contender)) {
            reads += 1;
            // Owner finished unlinking: the open now reports a plain ENOENT.
            if (reads === 1) throw errno("EBUSY");
            throw errno("ENOENT");
          }
          return realText(path);
        },
      },
      async () => {
        ran = true;
      },
    );
    expect(ran).toBe(true);
    await unlink(contender).catch(() => {});
    await unlink(`${contender}.number`).catch(() => {});
    expect(await readdir(root)).toEqual([]);
  });

  test("the same errors are real failures off Windows", async () => {
    const { lockPath } = await makeRoot();
    const contender = await plantContender(lockPath, 1);
    await expect(
      withConfigLockTransition(
        lockPath,
        Date.now() + 30_000,
        {
          platform: "linux",
          wait: async () => {},
          readText: async (path) => {
            if (path.startsWith(contender)) throw errno("EACCES");
            return realText(path);
          },
        },
        async () => {},
      ),
    ).rejects.toThrow("EACCES");
  });
});

describe("withConfigLockTransition removal errors", () => {
  test("a dead owner another reclaimer is already deleting does not fail the transition on Windows", async () => {
    const { lockPath } = await makeRoot();
    await plantContender(lockPath, 3, 999_999_999);
    const unlinkFile = async (path: string) => {
      if (path.includes("ticket-contender") && !path.endsWith(".number")) throw errno("EPERM");
      await unlink(path);
    };
    let ran = false;
    await withConfigLockTransition(
      lockPath,
      Date.now() + 30_000,
      { platform: "win32", unlinkFile, wait: async () => {} },
      async () => {
        ran = true;
      },
    );
    expect(ran).toBe(true);
  });

  test("the same refusal is surfaced off Windows", async () => {
    const { lockPath } = await makeRoot();
    await plantContender(lockPath, 3, 999_999_999);
    await expect(
      withConfigLockTransition(
        lockPath,
        Date.now() + 30_000,
        {
          platform: "linux",
          wait: async () => {},
          unlinkFile: async (path) => {
            if (path.includes("ticket-contender") && !path.endsWith(".number"))
              throw errno("EPERM");
            await unlink(path);
          },
        },
        async () => {},
      ),
    ).rejects.toThrow("EPERM");
  });

  test("an owner retries its own ticket removal while a reader holds it, then leaves nothing behind", async () => {
    const { root, lockPath } = await makeRoot();
    let refusals = 0;
    let waits = 0;
    await withConfigLockTransition(
      lockPath,
      Date.now() + 30_000,
      {
        platform: "win32",
        wait: async () => {
          waits += 1;
        },
        unlinkFile: async (path) => {
          if (!path.endsWith(".number") && refusals < 3) {
            refusals += 1;
            throw errno("EBUSY");
          }
          await unlink(path);
        },
      },
      async () => {},
    );
    expect(refusals).toBe(3);
    expect(waits).toBe(3);
    expect(await readdir(root)).toEqual([]);
  });

  test("a ticket that can never be removed is reported, not leaked silently", async () => {
    const { lockPath } = await makeRoot();
    await expect(
      withConfigLockTransition(
        lockPath,
        Date.now() + 30_000,
        {
          platform: "win32",
          wait: async () => {},
          unlinkFile: async () => {
            throw errno("EPERM");
          },
        },
        async () => {},
      ),
    ).rejects.toThrow("EPERM");
  });
});
