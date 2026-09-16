// Runs with the runner's Node, without installing workspace dependencies.
// Keep this policy aligned with job conditions; ci-ready.test.ts checks wiring.
const needs = JSON.parse(process.env.CI_NEEDS ?? "{}");
const event = process.env.GITHUB_EVENT_NAME;
const outputs = needs.changes?.outputs ?? {};
const errors = [];
for (const key of ["cli", "installer", "docs", "doc-coverage", "analytics"]) {
  if (!["true", "false"].includes(outputs[key])) errors.push(`Invalid or missing path filter: ${key}`);
}
if (!["pull_request", "push"].includes(event)) errors.push(`Unsupported CI event: ${event}`);
const main = event === "push";
const cli = outputs.cli === "true";
const installer = outputs.installer === "true";
const required = {
  changes: true,
  fmt: true,
  lint: true,
  typecheck: true,
  test: true,
  "analytics-postgres": main || outputs.analytics === "true",
  "windows-cli": main || cli || installer,
  "macos-cli": main || cli || installer,
  "installer-lint": installer,
  "build-cli": main || cli,
  "checks-docs": main || outputs.docs === "true",
  "checks-doc-coverage": main || outputs["doc-coverage"] === "true",
  "build-binaries": cli || installer,
  "installer-docker": installer,
  "installer-scenarios": installer,
};
for (const [id, mustRun] of Object.entries(required)) {
  const result = needs[id]?.result;
  if (result !== "success" && !(result === "skipped" && !mustRun)) {
    errors.push(`${id}: ${result ?? "missing"}${mustRun ? " (required)" : ""}`);
  }
}
for (const id of Object.keys(needs)) {
  if (!(id in required)) errors.push(`Unclassified CI dependency: ${id}`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("All required CI jobs passed; only expected path-filter skips were accepted.");
}
