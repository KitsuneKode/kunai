import { requirePortableHttpUrl } from "./portable-url";

export type MobileCommand =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | {
      readonly kind: "host-proof";
      readonly probeUrl: string;
      readonly mediaUrl: string;
    };

export function parseMobileArgs(argv: readonly string[]): MobileCommand {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--help")) {
    return { kind: "help" };
  }
  if (argv.length === 1 && argv[0] === "--version") return { kind: "version" };

  let hostProof = false;
  let probeUrl: string | undefined;
  let mediaUrl: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--host-proof") {
      if (hostProof) throw new Error("Duplicate --host-proof");
      hostProof = true;
      continue;
    }
    if (argument === "--probe-url" || argument === "--media-url") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      if (argument === "--probe-url") {
        if (probeUrl !== undefined) throw new Error("Duplicate --probe-url");
        probeUrl = requirePortableHttpUrl(value, argument);
      } else {
        if (mediaUrl !== undefined) throw new Error("Duplicate --media-url");
        mediaUrl = requirePortableHttpUrl(value, argument);
      }
      index += 1;
      continue;
    }
    // Never echo the rejected token. A mistyped flag name leaves the URL that
    // followed it sitting in this position, and these messages are rendered to
    // the host proof's terminal.
    throw new Error("Unknown option");
  }

  if (!hostProof) throw new Error("Missing --host-proof");
  if (!probeUrl) throw new Error("Missing --probe-url");
  if (!mediaUrl) throw new Error("Missing --media-url");
  return { kind: "host-proof", probeUrl, mediaUrl };
}
