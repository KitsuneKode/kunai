import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const outputRoot = join(import.meta.dir, "..", ".vercel", "output");

const functions = [
  {
    entrypoint: join(import.meta.dir, "..", "api", "health.ts"),
    outfile: join(outputRoot, "functions", "api", "health.func", "api", "health.js"),
    packageJson: join(outputRoot, "functions", "api", "health.func", "package.json"),
  },
  {
    entrypoint: join(import.meta.dir, "..", "api", "rpc", "[providerId].ts"),
    outfile: join(
      outputRoot,
      "functions",
      "api",
      "rpc",
      "[providerId].func",
      "api",
      "rpc",
      "[providerId].js",
    ),
    packageJson: join(outputRoot, "functions", "api", "rpc", "[providerId].func", "package.json"),
  },
] as const;

for (const fn of functions) {
  await mkdir(dirname(fn.outfile), { recursive: true });
  const outputName = basename(fn.entrypoint, ".ts");
  const result = await Bun.build({
    entrypoints: [fn.entrypoint],
    outdir: dirname(fn.outfile),
    target: "node",
    format: "esm",
    packages: "bundle",
    sourcemap: "external",
    naming: `${outputName}-[hash].js`,
    minify: false,
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }

  const built = result.outputs.find((output) => output.path.endsWith(".js"));
  if (!built) {
    console.error(`No bundled output created for ${fn.entrypoint}`);
    process.exit(1);
  }

  await Bun.write(fn.outfile, await built.text());
  await writeFile(fn.packageJson, JSON.stringify({ type: "module" }, null, 2).concat("\n"), "utf8");
}
