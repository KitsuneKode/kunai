/**
 * Self-contained fake mpv for compiled-binary smokes.
 * Invoked as `bun <this-file> ...` via a PATH shim.
 *
 * Env:
 * - KUNAI_FAKE_MPV_EVIDENCE: absolute JSONL path
 * - KUNAI_FAKE_MPV_MODE: normal | fail-pre-loaded | hold
 */
import { appendFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

type Mode = "normal" | "fail-pre-loaded" | "hold";

function modeFromEnv(): Mode {
  const raw = process.env.KUNAI_FAKE_MPV_MODE?.trim();
  if (raw === "fail-pre-loaded" || raw === "hold") return raw;
  return "normal";
}

function evidencePath(): string | null {
  const path = process.env.KUNAI_FAKE_MPV_EVIDENCE?.trim();
  return path || null;
}

function appendEvidence(entry: Record<string, unknown>): void {
  const path = evidencePath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ ts: Date.now(), pid: process.pid, ...entry })}\n`);
}

function parseSocketPath(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith("--input-ipc-server=")) {
      return arg.slice("--input-ipc-server=".length) || null;
    }
  }
  return null;
}

function reply(
  sock: { write: (data: string) => number | void },
  requestId: number | undefined,
  data?: unknown,
): void {
  const payload =
    data === undefined
      ? { request_id: requestId, error: "success" }
      : { request_id: requestId, error: "success", data };
  sock.write(`${JSON.stringify(payload)}\n`);
}

function emit(sock: { write: (data: string) => number | void }, event: Record<string, unknown>) {
  sock.write(`${JSON.stringify(event)}\n`);
}

async function runPlaybackLifecycle(
  sock: { write: (data: string) => number | void },
  mode: Mode,
  url: string | null,
): Promise<"continue" | "quit"> {
  appendEvidence({ type: "lifecycle-start", mode, url });

  if (mode === "fail-pre-loaded") {
    await Bun.sleep(30);
    emit(sock, { event: "end-file", reason: "error", file_error: "smoke-pre-loaded-failure" });
    appendEvidence({ type: "end-file", reason: "error", beforeFileLoaded: true });
    return "continue";
  }

  await Bun.sleep(20);
  emit(sock, { event: "file-loaded" });
  appendEvidence({ type: "file-loaded", url });
  emit(sock, { event: "property-change", name: "duration", data: 600 });
  emit(sock, { event: "property-change", name: "time-pos", data: 12 });
  appendEvidence({ type: "playback-properties", duration: 600, timePos: 12 });

  if (mode === "hold") {
    appendEvidence({ type: "hold" });
    return "continue";
  }

  await Bun.sleep(40);
  emit(sock, { event: "end-file", reason: "eof" });
  appendEvidence({ type: "end-file", reason: "eof" });
  return "continue";
}

async function serveIpc(socketPath: string, mode: Mode, initialUrl: string | null): Promise<void> {
  try {
    unlinkSync(socketPath);
  } catch {
    // absent is fine
  }

  let activeSocket: { write: (data: string) => number | void; end: () => void } | null = null;
  let buffer = "";
  let currentUrl = initialUrl;
  let lifecycleStarted = false;
  let quitRequested = false;

  const server = Bun.listen({
    unix: socketPath,
    socket: {
      open(sock) {
        activeSocket = sock;
        appendEvidence({ type: "ipc-accepted", socketPath });
      },
      async data(sock, data) {
        buffer += data.toString();
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
          if (!line) continue;
          let parsed: { command?: unknown[]; request_id?: number };
          try {
            parsed = JSON.parse(line) as { command?: unknown[]; request_id?: number };
          } catch {
            continue;
          }
          const command = Array.isArray(parsed.command) ? parsed.command : [];
          const name = typeof command[0] === "string" ? command[0] : "";
          appendEvidence({
            type: "ipc-command",
            command: name,
            argv: command,
            requestId: parsed.request_id,
          });

          if (name === "observe_property") {
            reply(sock, parsed.request_id);
            continue;
          }
          if (name === "get_property") {
            const prop = typeof command[1] === "string" ? command[1] : "";
            const dataValue =
              prop === "duration"
                ? 600
                : prop === "playback-time" || prop === "time-pos"
                  ? 0
                  : null;
            reply(sock, parsed.request_id, dataValue);
            continue;
          }
          if (name === "loadfile") {
            currentUrl = typeof command[1] === "string" ? command[1] : null;
            reply(sock, parsed.request_id);
            appendEvidence({ type: "loadfile", url: currentUrl });
            void runPlaybackLifecycle(sock, mode, currentUrl);
            continue;
          }
          if (name === "quit" || name === "quit-watch-later") {
            reply(sock, parsed.request_id);
            appendEvidence({ type: "quit" });
            quitRequested = true;
            sock.end();
            continue;
          }
          reply(sock, parsed.request_id);
        }

        if (!lifecycleStarted && activeSocket) {
          lifecycleStarted = true;
          void runPlaybackLifecycle(activeSocket, mode, currentUrl).then(() => {
            if (mode === "normal") {
              // stay alive until quit so persistent sessions can loadfile
            }
          });
        }
      },
      close() {
        appendEvidence({ type: "ipc-closed" });
      },
      error() {
        appendEvidence({ type: "ipc-error" });
      },
    },
  });

  appendEvidence({ type: "ipc-listen", socketPath, mode });

  while (!quitRequested) {
    await Bun.sleep(50);
    if (mode === "fail-pre-loaded" && lifecycleStarted) {
      await Bun.sleep(100);
      break;
    }
  }

  server.stop(true);
  try {
    unlinkSync(socketPath);
  } catch {
    // ignore
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  appendEvidence({ type: "spawn", argv });

  if (argv[0] === "--version" || argv.includes("--version")) {
    process.stdout.write("mpv 0.37.0-kunai-compiled-smoke Copyright © smoke harness\n");
    process.exit(0);
  }

  const socketPath = parseSocketPath(argv);
  const mode = modeFromEnv();
  const initialUrl =
    argv.find((arg) => arg.startsWith("http://") || arg.startsWith("https://")) ?? null;

  if (!socketPath) {
    appendEvidence({ type: "no-socket", argv });
    await Bun.sleep(200);
    process.exit(0);
  }

  await serveIpc(socketPath, mode, initialUrl);
  process.exit(0);
}

await main();
