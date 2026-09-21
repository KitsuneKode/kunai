/**
 * `bun run agent:drive` — stateless replay driver for agents.
 *
 * Boots a fresh seeded sandbox, replays `--keys` through the real root shell
 * (L2: in-process AppRoot + real container), prints whatever `--show` asks
 * for, and exits. Exploration and assertion run the SAME path: read the frame,
 * decide what to press next, and only write a scenario file once the flow is
 * understood.
 *
 * Keys: each `--keys` item is one input chunk. C-escapes are decoded
 * (`\r`, `\x1b`, `\t`, `\n`) and `<name>` tokens map to keys.ts
 * (`<enter>`, `<esc>`, `<up>`, `<down>`, `<left>`, `<right>`, `<tab>`,
 * `<space>`, `<backspace>`, `<ctrlC>`). Literal text like `history` types
 * character by character. The pseudo-token `<wait:TEXT>` pauses the replay
 * until a frame contains TEXT — how a multi-surface flow waits like a human
 * instead of typing into a surface that hasn't rendered yet.
 * `<wait-config:key=value>` waits for the (debounced) config write to land —
 * frame says it AND the file commits it, or the run times out honestly.
 *
 * Examples:
 *   bun run agent:drive -- --keys '/' --keys 'smoke movie' --keys '<enter>' --show frame,tables
 *   bun run agent:drive -- --keys '<esc>' --wait-for 'welcome' --show frame --evidence /tmp/ev
 *   bun run agent:drive -- --verify-citation 'Smoke Movie' --keys '/' 'movie' '<enter>' --show frame
 */
import { createAgentSession, type AgentSessionOptions } from "./agent-driver";
import { writeEvidenceBundle, verifyCitations } from "./evidence";
import { K } from "./keys";

type ShowSection = "frame" | "history" | "queue" | "config" | "tables" | "delta" | "journal";

const SHOW_SECTIONS: readonly ShowSection[] = [
  "frame",
  "history",
  "queue",
  "config",
  "tables",
  "delta",
  "journal",
];

const NAMED_KEYS: Record<string, string> = {
  enter: K.enter,
  esc: K.esc,
  escape: K.esc,
  tab: K.tab,
  space: K.space,
  backspace: K.backspace,
  up: K.up,
  down: K.down,
  left: K.left,
  right: K.right,
  ctrlc: K.ctrlC,
};

function decodeKey(raw: string): string {
  const named = /^<([a-zA-Z]+)>$/.exec(raw);
  const name = named?.[1];
  if (name) {
    const key = NAMED_KEYS[name.toLowerCase()];
    if (!key) throw new Error(`unknown key name <${name}>`);
    return key;
  }
  return raw
    .replace(/\\x1b|\\e/g, "\x1b")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n");
}

type DriveStep =
  | { kind: "key"; value: string }
  | { kind: "wait"; text: string }
  | { kind: "waitConfig"; key: string; value: string };

interface DriveArgs {
  steps: DriveStep[];
  show: ShowSection[];
  waitFor: string[];
  citations: string[];
  evidenceDir?: string;
  options: AgentSessionOptions;
}

function usage(): never {
  console.error(`usage: bun run agent:drive -- [opts]
  --keys <k>...            keys to replay (repeatable; escapes, <names>, <wait:text>,
                           <wait-config:key=value>)
  --show <a,b,c>           sections: ${SHOW_SECTIONS.join(",")} (default: frame,tables)
  --wait-for <text>        require the frame to contain text (repeatable)
  --verify-citation <text> require text to appear in captured evidence (repeatable)
  --evidence <dir>         write an evidence bundle (transcript + frames + db deltas)
  --seed onboarded|fresh   profile seed (default: onboarded)
  --providers smoke|none   fixture providers (default: smoke)
  --mpv fake|none          PATH-shim fake mpv (default: none)
  --fake-mpv-mode <m>      normal | fail-pre-loaded | hold
  --width N / --rows N     terminal size (default: 100x30)
  --set-env K=V            extra env for the session (repeatable)`);
  process.exit(2);
}

