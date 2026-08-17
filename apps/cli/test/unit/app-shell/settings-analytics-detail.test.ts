import { describe, expect, test } from "bun:test";

import { analyticsSettingDetail } from "@/app-shell/settings/registry/general";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

function config(over: Partial<KitsuneConfig>): KitsuneConfig {
  return { analytics: "unset", lastAnalyticsPingAt: 0, ...over } as KitsuneConfig;
}

const DAY = 86_400_000;

describe("analyticsSettingDetail", () => {
  test("an off switch never claims anything was sent", () => {
    // `lastAnalyticsPingAt` survives a disable, so that a re-enable does not
    // immediately re-send. Reporting it beside an off switch would read as if
    // sending were still happening.
    const sent = { lastAnalyticsPingAt: Date.now() - DAY };

    for (const analytics of ["unset", "disabled"] as const) {
      const detail = analyticsSettingDetail(config({ analytics, ...sent }));
      expect(detail).not.toContain("last sent");
      expect(detail).not.toContain("nothing sent yet");
    }
  });

  test("enabled but never sent says so, rather than staying silent", () => {
    const detail = analyticsSettingDetail(config({ analytics: "enabled" }));

    expect(detail).toContain("nothing sent yet");
  });

  test("enabled and sent reports when", () => {
    expect(
      analyticsSettingDetail(config({ analytics: "enabled", lastAnalyticsPingAt: Date.now() })),
    ).toContain("last sent today");

    expect(
      analyticsSettingDetail(
        config({ analytics: "enabled", lastAnalyticsPingAt: Date.now() - DAY }),
      ),
    ).toContain("last sent yesterday");

    expect(
      analyticsSettingDetail(
        config({ analytics: "enabled", lastAnalyticsPingAt: Date.now() - 3 * DAY }),
      ),
    ).toContain("last sent 3 days ago");
  });

  test("every form still describes what the ping contains", () => {
    // The detail line is the only place the payload is named before opting in.
    for (const cfg of [
      config({ analytics: "unset" }),
      config({ analytics: "enabled" }),
      config({ analytics: "enabled", lastAnalyticsPingAt: Date.now() }),
    ]) {
      expect(analyticsSettingDetail(cfg)).toContain("anonymous");
    }
  });

  test("a corrupt timestamp degrades to the plain description", () => {
    for (const bad of [Number.NaN, -1, Number.MAX_SAFE_INTEGER, Date.now() + 10 * DAY]) {
      const detail = analyticsSettingDetail(
        config({ analytics: "enabled", lastAnalyticsPingAt: bad }),
      );
      expect(detail).toContain("anonymous");
      expect(detail).not.toContain("NaN");
      expect(detail).not.toContain("Invalid");
    }
  });
});
