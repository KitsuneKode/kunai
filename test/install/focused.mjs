// Focused installer functions, exercised in real Bash/PowerShell processes.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const [rootArg, ...platforms] = process.argv.slice(2);
const root = resolve(rootArg);
const fixture = mkdtempSync(join(tmpdir(), "installer-metadata-"));
const children = new Set();
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith("KUNAI_") || key.startsWith("BUN_INSTALL")) delete env[key];
}
for (const key of [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
]) {
  env[key] = join(fixture, key);
  mkdirSync(env[key]);
}
env.KUNAI_DATA_DIR = join(fixture, "data");
env.KUNAI_SOURCE_DIR = join(fixture, "checkout");
const bashFunctions = join(fixture, "functions.sh");
writeFileSync(
  bashFunctions,
  readFileSync(join(root, "install.sh"), "utf8").replace(/^main "\$@"\s*$/m, ""),
);

function start(platform, body) {
  const prefix =
    platform === "bash"
      ? `source '${bashFunctions}'\n`
      : `$ErrorActionPreference = 'Stop'\n$tokens = $null; $errors = $null\n$ast = [System.Management.Automation.Language.Parser]::ParseFile('${join(root, "install.ps1")}', [ref]$tokens, [ref]$errors)\nif ($errors.Count) { throw 'installer parse failed' }\n$functions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)\n. ([scriptblock]::Create(($functions | ForEach-Object { $_.Extent.Text }) -join "\n"))\n$Package = '@kitsunekode/kunai'\n$DataDir = $env:KUNAI_DATA_DIR\n$DryRun = $false\n`;
  const script = join(
    fixture,
    `child-${children.size}-${Math.random().toString(16).slice(2)}.${platform === "bash" ? "sh" : "ps1"}`,
  );
  writeFileSync(script, prefix + body);
  const child = spawn(
    platform === "bash" ? "bash" : "pwsh",
    platform === "bash" ? [script] : ["-NoProfile", "-File", script],
    { env, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(child);
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const exited = new Promise((resolveExit, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      children.delete(child);
      resolveExit({ code, stderr });
    });
  });
  return {
    child,
    exited,
    async line(expected) {
      const next = await lines.next();
      assert.equal(next.value, expected, stderr);
    },
  };
}

async function metadata(platform) {
  const checkout = env.KUNAI_SOURCE_DIR;
  const cli = join(checkout, "apps", "cli");
  mkdirSync(cli, { recursive: true });
  writeFileSync(join(checkout, "package.json"), JSON.stringify({ name: "kunai", private: true }));
  const manifest = join(cli, "package.json");
  writeFileSync(manifest, JSON.stringify({ name: "@kitsunekode/kunai", version: "0.3.0" }));
  const resolveBody =
    platform === "bash"
      ? `finalize_package_active_version source latest\n`
      : `Complete-PackageActiveVersion 'source' 'latest'\n`;
  async function expectVersion() {
    const check = start(platform, resolveBody);
    await check.line("0.3.0");
    assert.equal((await check.exited).code, 0);
  }
  await expectVersion();
  // A valid root must not mask a broken workspace manifest.
  writeFileSync(
    join(checkout, "package.json"),
    JSON.stringify({ name: "@kitsunekode/kunai", version: "0.3.0" }),
  );
  for (const invalid of [
    { name: "other", version: "0.3.0" },
    { name: "@kitsunekode/kunai", version: "invalid" },
  ]) {
    writeFileSync(manifest, JSON.stringify(invalid));
    assert.notEqual((await start(platform, resolveBody).exited).code, 0);
  }
  rmSync(manifest);
  assert.notEqual((await start(platform, resolveBody).exited).code, 0);
  rmSync(cli, { recursive: true });
  await expectVersion();
  rmSync(checkout, { recursive: true });
  console.log(
    `PASS ${platform}: monorepo metadata, name/version validation, no broken-workspace fallback, legacy root fallback`,
  );
}

try {
  for (const platform of platforms) {
    if (
      platform === "powershell" &&
      spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { env }).error?.code === "ENOENT"
    ) {
      console.log("SKIP powershell: pwsh is not installed");
      continue;
    }
    await metadata(platform);
  }
} finally {
  for (const child of children) child.kill();
  rmSync(fixture, { recursive: true, force: true });
}
