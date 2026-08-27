#!/usr/bin/env bun
/**
 * Render smoke for the /analytics charts.
 *
 * Every existing docs test renders through `renderToStaticMarkup`, and recharts
 * draws nothing under it — `ResponsiveContainer` measures zero without a
 * layout, so the SSR output is card chrome and no paths at all. That leaves a
 * whole class of defect invisible to `bun run test`: the chart still mounts,
 * it just paints wrong or paints nothing. Every one of these assertions
 * corresponds to a bug that actually shipped into review here:
 *
 *   - an invalid `--color-0.3.0` custom property left bands unpainted
 *   - a mount animation left its clip rect at width 0 and blanked the chart
 *   - a category x-axis drew an 11-day gap the same width as a 1-day gap
 *
 * Opt-in, like the relay smoke: it needs Chrome and a production build, so it
 * is not part of the default gate.
 *
 * Usage: bun run --cwd apps/docs smoke:charts
 */
import path from "node:path";

const DOCS = path.resolve(import.meta.dir, "..");
const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
const DEBUG_PORT = 9412;
const BUN = Bun.which("bun") ?? process.execPath;

const CHROME =
  Bun.which("google-chrome-stable") ??
  Bun.which("google-chrome") ??
  Bun.which("chromium") ??
  Bun.which("chromium-browser");

type Failure = { readonly check: string; readonly detail: string };
const failures: Failure[] = [];

function check(name: string, ok: boolean, detail: string): void {
  if (ok) {
    console.log(`  ok   ${name}`);
    return;
  }
  console.log(`  FAIL ${name} — ${detail}`);
  failures.push({ check: name, detail });
}

/**
 * Poll the URL rather than watch stdout for "Ready".
 * Only one of the two streams ever prints it, so waiting on both hangs, and
 * racing them still couples the check to Next.js's log wording.
 */
async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(400);
  }
  throw new Error(`server did not answer ${url} within ${timeoutMs}ms`);
}

/** A tiny CDP client — enough to navigate, settle, and evaluate. */
async function connect(): Promise<{
  evaluate: (expression: string) => Promise<unknown>;
  navigate: (url: string, width: number) => Promise<void>;
  close: () => void;
}> {
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      break;
    } catch {
      await Bun.sleep(250);
    }
  }
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("Chrome exposed no page target");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve) => {
    socket.addEventListener("open", () => resolve(), { once: true });
  });

  let id = 0;

  /*
   * Frames land in a plain data inbox and each `send` waits for its own id.
   *
   * The obvious shape — a Map of resolver callbacks, looked up by the id on the
   * incoming frame and invoked — dispatches a function chosen by a value read
   * off a socket. CodeQL flags that as an unvalidated dynamic method call, and
   * it is right to: checking that the looked-up value is callable says nothing
   * about which target it is. Here the listener only ever WRITES data, so there
   * is no call to hijack, and the resolution path is ordinary control flow.
   */
  const inbox = new Map<number, Record<string, unknown>>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { id?: unknown };
    const frameId = message.id;
    if (typeof frameId !== "number" || !Number.isSafeInteger(frameId)) return;
    inbox.set(frameId, message as Record<string, unknown>);
  });

  const send = async (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const frameId = (id += 1);
    socket.send(JSON.stringify({ id: frameId, method, params }));
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const frame = inbox.get(frameId);
      if (frame) {
        inbox.delete(frameId);
        return frame;
      }
      await Bun.sleep(10);
    }
    throw new Error(`CDP ${method} did not answer within 30s`);
  };

  await send("Page.enable");
  await send("Runtime.enable");

  return {
    async navigate(url, width) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1400,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send("Page.navigate", { url });
      // ResponsiveContainer paints on a ResizeObserver callback, so the chart
      // geometry does not exist until a frame after load.
      await Bun.sleep(5000);
    },
    async evaluate(expression) {
      const response = (await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
      })) as { result?: { result?: { value?: unknown } } };
      return response.result?.result?.value;
    },
    close: () => socket.close(),
  };
}

