// Dependency-free QR Code Model 2 encoder. Share links use byte mode, error
// correction level L, and versions 1–10 to keep terminal output bounded.

type RsBlock = {
  readonly count: number;
  readonly totalCodewords: number;
  readonly dataCodewords: number;
};

type QrVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
const QR_VERSIONS: readonly QrVersion[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type QrFunctionMatrix = {
  readonly modules: boolean[][];
  readonly functions: boolean[][];
};

const RS_BLOCKS_L = {
  1: [{ count: 1, totalCodewords: 26, dataCodewords: 19 }],
  2: [{ count: 1, totalCodewords: 44, dataCodewords: 34 }],
  3: [{ count: 1, totalCodewords: 70, dataCodewords: 55 }],
  4: [{ count: 1, totalCodewords: 100, dataCodewords: 80 }],
  5: [{ count: 1, totalCodewords: 134, dataCodewords: 108 }],
  6: [{ count: 2, totalCodewords: 86, dataCodewords: 68 }],
  7: [{ count: 2, totalCodewords: 98, dataCodewords: 78 }],
  8: [{ count: 2, totalCodewords: 121, dataCodewords: 97 }],
  9: [{ count: 2, totalCodewords: 146, dataCodewords: 116 }],
  10: [
    { count: 2, totalCodewords: 86, dataCodewords: 68 },
    { count: 2, totalCodewords: 87, dataCodewords: 69 },
  ],
} as const satisfies Readonly<Record<number, readonly RsBlock[]>>;

const ALIGNMENT_POSITIONS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
} as const satisfies Readonly<Record<number, readonly number[]>>;

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
initializeGaloisTables();

export type QrMatrix = readonly (readonly boolean[])[];

export function encodeQrMatrix(payload: string): QrMatrix {
  const bytes = new TextEncoder().encode(payload);
  const version = chooseVersion(bytes.length);
  const codewords = buildCodewords(bytes, version);
  const base = createFunctionMatrix(version);
  placeDataBits(base.modules, base.functions, codewords);

  let best: boolean[][] | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = base.modules.map((row) => [...row]);
    applyMask(candidate, base.functions, mask);
    drawFormatBits(candidate, mask);
    const penalty = calculatePenalty(candidate);
    if (penalty < bestPenalty) {
      best = candidate;
      bestPenalty = penalty;
    }
  }
  if (!best) throw new Error("QR mask selection failed");
  return best;
}

export function renderQrHalfBlocks(matrix: QrMatrix, quietZone = 4): string {
  if (matrix.length === 0 || matrix.some((row) => row.length !== matrix.length)) {
    throw new Error("QR matrix must be non-empty and square");
  }
  const width = matrix.length + quietZone * 2;
  const paddedHeight = matrix.length + quietZone * 2;
  const lines: string[] = [];
  for (let y = 0; y < paddedHeight; y += 2) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const top = qrCell(matrix, x - quietZone, y - quietZone);
      const bottom = qrCell(matrix, x - quietZone, y + 1 - quietZone);
      line += top ? (bottom ? "█" : "▀") : bottom ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function chooseVersion(byteLength: number): QrVersion {
  for (const version of QR_VERSIONS) {
    const blocks = RS_BLOCKS_L[version];
    const dataCodewords = blocks.reduce((sum, block) => sum + block.count * block.dataCodewords, 0);
    const lengthBits = version <= 9 ? 8 : 16;
    if (4 + lengthBits + byteLength * 8 <= dataCodewords * 8) return version;
  }
  throw new Error("QR payload is too long for the bounded terminal encoder");
}

function buildCodewords(bytes: Uint8Array, version: QrVersion): Uint8Array {
  const blockSpecs = expandBlocks(RS_BLOCKS_L[version]);
  const dataCapacity = blockSpecs.reduce((sum, block) => sum + block.dataCodewords, 0);
  const bits: number[] = [0, 1, 0, 0];
  appendBits(bits, bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) appendBits(bits, byte, 8);
  const terminator = Math.min(4, dataCapacity * 8 - bits.length);
  for (let i = 0; i < terminator; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(dataCapacity);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      const byteIndex = i >>> 3;
      data[byteIndex] = (data[byteIndex] ?? 0) | (1 << (7 - (i & 7)));
    }
  }
  for (let i = bits.length >>> 3, toggle = 0; i < data.length; i++, toggle ^= 1) {
    data[i] = toggle === 0 ? 0xec : 0x11;
  }

  const dataBlocks: Uint8Array[] = [];
  const errorBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const spec of blockSpecs) {
    const block = data.slice(offset, offset + spec.dataCodewords);
    offset += spec.dataCodewords;
    dataBlocks.push(block);
    errorBlocks.push(reedSolomonRemainder(block, spec.totalCodewords - spec.dataCodewords));
  }

  const output: number[] = [];
  const maxDataLength = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < maxDataLength; i++) {
    for (const block of dataBlocks) if (i < block.length) output.push(block[i] ?? 0);
  }
  const maxErrorLength = Math.max(...errorBlocks.map((block) => block.length));
  for (let i = 0; i < maxErrorLength; i++) {
    for (const block of errorBlocks) if (i < block.length) output.push(block[i] ?? 0);
  }
  return Uint8Array.from(output);
}

