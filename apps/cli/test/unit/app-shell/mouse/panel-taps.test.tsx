import { describe, expect, test } from "bun:test";

import { CalendarDayStrip, CalendarScheduleRow, CalendarTypeTabs } from "@/app-shell/calendar-ui";
import type { CalendarDay } from "@/app-shell/calendar-ui.model";
import { ChecklistShell } from "@/app-shell/checklist-shell";
import { DownloadManagerContent } from "@/app-shell/download-manager-shell";
import type { GuideRow, GuideSectionRows } from "@/app-shell/guide-model";
import { GuideShell } from "@/app-shell/guide-shell";
import {
  useCalendarCursor,
  type CalendarCursor,
  type CalendarKeyboardCursor,
} from "@/app-shell/hooks/use-calendar-cursor";
import { NotificationsShell } from "@/app-shell/notifications-shell";
import { buildNotificationsView } from "@/app-shell/notifications-view";
import { OverlayLayoutProvider } from "@/app-shell/overlay-layout-context";
import {
  createNotificationInboxTaps,
  createNotificationSubPickerActivation,
} from "@/app-shell/root-overlay-taps";
import type { BrowseShellOption } from "@/app-shell/types";
import { createNotificationsOverlayState } from "@/app-shell/use-notifications-overlay-input";
import type { Container } from "@/container";
import type { DownloadJobRecord, NotificationRecord } from "@kunai/storage";
import React, { act } from "react";

import { renderWithPointer } from "../../../support/pointer-render";

type Pointer = ReturnType<typeof renderWithPointer>;

function regionIds(ui: Pointer, prefix: string): string[] {
  return ui.dispatcher
    .debugRegions()
    .map((region) => region.id)
    .filter((id) => id.startsWith(prefix));
}

