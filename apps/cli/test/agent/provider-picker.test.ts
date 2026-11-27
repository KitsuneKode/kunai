/**
 * L2 · the provider picker in the real root shell, on the bundled roster.
 *
 * The picker's whole point is that a row's state comes from somewhere: the
 * health stores for what this device has seen, the manifest for what a
 * maintainer audit saw. Unit tests pin each rule; this drives the real overlay
 * so a rule that never reaches the frame — the house silent no-op — fails here.
 * Nothing resolves a stream: opening and reading the picker is zero network.
 */
import { describe, expect, it } from "bun:test";

import type { Container } from "@/container";
import { DEFAULT_CONFIG } from "@kunai/config";

import { createAgentSession, type AgentSession } from "./agent-driver";
import { K } from "./keys";
import { onboardedConfig } from "./seed";

/** Health the returning user's device recorded, relative to the real clock the shell reads. */
function seedObservedHealth(container: Container): void {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  container.providerHealth.set({
    providerId: "vidlink",
    status: "healthy",
    checkedAt: minutesAgo(6),
    consecutiveFailures: 0,
  });
  container.providerHealth.set({
    providerId: "rivestream",
    status: "down",
    checkedAt: minutesAgo(12),
    consecutiveFailures: 5,
  });
  container.endpointHealth.recordFailure("rivestream", "scrapper.rivestream.app", {
    class: "route-dead",
    at: minutesAgo(12),
  });
}

async function openProviderPicker(s: AgentSession): Promise<void> {
  await s.waitForFrame((f) => f.includes("Search title"), "browse shell");
  // The browse footer already says "commands", so the palette is waited on by
  // its own title, and "/" is pressed only once the shell has settled: sent
  // into the first frame it is dropped and "provider" lands in the search box.
  await s.waitSettled();
  s.press("/");
  await s.waitForFrame((f) => f.includes("type a command"), "command palette");
  await s.waitSettled();
  s.press("provider");
  await s.waitForFrame((f) => f.includes("/provider"), "provider command listed");
  s.press(K.enter);
  // `/provider` lands on the provider actions menu; the picker is its first row.
  await s.waitForFrame((f) => f.includes("Switch for this session"), "provider actions menu");
  await s.waitSettled();
  s.press(K.enter);
  await s.waitForFrame((f) => f.includes("Type to narrow providers"), "provider picker");
  await s.waitSettled();
}

/** The list row that starts with this provider's name (the header names the provider too). */
function rowOf(frame: string, name: string): string {
  const row = frame.split("\n").find((line) => line.replace(/^[\s▌]+/, "").startsWith(`${name} `));
  if (!row) throw new Error(`no row for ${name} in:\n${frame}`);
  return row;
}

/** Walk the selection to a provider by name; the footer's text line says which row is highlighted. */
async function highlight(s: AgentSession, name: string): Promise<void> {
  const highlighted = (frame: string) => frame.includes(`\n ${name} · `);
  for (let presses = 0; presses < 6 && !highlighted(s.frame()); presses += 1) {
    const before = s.frame();
    s.press(K.down);
    await s.waitForFrame((frame) => frame !== before, `selection moved toward ${name}`);
  }
  await s.waitForFrame(highlighted, `${name} highlighted`);
  await s.waitSettled();
}

async function withPicker(
  label: string,
  columns: number,
  run: (s: AgentSession) => Promise<void>,
): Promise<void> {
  const session = await createAgentSession({
    label,
    columns,
    providers: "production",
    seed: { ...onboardedConfig(), provider: "movy" },
    beforeMount: ({ container }) => seedObservedHealth(container),
  });
  try {
    await openProviderPicker(session);
    await run(session);
    session.assertPrivacyClean();
  } finally {
    await session.dispose();
  }
}