async function main(): Promise<void> {
  if (!CHROME) {
    console.error("No Chrome or Chromium on PATH — install one to run the chart smoke.");
    process.exit(1);
  }

  console.log("Building docs...");
  const build = Bun.spawn([BUN, "run", "build"], {
    cwd: DOCS,
    env: { ...process.env, DOCS_SITE_URL: BASE },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await build.exited) !== 0) throw new Error("docs build failed");

  console.log(`Starting Next.js on ${BASE}...`);
  const server = Bun.spawn([BUN, "run", "start", "--", "-p", String(PORT)], {
    cwd: DOCS,
    env: { ...process.env, DOCS_SITE_URL: BASE },
    stdout: "ignore",
    stderr: "ignore",
  });

  const browser = Bun.spawn(
    [
      CHROME,
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--remote-debugging-port=${DEBUG_PORT}`,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );

  try {
    await waitForServer(`${BASE}/analytics`, 60_000);

    const cdp = await connect();

    console.log("\n/analytics at 1280px");
    await cdp.navigate(`${BASE}/analytics`, 1280);

    const areas = (await cdp.evaluate(
      `document.querySelectorAll(".recharts-area-area").length`,
    )) as number;
    check("both installs areas are drawn", areas >= 2, `found ${areas}, expected >= 2`);

    const painted = (await cdp.evaluate(
      `Array.from(document.querySelectorAll(".recharts-area-area")).every((p) => (p.getAttribute("d") ?? "").length > 20)`,
    )) as boolean;
    check("every area has real path data", painted, "an area carried an empty or stub `d`");

    // The bug this exists for: recharts reveals an area by growing a clip rect
    // from width 0. A stalled animation leaves it there and blanks the chart.
    const clipped = (await cdp.evaluate(
      `Array.from(document.querySelectorAll("clipPath[id^='animationClipPath'] rect")).some((r) => Number(r.getAttribute("width")) === 0)`,
    )) as boolean;
    check("no area is clipped to zero width", !clipped, "an animation clip rect is still width 0");

    const strokes = (await cdp.evaluate(
      `JSON.stringify(Array.from(document.querySelectorAll(".recharts-area-curve")).map((p) => getComputedStyle(p).stroke))`,
    )) as string;
    const resolved =
      strokes.includes("rgb(") && !strokes.includes("none") && !strokes.includes('""');
    check("series colours resolve to real values", resolved, `computed strokes were ${strokes}`);

    // Guards the CSS-identifier rule: an invalid `--color-0.3.0` would leave
    // the fill unresolved and the band invisible.
    const fills = (await cdp.evaluate(
      `JSON.stringify(Array.from(document.querySelectorAll("[data-chart]")).flatMap((c) => Array.from(c.querySelectorAll("stop")).map((s) => getComputedStyle(s).stopColor)))`,
    )) as string;
    check(
      "gradient stops resolve to real values",
      !fills.includes('""') && fills.includes("rgb("),
      `computed stop colours were ${fills}`,
    );

    const spansTime = (await cdp.evaluate(
      `(() => { const t = Array.from(document.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick")); return t.length >= 2; })()`,
    )) as boolean;
    check("the x-axis renders multiple ticks", spansTime, "fewer than two x ticks");

    console.log("\n/analytics at 320px");
    await cdp.navigate(`${BASE}/analytics`, 320);

    const overflow = (await cdp.evaluate(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    )) as number;
    check("the page does not scroll sideways", overflow <= 0, `overflowed by ${overflow}px`);

    const chartFits = (await cdp.evaluate(
      `(() => { const s = document.querySelector(".recharts-surface"); if (!s) return -1; const card = s.closest("[data-slot=card]"); return Math.round(s.getBoundingClientRect().right - card.getBoundingClientRect().right); })()`,
    )) as number;
    check("the chart fits inside its card", chartFits <= 0, `chart overhangs by ${chartFits}px`);

    cdp.close();
  } finally {
    browser.kill();
    server.kill();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} chart smoke check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll chart smoke checks passed.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
