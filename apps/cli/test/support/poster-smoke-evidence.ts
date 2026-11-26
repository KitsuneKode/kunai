const ESC = "\x1b";
const SIXEL = `${ESC}P0;1;0q`;
const stringEnd = `(?:[^${ESC}]|${ESC}${ESC})*${ESC}\\\\`;
// Preserve an unmatched APC, DCS, or OSC introducer so the leak scan can see it.
const packets = new RegExp(
  `${ESC}[P_]${stringEnd}|${ESC}\\][^\\x07${ESC}]*(?:\\x07|${ESC}\\\\)|${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}(?!P|_|\\])[ -/]*[@-Z\\\\-~]`,
  "g",
);

export function visibleTerminalText(transcript: string): string {
  return transcript.replace(packets, "");
}

export function hasPrintableGraphicsLeak(transcript: string): boolean {
  const visible = visibleTerminalText(transcript);
  return (
    visible.includes(SIXEL) ||
    /_G(?:a|i|m|f|t)=|\]1337;File=|Ptmux;|\d+;\d+;\d+q(?=["#])/.test(visible)
  );
}

export function posterProtocol(transcript: string): string | null {
  const visible = visibleTerminalText(transcript);
  const tmux = `${ESC}Ptmux;`;
  for (const [packet] of transcript.matchAll(packets)) {
    const wrapped = packet.startsWith(tmux);
    const inner = wrapped ? packet.slice(tmux.length, -2).replaceAll(ESC + ESC, ESC) : packet;
    if (inner.startsWith(`${ESC}_G`)) {
      const [control] = inner.slice(3, -2).split(";", 1);
      const fields = control?.split(",") ?? [];
      if (wrapped && fields.includes("a=T") && fields.includes("U=1")) return "kitty-tmux";
      if (!wrapped && fields.includes("a=p")) return "kitty-direct";
      if (!wrapped && fields.includes("a=T") && visible.includes("\u{10EEEE}")) {
        return "kitty-native";
      }
    }
    if (packet.startsWith(`${ESC}]1337;File=`)) return "iterm-inline";
    if (packet.startsWith(SIXEL) && /[?-~]/.test(packet.slice(SIXEL.length, -2))) return "sixel";
  }
  return visible.includes("▀") ? "half-block" : null;
}

export function matchesPosterRedraw(phase: string, expected: string, transcript: string): boolean {
  const observed = posterProtocol(transcript);
  if (observed === null) return false;
  if (observed !== expected)
    throw new Error(`${phase}: expected ${expected}, observed ${observed}`);
  return true;
}
