/**
 * lint-staged hands staged paths to `oxfmt --write`. That is the wrong default
 * for files oxfmt itself ignores (`.reference/**`, `.archive/**`, the frozen
 * docs pages): a commit made only of such files ends in
 * "Expected at least one target file", exit 2 — a hook failure on a
 * perfectly valid commit. Mixed batches are unaffected upstream: oxfmt
 * formats the matched files and exits 0.
 *
 * So: run oxfmt once with the staged list, and translate exactly the
 * all-ignored refusal into a skip. Any other failure is passed through.
 */
const files = process.argv.slice(2);
if (files.length === 0) process.exit(0);

const run = Bun.spawnSync(["bunx", "oxfmt", "--write", ...files], {
  stdout: "inherit",
  stderr: "pipe",
});

if (run.exitCode !== 0) {
  const stderr = run.stderr.toString();
  if (stderr.includes("excluded by ignore rules")) process.exit(0);
  process.stderr.write(stderr);
  process.exit(run.exitCode);
}
