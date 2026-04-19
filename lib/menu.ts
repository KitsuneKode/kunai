import { note, select, confirm, log } from "@clack/prompts";
import { isCancel } from "@clack/prompts";
import { saveConfig, type KitsuneConfig } from "./config";
import { getAllHistory, clearEntry, clearAllHistory, isFinished, formatTimestamp } from "./history";

// =============================================================================
// ANSI COLOR HELPERS — no extra dependency, thin wrappers around escape codes.
// =============================================================================

export const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;
export const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`;
export const cyan   = (s: string) => `\x1b[36m${s}\x1b[0m`;
export const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
// Highlighted shortcut key (bold + cyan)
export const key    = (k: string) => `\x1b[1m\x1b[36m${k}\x1b[0m`;

// =============================================================================
// RAW-MODE SINGLE-KEY READER
//
// MPV runs with stdio:"inherit" and modifies the terminal's raw/cooked mode.
// A persistent readline interface can receive EOF when MPV exits, breaking
// subsequent reads. This function always creates a fresh raw-mode listener
// so it is safe to call repeatedly after arbitrary subprocess invocations.
// =============================================================================

export async function readSingleKey(): Promise<string> {
  return new Promise((resolve) => {
    const onData = (buf: Buffer) => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      const k = buf.toString();
      if (k === "\x03") { // Ctrl+C
        process.stdout.write("\n");
        process.exit(0);
      }
      resolve(k.toLowerCase().trim() || "");
    };

    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once("data", onData);
    } catch {
      // Non-TTY fallback (e.g. piped input)
      process.stdin.once("data", (buf) => {
        process.stdin.pause();
        resolve(buf.toString().trim().toLowerCase().slice(0, 1) || "");
      });
    }
  });
}

// =============================================================================
// POST-EPISODE MENU
// =============================================================================

export type MenuContext = {
  type:       "movie" | "series";
  title:      string;
  season:     number;
  episode:    number;
  provider:   string;
  showMemory: boolean;
};

export function drawMenu(ctx: MenuContext): void {
  const SEP = dim("  " + "─".repeat(52));

  const contextLine = ctx.type === "movie"
    ? `${bold(ctx.title)}  ${dim("·")}  ${dim(ctx.provider)}`
    : `${bold(ctx.title)}  ${dim("·")}  ${cyan(`S${String(ctx.season).padStart(2, "0")}E${String(ctx.episode).padStart(2, "0")}`)}  ${dim("·")}  ${dim(ctx.provider)}`;

  console.log(`\n${SEP}`);
  console.log(`  ${contextLine}`);
  console.log(SEP);

  if (ctx.type === "series") {
    console.log(`
  ${key("n")}  next episode    ${key("p")}  previous episode
  ${key("s")}  next season     ${key("o")}  switch provider
  ${key("r")}  replay          ${key("c")}  settings
  ${key("q")}  quit
`);
  } else {
    console.log(`
  ${key("r")}  replay          ${key("c")}  settings
  ${key("q")}  quit
`);
  }

  if (ctx.showMemory) {
    const m  = process.memoryUsage();
    const mb = (b: number) => (b / 1_048_576).toFixed(1);
    console.log(SEP);
    console.log(`  ${dim(`Mem  RSS ${mb(m.rss)} MB · Heap ${mb(m.heapUsed)}/${mb(m.heapTotal)} MB`)}\n`);
  }

  process.stdout.write(`  ${dim("›")} `);
}

// =============================================================================
// SETTINGS MENU
//
// Returns the updated config on save, or null if the user cancelled.
// The caller is responsible for applying changes to session state.
// =============================================================================

export async function openSettings(current: KitsuneConfig): Promise<KitsuneConfig | null> {
  console.log();
  note("Changes apply immediately and save as new defaults.", "Settings 🦊");

  const guard = <T>(v: T | symbol): T | null => (isCancel(v) ? null : (v as T));

  // ── What to do ───────────────────────────────────────────────────────────
  const section = guard(await select({
    message: "Section:",
    options: [
      { value: "preferences", label: "Preferences  (provider, subtitles, browser, display)" },
      { value: "history",     label: "History  (view & manage watch history)" },
    ],
  })) as "preferences" | "history" | null;
  if (section === null) return null;

  // ── History management ───────────────────────────────────────────────────
  if (section === "history") {
    await manageHistory();
    return current; // no config changes from history section
  }

  // ── Preferences ──────────────────────────────────────────────────────────
  const newProvider = guard(await select({
    message: "Default provider:",
    options: [
      { value: "vidking", label: "VidKing  (recommended)" },
      { value: "cineby",  label: "Cineby" },
    ],
    initialValue: current.provider,
  })) as "vidking" | "cineby" | null;
  if (newProvider === null) return null;

  const newSubLang = guard(await select({
    message: "Default subtitles:",
    options: [
      { value: "en",   label: "English" },
      { value: "fzf",  label: "Pick interactively with fzf" },
      { value: "none", label: "None" },
      { value: "ar",   label: "Arabic" },
      { value: "fr",   label: "French" },
      { value: "de",   label: "German" },
      { value: "es",   label: "Spanish" },
      { value: "ja",   label: "Japanese" },
    ],
    initialValue: current.subLang,
  })) as string | null;
  if (newSubLang === null) return null;

  const newHeadless = guard(await confirm({
    message: "Run browser headless? (saves ~100 MB RAM)",
    initialValue: current.headless,
  })) as boolean | null;
  if (newHeadless === null) return null;

  const newShowMem = guard(await confirm({
    message: "Show memory usage in post-episode menu?",
    initialValue: current.showMemory,
  })) as boolean | null;
  if (newShowMem === null) return null;

  const updated: KitsuneConfig = {
    provider:   newProvider,
    subLang:    newSubLang,
    headless:   newHeadless,
    showMemory: newShowMem,
  };

  await saveConfig(updated);
  log.success(`Saved  ${green(newProvider)}  ·  ${newSubLang} subs  ·  ${newHeadless ? "headless" : "visible"}`);
  return updated;
}

// =============================================================================
// HISTORY VIEWER
// =============================================================================

async function manageHistory(): Promise<void> {
  const all = await getAllHistory();
  const entries = Object.entries(all);

  if (entries.length === 0) {
    log.info("No watch history yet.");
    return;
  }

  // Sort by most recently watched
  entries.sort((a, b) => new Date(b[1].watchedAt).getTime() - new Date(a[1].watchedAt).getTime());

  // Build the display list
  const label = ([id, e]: [string, (typeof all)[string]]) => {
    const progress = e.duration
      ? `${Math.round((e.timestamp / e.duration) * 100)}%`
      : formatTimestamp(e.timestamp);
    const where = e.type === "series"
      ? `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}  ${progress}`
      : `movie  ${progress}`;
    const finished = isFinished(e) ? dim(" ✓") : "";
    const date = new Date(e.watchedAt).toLocaleDateString();
    return `${e.title.padEnd(30)}  ${where.padEnd(14)}  ${dim(date)}${finished}`;
  };

  const guard = <T>(v: T | symbol): T | null => (isCancel(v) ? null : (v as T));

  const action = guard(await select({
    message: "History:",
    options: [
      ...entries.map(([id, e]) => ({ value: `entry:${id}`, label: label([id, e]) })),
      { value: "clear-all", label: dim("── Clear all history ──") },
    ],
  })) as string | null;
  if (action === null) return;

  if (action === "clear-all") {
    const sure = guard(await confirm({ message: "Delete all watch history? This cannot be undone.", initialValue: false })) as boolean | null;
    if (sure) { await clearAllHistory(); log.success("Watch history cleared."); }
    return;
  }

  if (action.startsWith("entry:")) {
    const tmdbId = action.slice(6);
    const entry  = all[tmdbId];
    if (!entry) return;

    const entryAction = guard(await select({
      message: `${entry.title}:`,
      options: [
        { value: "remove", label: "Remove this entry from history" },
        { value: "back",   label: "Back" },
      ],
    })) as "remove" | "back" | null;

    if (entryAction === "remove") {
      await clearEntry(tmdbId);
      log.success(`Removed "${entry.title}" from history.`);
    }
  }
}
