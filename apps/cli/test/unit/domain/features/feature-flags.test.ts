import { expect, test } from "bun:test";

import { resolveAttentionFeatureFlags } from "@/domain/features/feature-flags";

test("attention inbox and queue recovery are stable by default", () => {
  const flags = resolveAttentionFeatureFlags();

  expect(flags.attentionInbox).toBe(true);
  expect(flags.queueRecovery).toBe(true);
  expect(flags.newEpisodeProjection).toBe(true);
  expect(flags.providerAvailabilitySync).toBe(false);
  expect(flags.playlistSharing).toBe(false);
});

test("environment overrides can enable experimental sync without changing stable defaults", () => {
  const flags = resolveAttentionFeatureFlags({
    env: {
      KUNAI_EXPERIMENTAL_PROVIDER_AVAILABILITY_SYNC: "1",
      KUNAI_PLAYLIST_SHARING: "true",
    },
  });

  expect(flags.attentionInbox).toBe(true);
  expect(flags.queueRecovery).toBe(true);
  expect(flags.providerAvailabilitySync).toBe(true);
  expect(flags.playlistSharing).toBe(true);
});

test("default-on features have env kill switches", () => {
  const flags = resolveAttentionFeatureFlags({
    env: {
      KUNAI_ATTENTION_INBOX: "0",
      KUNAI_QUEUE_RECOVERY: "false",
      KUNAI_NEW_EPISODE_PROJECTION: "off",
    },
  });

  expect(flags.attentionInbox).toBe(false);
  expect(flags.queueRecovery).toBe(false);
  expect(flags.newEpisodeProjection).toBe(false);
});

test("explicit overrides beat env for the default-on features", () => {
  const flags = resolveAttentionFeatureFlags({
    env: { KUNAI_ATTENTION_INBOX: "0" },
    overrides: { attentionInbox: true },
  });

  expect(flags.attentionInbox).toBe(true);
});
