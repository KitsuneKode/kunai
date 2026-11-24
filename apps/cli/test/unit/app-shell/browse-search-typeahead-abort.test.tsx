// Deterministic browse submit while a type-ahead request is in flight — the
// superseded suggestion abort must not surface as a search error.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrowseShell } from "@/app-shell/browse-shell";
import type { SearchSuggestion } from "@/domain/search/suggestion-engine";
import type { SearchResult } from "@/domain/types";
import React, { act } from "react";

import { render } from "../../harness/render-capture";
import { applyStorageRootEnv } from "../../helpers/storage-env";

let storageRoot = "";
let restoreEnv: () => void = () => undefined;

beforeAll(() => {
  storageRoot = mkdtempSync(join(tmpdir(), "kunai-browse-search-typeahead-abort-"));
  restoreEnv = applyStorageRootEnv(storageRoot);
});

afterAll(() => {
  restoreEnv();
  rmSync(storageRoot, { recursive: true, force: true });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  promise.catch(() => {});
  return { promise, resolve };
}

function searchResult(id: string, title: string): SearchResult {
  return { id, type: "movie", title, year: "2026", overview: "", posterPath: null };
}

function catalogSuggestion(title: string): SearchSuggestion<SearchResult> {
  return {
    id: `catalog:${title}`,
    title,
    source: "catalog",
    value: searchResult(`tmdb:${title}`, title),
  };
}

async function nextMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("browse search vs type-ahead abort", () => {
  test("submit resolves while a superseded type-ahead is cancelled", async () => {
    const suggest = deferred<readonly SearchSuggestion<SearchResult>[]>();
    const suggestStarted = deferred<void>();
    let suggestAborted = false;
    const search = deferred<{ options: []; subtitle: string }>();

    const handle = render(
      <BrowseShell
        mode="series"
        provider="videasy"
        placeholder="Search"
        commands={[]}
        suggestionDebounceMs={0}
        onSuggest={async (_query, signal) => {
          suggestStarted.resolve();
          await new Promise<void>((resolve, reject) => {
            if (signal.aborted) {
              reject(new DOMException("The operation was aborted.", "AbortError"));
              return;
            }
            signal.addEventListener(
              "abort",
              () => {
                suggestAborted = true;
                reject(new DOMException("The operation was aborted.", "AbortError"));
              },
              { once: true },
            );
            void suggest.promise.then(() => resolve());
          });
          if (signal.aborted) {
            throw new DOMException("The operation was aborted.", "AbortError");
          }
          return suggest.promise;
        }}
        onSearch={async () => search.promise}
        onResolve={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
      { columns: 100, rows: 40 },
    );

    try {
      await act(async () => {
        for (const char of "dune") {
          handle.stdin.enqueue([char]);
        }
        await nextMacrotask();
        await nextMacrotask();
      });
      // The type-ahead must really be in flight, or Enter supersedes nothing.
      await act(async () => {
        await suggestStarted.promise;
      });

      await act(async () => {
        handle.stdin.enqueue("\r");
        await nextMacrotask();
      });

      suggest.resolve([catalogSuggestion("Dune")]);
      search.resolve({ options: [], subtitle: "1 result · TMDB" });

      await act(async () => {
        await nextMacrotask();
        await nextMacrotask();
      });

      const frame = handle.lastFrame();
      expect(frame).toContain("1 result");
      expect(frame).not.toContain("Search service unreachable");
      expect(frame).not.toContain("Search failed:");
      expect(suggestAborted).toBe(true);
    } finally {
      handle.unmount();
    }
  });
});
