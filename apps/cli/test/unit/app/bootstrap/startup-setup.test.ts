import { describe, expect, test } from "bun:test";

import { maybeRunStartupSetup, shouldRunSetupWizard } from "@/app/bootstrap/startup-setup";

describe("startup setup policy", () => {
  test("runs when forced or onboarding is incomplete", () => {
    expect(
      shouldRunSetupWizard({
        force: true,
        config: { onboardingVersion: 2, downloadOnboardingDismissed: true },
      }),
    ).toBe(true);
    expect(
      shouldRunSetupWizard({
        force: false,
        config: { onboardingVersion: 1, downloadOnboardingDismissed: true },
      }),
    ).toBe(true);
    expect(
      shouldRunSetupWizard({
        force: false,
        config: { onboardingVersion: 2, downloadOnboardingDismissed: false },
      }),
    ).toBe(true);
  });

  test("completed onboarding skips the workflow import", async () => {
    let loads = 0;
    const result = await maybeRunStartupSetup({
      force: false,
      config: { onboardingVersion: 2, downloadOnboardingDismissed: true },
      container: {} as never,
      loadSetupWorkflow: async () => {
        loads += 1;
        return { runSetupWizard: async () => "completed" as const };
      },
    });

    expect(result).toBe("skipped");
    expect(loads).toBe(0);
  });

  test("required onboarding loads and runs the workflow once", async () => {
    let loads = 0;
    let runs = 0;
    const result = await maybeRunStartupSetup({
      force: false,
      config: { onboardingVersion: 1, downloadOnboardingDismissed: false },
      container: {} as never,
      loadSetupWorkflow: async () => {
        loads += 1;
        return {
          runSetupWizard: async () => {
            runs += 1;
            return "completed" as const;
          },
        };
      },
    });

    expect(result).toBe("completed");
    expect(loads).toBe(1);
    expect(runs).toBe(1);
  });
});
