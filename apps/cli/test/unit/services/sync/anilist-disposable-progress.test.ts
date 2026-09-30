import { expect, test } from "bun:test";

/**
 * Opt-in proof against a throwaway AniList account. No secret means this skip
 * is the result CI should show, and the settings label stays experimental.
 * The in-flight overlap is covered by the outbox test. This file never reads
 * the developer profile and never creates an analytics install id.
 */
const token = process.env.KUNAI_ANILIST_DISPOSABLE_TOKEN;
const mediaId = Number(process.env.KUNAI_ANILIST_DISPOSABLE_MEDIA_ID);
const enabled = Boolean(token) && Number.isInteger(mediaId) && mediaId > 0;

async function anilist(
  query: string,
  variables: { readonly mediaId: number; readonly progress?: number },
) {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`AniList answered ${response.status}`);
  return response.json() as Promise<unknown>;
}

test.skipIf(!enabled)("disposable AniList account ends on episode 4 after episode 3", async () => {
  const save = `mutation SaveProgress($mediaId: Int, $progress: Int) {
      SaveMediaListEntry(mediaId: $mediaId, status: CURRENT, progress: $progress) { progress }
    }`;
  await anilist(save, { mediaId, progress: 3 });
  await anilist(save, { mediaId, progress: 4 });
  const current = (await anilist(
    `query Progress($mediaId: Int) { Media(id: $mediaId) { mediaListEntry { progress } } }`,
    { mediaId },
  )) as { data?: { Media?: { mediaListEntry?: { progress?: number } | null } } };
  expect(current.data?.Media?.mediaListEntry?.progress).toBe(4);
  await anilist(
    `mutation Rewind($mediaId: Int) { DeleteMediaListEntry(mediaId: $mediaId) { deleted } }`,
    { mediaId },
  );
});
