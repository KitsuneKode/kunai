import { describe, expect, test } from "bun:test";

import {
  AUDIO_SETTINGS_OPTIONS,
  SUBTITLE_SETTINGS_OPTIONS,
} from "@/app-shell/settings/registry/shared";
import { shouldRunSetupWizard, ONBOARDING_VERSION } from "@/app/bootstrap/startup-setup";
import {
  AUDIO_PREFERENCE_OPTIONS,
  RECOMMENDED_AUDIO_PREFERENCE,
  RECOMMENDED_SUBTITLE_PREFERENCE,
  SUBTITLE_PREFERENCE_OPTIONS,
} from "@/domain/media/media-preferences";

/**
 * Silent no-ops are the house failure mode — settings collected and dropped,
 * options declared in one surface and contradicted in another. These are the
 * structural guards, not a checklist someone has to remember to re-read.
 */

describe("setup option catalogs are one source of truth", () => {
  test("settings and setup offer the identical audio catalog", () => {
    // Not "equivalent" — identical. Two hand-maintained lists is how setup came
    // to offer en/none/interactive/ja/es/fr while settings offered a different
    // set in a different order with different labels for the same value.
    expect(AUDIO_SETTINGS_OPTIONS).toBe(AUDIO_PREFERENCE_OPTIONS);
  });

  test("settings and setup offer the identical subtitle catalog", () => {
    expect(SUBTITLE_SETTINGS_OPTIONS).toBe(SUBTITLE_PREFERENCE_OPTIONS);
  });

  test("every recommended value exists in the catalog it belongs to", () => {
    // A recommendation naming a value nobody offers silently falls back to
    // whatever sits at index 0, which is how a "recommended default" quietly
    // becomes something else.
    expect(AUDIO_PREFERENCE_OPTIONS.map((o) => o.value)).toContain(RECOMMENDED_AUDIO_PREFERENCE);
    expect(SUBTITLE_PREFERENCE_OPTIONS.map((o) => o.value)).toContain(
      RECOMMENDED_SUBTITLE_PREFERENCE,
    );
  });

  test("no catalog carries a duplicate value", () => {
    for (const catalog of [AUDIO_PREFERENCE_OPTIONS, SUBTITLE_PREFERENCE_OPTIONS]) {
      const values = catalog.map((option) => option.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  test("every option is labelled and explained", () => {
    for (const catalog of [AUDIO_PREFERENCE_OPTIONS, SUBTITLE_PREFERENCE_OPTIONS]) {
      for (const option of catalog) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.detail.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("shouldRunSetupWizard", () => {
  const fresh = { onboardingVersion: 0, downloadOnboardingDismissed: false };
  const onboarded = { onboardingVersion: 2, downloadOnboardingDismissed: true };

  test("runs on a fresh install", () => {
    expect(shouldRunSetupWizard({ force: false, config: fresh })).toBe(true);
  });

  test("does not re-onboard an install that already finished setup", () => {
    // Bumping ONBOARDING_VERSION must never drag existing users back through
    // the wizard on upgrade. Version 2 counts as done.
    expect(shouldRunSetupWizard({ force: false, config: onboarded })).toBe(false);
    expect(ONBOARDING_VERSION).toBeGreaterThan(onboarded.onboardingVersion);
  });

  test("an unfinished download prompt no longer re-triggers the whole wizard", () => {
    // Two gates for one question: `downloadOnboardingDismissed` used to force
    // the wizard back on an install that had already completed onboarding.
    expect(
      shouldRunSetupWizard({
        force: false,
        config: { onboardingVersion: 2, downloadOnboardingDismissed: false },
      }),
    ).toBe(false);
  });

  test("force re-runs it for an already-onboarded install", () => {
    expect(shouldRunSetupWizard({ force: true, config: onboarded })).toBe(true);
  });

  test("never mounts without an interactive terminal, even when forced", () => {
    // The wizard is an Ink surface driven by useInput. Mounting one where
    // nothing can type at it waits forever on a keystroke that cannot arrive.
    expect(shouldRunSetupWizard({ force: false, config: fresh, interactive: false })).toBe(false);
    expect(shouldRunSetupWizard({ force: true, config: fresh, interactive: false })).toBe(false);
  });
});
