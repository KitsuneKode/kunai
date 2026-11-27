// Holds one real Kanna sprite and waits to be signalled.
//
// The art is the shipped strip, decoded and framed by the real pipeline; only
// the terminal question is answered for it ("placeholders, no tmux") and the
// transport is pinned to chunks, so every byte lands on stdout where the test
// reads it. The SIGINT handler is the shape `main.ts` installs: the signal
// ends in `process.exit`, and the sprite's `exit` hook must delete her.

import { __testing, acquireKannaSprite, holdKannaSprites } from "@/app-shell/kanna-sprite";

__testing.runtime.passthrough = () => null;
__testing.runtime.env = () => ({});

process.on("SIGINT", () => process.exit(130));

holdKannaSprites();
const sprite = await acquireKannaSprite("seek", { rows: 4, cols: 9, pixels: 92 }, true);
process.stderr.write(sprite ? `ready ${sprite.imageId}\n` : "failed\n");
// The interval only holds the event loop open; nothing waits on it.
// sleep-allow: a real child process must stay alive until the test signals it
setInterval(() => undefined, 60_000);
