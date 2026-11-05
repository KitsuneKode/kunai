/** WebVTT is native to HTML tracks; conservatively convert ordinary SRT only. */
export function browserSubtitleText(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
  } catch {
    return null;
  }
  if (text.includes("\0")) return null;
  if (/^WEBVTT(?:[ \t][^\n]*)?\n(?:\n|$)/.test(text)) return text;

  const blocks = text.trim().split(/\n[ \t]*\n/);
  if (!blocks.length) return null;
  const converted: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const index = /^\d+$/.test(lines[0] ?? "") ? 1 : 0;
    const match = /^(\d{2,}:[0-5]\d:[0-5]\d),(\d{3}) --> (\d{2,}:[0-5]\d:[0-5]\d),(\d{3})$/.exec(
      lines[index] ?? "",
    );
    if (!match || !lines.slice(index + 1).some((line) => line.trim())) return null;
    const timestamp = (clock: string, fraction: string) =>
      clock.split(":").reduce((total, value) => total * 60 + Number(value), 0) * 1000 +
      Number(fraction);
    const [, startClock, startFraction, endClock, endFraction] = match;
    if (!startClock || !startFraction || !endClock || !endFraction) return null;
    const start = timestamp(startClock, startFraction);
    const end = timestamp(endClock, endFraction);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return null;
    lines[index] = `${startClock}.${startFraction} --> ${endClock}.${endFraction}`;
    converted.push(lines.join("\n"));
  }
  return `WEBVTT\n\n${converted.join("\n\n")}\n`;
}
