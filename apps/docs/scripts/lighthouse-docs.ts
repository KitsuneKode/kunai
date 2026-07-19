#!/usr/bin/env bun
/**
 * Local Lighthouse audit for the docs site (not run in CI).
 * Usage: bun run --cwd apps/docs lighthouse:docs
 */
import path from "node:path";

const DOCS = path.resolve(import.meta.dir, "..");
const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;
const BUN = Bun.which("bun") ?? process.execPath;

async function run(cmd: string[], cwd: string, env?: Record<string, string>) {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${cmd.join(" ")} exited with code ${code}`);
  }
}

async function main() {
  console.log("Building docs...");
  await run([BUN, "run", "build"], DOCS, { DOCS_SITE_URL: BASE });

  console.log(`Starting Next.js on ${BASE}...`);
  const server = Bun.spawn([BUN, "run", "start", "--", "-p", String(PORT)], {
    cwd: DOCS,
    env: { ...process.env, DOCS_SITE_URL: BASE },
    stdout: "pipe",
    stderr: "pipe",
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server start timeout")), 60_000);
    const decoder = new TextDecoder();
    const onChunk = async (stream: ReadableStream<Uint8Array> | null) => {
      if (!stream) return;
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        process.stdout.write(text);
        if (text.includes("Ready")) {
          clearTimeout(timeout);
          resolve();
          return;
        }
      }
    };
    void Promise.all([onChunk(server.stdout), onChunk(server.stderr)]).catch(reject);
    void server.exited.then((code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited early with code ${code}`));
        return;
      }
      return undefined;
    });
  });

  try {
    console.log("Running Lighthouse CI...");
    await run([BUN, "x", "@lhci/cli", "autorun", "--config=lighthouserc.json"], DOCS, {
      DOCS_SITE_URL: BASE,
    });
  } finally {
    server.kill();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
