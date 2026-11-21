import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { BrowseShell } from "@/app-shell/browse-shell";
import { MouseDispatcher, MouseDispatchProvider } from "@/app-shell/mouse/MouseRegions";
import { toBrowseResultOption } from "@/app/search/browse-option-mappers";
import type { SearchResult } from "@/domain/types";
import React from "react";

import { captureFrame, stripAnsi } from "./render-capture";

const RESULTS: readonly SearchResult[] = [
  {
    id: "demo:odyssey",
    type: "movie",
    title: "The Odyssey",
    year: "2026",
    overview: "A retelling of Homer's epic voyage across the ancient Mediterranean.",
    posterPath: null,
    rating: 8.2,
    metadataSource: "TMDB",
  },
  {
    id: "demo:sintel",
    type: "movie",
    title: "Sintel",
    year: "2010",
    overview: "A girl searches for the dragon she lost.",
    posterPath: null,
  },
  {
    id: "demo:big-buck-bunny",
    type: "movie",
    title: "Big Buck Bunny",
    year: "2008",
    overview: "A giant rabbit deals with three bullying rodents.",
    posterPath: null,
  },
  {
    id: "demo:tears-of-steel",
    type: "movie",
    title: "Tears of Steel",
    year: "2012",
    overview: "Warriors and scientists try to save the world from robots.",
    posterPath: null,
  },
];

const options = RESULTS.map((result) => toBrowseResultOption(result));

export function BrowseSearchCapture() {
  const dispatcher = new MouseDispatcher();
  return (
    <MouseDispatchProvider dispatcher={dispatcher}>
      <BrowseShell
        mode="series"
        provider="sample"
        placeholder="Search title"
        initialResults={options}
        initialResultSubtitle="4 results · sample"
        commands={[]}
        onSearch={async () => ({ options: [], subtitle: "" })}
        onResolve={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    </MouseDispatchProvider>
  );
}

const CAPTURE_SIZES = [
  { name: "100x30", columns: 100, rows: 30 },
  { name: "100x32", columns: 100, rows: 32 },
  { name: "100x40", columns: 100, rows: 40 },
  { name: "110x40", columns: 110, rows: 40 },
  { name: "120x40", columns: 120, rows: 40 },
] as const;

if (import.meta.main) {
  const captureDir = path.join(import.meta.dir, "..", "__captures__");
  await mkdir(captureDir, { recursive: true });
  const node = <BrowseSearchCapture />;
  for (const size of CAPTURE_SIZES) {
    const frame = stripAnsi(captureFrame(node, { columns: size.columns, rows: size.rows }));
    const file = path.join(captureDir, `browse-search.${size.name}.txt`);
    const header = `# browse-search · ${size.name} (${size.columns}×${size.rows})\n`;
    await writeFile(file, `${header}${frame}\n`, "utf8");
    console.log(`wrote ${file}`);
  }
  process.exit(0);
}
