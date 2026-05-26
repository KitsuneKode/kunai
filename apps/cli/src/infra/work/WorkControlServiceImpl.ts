import type { Logger } from "@/infra/logger/Logger";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";

import type { ActiveWorkControl, WorkControlService } from "./WorkControlService";

export class WorkControlServiceImpl implements WorkControlService {
  private active: ActiveWorkControl | null = null;

  constructor(
    private readonly deps: {
      logger: Logger;
      diagnostics: Pick<DiagnosticsService, "record">;
    },
  ) {}

  setActive(control: ActiveWorkControl | null): void {
    this.active = control;
  }

  getActive(): ActiveWorkControl | null {
    return this.active;
  }

  cancelActive(reason = "user-requested"): boolean {
    const active = this.active;
    if (!active) {
      this.deps.diagnostics.record({
        category: "session",
        message: "Work cancellation requested without active work",
        context: { reason },
      });
      return false;
    }

    this.deps.logger.info("Cancelling active work", {
      id: active.id,
      label: active.label,
      reason,
    });
    this.deps.diagnostics.record({
      category: "session",
      message: "Cancelling active work",
      context: {
        id: active.id,
        label: active.label,
        reason,
      },
    });
    active.cancel(reason);
    return true;
  }
}
