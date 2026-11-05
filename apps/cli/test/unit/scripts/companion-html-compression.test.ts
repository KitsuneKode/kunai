import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { renderWebCompanionHtml } from "../../../../../packages/relay/src/web-companion-html";
import { releaseBuildBaseOptions } from "../../../scripts/build-shared";
import {
  companionHtmlCompressionPlugin,
  compressedCompanionModuleSource,
} from "../../../scripts/companion-html-compression";

const cliRoot = resolve(import.meta.dirname, "../../..");
const companionPath = resolve(cliRoot, "../../packages/relay/src/web-companion-html.ts");

test("release companion transform preserves markup, escaping and shipped interaction behavior", async () => {
  const temp = await mkdtemp(join(tmpdir(), "kunai-companion-build-"));
  try {
    const source = await Bun.file(companionPath).text();
    const transformed = compressedCompanionModuleSource(source);
    expect(Buffer.byteLength(transformed)).toBeLessThan(Buffer.byteLength(source) / 2);
    const build = await Bun.build({
      entrypoints: [companionPath],
      plugins: [companionHtmlCompressionPlugin()],
      target: "bun",
      format: "esm",
      minify: true,
    });
    expect(build.success).toBe(true);
    const outputPath = join(temp, "companion.mjs");
    const outputText = await build.outputs[0]!.text();
    expect(outputText).toContain("gunzipSync");
    await Bun.write(outputPath, outputText);
    const built: { renderWebCompanionHtml: (options?: { serviceName?: string }) => string } =
      await import(outputPath);
    const options = { serviceName: 'A<&>" service $& $$ $`' };
    const originalHtml = renderWebCompanionHtml(options);
    const builtHtml = built.renderWebCompanionHtml(options);
    expect(builtHtml).toBe(originalHtml);
    expect(builtHtml).toContain("A&lt;&amp;&gt;&quot; service");
    expect(builtHtml).toContain("<script>");
    expect(builtHtml).toContain("<style>");

    // Reuse the actual browser-script behavior suite against the release-built
    // module. This exercises authentication, stale results, modes and cleanup
    // after binary-safe compression, not just a parse.
    const suitePath = resolve(cliRoot, "../../packages/relay/test/web-companion-html.test.ts");
    const suite = await Bun.file(suitePath).text();
    const testPath = join(temp, "release-companion.test.ts");
    await Bun.write(
      testPath,
      suite.replace('from "../src/web-companion-html"', `from ${JSON.stringify(outputPath)}`),
    );
    const child = Bun.spawn([process.execPath, "run", "test:file", testPath], {
      cwd: cliRoot,
      env: { ...process.env, DO_NOT_TRACK: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exit !== 0) throw new Error(`Release companion behavior failed:\n${stdout}\n${stderr}`);
    expect(stderr).toContain("0 fail");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("both release graphs use the transform and structural changes fail closed", async () => {
  expect(
    releaseBuildBaseOptions(cliRoot).plugins?.some(
      (plugin) => plugin.name === "kunai-companion-html-compression",
    ),
  ).toBe(true);
  const source = await Bun.file(companionPath).text();
  expect(() =>
    compressedCompanionModuleSource(source.replace("${service}", "${service}${service}")),
  ).toThrow("template changed");
});