describe("agent wiring · provider picker", () => {
  it("every row states where it stands, and one footer carries the keys", async () => {
    await withPicker("provider-picker-wide", 140, async (s) => {
      const frame = s.frame();

      // Stores: nothing recorded, a clean resolve, a failure streak.
      expect(rowOf(frame, "Movy")).toContain("not checked yet");
      expect(rowOf(frame, "VidLink")).toMatch(/healthy · \dm ago/);
      expect(rowOf(frame, "Rivestream")).toMatch(/down · 5 failures · 1\dm ago/);
      expect(rowOf(frame, "Rivestream")).toContain("skipped in auto-fallback");
      // Manifest: the two the audit found broken say so before anyone tries them.
      expect(rowOf(frame, "Videasy")).toContain("every resolve times out");
      expect(rowOf(frame, "Videasy")).toContain("known issue · 2026-11-27");
      expect(rowOf(frame, "VidRock")).toContain("streams answer HTTP 502");
      expect(rowOf(frame, "VidRock")).toContain("known issue · 2026-11-27");
      // The engine family is not a name either site is known by.
      expect(frame).not.toContain("P-Stream");
      expect(rowOf(frame, "Movy")).toContain("Known as movy.sx");

      // One count, one footer: the text line plus the chip row.
      // Every shipped movies/series provider: the lane lead plus its fallbacks.
      const shipped = new Set([DEFAULT_CONFIG.provider, ...DEFAULT_CONFIG.providerPriority]);
      expect(frame.match(/\d+ (options|items)\b/g)).toEqual([`${shipped.size} options`]);
      expect(rowOf(frame, "VidBolt")).toContain("not checked yet");
      expect(frame).not.toContain("Type to filter");
      expect(frame).not.toContain("Enter select");
      expect(frame).toContain("Movy  ·  current · not checked yet");
      for (const chip of ["[↑↓] select", "[enter] switch", "[esc] close", "[/] commands"]) {
        expect(frame.split(chip)).toHaveLength(2);
      }

      // Picker order stays the configured order: the default puts Rivestream
      // ahead of VidLink, and being down does not sink it below a healthy row.
      const rows = frame.split("\n");
      expect(rows.indexOf(rowOf(frame, "Rivestream"))).toBeLessThan(
        rows.indexOf(rowOf(frame, "VidLink")),
      );
    });
  }, 30_000);

  it("the footer follows the highlighted row, and a broken provider is still a choice", async () => {
    await withPicker("provider-picker-switch", 140, async (s) => {
      await highlight(s, "Rivestream");
      expect(s.frame()).toMatch(
        /Rivestream · down · 5 failures, last 1\dm ago · skipped in auto-fallback · 1 endpoint quarantined · Enter still tries it/,
      );

      await highlight(s, "VidRock");
      expect(s.frame()).toContain(
        "VidRock · known issue since 2026-11-27: streams answer HTTP 502 · not checked on this device",
      );
      s.press(K.enter);
      // The pick lands: the shell is now on VidRock. This entry is "switch for
      // this session", so the saved default is, correctly, still Movy.
      await s.waitForFrame((f) => f.includes("series · VidRock"), "shell switched to VidRock");
      expect(s.frame()).not.toContain("Type to narrow providers");
      expect(s.inspect().config().provider).toBe("movy");
    });
  }, 30_000);

  it("typing narrows, Esc is advertised as clearing first, and then it closes", async () => {
    await withPicker("provider-picker-filter", 140, async (s) => {
      const total = s.frame().match(/(\d+) options\b/)?.[1];
      expect(total).toBeDefined();
      s.press("vid");
      await s.waitForFrame((f) => f.includes("Filter: vid"), "filter applied");
      await s.waitSettled();
      const filtered = s.frame();
      expect(filtered).not.toContain(`${total} options`);
      expect(filtered).not.toContain("Rivestream");
      expect(filtered).toContain("[esc] show all");

      s.press(K.esc);
      await s.waitForFrame(
        (f) => f.includes(`${total} options`),
        "filter cleared, picker still open",
      );
      expect(s.frame()).toContain("[esc] close");
      await s.waitSettled();
      s.press(K.esc);
      await s.waitForFrame((f) => !f.includes("Type to narrow providers"), "picker closed");
      // Reading the picker is not choosing from it.
      expect(s.inspect().config().provider).toBe("movy");
    });
  }, 30_000);

  it("at 72 columns no key is lost: the chip the row drops is named in the text line", async () => {
    await withPicker("provider-picker-narrow", 72, async (s) => {
      const frame = s.frame();
      expect(frame).toContain("Esc close · Movy");
      expect(frame).toContain("[↑↓] select");
      expect(frame).toContain("[enter] switch");
      expect(frame).toContain("[/] commands");
      expect(rowOf(frame, "VidLink")).toMatch(/healthy · \dm ago/);
      expect(rowOf(frame, "VidRock")).toContain("known issue");
    });
  }, 30_000);
});
