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

/** True while the install has never completed (or deliberately exited) setup. */
export function isBelowOnboardedFloor(onboardingVersion: number): boolean {
  return onboardingVersion < ONBOARDED_FLOOR;
}

/**
 * True when the command line already says where this launch is going.
 *
 * `kunai -q -S "Dune"` on a fresh machine is someone trying to watch Dune, and
 * six screens of questions first is the opposite of what they typed. Such a
 * launch goes where it was told and writes nothing about onboarding, so the
 * next bare `kunai` still offers setup. Analytics stays `unset` meanwhile,
 * which is off: skipping setup is not an answer to the consent screen.
 */
export function launchHasDestination(args: {
  readonly search?: string;
  readonly id?: string;
  readonly history?: boolean;
  readonly continuePlayback?: boolean;
  readonly offline?: boolean;
  readonly download?: boolean;
  readonly initialRoute?: string;
  readonly openUrl?: string;
  readonly handoffUrl?: string;
}): boolean {
  return Boolean(
    args.search?.trim() ||
    args.id?.trim() ||
    args.history ||
    args.continuePlayback ||
    args.offline ||
    args.download ||
    args.initialRoute ||
    args.openUrl ||
    args.handoffUrl,
  );
}

export function shouldRunSetupWizard({
  force,
  config,
  interactive = true,
  hasDestination = false,
}: {
  readonly force: boolean;
  readonly config: StartupSetupState;
  /** See `launchHasDestination`. `--setup` still wins. */
  readonly hasDestination?: boolean;
  /**
   * A TTY on both stdin and stdout. The wizard is an Ink surface driven by
   * `useInput`; mounting one where nothing can type at it leaves the process
   * waiting on a keystroke that cannot arrive.
   */
  readonly interactive?: boolean;
}): boolean {
  if (!interactive) return false;
  if (force) return true;
  if (hasDestination) return false;
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
  hasDestination = false,
}: {
  readonly force: boolean;
  readonly config: StartupSetupState;
  readonly container: Container;
  readonly loadSetupWorkflow: SetupWorkflowLoader;
  readonly interactive?: boolean;
  readonly hasDestination?: boolean;
}): Promise<SetupWizardResult> {
  if (!shouldRunSetupWizard({ force, config, interactive, hasDestination })) return "skipped";
  const { runSetupWizard } = await loadSetupWorkflow();
  return runSetupWizard({ container, force });
}
