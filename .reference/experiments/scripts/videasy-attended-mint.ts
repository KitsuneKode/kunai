/**
 * Attended Videasy session mint for Kunai / VidKing.
 *
 * Opens one real browser handoff only when Kunai has no usable cached Videasy
 * session. On success it writes the token, app id, and expiry into Kunai config
 * so episode switches can stay pure CLI/mpv until the session expires.
 *
 * Usage:
 *   bun scripts/videasy-attended-mint.ts bitcine tv 61700 1 3
 *   bun scripts/videasy-attended-mint.ts vidking tv 61700 1 3
 *
 * Add --force to mint even when Kunai already has a cached session.
 */
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { chromium } from "playwright";

import { getKunaiPaths } from "../../../packages/storage/src/paths";

type MintTarget = "bitcine" | "cineplay" | "vidking";
type KunaiConfigPatch = {
  readonly videasySessionToken?: string;
  readonly videasySessionExpiresAt?: number;
  readonly videasyAppId?: "vidking" | "bc-frontend";
};

const target = (process.argv[2] ?? "cineplay") as MintTarget;
const kind = process.argv[3] ?? "tv";
const tmdbId = process.argv[4] ?? "61700";
const season = process.argv[5] ?? "1";
const episode = process.argv[6] ?? "3";
const force = process.argv.includes("--force");

const APP_ID = target === "vidking" ? "vidking" : "bc-frontend";
const URL =
  target === "bitcine"
    ? kind === "tv"
      ? `https://www.bitcine.tv/tv/${tmdbId}/${season}/${episode}?play=true`
      : `https://www.bitcine.tv/movie/${tmdbId}?play=true`
    : target === "cineplay"
      ? kind === "tv"
        ? `https://www.cineplay.to/tv/${tmdbId}/${season}/${episode}?play=true`
        : `https://www.cineplay.to/movie/${tmdbId}?play=true`
      : kind === "tv"
      ? `https://www.vidking.net/embed/tv/${tmdbId}/${season}/${episode}?autoPlay=true`
      : `https://www.vidking.net/embed/movie/${tmdbId}?autoPlay=true`;

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function main(): Promise<void> {
  const cached = await readKunaiConfig();
  const cachedToken =
    typeof cached.videasySessionToken === "string" ? cached.videasySessionToken.trim() : "";
  const cachedExpiresAt =
    typeof cached.videasySessionExpiresAt === "number" &&
    Number.isFinite(cached.videasySessionExpiresAt)
      ? cached.videasySessionExpiresAt
      : 0;
  if (!force && cachedToken && (!cachedExpiresAt || cachedExpiresAt > Date.now() + 60_000)) {
    console.log("[+] Kunai already has a cached Videasy session.");
    console.log(`    app id:    ${cached.videasyAppId ?? "vidking"}`);
    console.log(
      `    expires:   ${
        cachedExpiresAt
          ? `${new Date(cachedExpiresAt).toLocaleString()} (${msToMinutes(cachedExpiresAt - Date.now())} min)`
          : "unknown"
      }`,
    );
    console.log("    browser:   not opened; use --force to mint a replacement");
    return;
  }

  const startedAt = Date.now();
  console.log(`[*] Target: ${target}  x-app-id: ${APP_ID}`);
  console.log("[*] Open this page and complete any Cloudflare / player check:");
  console.log(`    ${URL}`);
  console.log("[*] Waiting up to 3 minutes for POST /auth/session ...");

  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newContext({ userAgent: UA, locale: "en-US" }).then((c) => c.newPage());

  const capture = new Promise<{ token: string; expiresIn?: number; budget?: number }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for a successful /auth/session response"));
      }, 180_000);

      page.on("response", async (resp) => {
        const url = resp.url();
        if (!url.includes("/auth/session") || resp.request().method() === "OPTIONS") return;
        const status = resp.status();
        let body: {
          token?: string;
          expiresIn?: number;
          budget?: number;
          error?: string;
          codes?: string[];
        } = {};
        try {
          body = (await resp.json()) as typeof body;
        } catch {
          return;
        }
        if (status === 200 && body.token) {
          clearTimeout(timer);
          resolve({ token: body.token, expiresIn: body.expiresIn, budget: body.budget });
          return;
        }
        console.log(
          `[~] /auth/session HTTP ${status}: ${body.error ?? "unknown"}${
            body.codes?.length ? ` (${body.codes.join(", ")})` : ""
          }`,
        );
      });
    },
  );

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const { token, expiresIn, budget } = await capture;
    const expiresAt = expiresIn ? Date.now() + Math.max(0, expiresIn - 15) * 1000 : 0;
    await writeKunaiConfig({
      videasySessionToken: token,
      videasySessionExpiresAt: expiresAt,
      videasyAppId: APP_ID,
    });
    console.log("\n========== SUCCESS ==========");
    console.log(`elapsed:   ${Date.now() - startedAt}ms`);
    console.log(`app id:    ${APP_ID}`);
    console.log(`expiresIn: ${expiresIn ?? "?"}s   budget: ${budget ?? "?"}`);
    console.log(`saved:     ${getKunaiPaths().configPath}`);
    console.log(`token:     ${token.slice(0, 16)}... (${token.length} chars)`);
    console.log("\nKunai will reuse this session until it expires.");
    console.log("Use --force if you need to mint a replacement early.");
    console.log("============================\n");
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("\nMint failed:", error instanceof Error ? error.message : error);
  console.error("\nManual fallback (while playback works in the browser):");
  console.error("  1. DevTools -> Network -> filter auth/session or sources-with-title");
  console.error("  2. Copy JSON body.token from POST /auth/session (200), or");
  console.error("     request header x-session-token on sources-with-title");
  console.error(`  3. Kunai /settings -> Videasy session token + app id ${APP_ID}`);
  process.exit(1);
});

async function readKunaiConfig(): Promise<Record<string, unknown>> {
  const path = getKunaiPaths().configPath;
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  try {
    return (await file.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeKunaiConfig(patch: KunaiConfigPatch): Promise<void> {
  const path = getKunaiPaths().configPath;
  const current = await readKunaiConfig();
  const next = { ...current, ...patch };
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await Bun.write(tmp, JSON.stringify(next, null, 2));
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

function msToMinutes(ms: number): number {
  return Math.max(0, Math.floor(ms / 60_000));
}
