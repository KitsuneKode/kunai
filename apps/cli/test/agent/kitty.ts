import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProductionProviderModules } from "@/container/bootstrap-providers";
import { z } from "zod";

import {
  playbackProgressProof,
  observedPlaybackAdvanceMs,
  PLAYBACK_ADVANCE_SECONDS,
  startKittySession,
  waitForKittyCondition,
} from "./kitty-session";

const scenarioSchema = z.object({
  argv: z.array(z.string().max(1000)).max(20).default([]),
  steps: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("key"), value: z.string().max(40) }),
        z.object({ type: z.literal("text"), value: z.string().max(1000) }),
        z.object({ type: z.literal("click"), value: z.string().min(1).max(200) }),
        z.object({ type: z.literal("expect"), value: z.string().min(1).max(200) }),
        z.object({ type: z.literal("capture"), value: z.string().regex(/^[a-z0-9-]+$/) }),
        z.object({ type: z.literal("decoded") }),
      ]),
    )
    .max(100),
});

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    evidence: { type: "string" },
    scenario: { type: "string" },
    live: { type: "boolean" },
    matrix: { type: "boolean" },
    provider: { type: "string" },
    font: { type: "string" },
    timeout: { type: "string", default: "45" },
    observe: { type: "string", default: String(PLAYBACK_ADVANCE_SECONDS) },
  },
});
if (!values.evidence) throw new Error("Pass --evidence with a NEW output directory");
if (values.matrix && !values.live) throw new Error("Provider matrix requires explicit --live");
if (values.live && !values.matrix && !values.provider)
  throw new Error(
    "Non-matrix --live verification requires --provider to prevent fallback substitution",
  );
const timeoutSeconds = z.coerce.number().int().min(5).max(120).parse(values.timeout);
const observeSeconds = z.coerce
  .number()
  .int()
  .min(PLAYBACK_ADVANCE_SECONDS)
  .max(120)
  .parse(values.observe);
const font = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[^\r\n]+$/)
  .optional()
  .parse(values.font);
