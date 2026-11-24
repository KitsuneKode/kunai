import { describe, expect, test } from "bun:test";

import { HistoryShell } from "@/app-shell/history-shell";
import type { HistoryView, HistoryViewRow } from "@/app-shell/history-view";
import { decideRowTap } from "@/app-shell/mouse/row-tap";
import { OverlayPanel } from "@/app-shell/overlay-panel";
import { createRootPickerActions } from "@/app-shell/root-overlay-taps";
import type { Container } from "@/container";
import React from "react";

import { renderWithPointer } from "../../../support/pointer-render";

describe("decideRowTap", () => {
  test("a tap selects; a second tap on the same selected row activates", () => {
    const first = decideRowTap<string>(null, "b", false);
    expect(first).toEqual({ outcome: "select", nextPreviousTap: "b" });
    const second = decideRowTap(first.nextPreviousTap, "b", true);
    expect(second).toEqual({ outcome: "activate", nextPreviousTap: null });
  });

  test("an already-selected row still needs two taps, so a stray tap never launches", () => {
    // The cursor starts on row 0; one tap there only remembers it.
    expect(decideRowTap<number>(null, 0, true).outcome).toBe("select");
    // A tap elsewhere in between resets it.
    expect(decideRowTap<number>(1, 0, true).outcome).toBe("select");
  });
});

function historyRow(title: string): HistoryViewRow {
  return {
    titleId: title,
    title,
    episodeCode: "S01E01",
    statusLabel: "40%",
    statusColor: "#d98",
    statusDim: true,
    detail: "",
    recencyLabel: "1d ago",
    progress: { percentage: 40, completed: false },
    resumeAction: "resume where you left off",
    dualSourceAvailable: false,
  };
}

function historyView(selected: number): HistoryView {
  const rows = [historyRow("Frieren"), historyRow("Blue Lock")];
  return {
    state: "success",
    tab: "all",
    tabLabels: ["Continue", "Completed", "New episodes", "All"],
    tabIndex: 3,
    typeFilter: "all",
    typeFilterLabels: ["All", "Anime", "Series", "Movie", "Tracked"],
    typeFilterIndex: 0,
    flatRows: rows,
    filterQuery: "",
    showScrollUp: false,
    showScrollDown: false,
    rail: null,
    items: rows.map((row, flatIndex) => ({
      kind: "row" as const,
      row,
      flatIndex,
      selected: flatIndex === selected,
    })),
  };
}

describe("History rows take taps", () => {
  test("tap moves the cursor; a second tap on that row continues it", () => {
    const calls: string[] = [];
    // Holds the selection like the root shell does, so the second tap lands
    // on the same mounted component (the harness's rerender remounts).
    function Harness() {
      const [selected, setSelected] = React.useState(0);
      return (
        <HistoryShell
          view={historyView(selected)}
          columns={120}
          listWidth={80}
          rowWidth={76}
          onRowSelect={(index) => {
            calls.push(`select:${index}`);
            setSelected(index);
          }}
          onRowActivate={(index) => calls.push(`activate:${index}`)}
        />
      );
    }
    const ui = renderWithPointer(<Harness />, { columns: 120 });
    ui.click("history:row:Blue Lock");
    ui.click("history:row:Blue Lock");
    expect(calls).toEqual(["select:1", "activate:1"]);
  });

  test("without handlers (a pending delete, command mode) rows are not targets", () => {
    const ui = renderWithPointer(
      <HistoryShell view={historyView(0)} columns={120} listWidth={80} rowWidth={76} />,
      { columns: 120 },
    );
    expect(
      ui.dispatcher.debugRegions().some((region) => region.id.startsWith("history:row:")),
    ).toBe(false);
  });
});

describe("Picker rows take taps", () => {
  const options = [
    { value: "s1e1", label: "Episode 1" },
    { value: "s1e2", label: "Episode 2" },
    { value: "section:extras", label: "Extras" },
  ];
  function PanelHarness({ calls }: { readonly calls: string[] }) {
    const [selectedIndex, setSelectedIndex] = React.useState(0);
    return (
      <OverlayPanel
        overlay={{
          type: "episode-picker",
          title: "Episodes",
          subtitle: "",
          options,
          filterQuery: "",
          selectedIndex,
        }}
        width={80}
        onOptionSelect={(index) => {
          calls.push(`select:${index}`);
          setSelectedIndex(index);
        }}
        onOptionActivate={(index) => calls.push(`activate:${index}`)}
      />
    );
  }

  test("tap selects, a second tap picks, and section headers are not targets", () => {
    const calls: string[] = [];
    const ui = renderWithPointer(<PanelHarness calls={calls} />, { columns: 100 });
    ui.click("overlay-panel:option:1");
    ui.click("overlay-panel:option:1");
    expect(calls).toEqual(["select:1", "activate:1"]);
    expect(
      ui.dispatcher.debugRegions().some((region) => region.id === "overlay-panel:option:2"),
    ).toBe(false);
  });
});

describe("createRootPickerActions", () => {
  function fakeContainer() {
    type Transition = Parameters<Container["stateManager"]["dispatch"]>[0];
    const dispatched: Transition[] = [];
    // SAFETY: the picker actions only call stateManager.dispatch on this fake.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- partial container fake
    const container = {
      stateManager: { dispatch: (event: Transition) => dispatched.push(event) },
    } as unknown as Container;
    return { container, dispatched };
  }

  test("media pickers move by delta and resolve the tapped option", () => {
    const { container, dispatched } = fakeContainer();
    const actions = createRootPickerActions({
      container,
      overlay: {
        type: "episode_picker",
        id: "picker-1",
        title: "Episodes",
        options: [],
      } as never,
      commandMode: false,
      pickerSelectedIndex: 3,
      providerOptions: [],
      mediaPickerOptions: [{ value: "a" }, { value: "b" }, { value: "c" }, { value: "d" }],
      setSelectedIndex: () => {},
    });
    actions.taps?.select(1);
    actions.taps?.activate(2);
    expect(dispatched).toEqual([
      { type: "MOVE_PICKER_SELECTION", id: "picker-1", delta: -2 },
      { type: "RESOLVE_PICKER", id: "picker-1", value: "c" },
    ]);
  });

  test("command mode turns taps off", () => {
    const { container } = fakeContainer();
    const actions = createRootPickerActions({
      container,
      overlay: { type: "provider_picker" } as never,
      commandMode: true,
      pickerSelectedIndex: 0,
      providerOptions: [{ value: "videasy" }],
      mediaPickerOptions: [],
      setSelectedIndex: () => {},
    });
    expect(actions.taps).toBeNull();
  });
});
