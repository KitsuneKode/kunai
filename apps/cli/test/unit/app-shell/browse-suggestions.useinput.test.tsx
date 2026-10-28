// =============================================================================
// browse-suggestions.useinput — the mounted suggestion-band contract.
//
// Drives a real BrowseShell through the stdin bridge: band renders under the
// field while typing, ↓ highlights a row, Enter commits a title row through
// the same onSubmit the results list uses, Esc dismisses the band before the
// ladder resumes. `suggestionDebounceMs: 0` collapses the catalog wait to one
// macrotask — no sleeps, no wall-clock assertions.
// =============================================================================

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrowseShell } from "@/app-shell/browse-shell";
import type { SearchSuggestion } from "@/domain/search/suggestion-engine";
import type { SearchResult } from "@/domain/types";
import React, { act } from "react";

import { render, stripAnsi } from "../../harness/render-capture";
import { applyStorageRootEnv } from "../../helpers/storage-env";

// BrowseShell reads search-history.json on every local-corpus pass — the file
// lives under the real config root, so isolate before any mount or a dev
// profile leaks into assertions.
let storageRoot = "";
let restoreEnv: () => void = () => undefined;

beforeAll(() => {
  storageRoot = mkdtempSync(join(tmpdir(), "kunai-browse-suggestions-"));
  restoreEnv = applyStorageRootEnv(storageRoot);
});

afterAll(() => {
  restoreEnv();
  rmSync(storageRoot, { recursive: true, force: true });
});

function searchResult(id: string, title: string): SearchResult {
  return {
    id,
    type: "movie",
    title,
    year: "2026",
    overview: "",
    posterPath: null,
  };
}

function localSuggestion(id: string, title: string): SearchSuggestion<SearchResult> {
  return {
    id,
    title,
    source: "watched",
    badge: "watched",
    value: searchResult(id, title),
  };
}

