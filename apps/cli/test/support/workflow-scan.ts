/** 1-based line numbers inside `run: |` / `run: >` block scalars that expand an input. */
export function inputExpansionsInRunBlocks(yaml: string): number[] {
  const hits: number[] = [];
  let blockIndent: number | null = null;
  yaml.split("\n").forEach((line, index) => {
    const indent = line.length - line.trimStart().length;
    if (blockIndent !== null && line.trim() !== "" && indent <= blockIndent) blockIndent = null;
    const opener = /^(\s*)(?:-\s+)?run:\s*([|>][-+]?)?\s*(.*)$/.exec(line);
    if (blockIndent === null && opener) {
      if (opener[2]) {
        blockIndent = (opener[1] ?? "").length;
        return;
      }
      // A one-line `run:` is shell source too.
      if (/\$\{\{\s*(?:github\.event\.)?inputs\./.test(opener[3] ?? "")) hits.push(index + 1);
      return;
    }
    if (blockIndent !== null && /\$\{\{\s*(?:github\.event\.)?inputs\./.test(line)) {
      hits.push(index + 1);
    }
  });
  return hits;
}
