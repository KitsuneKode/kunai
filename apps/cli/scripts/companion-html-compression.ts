import { statSync } from "node:fs";
import { resolve } from "node:path";

import type { BunPlugin } from "bun";

import { renderWebCompanionHtml } from "../../../packages/relay/src/web-companion-html";

const SERVICE_MARKER = "KUNAI_BUILD_COMPANION_SERVICE_NAME";
const companionPath = resolve(
  import.meta.dirname,
  "../../../packages/relay/src/web-companion-html.ts",
);

/** Compress the exact rendered template without changing HTML, CSS or JavaScript. */
export function compressedCompanionModuleSource(source: string): string {
  const start = source.indexOf("return `");
  const end = source.lastIndexOf("`;");
  if (start < 0 || end <= start || (source.match(/\$\{/g)?.length ?? 0) !== 1) {
    throw new Error("[build] Companion template changed; review its build transform");
  }
  const html = renderWebCompanionHtml({ serviceName: SERVICE_MARKER });
  const pieces = html.split(SERVICE_MARKER);
  if (pieces.length !== 2) throw new Error("[build] Companion service marker changed");
  // The CLI is Bun-only. Inflate on companion requests, keeping startup and other
  // runtimes free of both the HTML allocation and a runtime minifier dependency.
  const compressed = Buffer.from(Bun.gzipSync(html)).toString("base64");
  // Retain the original function and service escaping; only its static template changes.
  return (
    source.slice(0, start) +
    `return new TextDecoder().decode(Bun.gunzipSync(Buffer.from(${JSON.stringify(compressed)}, "base64"))).replace(${JSON.stringify(SERVICE_MARKER)}, () => service)` +
    source.slice(end + 1)
  );
}

/** Shared by npm and compiled outputs, without adding a runtime minifier. */
export function companionHtmlCompressionPlugin(): BunPlugin {
  return {
    name: "kunai-companion-html-compression",
    setup(build) {
      const expected = statSync(companionPath, { bigint: true });
      build.onLoad({ filter: /web-companion-html\.ts$/ }, async ({ path }) => {
        const loaded = statSync(path, { bigint: true });
        if (loaded.dev !== expected.dev || loaded.ino !== expected.ino) return;
        return {
          contents: compressedCompanionModuleSource(await Bun.file(path).text()),
          loader: "ts",
        };
      });
    },
  };
}