function expandBlocks(groups: readonly RsBlock[]): RsBlock[] {
  return groups.flatMap((group) => Array.from({ length: group.count }, () => group));
}

function appendBits(output: number[], value: number, count: number): void {
  for (let bit = count - 1; bit >= 0; bit--) output.push((value >>> bit) & 1);
}

function reedSolomonRemainder(data: Uint8Array, degree: number): Uint8Array {
  let generator = Uint8Array.of(1);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(generator.length + 1);
    for (let j = 0; j < generator.length; j++) {
      const coefficient = generator[j] ?? 0;
      next[j] = (next[j] ?? 0) ^ coefficient;
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMultiply(coefficient, GF_EXP[i] ?? 0);
    }
    generator = next;
  }

  const result = new Uint8Array(data.length + degree);
  result.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = result[i] ?? 0;
    if (factor === 0) continue;
    for (let j = 0; j < generator.length; j++) {
      result[i + j] = (result[i + j] ?? 0) ^ gfMultiply(generator[j] ?? 0, factor);
    }
  }
  return result.slice(data.length);
}

function initializeGaloisTables(): void {
  let value = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < GF_EXP.length; i++) GF_EXP[i] = GF_EXP[i - 255] ?? 0;
}

function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return GF_EXP[(GF_LOG[left] ?? 0) + (GF_LOG[right] ?? 0)] ?? 0;
}

function setMatrixCell(matrix: boolean[][], x: number, y: number, value: boolean): void {
  const row = matrix[y];
  if (!row || x < 0 || x >= row.length) throw new Error("QR matrix coordinate is out of bounds");
  row[x] = value;
}

function matrixCell(matrix: boolean[][], x: number, y: number): boolean {
  const row = matrix[y];
  if (!row || x < 0 || x >= row.length) throw new Error("QR matrix coordinate is out of bounds");
  return row[x] ?? false;
}

function createFunctionMatrix(version: QrVersion): QrFunctionMatrix {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const functions = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const setFunction = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    setMatrixCell(modules, x, y, dark);
    setMatrixCell(functions, x, y, true);
  };

  drawFinderPattern(setFunction, 3, 3);
  drawFinderPattern(setFunction, size - 4, 3);
  drawFinderPattern(setFunction, 3, size - 4);
  for (let i = 8; i < size - 8; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }
  for (const y of ALIGNMENT_POSITIONS[version] ?? []) {
    for (const x of ALIGNMENT_POSITIONS[version] ?? []) {
      if (functions[y]?.[x]) continue;
      drawAlignmentPattern(setFunction, x, y);
    }
  }
  reserveFormatAreas(setFunction, size);
  setFunction(8, size - 8, true);
  if (version >= 7) drawVersionBits(setFunction, version, size);
  return { modules, functions };
}

function drawFinderPattern(
  setFunction: (x: number, y: number, dark: boolean) => void,
  centerX: number,
  centerY: number,
): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(centerX + dx, centerY + dy, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignmentPattern(
  setFunction: (x: number, y: number, dark: boolean) => void,
  centerX: number,
  centerY: number,
): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunction(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function reserveFormatAreas(
  setFunction: (x: number, y: number, dark: boolean) => void,
  size: number,
): void {
  for (let i = 0; i <= 5; i++) setFunction(8, i, false);
  setFunction(8, 7, false);
  setFunction(8, 8, false);
  setFunction(7, 8, false);
  for (let i = 9; i < 15; i++) setFunction(14 - i, 8, false);
  for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, false);
  for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, false);
}

function drawVersionBits(
  setFunction: (x: number, y: number, dark: boolean) => void,
  version: number,
  size: number,
): void {
  let remainder = version;
  for (let i = 0; i < 12; i++) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }
  const bits = (version << 12) | remainder;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(a, b, dark);
    setFunction(b, a, dark);
  }
}

