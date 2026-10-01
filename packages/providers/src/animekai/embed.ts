/**
 * AnimeKai embed decoding — the megaplay.buzz contract the embed serves.
 * The implementation lives in `../shared/megaplay-embed`; this module keeps
 * the AnimeKai-named surface (error type included) so callers and tests name
 * the provider, not the upstream.
 */

import {
  decryptMegaplaySourcesBlob,
  MegaplayEmbedDecodeError,
  type MegaplayEmbedDecodeErrorCode,
  megaplayEmbedReferer,
  megaplayMasterUrlFromDecrypted,
  megaplaySourcesEndpoint,
  parseMegaplayEmbedDataId,
} from "../shared/megaplay-embed";
import type { AnimekaiSourcesPayload } from "./parsers";

export type AnimekaiEmbedDecodeErrorCode = MegaplayEmbedDecodeErrorCode;

export class AnimekaiEmbedDecodeError extends MegaplayEmbedDecodeError {
  constructor(code: AnimekaiEmbedDecodeErrorCode, message: string) {
    super(code, message);
    this.name = "AnimekaiEmbedDecodeError";
  }
}

function wrapAnimekaiDecode<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof MegaplayEmbedDecodeError) {
      throw new AnimekaiEmbedDecodeError(error.code, error.message);
    }
    throw error;
  }
}

export function animekaiEmbedDataIdOrThrow(html: string): string {
  const dataId = parseMegaplayEmbedDataId(html);
  if (!dataId) {
    throw new AnimekaiEmbedDecodeError(
      "missing-data-id",
      "animekai embed page exposes no player data-id",
    );
  }
  return dataId;
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- decrypted blob is untyped by contract; animekaiMasterUrlFromDecrypted is its parser
export async function decryptAnimekaiSourcesBlob(enc: string): Promise<unknown> {
  try {
    return await decryptMegaplaySourcesBlob(enc);
  } catch (error) {
    if (error instanceof MegaplayEmbedDecodeError) {
      throw new AnimekaiEmbedDecodeError(error.code, error.message);
    }
    throw error;
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the decrypted blob is exactly what this parser validates
/** Decrypted blob → `{file: <master m3u8>}`; the only field the stream needs. */
export function animekaiMasterUrlFromDecrypted(json: unknown): string {
  return wrapAnimekaiDecode(() => megaplayMasterUrlFromDecrypted(json));
}

export function animekaiSourcesEndpoint(embedUrl: string, dataId: string): string {
  return megaplaySourcesEndpoint(embedUrl, dataId);
}

export function animekaiEmbedReferer(embedUrl: string): string {
  return megaplayEmbedReferer(embedUrl);
}

export type { AnimekaiSourcesPayload };
