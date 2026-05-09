export function isPngBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export function isPngBuffer(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data, 0, Math.min(data.byteLength, 8));
  return isPngBytes(bytes);
}
