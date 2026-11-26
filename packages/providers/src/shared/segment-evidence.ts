/**
 * Byte-level evidence about what a probed body really is: TS packet runs,
 * fragmented-MP4 boxes, image-container magic, and HLS manifest labels.
 * Content-types lie in both directions on these CDNs (TS labelled image/jpeg,
 * PNG decoys labelled video), so the resolve gate decides from these bytes.
 */

export function hasTransportStreamSync(prefix: Uint8Array): boolean {
  // One ASCII 'G' also starts ordinary text. Require three 188-byte packet boundaries.
  return (
    prefix.byteLength >= 377 && prefix[0] === 0x47 && prefix[188] === 0x47 && prefix[376] === 0x47
  );
}

/**
 * A run of three TS packets starting anywhere in the first few KiB. Some CDNs
 * prepend a small image header to genuine TS so the segment passes as a
 * picture; ffmpeg's demuxer resyncs past it, so that is media, not a decoy.
 */
export function hasTransportStreamSyncAnywhere(prefix: Uint8Array): boolean {
  const lastStart = Math.min(prefix.byteLength - 377, 4096);
  for (let offset = 0; offset <= lastStart; offset += 1) {
    if (prefix[offset] === 0x47 && prefix[offset + 188] === 0x47 && prefix[offset + 376] === 0x47) {
      return true;
    }
  }
  return false;
}

/**
 * Positive magic bytes of an image container — evidence the bytes are a decoy,
 * never a media segment. Vidrock's top lanes serve literal PNG files as HLS
 * segments: the manifest probes clean, the segment answers 206 with an
 * `image/png` content-type and a large enough body, and mpv dies on decode.
 * The inverse disguise exists too — working lanes serve TS bytes mislabeled
 * `image/jpeg` — so the discriminator is the magic bytes, never the label.
 *
 * Ordered after the media checks by the caller: a body with real TS sync or an
 * fMP4 box is playable whatever its first bytes coincidentally resemble.
 */
export function hasImageContainerMagic(prefix: Uint8Array): boolean {
  if (prefix.byteLength < 4) return false;
  // PNG: 89 50 4E 47
  if (prefix[0] === 0x89 && prefix[1] === 0x50 && prefix[2] === 0x4e && prefix[3] === 0x47) {
    return true;
  }
  // JPEG: FF D8 FF
  if (prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return true;
  }
  // GIF87a/GIF89a: 47 49 46 38 — colliding with TS requires the media checks to
  // have already failed on a sub-377-byte read plus three specific PID bytes.
  if (prefix[0] === 0x47 && prefix[1] === 0x49 && prefix[2] === 0x46 && prefix[3] === 0x38) {
    return true;
  }
  // WebP: RIFF ???? WEBP
  if (
    prefix.byteLength >= 12 &&
    prefix[0] === 0x52 &&
    prefix[1] === 0x49 &&
    prefix[2] === 0x46 &&
    prefix[3] === 0x46 &&
    prefix[8] === 0x57 &&
    prefix[9] === 0x45 &&
    prefix[10] === 0x42 &&
    prefix[11] === 0x50
  ) {
    return true;
  }
  return false;
}

type IsoBoxPrefix = { readonly type: string; readonly payload: number; readonly end: number };