const evidenceRoot = resolve(values.evidence);
mkdirSync(evidenceRoot, { mode: 0o700 });
const repositoryRoot = resolve(import.meta.dir, "../../../..");
async function gitOutput(args: string[]) {
  const process = Bun.spawn(["git", ...args], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [code, output] = await Promise.all([process.exited, new Response(process.stdout).text()]);
  if (code !== 0) throw new Error("Cannot record verification source revision");
  return output.trim();
}
const revision = {
  commitSha: await gitOutput(["rev-parse", "HEAD"]),
  dirty: (await gitOutput(["status", "--porcelain"])).length > 0,
};
const modules = await loadProductionProviderModules({
  providerPriority: [],
  animeProviderPriority: [],
  youtubeProviderPriority: [],
});
const providerIds = modules.map((module) => module.providerId);
if (values.provider && !providerIds.includes(values.provider))
  throw new Error("Provider is not in the production roster");

type Session = Awaited<ReturnType<typeof startKittySession>>;
/** Record clock/dimension progress and a frame capture; visual approval is a separate manual gate. */
async function witnessPlayback(session: Session, signal: AbortSignal) {
  if (!Bun.which("mpv")) throw new Error("Decoded playback requires installed mpv");
  const start = await waitForKittyCondition(
    async () => {
      try {
        const value = await session.ipc(["get_property", "time-pos"]);
        const parsed = z.number().safeParse(value);
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    timeoutSeconds * 1000,
    signal,
  );
  const observationStarted = performance.now();
  let previousObservedAt = observationStarted;
  let previousPosition: number | null = start;
  let advancingMs = 0;
  let end: number;
  try {
    end = await waitForKittyCondition(
      async () => {
        try {
          const value = await session.ipc(["get_property", "time-pos"]);
          const parsed = z.number().safeParse(value);
          const observedAt = performance.now();
          if (parsed.success) {
            advancingMs += observedPlaybackAdvanceMs(
              previousPosition,
              parsed.data,
              previousObservedAt,
              observedAt,
            );
          }
          previousPosition = parsed.success ? parsed.data : null;
          previousObservedAt = observedAt;
          return parsed.success &&
            parsed.data > start + observeSeconds &&
            advancingMs >= observeSeconds * 1000 &&
            performance.now() - observationStarted >= observeSeconds * 1000
            ? parsed.data
            : null;
        } catch {
          previousPosition = null;
          return null;
        }
      },
      (observeSeconds + 30) * 1000,
      signal,
    );
  } catch (error) {
    await Bun.write(
      join(session.evidenceDir, "playback-observation.json"),
      JSON.stringify({
        timePosStart: start,
        lastTimePos: previousPosition,
        observedForMs: Math.round(performance.now() - observationStarted),
        advancingForMs: Math.round(advancingMs),
        requiredSeconds: observeSeconds,
      }),
    );
    throw error;
  }
  const proof = playbackProgressProof(
    start,
    end,
    await session.ipc(["get_property", "video-params"]),
    {
      elapsedMs: Math.round(performance.now() - observationStarted),
      advancingMs: Math.round(advancingMs),
      minimumSeconds: observeSeconds,
    },
  );
  await Bun.write(
    join(session.evidenceDir, "playback.json"),
    JSON.stringify({
      ...proof,
      proof: "mpv clock advanced with positive video dimensions; actual frame inspection required",
    }),
  );
  await session.ipc([
    "screenshot-to-file",
    join(session.evidenceDir, "decoded-frame.png"),
    "video",
  ]);
}

const cases = values.matrix
  ? modules
      .filter((module) => !values.provider || module.providerId === values.provider)
      .flatMap((module) => {
        const modes = module.manifest.mediaKinds;
        const routes: { label: string; providerId: string; argv: string[] }[] = [];
        if (modes.includes("movie"))
          routes.push({
            label: `${module.providerId}-movie`,
            providerId: module.providerId,
            argv: ["-i", "27205", "-t", "movie"],
          });
        if (modes.includes("series"))
          routes.push({
            label: `${module.providerId}-series`,
            providerId: module.providerId,
            argv: ["-i", "1396", "-t", "tv", "--season", "1", "-e", "1"],
          });
        if (modes.includes("anime"))
          routes.push({
            label: `${module.providerId}-anime`,
            providerId: module.providerId,
            argv: ["-i", "anilist:21", "-e", "1"],
          });
        if (modes.includes("video"))
          routes.push({
            label: `${module.providerId}-video`,
            providerId: module.providerId,
            argv: ["-i", "youtube:aqz-KE-bpKQ"],
          });
        return routes;
      })
  : [{ label: "scenario", providerId: values.provider, argv: [] }];
const results: { label: string; status: string; reason?: string }[] = [];
const shutdown = new AbortController();
let activeSession: Session | undefined;
let interruptExitCode: number | undefined;
/** Abort polling and share cleanup with finally; never exit before evidence is written. */
function interrupt(signal: "SIGINT" | "SIGTERM") {
  interruptExitCode ??= signal === "SIGINT" ? 130 : 143;
  shutdown.abort(new Error(`Verification interrupted by ${signal}`));
  void activeSession?.stop().catch(() => {
    // The route's finally awaits this same promise and records cleanup-failed.
  });
}
const onInterrupt = () => interrupt("SIGINT");
const onTerminate = () => interrupt("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);
try {
  for (const route of cases) {
    if (shutdown.signal.aborted) break;
    let session: Session | undefined;
    try {
      const scenario = values.matrix
        ? undefined
        : scenarioSchema.parse(
            values.scenario
              ? await Bun.file(values.scenario).json()
              : {
                  steps: [
                    { type: "expect", value: "Search title" },
                    { type: "capture", value: "home" },
                    { type: "click", value: "[/]" },
                    { type: "expect", value: "type a command" },
                    { type: "capture", value: "palette" },
                  ],
                },
          );
      session = await startKittySession({
        evidenceDir: join(evidenceRoot, route.label),
        argv: scenario?.argv ?? route.argv,
        fixture: !values.live,
        requiresMpv: values.matrix || scenario?.steps.some((step) => step.type === "decoded"),
        font,
        providerId: route.providerId,
        providerIds,
        signal: shutdown.signal,
      });
      activeSession = session;
      shutdown.signal.throwIfAborted();
      if (values.matrix) {
        await witnessPlayback(session, shutdown.signal);
        await session.capture("playing");
        results.push({ label: route.label, status: "playback-progress-observed" });
      } else {
        for (const step of scenario?.steps ?? []) {
          shutdown.signal.throwIfAborted();
          if (step.type === "key") await session.key(step.value);
          if (step.type === "text") await session.sendText(step.value);
          if (step.type === "expect") await session.waitForText(step.value);
          if (step.type === "click") await session.clickText(step.value);
          if (step.type === "capture") await session.capture(step.value);
          if (step.type === "decoded") await witnessPlayback(session, shutdown.signal);
        }
        results.push({ label: route.label, status: "scenario-observed" });
      }
    } catch (error) {
      if (session && !shutdown.signal.aborted) await session.capture("failure").catch(() => {});
      const reason =
        error instanceof Error
          ? error.message.replace(/https?:\/\/\S+/g, "[redacted-url]").slice(0, 500)
          : "Unknown verification failure";
      results.push({ label: route.label, status: "failed", reason });
    } finally {
      try {
        await session?.stop();
      } catch {
        results.push({ label: route.label, status: "cleanup-failed" });
      }
      activeSession = undefined;
      await Bun.write(
        join(evidenceRoot, "results.json"),
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            revision,
            timeoutSeconds,
            observeSeconds,
            source: values.live
              ? "production registry, one provider per route"
              : "fixture registry",
            mouseInput: "SGR bytes injected into PTY; not native desktop pointer proof",
            visualReview: "required; screenshots are not automatically approved",
            results,
          },
          null,
          2,
        ),
      );
      console.log(`${route.label}: ${results.at(-1)?.status}`);
    }
  }
} finally {
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onTerminate);
}
if (interruptExitCode !== undefined) process.exitCode = interruptExitCode;
else if (results.some((result) => result.status === "failed" || result.status === "cleanup-failed"))
  process.exitCode = 1;
