/**
 * Experimental Real-Debrid unrestrict client (account required, user-owned
 * token — same sensitivity rules as every other credential: never shipped,
 * never logged, never sent anywhere but api.real-debrid.com).
 *
 * Scope is deliberately narrow: add a magnet, wait until the cache holds it,
 * unrestrict the chosen file. Anything fancier (host picking, season packs)
 * waits until the local engine proves the workflow shape.
 */

import { isJsonObject, isJsonString, type JsonObject } from "@kunai/types";

const REAL_DEBRID_API = "https://api.real-debrid.com/rest/1.0";

export type DebridFile = {
  readonly id: string;
  readonly path: string;
  readonly bytes: number;
  readonly selected: number;
};

export type DebridTorrentStatus = {
  readonly id: string;
  readonly status: string;
  readonly progress: number;
  readonly files: readonly DebridFile[];
  readonly links: readonly string[];
};

export type DebridPort = {
  readonly unrestrict: (magnet: string, signal?: AbortSignal) => Promise<string>;
};

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function readJsonObject(response: Response, what: string): Promise<JsonObject> {
  if (!response.ok) {
    throw new Error(`debrid ${what} failed: HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isJsonObject(body)) {
    throw new Error(`debrid ${what} returned a non-object payload`);
  }
  return body;
}

function stringField(record: JsonObject, key: string): string | null {
  const value: unknown = record[key];
  return isJsonString(value) ? value : null;
}

export function createRealDebridPort(token: string): DebridPort {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("debrid token is missing");
  return {
    async unrestrict(magnet: string, signal?: AbortSignal): Promise<string> {
      const added = await readJsonObject(
        await fetch(`${REAL_DEBRID_API}/torrents/addMagnet`, {
          method: "POST",
          headers: { ...authHeaders(trimmed), "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ magnet }),
          signal,
        }),
        "add-magnet",
      );
      const id = stringField(added, "id");
      if (!id) throw new Error("debrid add-magnet returned no torrent id");

      await fetch(`${REAL_DEBRID_API}/torrents/selectFiles/${id}`, {
        method: "POST",
        headers: { ...authHeaders(trimmed), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ files: "all" }),
        signal,
      });

      const deadline = Date.now() + 120_000;
      for (;;) {
        const info = await readJsonObject(
          await fetch(`${REAL_DEBRID_API}/torrents/info/${id}`, {
            headers: authHeaders(trimmed),
            signal,
          }),
          "torrent-info",
        );
        const status = stringField(info, "status") ?? "";
        if (status === "downloaded") break;
        if (status === "error" || status === "dead" || status === "magnet_error") {
          throw new Error(`debrid torrent failed: ${status}`);
        }
        if (Date.now() >= deadline) throw new Error("debrid torrent not ready in time");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      const finalInfo = await readJsonObject(
        await fetch(`${REAL_DEBRID_API}/torrents/info/${id}`, {
          headers: authHeaders(trimmed),
          signal,
        }),
        "torrent-info",
      );
      const links: unknown = finalInfo["links"];
      const firstLink = Array.isArray(links) ? (links.find(isJsonString) ?? null) : null;
      if (!firstLink) throw new Error("debrid torrent has no downloadable link");

      const unlocked = await readJsonObject(
        await fetch(`${REAL_DEBRID_API}/unrestrict/link`, {
          method: "POST",
          headers: { ...authHeaders(trimmed), "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ link: firstLink }),
          signal,
        }),
        "unrestrict",
      );
      const download = stringField(unlocked, "download");
      if (!download) {
        throw new Error("debrid unrestrict returned no download URL");
      }
      return download;
    },
  };
}