export function readIsoBox(view: DataView, offset: number): IsoBoxPrefix | null {
  if (offset + 8 > view.byteLength) return null;
  let size = view.getUint32(offset);
  const type = String.fromCharCode(
    ...[0, 1, 2, 3].map((index) => view.getUint8(offset + 4 + index)),
  );
  let header = 8;
  if (size === 1) {
    if (offset + 16 > view.byteLength) return null;
    const extendedSize = view.getBigUint64(offset + 8);
    if (extendedSize < 16n || extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(extendedSize);
    header = 16;
  }
  if (size === 0 && type === "mdat")
    return { type, payload: offset + header, end: Number.POSITIVE_INFINITY };
  if (size < header) return null;
  const end = offset + size;
  if (!Number.isSafeInteger(end)) return null;
  return { type, payload: offset + header, end };
}

function hasTrackFragment(
  view: DataView,
  box: IsoBoxPrefix,
  minimumDataOffset: number,
  dataEndOffset: number,
): boolean {
  let header = false;
  let decodeTime = false;
  const runs: IsoBoxPrefix[] = [];
  let defaultSampleSize: number | undefined;
  for (let offset = box.payload; offset < box.end;) {
    const child = readIsoBox(view, offset);
    if (!child || child.end > box.end) return false;
    const length = child.end - child.payload;
    if (child.type === "tfhd") {
      if (header || length < 8) return false;
      const flags = view.getUint32(child.payload);
      // HLS uses fragment-relative addressing, never an absolute external base.
      if ((flags & ~0x03003a) !== 0 || view.getUint32(child.payload + 4) === 0) return false;
      const optionalFields = [2, 8, 16, 32].filter((flag) => (flags & flag) !== 0).length;
      if (length !== 8 + optionalFields * 4) return false;
      if ((flags & 0x10) !== 0) {
        const sizeOffset = child.payload + 8 + (flags & 2 ? 4 : 0) + (flags & 8 ? 4 : 0);
        defaultSampleSize = view.getUint32(sizeOffset);
      }
      header = true;
    } else if (child.type === "tfdt") {
      if (decodeTime || length < 8) return false;
      const flags = view.getUint32(child.payload);
      if (flags !== 0 && flags !== 0x01000000) return false;
      if (length !== (flags === 0 ? 8 : 12)) return false;
      decodeTime = true;
    } else if (child.type === "trun") {
      if (length < 12) return false;
      const flags = view.getUint32(child.payload);
      const version = flags >>> 24;
      const fields = flags & 0xffffff;
      if (version > 1 || (fields & ~0xf05) !== 0 || (fields & 1) === 0) return false;
      const samples = view.getUint32(child.payload + 4);
      const sampleFields = [0x100, 0x200, 0x400, 0x800].filter(
        (flag) => (fields & flag) !== 0,
      ).length;
      if (samples === 0 || length !== 12 + (fields & 4 ? 4 : 0) + samples * sampleFields * 4)
        return false;
      const sampleOffset = view.getInt32(child.payload + 8);
      if (sampleOffset < minimumDataOffset || sampleOffset >= dataEndOffset) return false;
      runs.push(child);
    }
    offset = child.end;
  }
  if (!header || !decodeTime || runs.length === 0) return false;
  if (!Number.isFinite(dataEndOffset)) return true;
  // Resolve defaults after the whole traf, so box order cannot bypass extent checks.
  for (const child of runs) {
    const fields = view.getUint32(child.payload) & 0xffffff;
    const samples = view.getUint32(child.payload + 4);
    let remaining = dataEndOffset - view.getInt32(child.payload + 8);
    if ((fields & 0x200) !== 0) {
      const stride =
        [0x100, 0x200, 0x400, 0x800].filter((flag) => (fields & flag) !== 0).length * 4;
      const firstSize = child.payload + 12 + (fields & 4 ? 4 : 0) + (fields & 0x100 ? 4 : 0);
      // Explicit sizes imply a bounded entry table already checked against box length.
      for (let index = 0; index < samples; index++) {
        const size = view.getUint32(firstSize + index * stride);
        if (size > remaining) return false;
        remaining -= size;
      }
    } else if (defaultSampleSize !== undefined) {
      // A field-free run may claim billions of samples. Never loop over that count
      // or round its product past JS's safe-integer range.
      if (BigInt(samples) * BigInt(defaultSampleSize) > BigInt(remaining)) return false;
    }
    // Otherwise sizes live in the initialization segment's trex, not this prefix.
    // Keep the structural-prefix contract; this is not a full media decode check.
  }
  return true;
}

export function hasFragmentedMp4Prefix(prefix: Uint8Array): boolean {
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  for (let offset = 0; offset < prefix.byteLength;) {
    const box = readIsoBox(view, offset);
    if (!box || box.end > prefix.byteLength) return false;
    if (box.type === "moof") {
      const data = readIsoBox(view, box.end);
      if (
        !data ||
        data.type !== "mdat" ||
        data.end <= data.payload ||
        prefix.byteLength <= data.payload
      )
        return false;
      let header = false;
      let tracks = 0;
      for (let childOffset = box.payload; childOffset < box.end;) {
        const child = readIsoBox(view, childOffset);
        if (!child || child.end > box.end) return false;
        if (child.type === "mfhd") {
          if (header || child.end - child.payload !== 8 || view.getUint32(child.payload) !== 0)
            return false;
          header = true;
        } else if (child.type === "traf") {
          if (!hasTrackFragment(view, child, data.payload - offset, data.end - offset))
            return false;
          tracks++;
        }
        childOffset = child.end;
      }
      // The moof must be complete. Only mdat's media payload may extend beyond
      // the prefix; an ftyp marker alone or a truncated fragment proves nothing.
      return header && tracks > 0;
    }
    if (!["styp", "sidx", "emsg", "prft", "free", "skip"].includes(box.type)) return false;
    if (box.type === "styp" && (box.end - box.payload < 8 || (box.end - box.payload) % 4 !== 0))
      return false;
    offset = box.end;
  }
  return false;
}

/** Content-types HLS manifests are served under, extensionless URLs included. */
export function isHlsContentType(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().includes("mpegurl") ?? false;
}