function parseArgs(argv: string[]): DriveArgs {
  const out: DriveArgs = {
    steps: [],
    show: ["frame", "tables"],
    waitFor: [],
    citations: [],
    options: { label: "agent-drive", recordEvidence: true },
  };
  let showSet = false;
  const extraEnv: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) usage();
      return value;
    };
    switch (arg) {
      case "--keys": {
        // Consume every following non-flag token so typing a word is one flag:
        // `--keys s m o k e <enter>` — not six repeated flags.
        let consumed = 0;
        while (i + 1 < argv.length) {
          const token = argv[i + 1];
          if (token === undefined || token.startsWith("--")) break;
          i++;
          const wait = /^<wait:(.+)>$/i.exec(token);
          const waitConfig = /^<wait-config:([A-Za-z0-9_.-]+)=(.*)>$/i.exec(token);
          out.steps.push(
            wait?.[1]
              ? { kind: "wait", text: wait[1] }
              : waitConfig?.[1] !== undefined
                ? { kind: "waitConfig", key: waitConfig[1], value: waitConfig[2] ?? "" }
                : { kind: "key", value: decodeKey(token) },
          );
          consumed++;
        }
        if (consumed === 0) usage();
        break;
      }
      case "--show": {
        const sections = next()
          .split(",")
          .map((s) => s.trim()) as ShowSection[];
        for (const s of sections) {
          if (!SHOW_SECTIONS.includes(s)) usage();
        }
        if (!showSet) {
          out.show = sections;
          showSet = true;
        } else {
          out.show.push(...sections);
        }
        break;
      }
      case "--wait-for":
        out.waitFor.push(next());
        break;
      case "--verify-citation":
        out.citations.push(next());
        break;
      case "--evidence":
        out.evidenceDir = next();
        break;
      case "--seed": {
        const seed = next();
        if (seed !== "onboarded" && seed !== "fresh") usage();
        out.options = { ...out.options, seed };
        break;
      }
      case "--providers": {
        const providers = next();
        if (providers !== "smoke" && providers !== "none") usage();
        out.options = { ...out.options, providers };
        break;
      }
      case "--mpv": {
        const mpv = next();
        if (mpv !== "fake" && mpv !== "none") usage();
        out.options = { ...out.options, mpv };
        break;
      }
      case "--fake-mpv-mode": {
        const mode = next();
        if (mode !== "normal" && mode !== "fail-pre-loaded" && mode !== "hold") usage();
        out.options = { ...out.options, fakeMpvMode: mode };
        break;
      }
      case "--width":
        out.options = { ...out.options, columns: Number(next()) || undefined };
        break;
      case "--rows":
        out.options = { ...out.options, rows: Number(next()) || undefined };
        break;
      case "--set-env": {
        const kv = next();
        const eq = kv.indexOf("=");
        if (eq <= 0) usage();
        extraEnv[kv.slice(0, eq)] = kv.slice(eq + 1);
        break;
      }
      default:
        usage();
    }
  }
  if (Object.keys(extraEnv).length > 0) {
    out.options = { ...out.options, extraEnv };
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const session = await createAgentSession(args.options);
  let failed = false;

  try {
    const bootSnapshot = session.snapshot();
    // The phase machine boots asynchronously — always settle before reading,
    // or the frame is whatever mid-mount state happened to be committed.
    await session.waitSettled();
    for (const step of args.steps) {
      if (step.kind === "wait") {
        await session.waitForFrame(
          (f) => f.includes(step.text),
          `frame contains ${JSON.stringify(step.text)}`,
        );
      } else if (step.kind === "waitConfig") {
        // Config writes are debounced (~300ms) — a frame claiming "Minimal"
        // while config.json still says nothing is a deferred write, not a
        // no-op. This is the bounded poll that tells them apart.
        await session.waitForBackend(
          (i) => i.config()[step.key] === step.value,
          `config.${step.key} === ${JSON.stringify(step.value)}`,
        );
      } else {
        session.press(step.value);
        await session.waitSettled();
      }
    }
    for (const needle of args.waitFor) {
      await session.waitForFrame(
        (f) => f.includes(needle),
        `frame contains ${JSON.stringify(needle)}`,
      );
    }

    const inspect = session.inspect();
    for (const section of args.show) {
      console.log(`\n== ${section} ==`);
      switch (section) {
        case "frame":
          console.log(session.frame());
          break;
        case "history":
          console.log(JSON.stringify(inspect.history(), null, 2));
          break;
        case "queue":
          console.log(JSON.stringify(inspect.queue(), null, 2));
          break;
        case "config":
          console.log(JSON.stringify(inspect.config(), null, 2));
          break;
        case "tables":
          console.log(JSON.stringify(inspect.tables(), null, 2));
          break;
        case "delta": {
          const delta = session.diffSince(bootSnapshot);
          const obj: Record<string, { added: number; removed: number }> = {};
          for (const [table, d] of delta)
            obj[table] = { added: d.added.length, removed: d.removed.length };
          console.log(JSON.stringify(obj, null, 2));
          break;
        }
        case "journal":
          for (const entry of session.journal) {
            const deltas = Object.entries(entry.dbDelta)
              .map(([t, d]) => `${t} +${d.added}/-${d.removed}`)
              .join(", ");
            console.log(
              `${String(entry.step).padStart(2, "0")} ${entry.kind} ${entry.label}${deltas ? `  [${deltas}]` : ""}`,
            );
          }
          break;
      }
    }

    session.assertPrivacyClean();

    if (args.evidenceDir) {
      const bundle = writeEvidenceBundle({
        dir: args.evidenceDir,
        journal: session.journal,
        inspect,
      });
      console.log(`\n== evidence ==\n${bundle.transcriptPath}`);
      if (args.citations.length > 0) {
        const { unverified } = verifyCitations({ bundle, citations: args.citations });
        if (unverified.length > 0) {
          failed = true;
          console.log(`\n== UNVERIFIED CITATIONS (${unverified.length}) ==`);
          for (const c of unverified) console.log(`  ✗ ${c}`);
        } else {
          console.log(`\n== citations verified: ${args.citations.length} ==`);
        }
      }
    } else if (args.citations.length > 0) {
      // Citations without a bundle verify against captured frames directly.
      const corpus = session.frames().join("\n") + "\n" + session.frame();
      const unverified = args.citations.filter((c) => !corpus.includes(c.trim()));
      if (unverified.length > 0) {
        failed = true;
        console.log(`\n== UNVERIFIED CITATIONS (${unverified.length}) ==`);
        for (const c of unverified) console.log(`  ✗ ${c}`);
      } else {
        console.log(`\n== citations verified: ${args.citations.length} ==`);
      }
    }
  } finally {
    await session.dispose();
  }
  process.exit(failed ? 1 : 0);
}

await main();
