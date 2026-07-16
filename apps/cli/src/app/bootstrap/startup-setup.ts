import type { Container } from "@/container";

export type SetupWizardResult = "completed" | "cancelled" | "skipped";

export type StartupSetupState = {
  readonly onboardingVersion: number;
  readonly downloadOnboardingDismissed: boolean;
};

export type SetupWorkflowLoader = () => Promise<{
  runSetupWizard(input: { container: Container; force?: boolean }): Promise<SetupWizardResult>;
}>;

export function shouldRunSetupWizard({
  force,
  config,
}: {
  readonly force: boolean;
  readonly config: StartupSetupState;
}): boolean {
  return force || config.onboardingVersion < 2 || !config.downloadOnboardingDismissed;
}

const loadDefaultSetupWorkflow: SetupWorkflowLoader = () =>
  import("@/app-shell/workflows/setup-workflows");

export async function maybeRunStartupSetup({
  force,
  config,
  container,
  loadSetupWorkflow = loadDefaultSetupWorkflow,
}: {
  readonly force: boolean;
  readonly config: StartupSetupState;
  readonly container: Container;
  readonly loadSetupWorkflow?: SetupWorkflowLoader;
}): Promise<SetupWizardResult> {
  if (!shouldRunSetupWizard({ force, config })) return "skipped";
  const { runSetupWizard } = await loadSetupWorkflow();
  return runSetupWizard({ container, force });
}