async function nextMacrotask(): Promise<void> {
  // A single event-loop yield flushes the debounce-0 catalog timer — this is a
  // scheduling boundary, not a sleep: the callback is already queued.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function pressEscape(handle: { stdin: { enqueue: (data: string) => void } }): Promise<void> {
  await act(async () => {
    handle.stdin.enqueue("\x1b");
    // Ink defers a lone ESC briefly to disambiguate escape sequences — same
    // convention as library-input-ownership's pressEscape.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

async function type(handle: ReturnType<typeof render>, text: string): Promise<void> {
  await act(async () => {
    for (const char of text) {
      handle.stdin.enqueue([char]);
    }
    await nextMacrotask();
  });
}

describe("browse shell suggestion band", () => {
  test("band renders local + catalog rows under the field after ~2 chars", async () => {
    const handle = render(
      <BrowseShell
        mode="series"
        provider="videasy"
        placeholder="Search"
        commands={[]}
        suggestionDebounceMs={0}
        loadLocalSuggestions={() => [localSuggestion("local:dune", "Dune Patrol")]}
        onSuggest={async () => [
          {
            id: "catalog:dune",
            title: "Dune Messiah",
            source: "catalog",
            meta: "2026 · Movie",
            value: searchResult("tmdb:1", "Dune Messiah"),
          },
        ]}
        onSearch={async () => ({ options: [], subtitle: "0 results" })}
        onResolve={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      expect(stripAnsi(handle.lastFrame())).not.toContain("Dune Patrol");

      await type(handle, "du");
      // One more boundary: the debounce-0 timer fires during the first yield,
      // then the resolved catalog promise commits on this one.
      await act(async () => {
        await nextMacrotask();
      });
      const frame = stripAnsi(handle.lastFrame());
      expect(frame).toContain("From your list");
      expect(frame).toContain("Dune Patrol");
      expect(frame).toContain("Catalog");
      expect(frame).toContain("Dune Messiah");
      expect(frame).toContain("watched");
    } finally {
      handle.unmount();
    }
  });

  test("↓ highlights a suggestion and Enter commits it through onSubmit", async () => {
    const submitted: string[] = [];
    const searches: string[] = [];
    const handle = render(
      <BrowseShell
        mode="series"
        provider="videasy"
        placeholder="Search"
        commands={[]}
        suggestionDebounceMs={0}
        loadLocalSuggestions={() => [localSuggestion("local:dune", "Dune Patrol")]}
        onSuggest={async () => []}
        onSearch={async (query) => {
          searches.push(query);
          return { options: [], subtitle: "0 results" };
        }}
        onResolve={() => {}}
        onSubmit={(value) => {
          submitted.push(value.id);
        }}
        onCancel={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await type(handle, "du");
      expect(stripAnsi(handle.lastFrame())).toContain("Dune Patrol");

      await act(async () => {
        handle.stdin.enqueue(["\x1b[B"]); // ↓ into the band
      });
      expect(stripAnsi(handle.lastFrame())).toMatch(/▌.*Dune Patrol/s);

      await act(async () => {
        handle.stdin.enqueue(["\r"]);
        await nextMacrotask();
      });
      // The pick lands through the SAME commit the results list uses — no
      // second search of the raw draft fired alongside it.
      expect(submitted).toEqual(["local:dune"]);
      expect(searches).toEqual([]);
    } finally {
      handle.unmount();
    }
  });

  test("plain Enter with nothing highlighted still runs the real search", async () => {
    const searches: string[] = [];
    const handle = render(
      <BrowseShell
        mode="series"
        provider="videasy"
        placeholder="Search"
        commands={[]}
        suggestionDebounceMs={0}
        loadLocalSuggestions={() => [localSuggestion("local:dune", "Dune Patrol")]}
        onSuggest={async () => []}
        onSearch={async (query) => {
          searches.push(query);
          return { options: [], subtitle: "0 results" };
        }}
        onResolve={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await type(handle, "du");
      expect(stripAnsi(handle.lastFrame())).toContain("Dune Patrol");

      await act(async () => {
        handle.stdin.enqueue(["\r"]);
        await nextMacrotask();
      });
      expect(searches).toEqual(["du"]);
    } finally {
      handle.unmount();
    }
  });

  test("Esc dismisses the band for the draft; typing brings it back", async () => {
    const handle = render(
      <BrowseShell
        mode="series"
        provider="videasy"
        placeholder="Search"
        commands={[]}
        suggestionDebounceMs={0}
        loadLocalSuggestions={() => [localSuggestion("local:dune", "Dune Patrol")]}
        onSuggest={async () => []}
        onSearch={async () => ({ options: [], subtitle: "0 results" })}
        onResolve={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await type(handle, "du");
      expect(stripAnsi(handle.lastFrame())).toContain("Dune Patrol");

      await pressEscape(handle); // Esc — band only, query survives
      expect(stripAnsi(handle.lastFrame())).not.toContain("Dune Patrol");
      expect(stripAnsi(handle.lastFrame())).toContain("du");

      await type(handle, "n"); // next keystroke → band returns
      expect(stripAnsi(handle.lastFrame())).toContain("Dune Patrol");
    } finally {
      handle.unmount();
    }
  });

  test("typing keeps editing the draft while a suggestion is highlighted", async () => {
    const handle = render(
      <BrowseShell
        mode="series"
        provider="videasy"
        placeholder="Search"
        commands={[]}
        suggestionDebounceMs={0}
        loadLocalSuggestions={() => [localSuggestion("local:dune", "Dune Patrol")]}
        onSuggest={async () => []}
        onSearch={async () => ({ options: [], subtitle: "0 results" })}
        onResolve={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await type(handle, "du");
      await act(async () => {
        handle.stdin.enqueue(["\x1b[B"]);
      });
      await type(handle, "n");
      // The keystroke edited the draft (band re-scored, highlight cleared) —
      // the band never captured the field.
      const frame = stripAnsi(handle.lastFrame());
      expect(frame).toContain("dun");
      expect(frame).not.toMatch(/▌.*Dune Patrol/s);
    } finally {
      handle.unmount();
    }
  });
});
