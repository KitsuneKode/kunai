import type { Container } from "@/container";

export type SetupWizardResult = "completed" | "cancelled" | "skipped";

export type StartupSetupState = {
  readonly onboardingVersion: number;
  readonly downloadOnboardingDismissed: boolean;
};

export type SetupWorkflowLoader = () => Promise<{
  runSetupWizard(input: { container: Container; force?: boolean }): Promise<SetupWizardResult>;
}>;

/**
 * Current onboarding revision.
 *
 * Anyone already at 2 has been onboarded and is left alone. Bumping this alone
 * would drag every existing install back through the wizard on upgrade, which
 * is the most annoying thing an upgrade can do to someone who already
 * configured Kunai the way they wanted. New screens reach them through
 * `/setup`, not by ambush.
 */
export const ONBOARDING_VERSION = 3;

/** Below this, an install has never been offered setup. */
const ONBOARDED_FLOOR = 2;

export function shouldRunSetupWizard({
  force,
  config,
  interactive = true,
}: {
  readonly force: boolean;
  readonly config: StartupSetupState;
  /**
   * A TTY on both stdin and stdout. The wizard is an Ink surface driven by
   * `useInput`; mounting one where nothing can type at it leaves the process
   * waiting on a keystroke that cannot arrive.
   */
  readonly interactive?: boolean;
}): boolean {
  if (!interactive) return false;
  if (force) return true;
  // One gate, not two. `downloadOnboardingDismissed` also used to gate this, so
  // an install that finished the wizard could still be re-shown it whenever that
  // second flag was false — two gates answering one question.
  return config.onboardingVersion < ONBOARDED_FLOOR;
}

export async function maybeRunStartupSetup({
  force,
  config,
  container,
  loadSetupWorkflow,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
}: {
  readonly force: boolean;
  readonly config: StartupSetupState;
  readonly container: Container;
  readonly loadSetupWorkflow: SetupWorkflowLoader;
  readonly interactive?: boolean;
}): Promise<SetupWizardResult> {
  if (!shouldRunSetupWizard({ force, config, interactive })) return "skipped";
  const { runSetupWizard } = await loadSetupWorkflow();
  return runSetupWizard({ container, force });
}
