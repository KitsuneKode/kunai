import { createSocket, type RemoteInfo, type Socket } from "node:dgram";

import type { GoogleCastPlaybackTarget } from "@/domain/playback/playback-target";

const MDNS_ADDRESS = "224.0.0.251";
const MDNS_PORT = 5353;
const CAST_SERVICE = "_googlecast._tcp.local";

export type DiscoveredCastService = {
  readonly name: string;
  readonly fqdn: string;
  readonly port: number;
  readonly addresses: readonly string[];
  readonly txt?: Readonly<Record<string, string>>;
};

export type CastDiscoveryHandle = {
  readonly targets: readonly GoogleCastPlaybackTarget[];
  refresh(): void;
  stop(): void;
};

type DnsRecord = {
  readonly name: string;
  readonly type: number;
  readonly ttl: number;
  readonly dataOffset: number;
  readonly dataLength: number;
};

type MutableService = {
  name: string;
  fqdn: string;
  port?: number;
  host?: string;
  fallbackAddress?: string;
  txt: Record<string, string>;
};

function encodeDnsName(name: string): Uint8Array {
  const bytes: number[] = [];
  for (const label of name.split(".")) {
    const encoded = new TextEncoder().encode(label);
    bytes.push(encoded.length, ...encoded);
  }
  bytes.push(0);
  return Uint8Array.from(bytes);
}

export function buildGoogleCastMdnsQuery(): Uint8Array {
  const name = encodeDnsName(CAST_SERVICE);
  const query = new Uint8Array(12 + name.length + 4);
  const view = new DataView(query.buffer);
  view.setUint16(4, 1);
  query.set(name, 12);
  view.setUint16(12 + name.length, 12);
  // QU requests a unicast answer as well as allowing the usual multicast
  // response; this survives Wi-Fi networks that suppress multicast replies.
  view.setUint16(14 + name.length, 0x8001);
  return query;
}

function readDnsName(packet: Uint8Array, start: number): { name: string; next: number } | null {
  const labels: string[] = [];
  let offset = start;
  let next = start;
  let jumped = false;
  const visited = new Set<number>();
  for (let depth = 0; depth < 64; depth++) {
    if (offset >= packet.length || visited.has(offset)) return null;
    visited.add(offset);
    const length = packet[offset] ?? 0;
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= packet.length) return null;
      const pointer = ((length & 0x3f) << 8) | (packet[offset + 1] ?? 0);
      if (!jumped) next = offset + 2;
      jumped = true;
      offset = pointer;
      continue;
    }
    if (length === 0) {
      if (!jumped) next = offset + 1;
      return { name: labels.join("."), next };
    }
    if (length > 63 || offset + 1 + length > packet.length) return null;
    labels.push(new TextDecoder().decode(packet.subarray(offset + 1, offset + 1 + length)));
    offset += 1 + length;
    if (!jumped) next = offset;
  }
  return null;
}

function parseDnsRecords(packet: Uint8Array): readonly DnsRecord[] {
  if (packet.length < 12) return [];
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const questions = view.getUint16(4);
  const recordCount = view.getUint16(6) + view.getUint16(8) + view.getUint16(10);
  let offset = 12;
  for (let i = 0; i < questions; i++) {
    const name = readDnsName(packet, offset);
    if (!name || name.next + 4 > packet.length) return [];
    offset = name.next + 4;
  }
  const records: DnsRecord[] = [];
  for (let i = 0; i < recordCount; i++) {
    const name = readDnsName(packet, offset);
    if (!name || name.next + 10 > packet.length) break;
    const type = view.getUint16(name.next);
    const ttl = view.getUint32(name.next + 4);
    const dataLength = view.getUint16(name.next + 8);
    const dataOffset = name.next + 10;
    if (dataOffset + dataLength > packet.length) break;
    records.push({ name: name.name, type, ttl, dataOffset, dataLength });
    offset = dataOffset + dataLength;
  }
  return records;
}

