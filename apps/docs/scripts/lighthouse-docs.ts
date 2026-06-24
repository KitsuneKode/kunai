#!/usr/bin/env bun
/**
 * Local Lighthouse audit for the docs site (not run in CI).
 * Usage: bun run --cwd apps/docs lighthouse:docs
 */
import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const DOCS = path.join(ROOT, "apps/docs");
const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function main() {
  console.log("Building docs...");
  await run("bun", ["run", "build"], DOCS, { DOCS_SITE_URL: BASE });

  console.log(`Starting Next.js on ${BASE}...`);
  const server = spawn("bun", ["run", "start", "--", "-p", String(PORT)], {
    cwd: DOCS,
    env: { ...process.env, DOCS_SITE_URL: BASE },
    stdio: "pipe",
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server start timeout")), 60_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.on("error", reject);
  });

  try {
    console.log("Running Lighthouse CI...");
    await run("bunx", ["@lhci/cli", "autorun", "--config=lighthouserc.json"], DOCS, {
      DOCS_SITE_URL: BASE,
    });
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