/** Footer targets carry a per-mount id; find one by its key. */
function footerId(ui: Pointer, key: string): string {
  const id = ui.dispatcher
    .debugRegions()
    .map((region) => region.id)
    .find((candidate) => candidate.includes(`:footer:${key}:`));
  if (!id) throw new Error(`footer action ${key} is not a target`);
  return id;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function notice(dedupKey: string, title: string): NotificationRecord {
  return {
    id: dedupKey,
    dedupKey,
    kind: "new-episode",
    title,
    body: "available",
    actionJson: JSON.stringify(["queue-next", "dismiss"]),
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
  };
}

describe("Notifications inbox rows take taps", () => {
  const records = [notice("a", "Frieren S1E13"), notice("b", "Dandadan S2E01")];

  function Inbox({ calls }: { readonly calls: string[] }) {
    const [selectedDedupKey, setSelected] = React.useState<string | null>(null);
    const view = buildNotificationsView({
      records,
      tab: "active",
      sortMode: "newest",
      page: 0,
      pageSize: 6,
      selectedDedupKey,
      now: "2026-07-16T12:00:00.000Z",
    });
    return (
      <NotificationsShell
        view={view}
        columns={100}
        selectedIndex={view.selectedIndex}
        unreadCount={2}
        taps={createNotificationInboxTaps({
          commandMode: false,
          rows: view.rows,
          run: (dedupKey) => calls.push(`run:${dedupKey}`),
          setState: (update) => {
            const next = update({ ...createNotificationsOverlayState(), selectedDedupKey });
            calls.push(`select:${next.selectedDedupKey}`);
            setSelected(next.selectedDedupKey);
          },
        })}
      />
    );
  }

  test("a tap selects the notice by identity; a second tap runs its primary action", () => {
    const calls: string[] = [];
    const ui = renderWithPointer(<Inbox calls={calls} />, { columns: 104 });
    ui.click("notifications:row:b");
    ui.click("notifications:row:b");
    expect(calls).toEqual(["select:b", "run:b"]);
  });

  test("command mode turns inbox taps off", () => {
    expect(
      createNotificationInboxTaps({
        commandMode: true,
        rows: [],
        run: () => {},
        setState: () => {},
      }),
    ).toBeNull();
  });

  test("without taps the rows are not targets", () => {
    const view = buildNotificationsView({
      records,
      tab: "active",
      sortMode: "newest",
      page: 0,
      pageSize: 6,
      selectedDedupKey: null,
      now: "2026-07-16T12:00:00.000Z",
    });
    const ui = renderWithPointer(
      <NotificationsShell view={view} columns={100} selectedIndex={0} unreadCount={0} />,
      { columns: 104 },
    );
    expect(regionIds(ui, "notifications:row:")).toEqual([]);
  });
});

describe("createNotificationSubPickerActivation", () => {
  const confirmOptions = [{ value: "confirm" as const }, { value: "cancel" as const }];
  const actionOptions = [
    { value: "queue-next" as const, label: "Queue next" },
    { value: "dismiss" as const, label: "Dismiss" },
  ];

  function build(state: {
    playConfirm?: { dedupKey: string; actionId: "play-now" } | null;
    actionDedupKey?: string | null;
  }) {
    const calls: string[] = [];
    const activate = createNotificationSubPickerActivation({
      playConfirm: state.playConfirm ?? null,
      playConfirmOptions: confirmOptions,
      actionDedupKey: state.actionDedupKey ?? null,
      actionOptions,
      run: (dedupKey, actionId, options) =>
        calls.push(`run:${dedupKey}:${actionId}:${options?.confirmedContextSwitch ?? false}`),
      clearPlayConfirm: () => calls.push("clear-confirm"),
      closeActionPicker: () => calls.push("close-actions"),
    });
    return { activate, calls };
  }

  test("the play confirmation runs with the context switch confirmed, or cancels", () => {
    const confirm = build({ playConfirm: { dedupKey: "a", actionId: "play-now" } });
    confirm.activate?.(0);
    confirm.activate?.(1);
    expect(confirm.calls).toEqual(["run:a:play-now:true", "clear-confirm"]);
  });

  test("the action list runs the picked action and closes", () => {
    const actions = build({ actionDedupKey: "b" });
    actions.activate?.(1);
    actions.activate?.(5);
    expect(actions.calls).toEqual(["run:b:dismiss:false", "close-actions"]);
  });

  test("with neither picker open there is nothing to activate", () => {
    expect(build({}).activate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Guide
// ---------------------------------------------------------------------------

function guideRow(command: GuideRow["command"], invocation: string): GuideRow {
  return {
    command,
    invocation,
    description: `${invocation} does a thing`,
    note: undefined,
    enabled: true,
    reason: undefined,
    surface: "run",
  };
}

describe("Guide rows take taps", () => {
  const sections: GuideSectionRows[] = [
    {
      title: "Watch",
      blurb: "Find something",
      rows: [guideRow("history", "/history"), guideRow("calendar", "/calendar")],
    },
  ];

  function render(commandMode: boolean, activated: string[]) {
    return renderWithPointer(
      // The guide sizes its rows from the overlay it is mounted in.
      <OverlayLayoutProvider
        value={{ contentRows: 30, contentColumns: 96, chromeRows: 4, listMaxVisible: 10 }}
      >
        <GuideShell
          sections={sections}
          maxRows={12}
          commandMode={commandMode}
          commandInput=""
          commandCursor={0}
          commands={[]}
          highlightedIndex={0}
          footerActions={[]}
          statusNote={null}
          onActivate={(row) => activated.push(row.invocation)}
        />
      </OverlayLayoutProvider>,
      { columns: 100, rows: 30 },
    );
  }

  test("a tap selects an entry and a second tap runs it; headers are not targets", () => {
    const activated: string[] = [];
    const ui = render(false, activated);
    expect(regionIds(ui, "guide:row:")).toEqual(["guide:row:history", "guide:row:calendar"]);
    ui.click("guide:row:calendar");
    expect(activated).toEqual([]);
    expect(ui.lastFrame()).toMatch(/▌ \/calendar/);
    ui.click("guide:row:calendar");
    expect(activated).toEqual(["/calendar"]);
  });

  test("the wheel stops at the last entry instead of wrapping", () => {
    const ui = render(false, []);
    ui.wheel("guide:row:history", "down");
    ui.wheel("guide:row:history", "down");
    expect(ui.lastFrame()).toMatch(/▌ \/calendar/);
  });

  test("command mode turns taps off", () => {
    expect(regionIds(render(true, []), "guide:row:")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

describe("Checklist rows take taps", () => {
  const options = [
    { value: 1, label: "Episode 1" },
    { value: 2, label: "Episode 2" },
    { value: 3, label: "Episode 3" },
  ];

  test("one tap toggles a row; the footer's confirm submits the checked set", () => {
    const ui = renderWithPointer(
      <ChecklistShell
        title="Download episodes"
        subtitle="Pick episodes"
        options={options}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
      { columns: 100, rows: 30 },
    );
    ui.click("checklist:row:0");
    ui.click("checklist:row:2");
    ui.click("checklist:row:0");
    ui.click(footerId(ui, "enter"));
    // The confirm flash names the count before handing off: only row 2 stayed checked.
    const frame = ui.lastFrame() ?? "";
    expect(frame).toContain("Selected");
    expect(frame).toContain("1 item");
  });

  test("the footer's back clears a typed filter before it closes", () => {
    let cancelled = 0;
    const ui = renderWithPointer(
      <ChecklistShell
        title="Download episodes"
        subtitle="Pick episodes"
        options={options}
        initialFilter="Episode 3"
        onSubmit={() => {}}
        onCancel={() => {
          cancelled += 1;
        }}
      />,
      { columns: 100, rows: 30 },
    );
    ui.click(footerId(ui, "esc"));
    expect(cancelled).toBe(0);
    expect(ui.lastFrame()).toContain("Episode 1");
    ui.click(footerId(ui, "esc"));
    expect(cancelled).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Download manager
// ---------------------------------------------------------------------------

function job(id: string, status: DownloadJobRecord["status"], episode: number): DownloadJobRecord {
  // SAFETY: the manager reads only these fields; the rest of the record is storage-only.
  return {
    id,
    titleId: "title-1",
    titleName: "Frieren",
    status,
    mediaKind: "anime",
    mode: "series",
    providerId: "videasy",
    season: 1,
    episode,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    progressPercent: 0,
    outputPath: `/tmp/frieren-${id}.mp4`,
  } as DownloadJobRecord;
}

describe("Download manager rows take taps", () => {
  test("a tap selects a job and a second tap retries it; no tap removes anything", async () => {
    const retried: string[] = [];
    const removed: string[] = [];
    // SAFETY: the manager only reads these members of the container.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- partial container fake
    const container = {
      stateManager: { dispatch: () => undefined },
      config: { zenMode: false },
      downloadService: {
        listActive: () => [job("q1", "queued", 1)],
        listCompleted: () => [],
        listFailed: () => [job("f1", "failed", 2)],
        onEvent: () => () => {},
        retry: async (jobId: string) => {
          retried.push(jobId);
        },
        kickQueue: () => undefined,
        deleteJob: async (jobId: string) => {
          removed.push(jobId);
          return { status: "deleted", jobId };
        },
      },
    } as unknown as Container;
    const ui = renderWithPointer(
      <DownloadManagerContent container={container} onClose={() => {}} />,
      { columns: 120, rows: 35 },
    );
    ui.click("downloads:row:f1");
    expect(ui.lastFrame()).toContain("r to retry");
    expect(retried).toEqual([]);
    ui.click("downloads:row:f1");
    await act(async () => {});
    expect(retried).toEqual(["f1"]);
    expect(removed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Schedule (calendar)
// ---------------------------------------------------------------------------

const DAYS: CalendarDay[] = [
  { key: "2026-07-16", label: "THU 16", isToday: true },
  { key: "2026-07-17", label: "FRI 17", isToday: false },
];

describe("Schedule chips and tabs take taps", () => {
  test("a tap on a date chip selects that date", () => {
    const picked: string[] = [];
    const ui = renderWithPointer(
      <CalendarDayStrip
        days={DAYS}
        selectedDayKey="2026-07-16"
        onSelect={(key) => picked.push(key)}
      />,
      { columns: 100 },
    );
    ui.click("calendar:day:2026-07-17");
    expect(picked).toEqual(["2026-07-17"]);
  });

  test("a tap on a type tab selects that type", () => {
    const picked: string[] = [];
    const ui = renderWithPointer(
      <CalendarTypeTabs activeTab="All" compact={false} onSelect={(tab) => picked.push(tab)} />,
      { columns: 120 },
    );
    ui.click("calendar:type:tab:2");
    expect(picked).toEqual(["TV"]);
  });

  test("without handlers neither chips nor tabs are targets", () => {
    const ui = renderWithPointer(
      <>
        <CalendarDayStrip days={DAYS} selectedDayKey="2026-07-16" />
        <CalendarTypeTabs activeTab="All" compact={false} />
      </>,
      { columns: 120 },
    );
    expect(regionIds(ui, "calendar:")).toEqual([]);
  });
});

function scheduleOption(label: string): BrowseShellOption<string> {
  return { value: label, label };
}

describe("useCalendarCursor", () => {
  const byDay = new Map([
    ["2026-07-16", [scheduleOption("Frieren"), scheduleOption("Dandadan")]],
    ["2026-07-17", [scheduleOption("Blue Lock")]],
  ]);

  function Schedule({ log }: { readonly log: string[] }) {
    const [dayKey, setDayKey] = React.useState<string | null>("2026-07-16");
    const [selectedIndex, setSelectedIndex] = React.useState(0);
    const cursorRef = React.useRef<CalendarKeyboardCursor<string>>({
      dayKey: "2026-07-16",
      optionIndex: 0,
      option: null,
    });
    const cursor: CalendarCursor = useCalendarCursor({
      cursorRef,
      dayFilter: dayKey,
      days: DAYS,
      optionsForDay: (key) => byDay.get(key ?? "") ?? [],
      setDayFilter: (key) => {
        log.push(`day:${key}`);
        setDayKey(key);
      },
      setTypeTab: (tab) => log.push(`type:${tab}`),
      setSelectedIndex: (index) => {
        log.push(`row:${index}`);
        setSelectedIndex(index);
      },
      focusList: () => {},
      submit: (option) => log.push(`submit:${option.value}`),
    });
    const rows = byDay.get(dayKey ?? "") ?? [];
    return (
      <>
        {rows.map((option, optionIndex) => (
          <CalendarScheduleRow
            key={option.label}
            option={option}
            selected={optionIndex === selectedIndex}
            rowWidth={80}
            timeLabel="12:00"
            optionIndex={optionIndex}
            pointer={cursor}
          />
        ))}
        <CalendarDayStrip days={DAYS} selectedDayKey={dayKey} onSelect={cursor.selectDay} />
        <CalendarTypeTabs activeTab="All" compact={false} onSelect={cursor.selectType} />
      </>
    );
  }

  test("a tap selects a row, a second tap submits it, and the wheel stops at the end", () => {
    const log: string[] = [];
    const ui = renderWithPointer(<Schedule log={log} />, { columns: 120, rows: 30 });
    ui.click("calendar:row:1");
    ui.click("calendar:row:1");
    expect(log).toEqual(["row:1", "submit:Dandadan"]);
    log.length = 0;
    ui.wheel("calendar:row:0", "down");
    expect(log).toEqual(["row:1"]);
  });

  test("a date tap moves to that date's first row; a type tap resets the date", () => {
    const log: string[] = [];
    const ui = renderWithPointer(<Schedule log={log} />, { columns: 120, rows: 30 });
    ui.click("calendar:day:2026-07-17");
    expect(log).toEqual(["day:2026-07-17", "row:0"]);
    // Only Blue Lock airs on the 17th; a tap on it then a confirming tap submits it.
    ui.click("calendar:row:0");
    ui.click("calendar:row:0");
    expect(log.at(-1)).toBe("submit:Blue Lock");
    log.length = 0;
    ui.click("calendar:type:tab:1");
    expect(log).toEqual(["type:Anime", "day:null", "row:0"]);
  });
});
