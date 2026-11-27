// Every pose, in a real terminal, under real Ink repaints.
//
// This is the eyes-on check for the companion's picture tier: it mounts each
// pose through the same `CompanionPet` the shell uses, keeps Ink re-rendering
// on a timer, and echoes what you type — so a placement that only survives the
// first frame shows up as a fox that vanishes, and a leaked image shows up as a
// fox still on screen after `q`.
//
//   bun run --cwd apps/cli test/harness/kanna-gallery.tsx [--rows N] [--pose NAME] [--cell WxH]
//
// Pass `--cell` to size her from the real cell, as the shell does:
//
//   --cell "$(python3 -c 'import fcntl,termios,struct;r,c,x,y=struct.unpack("HHHH",fcntl.ioctl(0,termios.TIOCGWINSZ,bytes(8)));print(f"{x//c}x{y//r}")')"
//
// It touches no profile: nothing here opens config, data or cache.

import { companionMode, type CompanionPose } from "@/app-shell/companion-policy";
import { CompanionPet } from "@/app-shell/CompanionPet";
import { kannaSlot, releaseAllKannaSprites } from "@/app-shell/kanna-sprite";
import { reducedMotionEnabled } from "@/app-shell/motion-policy";
import { detectImageCapability } from "@/image";
import { setTerminalCellPixels } from "@/image/cell-size";
import { Box, render, Text, useApp, useInput } from "ink";
import React, { useEffect, useState } from "react";

const ALL: readonly CompanionPose[] = [
  "idle",
  "wait",
  "seek",
  "go",
  "watch",
  "oops",
  "nap",
  "peek",
];

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const rows = Number(flag("--rows") ?? 4);
const only = flag("--pose");
const poses = only ? ALL.filter((pose) => pose === only) : ALL;

/**
 * The cell size comes in as a flag rather than from a terminal query.
 *
 * Asking means reading the reply off stdin in flowing mode, and a stream that
 * has been read that way and paused delivers nothing to Ink's `readable`
 * listener afterwards — the gallery would draw and never hear a key. The shell
 * measures through its mouse session; here the launcher passes what
 * `TIOCGWINSZ` reports (see the usage line above).
 */
function applyCellFlag(): void {
  const [width, height] = (flag("--cell") ?? "").split("x").map(Number);
  if (width && height) setTerminalCellPixels({ width, height });
}

function Gallery() {
  const { exit } = useApp();
  const [tick, setTick] = useState(0);
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 400);
    return () => clearInterval(timer);
  }, []);

  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
    else if (input === "h") setShown((on) => !on);
    else if (key.backspace || key.delete) setTyped((text) => text.slice(0, -1));
    else if (input) setTyped((text) => text + input);
  });

  const capability = detectImageCapability();
  const slot = kannaSlot(rows);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        kanna gallery · mode={companionMode()} · renderer={capability.renderer} · motion=
        {reducedMotionEnabled() ? "reduced" : "on"} · slot={slot.cols}x{slot.rows} cells ={" "}
        {slot.pixels}px
      </Text>
      <Text dimColor>
        ink frame {tick} · typed: {typed || "—"} · h hides her, q quits
      </Text>
      <Box marginTop={1} flexWrap="wrap">
        {shown
          ? poses.map((pose) => (
              <Box key={pose} flexDirection="column" marginRight={2} marginBottom={1}>
                <CompanionPet pose={pose} rows={rows} />
                <Text dimColor>{pose}</Text>
              </Box>
            ))
          : null}
      </Box>
      <Text dimColor>── text under her, to show nothing is clobbered ──</Text>
    </Box>
  );
}

applyCellFlag();
const app = render(<Gallery />);
await app.waitUntilExit();
releaseAllKannaSprites();
process.exit(0);
