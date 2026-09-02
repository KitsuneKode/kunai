import { createSocket, type Socket } from "node:dgram";
import { isIP } from "node:net";

import type { GoogleCastPlaybackTarget } from "@/domain/playback/playback-target";
import { withTimeoutSignal } from "@/infra/abort/timeout-signal";

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const DIAL_SEARCH_TARGET = "urn:dial-multiscreen-org:service:dial:1";

const DIAL_QUERY = [
  "M-SEARCH * HTTP/1.1",
  `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
  'MAN: "ssdp:discover"',
  "MX: 1",
  `ST: ${DIAL_SEARCH_TARGET}`,
  "",
  "",
].join("\r\n");

export function isPrivateLanIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const octets = address.split(".").map(Number);
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
}

export function isGoogleCastDialResponse(payload: string): boolean {
  const normalized = payload.toLocaleLowerCase();
  return (
    normalized.startsWith("http/1.1 200") &&
    (normalized.includes(DIAL_SEARCH_TARGET) || normalized.includes("googlezone"))
  );
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function xmlText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]+)</${tag}>`, "i"));
  return match?.[1] ? decodeXml(match[1].trim()) : undefined;
}

export function googleCastTargetFromDialDescription(
  address: string,
  xml: string,
): GoogleCastPlaybackTarget | null {
  if (!isPrivateLanIpv4(address)) return null;
  const name = xmlText(xml, "friendlyName");
  if (!name) return null;
  const id = xmlText(xml, "UDN")?.replace(/^uuid:/i, "") || `dial:${address}`;
  return {
    kind: "google-cast",
    id,
    name,
    host: address,
    port: 8009,
    modelName: xmlText(xml, "modelName"),
    capabilities: ["audio", "video"],
  };
}

export class GoogleCastDialDiscoveryService {
  constructor(
    private readonly createUdpSocket: () => Socket = () => createSocket("udp4"),
    private readonly readDescription: typeof fetch = fetch,
  ) {}

  async discover(
    durationMs = 2_500,
    signal?: AbortSignal,
  ): Promise<readonly GoogleCastPlaybackTarget[]> {
    const socket = this.createUdpSocket();
    const responders = new Set<string>();
    const discoverySignal = withTimeoutSignal(signal, durationMs);
    socket.on("message", (packet, remote) => {
      if (isPrivateLanIpv4(remote.address) && isGoogleCastDialResponse(packet.toString("utf8"))) {
        responders.add(remote.address);
      }
    });
    await new Promise<void>((resolve) => {
      const finish = () => {
        discoverySignal.removeEventListener("abort", finish);
        socket.close();
        resolve();
      };
      discoverySignal.addEventListener("abort", finish, { once: true });
      socket.once("error", finish);
      socket.bind(0, () => socket.send(DIAL_QUERY, SSDP_PORT, SSDP_ADDRESS));
      if (discoverySignal.aborted) finish();
    });

    const targets = await Promise.all(
      [...responders].map(async (address) => {
        try {
          const response = await this.readDescription(
            `http://${address}:8008/ssdp/device-desc.xml`,
            { signal: withTimeoutSignal(signal, 1_500) },
          );
          if (!response.ok) return null;
          return googleCastTargetFromDialDescription(address, await response.text());
        } catch {
          return null;
        }
      }),
    );
    return targets.filter((target): target is GoogleCastPlaybackTarget => target !== null);
  }
}