function parseTxt(packet: Uint8Array, record: DnsRecord): Record<string, string> {
  const txt: Record<string, string> = {};
  let offset = record.dataOffset;
  const end = offset + record.dataLength;
  while (offset < end) {
    const length = packet[offset++] ?? 0;
    if (offset + length > end) break;
    const entry = new TextDecoder().decode(packet.subarray(offset, offset + length));
    offset += length;
    const separator = entry.indexOf("=");
    if (separator > 0) txt[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return txt;
}

export function googleCastTargetFromService(
  service: DiscoveredCastService,
): GoogleCastPlaybackTarget | null {
  const host = service.addresses.find((address) => !address.includes(":")) ?? service.addresses[0];
  if (!host || !service.port) return null;
  const txt = service.txt ?? {};
  const id = txt.id?.trim() || service.fqdn;
  const name = txt.fn?.trim() || service.name;
  const modelName = txt.md?.trim() || undefined;
  const capabilities = Number(txt.ca);
  return {
    kind: "google-cast",
    id,
    name,
    host,
    port: service.port,
    modelName,
    capabilities: capabilities === 1 ? ["audio"] : ["audio", "video"],
  };
}

function applyPacket(
  packet: Uint8Array,
  remote: RemoteInfo,
  services: Map<string, MutableService>,
  addresses: Map<string, string[]>,
): void {
  const records = parseDnsRecords(packet);
  for (const record of records) {
    if (record.type !== 1 || record.dataLength !== 4) continue;
    const address = [...packet.subarray(record.dataOffset, record.dataOffset + 4)].join(".");
    addresses.set(record.name.toLocaleLowerCase(), [address]);
  }
  for (const record of records) {
    if (record.type !== 12 || record.name.toLocaleLowerCase() !== CAST_SERVICE) continue;
    const ptr = readDnsName(packet, record.dataOffset);
    if (!ptr) continue;
    const key = ptr.name.toLocaleLowerCase();
    if (record.ttl === 0) services.delete(key);
    else if (!services.has(key)) {
      services.set(key, {
        name: ptr.name.split("._googlecast.")[0] ?? ptr.name,
        fqdn: ptr.name,
        txt: {},
      });
    }
  }
  for (const record of records) {
    const service = services.get(record.name.toLocaleLowerCase());
    if (!service) continue;
    if (record.type === 33 && record.dataLength >= 7) {
      const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
      service.port = view.getUint16(record.dataOffset + 4);
      service.host = readDnsName(packet, record.dataOffset + 6)?.name;
      service.fallbackAddress = remote.address;
    } else if (record.type === 16) {
      Object.assign(service.txt, parseTxt(packet, record));
    }
  }
}

export class GoogleCastDiscoveryService {
  constructor(
    private readonly createUdpSocket: () => Socket = () =>
      createSocket({ type: "udp4", reuseAddr: true }),
  ) {}

  browse(
    onUpdate?: (targets: readonly GoogleCastPlaybackTarget[]) => void,
    onError?: (error: Error) => void,
  ): CastDiscoveryHandle {
    const socket = this.createUdpSocket();
    const services = new Map<string, MutableService>();
    const addresses = new Map<string, string[]>();
    let stopped = false;
    let ready = false;
    const snapshot = () =>
      [...services.values()]
        .map((service) =>
          googleCastTargetFromService({
            name: service.name,
            fqdn: service.fqdn,
            port: service.port ?? 0,
            addresses: service.host
              ? (addresses.get(service.host.toLocaleLowerCase()) ?? [service.fallbackAddress ?? ""])
              : [service.fallbackAddress ?? ""],
            txt: service.txt,
          }),
        )
        .filter((target): target is GoogleCastPlaybackTarget => target !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    const publish = () => onUpdate?.(snapshot());
    const sendQuery = () => {
      if (!ready || stopped) return;
      socket.send(buildGoogleCastMdnsQuery(), MDNS_PORT, MDNS_ADDRESS);
    };
    socket.on("message", (packet, remote) => {
      applyPacket(packet, remote, services, addresses);
      publish();
    });
    socket.on("error", (error) => onError?.(error));
    socket.bind(MDNS_PORT, () => {
      ready = true;
      socket.addMembership(MDNS_ADDRESS);
      socket.setMulticastTTL(2);
      sendQuery();
    });
    return {
      get targets() {
        return snapshot();
      },
      refresh: sendQuery,
      stop: () => {
        if (stopped) return;
        stopped = true;
        socket.close();
      },
    };
  }
}
