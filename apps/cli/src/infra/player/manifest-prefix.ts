export type ManifestPrefix = "hls" | "dash" | "media" | "incomplete";

/** Inspect a bounded prefix, allowing transport splits, XML prologs, and comments. */
export function classifyManifestPrefix(bytes: Uint8Array): ManifestPrefix {
  const bom = [0xef, 0xbb, 0xbf];
  if (bytes.length < 3 && bytes.every((byte, index) => byte === bom[index])) return "incomplete";
  let text = Buffer.from(bytes).toString("utf-8").trimStart();
  if (!text) return "incomplete";
  if (text.startsWith("#")) {
    if ("#EXTM3U".startsWith(text)) return text.length < 7 ? "incomplete" : "hls";
    return text.startsWith("#EXTM3U") ? "hls" : "media";
  }
  for (;;) {
    if (text.startsWith("<?")) {
      const end = text.indexOf("?>");
      if (end < 0) return "incomplete";
      text = text.slice(end + 2).trimStart();
    } else if (text.startsWith("<!--")) {
      const end = text.indexOf("-->");
      if (end < 0) return "incomplete";
      text = text.slice(end + 3).trimStart();
    } else {
      break;
    }
  }
  if (!text || text === "<" || "<!--".startsWith(text)) return "incomplete";
  // Route declarations through the strict parser, which refuses DTD/entities.
  if (text.startsWith("<!")) return "dash";
  if (!text.startsWith("<")) return "media";
  const opening = /^<([A-Za-z_][\w.:-]*)(?=[\s/>])/.exec(text);
  if (opening) return opening[1]?.split(":").at(-1) === "MPD" ? "dash" : "media";
  return /^<[A-Za-z_][\w.:-]*$/.test(text) ? "incomplete" : "media";
}
