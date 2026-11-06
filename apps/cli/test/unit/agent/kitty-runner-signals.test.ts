import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { waitForKittyCondition } from "../../agent/kitty-session";
import { storageRootEnv } from "../../helpers/storage-env";

// Protocol fixture only: these checks launch no desktop window or media player.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  for (const phase of ["startup", "active", "undiscovered"] as const) {
    test.skipIf(process.platform === "win32")(
      `Kitty runner ${signal} during ${phase} records cleanup before exiting`,
      async () => {
        const scratch = mkdtempSync(join(tmpdir(), "kunai-kitty-signal-test-"));
        const bin = join(scratch, "bin");
        mkdirSync(bin);
        const launchFile = join(scratch, "launch.json");
        const readMarker = join(scratch, "reading");
        const executable = join(bin, "kitty");
        await Bun.write(
          executable,
          `#!${process.execPath}
const args=process.argv.slice(2);
const file=${JSON.stringify(launchFile)};
if(args[0]==='@') {
  const launch=await Bun.file(file).json();
  if(args.includes('ls')) console.log(JSON.stringify(${phase === "active"} ? [{tabs:[{windows:[{id:1,pid:launch.applicationPid}]}]}] : []));
  else if(args.includes('get-text')) { await Bun.write(${JSON.stringify(readMarker)},'1');console.log('Search title'); }
} else {
  const childProgram = "process.stdout.write('ready');const timer=setInterval(()=>{},1000);process.on('SIGTERM',()=>{clearInterval(timer);process.exit(0)});process.on('SIGHUP',()=>{});";
  const command=args.slice(args.indexOf('/usr/bin/env')+1);
  command.splice(-2,2,process.execPath,'-e',childProgram);
  const child=Bun.spawn(${phase === "undiscovered"} ? [process.execPath,'-e',childProgram] : ['/usr/bin/env',...command],{stdout:'pipe',stderr:'ignore',stdin:'ignore'});
  await child.stdout.getReader().read();
  await Bun.write(file,JSON.stringify({pid:process.pid,applicationPid:child.pid,profileRoot:process.cwd()}));
  const timer=setInterval(()=>{},1000);
  for(const signal of ['SIGINT','SIGTERM','SIGHUP']) process.on(signal,()=>{clearInterval(timer);process.exit(0)});
}
`,
        );
        chmodSync(executable, 0o755);
        const recipe = join(scratch, "recipe.json");
        await Bun.write(
          recipe,
          JSON.stringify({ steps: [{ type: "expect", value: "not returned by fixture" }] }),
        );
        const evidence = join(scratch, "evidence");
        const runner = Bun.spawn(
          [
            process.execPath,
            "run",
            "test/agent/kitty.ts",
            "--scenario",
            recipe,
            "--evidence",
            evidence,
          ],
          {
            cwd: resolve(import.meta.dir, "../../.."),
            env: {
              ...process.env,
              ...storageRootEnv(scratch),
              PATH: `${bin}:${process.env.PATH ?? ""}`,
              DISPLAY: "kunai-fixture:0",
              WAYLAND_DISPLAY: "",
            },
            stdin: "ignore",
            stdout: "ignore",
            stderr: Bun.file(join(scratch, "runner.log")),
          },
        );
        let launch: { pid: number; applicationPid: number; profileRoot: string } | undefined;
        try {
          const started: { pid: number; applicationPid: number; profileRoot: string } =
            await waitForKittyCondition(async () =>
              Bun.file(launchFile)
                .json()
                .catch(() => null),
            );
          launch = started;
          if (phase === "active")
            await waitForKittyCondition(async () =>
              (await Bun.file(readMarker).exists()) ? true : null,
            );
          runner.kill(signal);
          await runner.exited;
          const cleanup = await Bun.file(join(evidence, "scenario", "cleanup.json")).json();
          expect(cleanup).toMatchObject({
            privateStateClean: true,
            childrenExited: phase !== "undiscovered",
            profileRetained: phase === "undiscovered",
          });
          expect(await Bun.file(join(evidence, "results.json")).exists()).toBe(true);
          expect(existsSync(started.profileRoot)).toBe(phase === "undiscovered");
          expect(() => process.kill(started.pid, 0)).toThrow();
          if (phase === "undiscovered") {
            expect(() => process.kill(started.applicationPid, 0)).not.toThrow();
          } else {
            expect(() => process.kill(started.applicationPid, 0)).toThrow();
          }
        } finally {
          if (runner.exitCode === null) runner.kill();
          await runner.exited;
          if (launch) {
            try {
              process.kill(launch.applicationPid, "SIGKILL");
            } catch {
              /* Owned fixture child already exited. */
            }
            try {
              process.kill(launch.pid, "SIGKILL");
            } catch {
              /* Owned fixture already exited. */
            }
            rmSync(launch.profileRoot, { recursive: true, force: true });
          }
          rmSync(scratch, { recursive: true, force: true });
        }
      },
    );
  }
}
