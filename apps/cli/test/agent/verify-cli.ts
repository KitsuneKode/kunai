#!/usr/bin/env bun
/**
 * Ergonomic verification entrypoints — doctor preflight, L2 smoke, Kitty fixture
 * drives, and post-run evidence survival checks.
 */
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { verifyCitations } from "./evidence";
import { assertKittyEvidenceSurvival, checkKittyDoctor } from "./verification";

const AGENT_DIR = import.meta.dir;
const SCENARIOS = {
  interactive: join(AGENT_DIR, "scenario-interactive.json"),
  palette: join(AGENT_DIR, "scenario-interactive.json"),
} as const;

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    live: { type: "boolean" },
    provider: { type: "string" },
    requiresMpv: { type: "boolean" },
    evidence: { type: "string" },
    bundle: { type: "string" },
    citation: { type: "string", multiple: true },
  },
});

const command = positionals[0];
if (!command) {
  console.log(`Usage:
  bun run agent:verify -- doctor [--live] [--provider ID] [--requires-mpv]
  bun run agent:verify -- evidence --evidence DIR
  bun run agent:verify -- citation --bundle DIR --citation TEXT [--citation TEXT…]
  bun run agent:verify -- l2-smoke [--evidence DIR]
  bun run agent:verify -- kitty-fixture [--evidence DIR] [--scenario interactive]
`);
  process.exit(1);
}

async function main() {
  switch (command) {
    case "doctor": {
      const report = await checkKittyDoctor({
        live: values.live,
        requiresMpv: values.requiresMpv,
        providerId: values.provider,
      });
      for (const line of report.lines) console.log(line);
      if (!report.ok) process.exit(1);
      console.log("doctor: prerequisites satisfied (launch not attempted)");
      break;
    }

    case "evidence": {
      const dir = values.evidence ?? positionals[1];
      if (!dir) throw new Error("Pass --evidence DIR with the external bundle root");
      const resultsPath = join(resolve(dir), "results.json");
      if (!existsSync(resultsPath)) throw new Error(`Missing ${resultsPath}`);
      const parsed = JSON.parse(await Bun.file(resultsPath).text()) as {
        results: { label: string; status: string; reason?: string }[];
      };
      assertKittyEvidenceSurvival(resolve(dir), parsed.results);
      console.log(`evidence: survival check passed for ${parsed.results.length} route(s)`);
      break;
    }

    case "citation": {
      if (!values.bundle) throw new Error("Pass --bundle DIR from an L2 --evidence run");
      const citations = values.citation ?? [];
      if (citations.length === 0) throw new Error("Pass at least one --citation TEXT");
      const bundleDir = resolve(values.bundle);
      const transcript = join(bundleDir, "transcript.md");
      if (!existsSync(transcript)) throw new Error(`Missing L2 bundle at ${bundleDir}`);
      const framesDir = join(bundleDir, "frames");
      const framePaths = existsSync(framesDir)
        ? readdirSync(framesDir).map((name) => join(framesDir, name))
        : [];
      const { unverified } = verifyCitations({
        bundle: {
          dir: bundleDir,
          transcriptPath: transcript,
          framePaths,
          dbPath: join(bundleDir, "db"),
        },
        citations,
      });
      if (unverified.length > 0) {
        console.error("Unverified citations:", unverified);
        process.exit(1);
      }
      console.log("citation: all claims found in bundle transcript/frames");
      break;
    }

    case "l2-smoke": {
      const evidence = values.evidence ?? mkdtempSync(join(tmpdir(), "kunai-verify-l2-"));
      const drive = join(AGENT_DIR, "drive.ts");
      const proc = Bun.spawn(
        [
          process.execPath,
          drive,
          "--mpv",
          "fake",
          "--evidence",
          evidence,
          "--show",
          "frame,history",
          "--keys",
          "smoke",
          "<enter>",
          "<wait:Smoke>",
          "<enter>",
          "<wait:Post-play>",
        ],
        { cwd: join(AGENT_DIR, "../.."), stdout: "inherit", stderr: "inherit" },
      );
      if ((await proc.exited) !== 0) process.exit(proc.exitCode ?? 1);
      console.log(`l2-smoke: evidence at ${evidence}`);
      break;
    }

    case "kitty-fixture": {
      const scenarioName = (positionals[1] ?? "interactive") as keyof typeof SCENARIOS;
      const scenarioPath = SCENARIOS[scenarioName];
      if (!scenarioPath || !existsSync(scenarioPath)) {
        throw new Error(
          `Unknown scenario ${scenarioName}; available: ${Object.keys(SCENARIOS).join(", ")}`,
        );
      }
      const evidence = values.evidence ?? mkdtempSync(join(tmpdir(), "kunai-verify-kitty-"));
      const kitty = join(AGENT_DIR, "kitty.ts");
      const doctor = await checkKittyDoctor({ requiresMpv: false });
      for (const line of doctor.lines) console.log(line);
      if (!doctor.ok) process.exit(1);
      const proc = Bun.spawn(
        [process.execPath, kitty, "--evidence", evidence, "--scenario", scenarioPath],
        { cwd: join(AGENT_DIR, "../.."), stdout: "inherit", stderr: "inherit" },
      );
      const code = await proc.exited;
      if (code !== 0) process.exit(code ?? 1);
      const results = JSON.parse(await Bun.file(join(evidence, "results.json")).text()) as {
        results: { label: string; status: string }[];
      };
      assertKittyEvidenceSurvival(evidence, results.results);
      console.log(`kitty-fixture: evidence at ${evidence}`);
      break;
    }

    default:
      throw new Error(`Unknown command ${command}`);
  }
}

await main();