function placeDataBits(modules: boolean[][], functions: boolean[][], codewords: Uint8Array): void {
  const size = modules.length;
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        if (functions[y]?.[x]) continue;
        const byte = codewords[bitIndex >>> 3];
        setMatrixCell(
          modules,
          x,
          y,
          byte === undefined ? false : ((byte >>> (7 - (bitIndex & 7))) & 1) !== 0,
        );
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

function applyMask(modules: boolean[][], functions: boolean[][], mask: number): void {
  for (let y = 0; y < modules.length; y++) {
    for (let x = 0; x < modules.length; x++) {
      if (!functions[y]?.[x] && maskBit(mask, x, y)) {
        setMatrixCell(modules, x, y, !matrixCell(modules, x, y));
      }
    }
  }
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new Error(`Unsupported QR mask ${mask}`);
  }
}

function drawFormatBits(modules: boolean[][], mask: number): void {
  const size = modules.length;
  const data = (1 << 3) | mask; // Error correction level L is format value 01.
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const readBit = (index: number) => ((bits >>> index) & 1) !== 0;

  for (let i = 0; i <= 5; i++) setMatrixCell(modules, 8, i, readBit(i));
  setMatrixCell(modules, 8, 7, readBit(6));
  setMatrixCell(modules, 8, 8, readBit(7));
  setMatrixCell(modules, 7, 8, readBit(8));
  for (let i = 9; i < 15; i++) setMatrixCell(modules, 14 - i, 8, readBit(i));
  for (let i = 0; i < 8; i++) setMatrixCell(modules, size - 1 - i, 8, readBit(i));
  for (let i = 8; i < 15; i++) setMatrixCell(modules, 8, size - 15 + i, readBit(i));
  setMatrixCell(modules, 8, size - 8, true);
}

function calculatePenalty(modules: boolean[][]): number {
  const size = modules.length;
  let penalty = 0;
  for (let y = 0; y < size; y++) penalty += linePenalty(modules[y] ?? []);
  for (let x = 0; x < size; x++) {
    penalty += linePenalty(Array.from({ length: size }, (_, y) => modules[y]?.[x] ?? false));
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const value = modules[y]?.[x];
      if (
        value === modules[y]?.[x + 1] &&
        value === modules[y + 1]?.[x] &&
        value === modules[y + 1]?.[x + 1]
      ) {
        penalty += 3;
      }
    }
  }
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark++;
  penalty += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return penalty;
}

function linePenalty(line: readonly boolean[]): number {
  let penalty = 0;
  let runLength = 1;
  for (let i = 1; i < line.length; i++) {
    if (line[i] === line[i - 1]) {
      runLength++;
      if (runLength === 5) penalty += 3;
      else if (runLength > 5) penalty++;
    } else {
      runLength = 1;
    }
  }

  // Finder-like 1:1:3:1:1 runs are penalized at every scale, with four light
  // modules on either side. Exact 11-cell substring matching misses scaled
  // patterns and can choose a materially worse mask.
  const history = Array<number>(7).fill(0);
  let runColor = false;
  let finderRunLength = 0;
  for (const cell of line) {
    if (cell === runColor) {
      finderRunLength++;
    } else {
      addFinderRun(finderRunLength, history, line.length);
      if (!runColor) penalty += countFinderPatterns(history) * 40;
      runColor = cell;
      finderRunLength = 1;
    }
  }
  if (runColor) {
    addFinderRun(finderRunLength, history, line.length);
    finderRunLength = 0;
  }
  finderRunLength += line.length;
  addFinderRun(finderRunLength, history, line.length);
  penalty += countFinderPatterns(history) * 40;
  return penalty;
}

function addFinderRun(runLength: number, history: number[], lineLength: number): void {
  const adjusted = history[0] === 0 ? runLength + lineLength : runLength;
  history.pop();
  history.unshift(adjusted);
}

function countFinderPatterns(history: readonly number[]): number {
  const scale = history[1] ?? 0;
  const core =
    scale > 0 &&
    history[2] === scale &&
    history[3] === scale * 3 &&
    history[4] === scale &&
    history[5] === scale;
  if (!core) return 0;
  return (
    Number((history[0] ?? 0) >= scale * 4 && (history[6] ?? 0) >= scale) +
    Number((history[6] ?? 0) >= scale * 4 && (history[0] ?? 0) >= scale)
  );
}

function qrCell(matrix: QrMatrix, x: number, y: number): boolean {
  return y >= 0 && x >= 0 && y < matrix.length && x < matrix.length
    ? (matrix[y]?.[x] ?? false)
    : false;
}
