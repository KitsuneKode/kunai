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
    // An unfinished download prompt no longer drags the whole wizard back:
    // `downloadOnboardingDismissed` was a second gate answering the same
    // question, so a completed onboarding could still be re-shown.
    expect(
      shouldRunSetupWizard({
        force: false,
        config: { onboardingVersion: 2, downloadOnboardingDismissed: false },
      }),
    ).toBe(false);
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
      // The default reads the real stdin, which is not a TTY under the test
      // runner. Stating it keeps this test about the onboarding gate.
      interactive: true,
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

  test("a non-interactive session never imports or mounts the wizard", async () => {
    // The wizard is an Ink surface driven by useInput. In a pipe or under CI it
    // would wait forever on a keystroke that cannot arrive, so the guard has to
    // sit before the dynamic import, not inside the shell.
    let loads = 0;
    const result = await maybeRunStartupSetup({
      force: true,
      config: { onboardingVersion: 0, downloadOnboardingDismissed: false },
      container: {} as never,
      interactive: false,
      loadSetupWorkflow: async () => {
        loads += 1;
        return { runSetupWizard: async () => "completed" as const };
      },
    });

    expect(result).toBe("skipped");
    expect(loads).toBe(0);
  });
});
