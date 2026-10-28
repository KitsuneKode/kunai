import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrowseShell } from "@/app-shell/browse-shell";
import { RootContentSuspension } from "@/app-shell/RootContentSuspension";
import { flushSearchHistory } from "@/services/persistence/search-history";
import { act, createRef, useImperativeHandle, useState } from "react";

import { applyStorageRootEnv } from "../../../helpers/storage-env";
import { renderWithPointer } from "../../../support/pointer-render";

let sandbox: string;
let restoreEnvironment: () => void;
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "kunai-browse-pointer-"));
  restoreEnvironment = applyStorageRootEnv(sandbox);
});
afterEach(async () => {
  try {
    await flushSearchHistory();
  } finally {
    restoreEnvironment();
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("calendar footer names and cycles calendar types instead of claiming a mode switch", () => {
  const actions: string[] = [];
  const calendar = {
    source: "anilist",
    titleId: "anilist:21",
    title: "One Piece",
    contentKind: "anime",
    releaseAt: "2026-06-01T10:00:00.000Z",
    releasePrecision: "timestamp",
    releaseStatus: "upcoming",
    providerConfirmed: false,
    reason: "upcoming-episode",
    dayKey: "2026-06-01",
    display: { time: "10:00", statusLabel: "airs later", episodeCode: "E01", groupLabel: "MON 1" },
  } as const;
  const handle = renderWithPointer(
    <BrowseShell
      mode="anime"
      provider="hianime"
      placeholder="Search"
      commands={[]}
      initialResults={[
        {
          label: calendar.title,
          value: {
            id: calendar.titleId,
            type: "series",
            title: calendar.title,
            isAnime: true,
            calendar,
          },
          calendar,
        },
      ]}
      initialResultSubtitle="1 this week · schedule"
      onSearch={async () => ({ options: [], subtitle: "" })}
      onResolve={(action) => actions.push(action)}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { columns: 120, rows: 40 },
  );
  try {
    expect(handle.lastFrame()).toContain("calendar type");
    const target = handle.dispatcher
      .debugRegions()
      .find((row) => row.id.includes(":footer:") && row.id.includes(":toggle-mode:"));
    expect(target?.id).toContain("calendar type");
    expect(target?.id).not.toContain("switch mode");
    handle.click(target!.id);
    expect(actions).toEqual([]);
    expect(handle.lastFrame()).toContain("One Piece");
    handle.click(target!.id);
    expect(handle.lastFrame()).toContain("No tv releases");
    act(() => handle.stdin.enqueue(["\u001b[Z"]));
    expect(handle.lastFrame()).toContain("One Piece");
  } finally {
    handle.unmount();
  }
});

test("home rows remain selectable after discovery returns no results", async () => {
  const actions: string[] = [];
  const handle = renderWithPointer(
    <BrowseShell
      mode="series"
      provider="vidlink"
      placeholder="Search"
      commands={[]}
      idleContext={{
        continueWatching: { title: "Resume series", titleId: "tmdb:1396", mediaKind: "series" },
      }}
      onSearch={async () => ({ options: [], subtitle: "0 results" })}
      onLoadDiscovery={async () => ({
        options: [],
        subtitle: "0 trending",
        emptyMessage: "No trending titles",
      })}
      onResolve={(action) => actions.push(action)}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { columns: 120, rows: 40 },
  );
  try {
    await act(async () => handle.stdin.enqueue(["\x14"]));
    expect(handle.lastFrame()).toContain("No trending titles");
    expect(handle.lastFrame()).toContain("Resume series");
    const target = handle.dispatcher
      .debugRegions()
      .find((row) => row.id.startsWith("browse:idle:continue:"));
    expect(target).toBeDefined();
    handle.click(target!.id);
    expect(actions).toEqual([]);
    handle.click(target!.id);
    expect(actions).toEqual(["resume-continue-watching"]);
  } finally {
    handle.unmount();
  }
});

test("browse footer opens commands and releases its targets while the palette owns input", () => {
  const handle = renderWithPointer(
    <BrowseShell
      mode="series"
      provider="vidlink"
      placeholder="Search"
      commands={[]}
      onSearch={async () => ({ options: [], subtitle: "" })}
      onResolve={() => {}}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { columns: 120, rows: 40 },
  );
  try {
    const target = handle.dispatcher
      .debugRegions()
      .find((row) => row.id.includes(":footer:/:command-mode:"));
    expect(target).toBeDefined();
    handle.click(target!.id);
    expect(handle.lastFrame()).toContain("/ type a command");
    expect(handle.dispatcher.debugRegions().some((row) => row.id.includes(":footer:"))).toBe(false);
  } finally {
    handle.unmount();
  }
});

test("home resume needs a first selection click and a second activation click", () => {
  const actions: string[] = [];
  const handle = renderWithPointer(
    <BrowseShell
      mode="anime"
      provider="hianime"
      placeholder="Search"
      commands={[]}
      idleContext={{
        continueWatching: { title: "Resume anime", titleId: "anilist:21", mediaKind: "series" },
      }}
      onSearch={async () => ({ options: [], subtitle: "" })}
      onResolve={(action) => actions.push(action)}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { columns: 120, rows: 40 },
  );
  try {
    const target = handle.dispatcher
      .debugRegions()
      .find((row) => row.id.startsWith("browse:idle:continue:"));
    expect(target).toBeDefined();
    handle.click(target!.id);
    expect(actions).toEqual([]);
    handle.click(target!.id);
    expect(actions).toEqual(["resume-continue-watching"]);
  } finally {
    handle.unmount();
  }
});

test("an idle target replacement or overlay cannot inherit a previous click", async () => {
  const actions: string[] = [];
  const renderShell = (titleId: string, suspended = false, ep = "S01E01") => (
    <RootContentSuspension suspended={suspended}>
      <BrowseShell
        mode="series"
        provider="vidlink"
        placeholder="Search"
        commands={[]}
        idleContext={{
          continueWatching: { title: "Same visible name", titleId, mediaKind: "series", ep },
        }}
        loadIdleContext={async () => ({
          continueWatching: { title: "Same visible name", titleId, mediaKind: "series", ep },
        })}
        onSearch={async () => ({ options: [], subtitle: "" })}
        onResolve={(action) => actions.push(action)}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    </RootContentSuspension>
  );
  type TargetState = { titleId: string; ep: string; suspended: boolean };
  const control = createRef<{ replace: (next: TargetState) => void }>();
  function StatefulShell() {
    const [target, setTarget] = useState<TargetState>({
      titleId: "tmdb:1",
      ep: "S01E01",
      suspended: false,
    });
    useImperativeHandle(control, () => ({ replace: setTarget }), []);
    return renderShell(target.titleId, target.suspended, target.ep);
  }
  const replace = async (titleId: string, suspended = false, ep = "S01E01") => {
    await act(async () => control.current!.replace({ titleId, suspended, ep }));
  };
  const handle = renderWithPointer(<StatefulShell />, { columns: 120, rows: 40 });
  const target = () =>
    handle.dispatcher.debugRegions().find((row) => row.id.startsWith("browse:idle:continue:"));
  try {
    await act(async () => {});
    handle.click(target()!.id);
    await replace("tmdb:2");
    handle.click(target()!.id);
    expect(actions).toEqual([]);
    await replace("tmdb:2", false, "S01E02");
    handle.click(target()!.id);
    expect(actions).toEqual([]);
    await replace("tmdb:2", true);
    expect(target()).toBeUndefined();
    expect(handle.dispatcher.debugRegions().some((row) => row.id.includes(":footer:"))).toBe(false);
    await replace("tmdb:2");
    expect(target()?.id).toContain("tmdb:2");
    handle.click(target()!.id);
    expect(actions).toEqual([]);
  } finally {
    handle.unmount();
  }
});
