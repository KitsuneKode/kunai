/**
 * Shared verification helpers — doctor preflight, double-witness checks, and
 * evidence survival after owned-instance teardown. Keeps Kitty/L2 drivers aligned
 * with the pstack verification-skill contract.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { loadProductionProviderModules } from "@/container/bootstrap-providers";

import { bootSurface } from "./frame-match";
import { createProfileInspector, type ProfileStoragePaths } from "./profile-inspector";

export interface KittyDoctorOptions {
  readonly live?: boolean;
  readonly requiresMpv?: boolean;
  readonly providerId?: string;
}

/** Read-only host prerequisites before launching an owned Kitty window. */
export async function checkKittyDoctor(options: KittyDoctorOptions = {}): Promise<{
  readonly ok: boolean;
  readonly lines: readonly string[];
}> {
  const lines: string[] = [];
  const errors: string[] = [];
  const push = (line: string, error = false) => {
    lines.push(line);
    if (error) errors.push(line);
  };

  if (process.platform === "win32") push("Kitty verification requires a Unix desktop", true);
  const kitty = Bun.which("kitty");
  const bun = Bun.which("bun");
  if (!kitty) push("kitty executable not on PATH", true);
  else push(`kitty: ${kitty}`);
  if (!bun) push("bun executable not on PATH", true);
  else push(`bun: ${bun}`);

  const display = process.env.DISPLAY;
  const wayland = process.env.WAYLAND_DISPLAY;
  if (!display && !wayland)
    push("No DISPLAY or WAYLAND_DISPLAY — graphical desktop required", true);
  else push(`display: ${wayland ? `wayland (${wayland})` : display}`);

  if (options.requiresMpv || options.live) {
    const mpv = Bun.which("mpv");
    if (!mpv) push("mpv required for decoded playback / live matrix", true);
    else push(`mpv: ${mpv}`);
  }

  if (options.live) {
    if (!options.providerId) {
      push("Live verification requires --provider pin (non-matrix)", true);
    } else {
      const modules = await loadProductionProviderModules({
        providerPriority: [],
        animeProviderPriority: [],
        youtubeProviderPriority: [],
      });
      const roster = modules.map((module) => module.providerId);
      if (!roster.includes(options.providerId)) {
        push(`Provider ${options.providerId} is not in the production roster`, true);
      } else {
        push(`provider pin: ${options.providerId} (others disabled per route)`);
      }
    }
  } else {
    push("tier: fixture providers (compiled smoke, no network)");
  }

  const screenshotProbe = kitty
    ? Bun.spawnSync([kitty, "@", "screenshot", "--help"], {
        env: { ...process.env, PAGER: "cat", TERM: "dumb" },
        stderr: "pipe",
        stdout: "pipe",
      })
    : null;
  if (screenshotProbe && screenshotProbe.exitCode !== 0) {
    push("Kitty remote screenshot may be unavailable on this build", true);
  } else if (kitty) {
    push("kitty @ screenshot: available");
  }

  return { ok: errors.length === 0, lines };
}

/** After readiness, confirm the owned window and shadow profile are safe to drive. */
export async function inspectOwnedKittySession(input: {
  readonly text: () => Promise<string>;
  readonly paths: ProfileStoragePaths;
}): Promise<{ readonly surface: string }> {
  const frame = await input.text();
  const surface = bootSurface(frame);
  if (surface === null && !frame.includes("Search title")) {
    throw new Error(
      "Owned Kitty window has no recognised interactive surface; capture terminal.log and first PNG",
    );
  }
  const config = createProfileInspector(input.paths).config();
  if (
    config.analytics === "enabled" ||
    (config.installId !== undefined && config.installId !== "")
  ) {
    throw new Error("Owned profile minted analytics consent or installId");
  }
  return { surface: surface ?? "Browse" };
}

/** Frame text and persisted backend must agree before claiming a UI transition. */
export function assertDoubleWitness(input: {
  readonly frameText: string;
  readonly frameNeedle: string;
  readonly backendJson: string;
  readonly backendNeedle: string;
}): void {
  if (!input.frameText.includes(input.frameNeedle)) {
    throw new Error(`Frame witness missing: ${JSON.stringify(input.frameNeedle)}`);
  }
  if (!input.backendJson.includes(input.backendNeedle)) {
    throw new Error(`Backend witness missing: ${JSON.stringify(input.backendNeedle)}`);
  }
}

export interface KittyRouteResult {
  readonly label: string;
  readonly status: string;
  readonly reason?: string;
}

/**
 * Evidence survives profile disposal — proof lives only under the external
 * evidence directory named at launch.
 */
export function assertKittyEvidenceSurvival(
  evidenceRoot: string,
  results: readonly KittyRouteResult[],
): void {
  const resultsPath = join(evidenceRoot, "results.json");
  if (!existsSync(resultsPath)) {
    throw new Error(`Evidence survival failed: missing ${resultsPath}`);
  }
  const parsed = JSON.parse(readFileSync(resultsPath, "utf8")) as {
    results?: KittyRouteResult[];
  };
  const recorded = parsed.results ?? results;

  for (const route of recorded) {
    const routeDir = join(evidenceRoot, route.label);
    if (!existsSync(routeDir)) {
      throw new Error(`Evidence survival failed: missing route directory ${routeDir}`);
    }
    if (route.status === "failed") {
      const names = existsSync(routeDir) ? readdirSync(routeDir) : [];
      const hasFailureArtifact =
        names.some((name) => name.includes("failure")) || names.includes("terminal.log");
      if (!hasFailureArtifact) {
        throw new Error(`Failed route ${route.label} retained no failure capture or terminal.log`);
      }
      continue;
    }
    const cleanupPath = join(routeDir, "cleanup.json");
    if (!existsSync(cleanupPath)) {
      throw new Error(`Evidence survival failed: missing ${cleanupPath}`);
    }
    const cleanup = JSON.parse(readFileSync(cleanupPath, "utf8")) as {
      privateStateClean?: boolean;
      terminalExited?: boolean;
    };
    if (route.status === "cleanup-failed") {
      throw new Error(`Route ${route.label} recorded cleanup-failed`);
    }
    if (route.status !== "failed" && cleanup.privateStateClean !== true) {
      throw new Error(`Route ${route.label} cleanup.json privateStateClean !== true`);
    }
    if (route.status !== "failed" && cleanup.terminalExited !== true) {
      throw new Error(`Route ${route.label} cleanup.json terminalExited !== true`);
    }
    const capturesPath = join(routeDir, "captures.json");
    const playbackPath = join(routeDir, "playback.json");
    if (!existsSync(capturesPath) && !existsSync(playbackPath)) {
      throw new Error(
        `Route ${route.label} retained neither captures.json nor playback.json — no proof artifacts`,
      );
    }
  }
}
