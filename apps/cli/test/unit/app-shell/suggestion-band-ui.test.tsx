import { describe, expect, test } from "bun:test";

import { measureColumns } from "@/app-shell/shell-text";
import { getSuggestionBandRowCount, SearchSuggestionBand } from "@/app-shell/suggestion-band-ui";
import { buildSuggestionBand } from "@/domain/search/suggestion-engine";
import { Box, Text } from "ink";

import { render, stripAnsi } from "../../harness/render-capture";

describe("bounded suggestion surface", () => {
  test.each([24, 40, 60, 100])(
    "long non-Latin metadata fits %i columns and previews selection",
    (width) => {
      const model = buildSuggestionBand({
        query: "東京",
        local: [],
        remotePending: false,
        remote: [
          {
            id: "jp",
            title: "東京の物語と長い名前".repeat(8),
            source: "catalog",
            meta: "2026 · 映画".repeat(10),
            badge: "お気に入り".repeat(8),
            value: "jp",
          },
        ],
      });
      const h = render(<SearchSuggestionBand model={model} selectedIndex={0} width={width} />, {
        columns: width,
        rows: 40,
      });
      try {
        const frame = stripAnsi(h.lastFrame());
        expect(frame).toContain("┌");
        expect(frame).toContain("Preview");
        expect(frame).toContain("東京");
        expect(frame.split("\n").every((line) => measureColumns(line) <= width)).toBe(true);
      } finally {
        h.unmount();
      }
    },
  );
  test("query-history preview offers search, never promises title details", () => {
    const model = buildSuggestionBand({
      query: "du",
      remote: [],
      remotePending: true,
      local: [{ id: "query", title: "dune", source: "query-history", commitQuery: "dune" }],
    });
    const h = render(<SearchSuggestionBand model={model} selectedIndex={0} width={60} />, {
      columns: 60,
      rows: 40,
    });
    try {
      expect(h.lastFrame()).toContain("Enter search");
      expect(h.lastFrame()).not.toContain("Ctrl+O");
    } finally {
      h.unmount();
    }
  });
});

test("a bounded window follows the last selection and accounts for every rendered row", () => {
  const model = buildSuggestionBand({
    query: "du",
    local: [],
    remotePending: false,
    remote: Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      title: `Dune chapter ${i + 1}`,
      source: "catalog" as const,
      meta: "2026 · Movie",
      value: i,
    })),
  });
  for (const selectedIndex of [-1, 0, 5]) {
    const h = render(
      <SearchSuggestionBand model={model} selectedIndex={selectedIndex} width={60} maxRows={7} />,
      { columns: 60, rows: 30 },
    );
    try {
      const lines = stripAnsi(h.lastFrame()).split("\n");
      expect(lines.length).toBe(getSuggestionBandRowCount(model, selectedIndex, 7));
      expect(lines.length).toBeLessThanOrEqual(7);
      expect(h.lastFrame()).toContain("↑↓ move");
      if (selectedIndex >= 0) expect(h.lastFrame()).toContain(`Dune chapter ${selectedIndex + 1}`);
    } finally {
      h.unmount();
    }
  }
});

test("empty, pending, missing metadata and joined emoji remain bounded", () => {
  for (const pending of [false, true]) {
    const model = buildSuggestionBand({
      query: "du",
      local: [],
      remote: [],
      remotePending: pending,
    });
    const h = render(<SearchSuggestionBand model={model} width={24} />, { columns: 24, rows: 30 });
    try {
      expect(
        h
          .lastFrame()
          .split("\n")
          .every((line) => measureColumns(stripAnsi(line)) <= 24),
      ).toBe(true);
      expect(h.lastFrame()).not.toContain("Preview");
    } finally {
      h.unmount();
    }
  }
  const model = buildSuggestionBand({
    query: "du",
    local: [],
    remotePending: false,
    remote: [{ id: "emoji", title: "Dune 👩🏽‍🚀 é adventures", source: "catalog", value: 1 }],
  });
  const h = render(<SearchSuggestionBand model={model} selectedIndex={0} width={24} />, {
    columns: 24,
    rows: 30,
  });
  try {
    expect(h.lastFrame()).toContain("👩🏽‍🚀");
    expect(h.lastFrame()).toContain("Title suggestion");
    expect(h.lastFrame()).not.toContain("undefined");
  } finally {
    h.unmount();
  }
});

test("a constrained parent cannot squeeze suggestion rows into each other", () => {
  const model = buildSuggestionBand({
    query: "du",
    local: [],
    remotePending: false,
    remote: [{ id: "dune", title: "Dune", meta: "2026 · Movie", source: "catalog", value: 1 }],
  });
  const h = render(
    <Box height={7} flexDirection="column">
      <Text>Search title</Text>
      <SearchSuggestionBand model={model} selectedIndex={0} width={60} maxRows={7} />
      <Text>Search footer</Text>
    </Box>,
    { columns: 60, rows: 30 },
  );
  try {
    expect(h.lastFrame()).toContain("Preview · Enter open · Ctrl+O details");
    expect(h.lastFrame()).toContain("Suggestions · ↑↓ move · Esc dismiss");
    const lines = h.lastFrame().split("\n");
    expect(lines.findIndex((line) => line.includes("Preview"))).not.toBe(
      lines.findIndex((line) => line.includes("Suggestions")),
    );
  } finally {
    h.unmount();
  }
});
