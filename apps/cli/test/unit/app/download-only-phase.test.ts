import { expect, test } from "bun:test";

import { DownloadOnlyPhase } from "@/app/DownloadOnlyPhase";
import type { PhaseContext } from "@/app/Phase";

test("DownloadOnlyPhase does not discover provider episodes when downloads are disabled", async () => {
  let providerReads = 0;
  let episodeCalls = 0;
  const context = {
    signal: new AbortController().signal,
    container: {
      stateManager: {
        getState: () => ({ provider: "allanime", mode: "anime" }),
        dispatch: () => {},
      },
      providerRegistry: {
        get: () => {
          providerReads += 1;
          return {
            listEpisodes: async () => {
              episodeCalls += 1;
              return [];
            },
          };
        },
      },
      downloadService: {
        getEnqueueEligibility: () => ({
          allowed: false,
          code: "downloads-disabled",
          reason: "Downloads are disabled.",
        }),
      },
      diagnosticsStore: { record: () => {} },
    },
  } as unknown as PhaseContext;

  const result = await new DownloadOnlyPhase().execute(
    { title: { id: "anilist:1", type: "series", name: "Demo" } },
    context,
  );

  expect(result).toEqual({ status: "success", value: "back" });
  expect(providerReads).toBe(0);
  expect(episodeCalls).toBe(0);
});
