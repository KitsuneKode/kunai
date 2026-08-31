import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIST_IOS = join(import.meta.dir, "../../dist/ios");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function launcherFixture(fakeJsc: string) {
  const directory = await mkdtemp(join(tmpdir(), "kunai-mobile-launcher-"));
  temporaryDirectories.push(directory);
  const binaryDirectory = join(directory, "bin");
  await mkdir(binaryDirectory);
  const launcher = join(directory, "kunai-mobile");
  await Bun.write(launcher, Bun.file(join(DIST_IOS, "kunai-mobile")));
  await Bun.write(join(directory, "kunai-mobile-ios.js"), "void 0;\n");
  await Bun.write(join(binaryDirectory, "jsc"), fakeJsc);
  await chmod(launcher, 0o755);
  await chmod(join(binaryDirectory, "jsc"), 0o755);
  return { directory, launcher, binaryDirectory };
}

describe("a-Shell launcher", () => {
  test("returns the validated status written by JavaScript", async () => {
    for (const expected of [0, 1, 2]) {
      const fixture = await launcherFixture(
        `#!/bin/sh\nprintf '%s' '${expected}' > .runtime/exit-code\n`,
      );
      const child = Bun.spawn([fixture.launcher, "--help"], {
        cwd: fixture.directory,
        env: { ...process.env, PATH: `${fixture.binaryDirectory}:${process.env.PATH ?? ""}` },
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await child.exited).toBe(expected);
      expect(await Bun.file(join(fixture.directory, ".runtime/exit-code")).exists()).toBe(false);
    }
  });

  test("fails closed when jsc writes no status or a malformed status", async () => {
    for (const fakeJsc of ["#!/bin/sh\nexit 0\n", "#!/bin/sh\nprintf bad > .runtime/exit-code\n"]) {
      const fixture = await launcherFixture(fakeJsc);
      const child = Bun.spawn([fixture.launcher], {
        cwd: fixture.directory,
        env: { ...process.env, PATH: `${fixture.binaryDirectory}:${process.env.PATH ?? ""}` },
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await child.exited).toBe(1);
    }
  });
});
