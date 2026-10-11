import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

import { launchMpv } from "@/mpv";

async function main() {
  const root = process.env.HOME;
  if (!root) throw new Error("isolated HOME required");
  const shim = join(root, "shim");
  mkdirSync(shim, { recursive: true, mode: 0o700 });
  const executable = join(shim, "mpv");
  const fake = join(import.meta.dir, "../helpers/fake-mpv-bin.ts");
  await Bun.write(executable, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
  chmodSync(executable, 0o700);
  process.env.PATH = shim + ":" + process.env.PATH;
  process.env.KUNAI_FAKE_MPV_EVIDENCE = join(root, "player-evidence.jsonl");
  let network = 0;
  globalThis.fetch = Object.assign(
    async () => {
      network++;
      return new Response("forbidden", { status: 403 });
    },
    { preconnect: () => {} },
  );
  const file = join(root, "owned.mp4");
  await Bun.write(file, "owned local fixture");
  const scenario = process.argv[2] ?? "local";
  try {
    const result = await launchMpv({
      url:
        scenario === "remote" || scenario === "remote-local-kind"
          ? "https://1.1.1.1/movie.mp4"
          : file,
      urlKind: scenario === "untrusted-file" || scenario === "remote" ? "remote" : "local",
      headers: {},
      subtitle: null,
      displayTitle: "Owned preflight fixture",
    });
    console.log("RESULT " + JSON.stringify({ result, network }));
  } catch (error) {
    console.log(
      "RESULT " +
        JSON.stringify({ network, error: error instanceof Error ? error.name : "unknown" }),
    );
  }
}

await main();
