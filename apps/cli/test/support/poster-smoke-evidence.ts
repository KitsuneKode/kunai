const ESC = "\x1b";
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
  return /_G(?:a|i|m|f|t)=|\]1337;File=|Ptmux;|\[?\d*(?:;\d+)*q(?=["#])/.test(
    visibleTerminalText(transcript),
  );
}

export function posterProtocol(transcript: string): string | null {
  if (transcript.includes(`${ESC}Ptmux;${ESC}${ESC}_Ga=T,`) && transcript.includes("U=1")) {
    return "kitty-tmux";
  }
  if (transcript.includes(`${ESC}_Ga=p,`)) return "kitty-direct";
  if (transcript.includes(`${ESC}_Ga=T,`) && transcript.includes("\u{10EEEE}"))
    return "kitty-native";
  if (transcript.includes(`${ESC}]1337;File=`)) return "iterm-inline";
  if (transcript.includes(`${ESC}P0;1;0q`)) return "sixel";
  if (transcript.includes("▀")) return "half-block";
  return null;
}
