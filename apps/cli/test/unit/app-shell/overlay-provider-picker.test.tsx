import { afterEach, describe, expect, test } from "bun:test";

import { OverlayPanel } from "@/app-shell/overlay-panel";
import {
  providerOptionsForListShell,
  providerPickerFooter,
  providerPickerSources,
} from "@/app-shell/overlay-provider-picker";
import { buildProviderPickerOptions } from "@/app-shell/panel-data";
import { setPlainModePreferenceSource } from "@/app-shell/plain-mode";
import { selectFooterActions, ShellFooter } from "@/app-shell/shell-primitives";
import type { ProviderMetadata } from "@/domain/types";
import type { ProviderHealth } from "@kunai/types";

import { captureFrame } from "../../harness/render-capture";

const NOW = new Date("2026-11-27T12:00:00.000Z");

function provider(
  id: string,
  name: string,
  extra: Partial<ProviderMetadata> = {},
): ProviderMetadata {
  return {
    id,
    name,
    description: `${name} description`,
    isAnimeProvider: false,
    isYoutubeProvider: false,
    providerLane: "series",
    ...extra,
  };
}

const HEALTH = new Map<string, ProviderHealth>([
  [
    "steady",
    {
      providerId: "steady",
      status: "healthy",
      checkedAt: "2026-11-27T11:54:00.000Z",
      consecutiveFailures: 0,
    },
  ],
  [
    "broken",
    {
      providerId: "broken",
      status: "down",
      checkedAt: "2026-11-27T11:48:00.000Z",
      consecutiveFailures: 5,
    },
  ],
]);

function rows(compact = false) {
  return buildProviderPickerOptions({
    currentProvider: "steady",
    providers: [
      provider("steady", "Steady"),
      provider("broken", "Broken"),
      provider("untested", "Untested"),
      provider("audited", "Audited", {
        knownIssue: { since: "2026-11-27", summary: "streams answer HTTP 502" },
      }),
    ],
    getProviderHealth: (providerId) => HEALTH.get(providerId),
    compact,
    now: NOW,
  });
}

function footerFrame(columns: number, selectedIndex = 0, filterQuery = "") {
  const options = filterQuery ? [] : rows(columns < 72);
  const footer = providerPickerFooter(options, selectedIndex, filterQuery, columns);
  return {
    footer,
    frame: captureFrame(
      <ShellFooter taskLabel={footer.taskLabel} actions={footer.actions} companionHint />,
      { columns, rows: 8 },
    ),
  };
}

afterEach(() => {
  setPlainModePreferenceSource(() => false);
});

describe("provider picker footer", () => {
  test("a wide terminal shows every key as a chip and the highlighted state as the one text line", () => {
    const { footer, frame } = footerFrame(140, 1);

    expect(footer.actions.map((action) => `${action.key} ${action.label}`)).toEqual([
      "↑↓ select",
      "enter switch",
      "/ commands",
      "esc close",
    ]);
    expect(footer.taskLabel).toBe(
      "Broken · down · 5 failures, last 12m ago · skipped in auto-fallback · Enter still tries it",
    );
    for (const chip of ["[↑↓] select", "[enter] switch", "[esc] close", "[/] commands"]) {
      expect(frame).toContain(chip);
    }
    // One footer: the text line plus one chip row, and no key hint said twice.
    expect(frame.match(/switch/g)).toHaveLength(1);
    expect(frame.match(/close/g)).toHaveLength(1);
  });

  test("a chip the footer has no room for is named in the text line, never lost", () => {
    for (const columns of [40, 60, 80, 91]) {
      const { footer, frame } = footerFrame(columns);
      const shown = selectFooterActions(footer.actions, "detailed", columns);
      const dropped = footer.actions.filter((action) => !shown.includes(action));

      expect(dropped.map((action) => action.key)).toEqual(["esc"]);
      expect(footer.taskLabel.startsWith("Esc close · Steady")).toBe(true);
      expect(frame).toContain("Esc close");
      expect(frame).toContain("[↑↓] select");
      expect(frame).toContain("[enter] switch");
      expect(frame).toContain("[/] commands");
    }
  });

  test("with a filter typed, Esc is advertised as what it does first", () => {
    const { footer } = footerFrame(140, 0, "zzz");
    // No row to act on: the row keys are not advertised, and Esc clears the filter.
    expect(footer.actions.map((action) => `${action.key} ${action.label}`)).toEqual([
      "/ commands",
      "esc show all",
    ]);
    expect(footer.taskLabel).toBe("No provider matches “zzz”");
  });

  test("the highlighted row past a shrunken list falls back to the last row", () => {
    const options = rows();
    const footer = providerPickerFooter(options.slice(0, 2), 3, "", 140);
    expect(footer.taskLabel.startsWith("Broken · down")).toBe(true);
  });

  test("plain mode keeps the same keys as words", () => {
    setPlainModePreferenceSource(() => true);
    const { frame } = footerFrame(140, 2);
    expect(frame).toContain("Untested · not checked yet · no resolve recorded on this device");
    expect(frame).toContain("Actions:");
    expect(frame).toContain("switch");
    expect(frame).toContain("close");
  });
});

