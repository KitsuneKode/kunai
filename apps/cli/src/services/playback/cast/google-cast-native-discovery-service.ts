import type { GoogleCastPlaybackTarget } from "@/domain/playback/playback-target";

function decodeAvahiEscapes(value: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const escaped = value.slice(index).match(/^\\(\d{3})/);
    const escapedByte = escaped?.[1];
    if (escapedByte) {
      bytes.push(Number.parseInt(escapedByte, 10));
      index += 3;
      continue;
    }
    const character = value[index];
    if (character) bytes.push(...new TextEncoder().encode(character));
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

function parseTxtFields(value: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of value.matchAll(/"((?:\\\d{3}|[^"])*)"/g)) {
    const entry = decodeAvahiEscapes(match[1] ?? "");
    const separator = entry.indexOf("=");
    if (separator > 0) fields[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return fields;
}

export function parseAvahiGoogleCastTargets(output: string): readonly GoogleCastPlaybackTarget[] {
  const targets = new Map<string, GoogleCastPlaybackTarget>();
  for (const line of output.split(/\r?\n/)) {
    const fields = line.split(";");
    if (fields[0] !== "=" || fields[2] !== "IPv4" || fields.length < 10) continue;
    const address = fields[7]?.trim();
    const port = Number(fields[8]);
    if (!address || !Number.isInteger(port) || port < 1 || port > 65_535) continue;
    const txt = parseTxtFields(fields.slice(9).join(";"));
    const name = txt.fn?.trim() || fields[3]?.trim();
    if (!name) continue;
    targets.set(`${address}:${port}`, {
      kind: "google-cast",
      id: txt.id?.trim() || `avahi:${address}:${port}`,
      name,
      host: address,
      port,
      modelName: txt.md?.trim() || undefined,
      capabilities: ["audio", "video"],
    });
  }
  return [...targets.values()];
}

export class GoogleCastNativeDiscoveryService {
  async discover(): Promise<readonly GoogleCastPlaybackTarget[]> {
    const executable = Bun.which("avahi-browse");
    if (!executable) return [];
    try {
      const process = Bun.spawn(
        [executable, "--parsable", "--resolve", "--terminate", "_googlecast._tcp"],
        { stdout: "pipe", stderr: "ignore" },
      );
      const output = await new Response(process.stdout).text();
      if ((await process.exited) !== 0) return [];
      return parseAvahiGoogleCastTargets(output);
    } catch {
      return [];
    }
  }
}