describe("provider picker rows", () => {
  function panelFrame(columns: number, compact: boolean): string {
    return captureFrame(
      <OverlayPanel
        width={columns}
        overlay={{
          type: "provider",
          title: "Provider",
          subtitle: "Series lane",
          filterQuery: "",
          selectedIndex: 0,
          options: rows(compact),
        }}
      />,
      { columns, rows: 16 },
    );
  }

  test("each state reads in words, and the picker carries no hint line of its own", () => {
    const frame = panelFrame(120, false);

    expect(frame).toContain("healthy · 6m ago");
    expect(frame).toContain("down · 5 failures · 12m ago");
    expect(frame).toContain("not checked yet");
    expect(frame).toContain("known issue · 2026-11-27");
    // The reason leads the detail, ahead of the description.
    expect(frame).toMatch(/Broken\s+skipped in auto-fallback\s+·\s+Broken description/);
    expect(frame).toMatch(/Audited\s+streams answer HTTP 502\s+·\s+Audited description/);
    // The states end on one column, so the list scans as a column of verdicts.
    const stateEnds = ["6m ago", "12m ago", "not checked yet", "2026-11-27"].map((state) => {
      const line = frame.split("\n").find((candidate) => candidate.includes(state)) ?? "";
      return line.trimEnd().length;
    });
    expect(new Set(stateEnds).size).toBe(1);
    expect(frame).not.toContain("items");
    expect(frame).not.toContain("Enter select");
    expect(frame).not.toContain("Esc close");
  });

  test("at the 40-column floor every row keeps its name and its state", () => {
    const frame = panelFrame(40, true);
    const lines = frame.split("\n");
    for (const [name, state] of [
      ["Steady", "healthy"],
      ["Broken", "down"],
      ["Untested", "not checked"],
      ["Audited", "known issue"],
    ] as const) {
      const line = lines.find((candidate) => candidate.includes(name));
      expect(line).toBeDefined();
      expect(line).toContain(state);
    }
  });

  test("plain mode marks the selection in words and keeps every state", () => {
    setPlainModePreferenceSource(() => true);
    const frame = panelFrame(120, false);
    expect(frame).toContain("[selected] Steady  ·  current");
    expect(frame).toContain("down · 5 failures · 12m ago");
    expect(frame).toContain("known issue · 2026-11-27");
  });
});

test("the list shell, which draws no badge, gets the state at the front of the detail", () => {
  const details = providerOptionsForListShell(rows()).map((option) => option.detail);
  expect(details).toEqual([
    "healthy · 6m ago  ·  Steady description",
    "down · 5 failures · 12m ago  ·  skipped in auto-fallback  ·  Broken description",
    "not checked yet  ·  Untested description",
    "known issue · 2026-11-27  ·  streams answer HTTP 502  ·  Audited description",
  ]);
});

describe("provider picker sources", () => {
  test("reads global health, quarantine counts, and the title's failure streak", () => {
    const titleLookups: string[] = [];
    const sources = providerPickerSources(
      // SAFETY: providerPickerSources reads exactly these three methods; the
      // real services need a database this reader test does not.
      {
        providerHealth: { get: (providerId: string) => HEALTH.get(providerId) },
        endpointHealth: { countQuarantinedByProvider: () => new Map([["broken", 2]]) },
        titleProviderHealth: {
          getFailure: (titleId: string, providerId: string) => {
            titleLookups.push(`${titleId}:${providerId}`);
            return providerId === "steady" ? { consecutiveFailures: 2 } : null;
          },
        },
      } as never,
      "tmdb:1396",
      100,
    );

    expect(sources.getProviderHealth?.("broken")?.status).toBe("down");
    expect(sources.getQuarantinedEndpoints?.("broken")).toBe(2);
    expect(sources.getQuarantinedEndpoints?.("steady")).toBe(0);
    expect(sources.getTitleFailure?.("steady")).toEqual({ consecutiveFailures: 2 });
    expect(titleLookups).toEqual(["tmdb:1396:steady"]);
    expect(sources.compact).toBe(false);
  });

  test("without a title there is no title lookup, and a narrow terminal asks for compact rows", () => {
    const sources = providerPickerSources(
      // SAFETY: same three-method surface as above; nothing else is read.
      {
        providerHealth: { get: () => undefined },
        endpointHealth: { countQuarantinedByProvider: () => new Map() },
        titleProviderHealth: {
          getFailure: () => {
            throw new Error("no title is open");
          },
        },
      } as never,
      undefined,
      60,
    );
    expect(sources.getTitleFailure?.("steady")).toBeNull();
    expect(sources.compact).toBe(true);
  });
});
