# Search-Ready Startup and Stats Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `/stats` across the real CLI command surfaces and make the normal no-query launch reach a focused browse search input before optional setup/workflow and personal-projection work.

**Architecture:** Keep the persistent Ink host and `SearchPhase` ownership intact. Remove accidental eager imports with two narrow dependency-injection seams, then let `BrowseShell` hydrate its existing local return-loop context after mount without changing query or focus state. Record privacy-safe startup milestones through the existing diagnostics service.

**Tech Stack:** Bun, TypeScript, React 19, Ink, Bun test, Kunai render-capture harness.

## Global Constraints

- Use `bun`, `bunx`, and `bun run`; never invoke `bun test` directly.
- Preserve the canonical runtime entrypoint in `apps/cli/src/main.ts`.
- Keep command behavior routed through the existing registry, dispatcher, and `handleStats` workflow.
- Focused media-picker palettes remain restricted to `diagnostics` and `help`.
- Do not add provider calls, recommendation fetches, storage migrations, or new recent-search persistence.
- Personal startup projection is local, best-effort, and cannot block or steal focus from search.
- Do not record query text, title names, file paths, tokens, or other private content in startup diagnostics.
- Use the repository render-capture harness, not `ink-testing-library` or real-time sleeps.
- Preserve and do not stage the user's existing edits to `apps/docs/lib/generated-metadata.json`, `apps/docs/package.json`, `package.json`, and `bun.lock`.
- Run focused package-local tests after each task and full repository gates at the end.

---

## File Map

- `apps/cli/src/domain/session/command-registry.ts`: canonical command definitions, context membership, and help-command membership.
- `apps/cli/src/app-shell/search-browse-command-ids.ts`: browse palette allowlist.
- `apps/cli/src/app-shell/commands.ts`: curated post-play palette.
- `apps/cli/src/app/bootstrap/startup-setup.ts`: new pure setup policy plus lazy startup runner.
- `apps/cli/src/app-shell/workflows/setup-workflows.ts`: setup UI implementation reusing the startup policy.
- `apps/cli/src/app-shell/palette-workflow-port.ts`: new demand-loaded workflow boundary.
- `apps/cli/src/app-shell/dispatch-palette-command.ts`: shared command dispatch using the workflow port.
- `apps/cli/src/app-shell/command-router.ts`: browse/playback routing with an injectable workflow port for real-route tests.
- `apps/cli/src/app-shell/browse-shell.tsx`: focused first-paint state and deferred idle-context hydration.
- `apps/cli/src/app-shell/types.ts`: async idle-context loader contract.
- `apps/cli/src/app/search/search-startup-policy.ts`: new pure decision for when idle context hydrates after mount.
- `apps/cli/src/app/search/SearchPhase.ts`: mounts browse first on a normal empty launch and owns the deferred local projection.
- `apps/cli/src/services/diagnostics/cli-startup-milestone.ts`: privacy-safe startup milestone helper.
- `apps/cli/src/main.ts`: skips setup imports when complete and records shell milestones.

### Task 1: Restore Stats Command Truth

**Files:**

- Modify: `apps/cli/src/domain/session/command-registry.ts`
- Modify: `apps/cli/src/app-shell/search-browse-command-ids.ts`
- Modify: `apps/cli/src/app-shell/commands.ts`
- Modify: `apps/cli/test/unit/app-shell/command-router.test.ts`
- Modify: `apps/cli/test/unit/app-shell/command-registry.coverage.test.ts`
- Modify: `apps/cli/test/unit/app-shell/panel-data.test.ts`

**Interfaces:**

- Consumes: existing `AppCommandId`, `COMMAND_CONTEXTS`, `HELP_PANEL_COMMAND_IDS`, and `resolveCommandsForPaletteSurface`.
- Produces: `stats` reachable from browse, normal root overlays, active playback, post-playback, and help.

- [ ] **Step 1: Change the surface tests to require Stats**

Update `command-router.test.ts`:

```ts
test("browse palette exposes personal stats without enabling Experimental commands", () => {
  const commands = resolveCommandsForPaletteSurface(baseState(), "browse").map(
    (command) => command.id,
  );

  expect(commands).toContain("stats");
  expect(commands).not.toContain("sync");
  expect(commands).not.toContain("random");
});

test("post-play palette exposes personal stats without Experimental commands", () => {
  const commands = resolveCommandsForPaletteSurface(baseState(), "post-play").map(
    (command) => command.id,
  );

  expect(commands).toContain("stats");
  expect(commands).not.toContain("sync");
  expect(commands).not.toContain("random");
});
```

Extend the scoped-context test:

```ts
expect(resolveCommandContext(baseState(), "rootOverlay").map((command) => command.id)).toContain(
  "stats",
);
expect(resolveCommandContext(baseState(), "activePlayback").map((command) => command.id)).toContain(
  "stats",
);
```

Update `panel-data.test.ts`:

```ts
expect(lines.find((line) => line.label === "/stats")?.detail).toContain("Watch stats");
```

Remove `"stats"` from `KNOWN_HANDLER_ONLY` in
`command-registry.coverage.test.ts`.

- [ ] **Step 2: Run the focused tests and confirm the regression**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/command-router.test.ts test/unit/app-shell/command-registry.coverage.test.ts test/unit/app-shell/panel-data.test.ts
```

Expected: FAIL because `stats` is missing from the real surface lists and help.

- [ ] **Step 3: Add Stats to the canonical surface lists**

Add `"stats"`:

```ts
export const SEARCH_BROWSE_COMMAND_IDS = [
  "continue",
  "filters",
  "recommendation",
  "calendar",
  "bookmark",
  "follow",
  "watchlist",
  "playlists",
  "up-next",
  "stats",
  // existing ids continue unchanged
] as const satisfies readonly AppCommandId[];
```

Add `"stats"` to `COMMAND_CONTEXTS.rootOverlay`,
`COMMAND_CONTEXTS.activePlayback`, and `COMMAND_CONTEXTS.postPlayback`. Add it
to `HELP_PANEL_COMMAND_IDS` after `up-next`.

Add `"stats"` to `POST_PLAYBACK_SURFACE_COMMANDS` beside the other personal
media surfaces:

```ts
  "playlists",
  "up-next",
  "stats",
  "search",
```

- [ ] **Step 4: Run the focused tests**

Run the Step 2 command again.

Expected: PASS.

- [ ] **Step 5: Commit the Stats reachability repair**

```sh
git add apps/cli/src/domain/session/command-registry.ts apps/cli/src/app-shell/search-browse-command-ids.ts apps/cli/src/app-shell/commands.ts apps/cli/test/unit/app-shell/command-router.test.ts apps/cli/test/unit/app-shell/command-registry.coverage.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts
git commit -m "fix(cli): restore stats command reachability"
```

### Task 2: Skip Setup UI Imports When Onboarding Is Complete

**Files:**

- Create: `apps/cli/src/app/bootstrap/startup-setup.ts`
- Create: `apps/cli/test/unit/app/bootstrap/startup-setup.test.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/app-shell/workflows/setup-workflows.ts`

**Interfaces:**

- Produces:

```ts
export type SetupWizardResult = "completed" | "cancelled" | "skipped";

export type StartupSetupState = {
  readonly onboardingVersion: number;
  readonly downloadOnboardingDismissed: boolean;
};

export function shouldRunSetupWizard(input: {
  readonly force: boolean;
  readonly config: StartupSetupState;
}): boolean;

export async function maybeRunStartupSetup(input: {
  readonly force: boolean;
  readonly config: StartupSetupState;
  readonly container: Container;
  readonly loadSetupWorkflow?: SetupWorkflowLoader;
}): Promise<SetupWizardResult>;
```

- [ ] **Step 1: Write policy and lazy-loader tests**

Create `startup-setup.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app/bootstrap/startup-setup.test.ts
```

Expected: FAIL because `startup-setup.ts` does not exist.

- [ ] **Step 3: Implement the shared policy and lazy runner**

Create `startup-setup.ts`:

```ts
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
```

In `setup-workflows.ts`, import `SetupWizardResult` and
`shouldRunSetupWizard`, remove the local result type, and replace the duplicate
condition:

```ts
const current = container.config.getRaw();
if (
  !shouldRunSetupWizard({
    force,
    config: {
      onboardingVersion: current.onboardingVersion,
      downloadOnboardingDismissed: current.downloadOnboardingDismissed,
    },
  })
) {
  return "skipped";
}
```

In `main.ts`, remove `maybeRunSetupWizard` and call:

```ts
await maybeRunStartupSetup({
  force: args.setup,
  config: {
    onboardingVersion: container.config.onboardingVersion,
    downloadOnboardingDismissed: container.config.downloadOnboardingDismissed,
  },
  container,
});
```

Use the same policy for the pre-shell `checkDeps` silence decision by reading
both config fields from `config.json`.

- [ ] **Step 4: Run focused setup and config tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app/bootstrap/startup-setup.test.ts test/unit/services/persistence/ConfigServiceImpl.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the setup critical-path repair**

```sh
git add apps/cli/src/app/bootstrap/startup-setup.ts apps/cli/test/unit/app/bootstrap/startup-setup.test.ts apps/cli/src/main.ts apps/cli/src/app-shell/workflows/setup-workflows.ts
git commit -m "perf(cli): skip setup imports after onboarding"
```

### Task 3: Demand-Load Palette Workflows

**Files:**

- Create: `apps/cli/src/app-shell/palette-workflow-port.ts`
- Create: `apps/cli/test/unit/app-shell/palette-workflow-port.test.ts`
- Modify: `apps/cli/src/app-shell/dispatch-palette-command.ts`
- Modify: `apps/cli/src/app-shell/command-router.ts`
- Modify: `apps/cli/test/unit/app-shell/command-router.test.ts`

**Interfaces:**

- Produces:

```ts
export interface PaletteWorkflowPort {
  resolveQuit(container: Container): Promise<"handled" | "quit">;
  runSetup(container: Container): Promise<"handled">;
  runAction(action: ShellAction, container: Container): Promise<ShellWorkflowResult>;
}

export function createPaletteWorkflowPort(
  loaders?: Partial<PaletteWorkflowLoaders>,
): PaletteWorkflowPort;
```

- `routeSearchShellAction` accepts an optional `workflows` port for tests and
  specialized hosts; production uses `defaultPaletteWorkflowPort`.

- [ ] **Step 1: Write lazy-boundary and real-route tests**

Create `palette-workflow-port.test.ts`:

```ts
import { expect, test } from "bun:test";

import { createPaletteWorkflowPort } from "@/app-shell/palette-workflow-port";

test("stats loads only the shell workflow module", async () => {
  const loaded: string[] = [];
  const actions: string[] = [];
  const port = createPaletteWorkflowPort({
    loadShellWorkflows: async () => {
      loaded.push("shell");
      return {
        handleShellAction: async ({ action }) => {
          actions.push(action);
          return "handled" as const;
        },
        resolveQuitWithDownloadQueue: async () => "quit" as const,
      };
    },
    loadSetupWorkflow: async () => {
      loaded.push("setup");
      return { openSetupWizardFromShell: async () => "completed" as const };
    },
  });

  await expect(port.runAction("stats", {} as never)).resolves.toBe("handled");
  expect(loaded).toEqual(["shell"]);
  expect(actions).toEqual(["stats"]);
});

test("setup loads only the focused setup module", async () => {
  const loaded: string[] = [];
  const port = createPaletteWorkflowPort({
    loadShellWorkflows: async () => {
      loaded.push("shell");
      throw new Error("shell workflows should stay unloaded");
    },
    loadSetupWorkflow: async () => {
      loaded.push("setup");
      return { openSetupWizardFromShell: async () => "completed" as const };
    },
  });

  await expect(port.runSetup({} as never)).resolves.toBe("handled");
  expect(loaded).toEqual(["setup"]);
});
```

Add to `command-router.test.ts`:

```ts
test("routes browse stats through the real palette route", async () => {
  const actions: string[] = [];
  const result = await routeSearchShellAction({
    action: "stats",
    container: {} as never,
    workflows: {
      resolveQuit: async () => "quit",
      runSetup: async () => "handled",
      runAction: async (action) => {
        actions.push(action);
        return "handled";
      },
    },
  });

  expect(result).toBe("handled");
  expect(actions).toEqual(["stats"]);
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/palette-workflow-port.test.ts test/unit/app-shell/command-router.test.ts
```

Expected: FAIL because the workflow port and injection seam do not exist.

- [ ] **Step 3: Implement the lazy workflow port**

Create `palette-workflow-port.ts` with direct dynamic imports:

```ts
import type { Container } from "@/container";

import type { ShellAction } from "./types";
import type { ShellWorkflowResult } from "./workflows/shell-workflows";

export type PaletteWorkflowLoaders = {
  readonly loadShellWorkflows: () => Promise<
    Pick<
      typeof import("./workflows/shell-workflows"),
      "handleShellAction" | "resolveQuitWithDownloadQueue"
    >
  >;
  readonly loadSetupWorkflow: () => Promise<
    Pick<typeof import("./workflows/setup-workflows"), "openSetupWizardFromShell">
  >;
};

const defaultLoaders: PaletteWorkflowLoaders = {
  loadShellWorkflows: () => import("./workflows/shell-workflows"),
  loadSetupWorkflow: () => import("./workflows/setup-workflows"),
};

export interface PaletteWorkflowPort {
  resolveQuit(container: Container): Promise<"handled" | "quit">;
  runSetup(container: Container): Promise<"handled">;
  runAction(action: ShellAction, container: Container): Promise<ShellWorkflowResult>;
}

export function createPaletteWorkflowPort(
  loaders: Partial<PaletteWorkflowLoaders> = {},
): PaletteWorkflowPort {
  const resolved = { ...defaultLoaders, ...loaders };
  return {
    async resolveQuit(container) {
      const result = await (
        await resolved.loadShellWorkflows()
      ).resolveQuitWithDownloadQueue(container);
      return result === "quit" ? "quit" : "handled";
    },
    async runSetup(container) {
      const { openSetupWizardFromShell } = await resolved.loadSetupWorkflow();
      await openSetupWizardFromShell(container, { force: true, closeOverlays: true });
      return "handled";
    },
    async runAction(action, container) {
      const { handleShellAction } = await resolved.loadShellWorkflows();
      return handleShellAction({ action, container });
    },
  };
}

export const defaultPaletteWorkflowPort = createPaletteWorkflowPort();
```

Remove static imports of `handleShellAction`,
`resolveQuitWithDownloadQueue`, and `openSetupWizardFromShell` from
`dispatch-palette-command.ts`. Add an optional workflow-port argument and use
its three methods for quit, setup, and workflow actions.

Extend `routeSearchShellAction` input:

```ts
workflows?: PaletteWorkflowPort;
```

Pass it to `dispatchPaletteCommand`; production callers omit it.

- [ ] **Step 4: Run focused command tests**

Run the Step 2 command again.

Expected: PASS.

- [ ] **Step 5: Commit the lazy command boundary**

```sh
git add apps/cli/src/app-shell/palette-workflow-port.ts apps/cli/test/unit/app-shell/palette-workflow-port.test.ts apps/cli/src/app-shell/dispatch-palette-command.ts apps/cli/src/app-shell/command-router.ts apps/cli/test/unit/app-shell/command-router.test.ts
git commit -m "perf(cli): demand-load palette workflows"
```

### Task 4: Hydrate Personal Shortcuts After the Search Input Mounts

**Files:**

- Modify: `apps/cli/src/app-shell/types.ts`
- Modify: `apps/cli/src/app-shell/browse-shell.tsx`
- Create: `apps/cli/test/unit/app-shell/browse-first-paint.useinput.test.tsx`

**Interfaces:**

- Add to `BrowseShell` and `openBrowseShell`:

```ts
loadIdleContext?: () => Promise<BrowseIdleContext | undefined>;
```

- Keep `idleContext` as the synchronous initial value for existing callers.

- [ ] **Step 1: Write first-paint, focus, success, and rejection tests**

Start the test with:

```tsx
import { expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
import type { BrowseIdleContext } from "@/app-shell/types";
import React, { act } from "react";

import { render } from "../../harness/render-capture";
```

Create a deferred helper in the test:

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
```

Mount `BrowseShell` with `loadIdleContext` returning that promise:

```tsx
const pending = deferred<BrowseIdleContext | undefined>();
const handle = render(
  <BrowseShell
    mode="series"
    provider="vidking"
    placeholder="Breaking Bad"
    commands={[]}
    loadIdleContext={() => pending.promise}
    onSearch={async () => ({ options: [], subtitle: "" })}
    onResolve={() => {}}
    onSubmit={() => {}}
    onCancel={() => {}}
  />,
  { columns: 100, rows: 32 },
);
```

Assertions:

```ts
expect(handle.lastFrame()).toContain("Search title");
expect(handle.lastFrame()).toContain("Breaking Bad");

handle.stdin.enqueue(["D", "u", "n", "e"]);

await act(async () => {
  pending.resolve({
    continueWatching: {
      title: "Continue Me",
      titleId: "tmdb:1",
      mediaKind: "series",
      ep: "S01E02",
    },
  });
  await pending.promise;
});

expect(handle.lastFrame()).toContain("Dune");
expect(handle.lastFrame()).toContain("Continue Me");
expect(handle.lastFrame()).not.toContain("▌ ⏸");
```

Add a rejection case:

```ts
await act(async () => {
  pending.reject(new Error("local read failed"));
  await pending.promise.catch(() => {});
});
expect(handle.lastFrame()).toContain("Search title");
expect(handle.lastFrame()).toContain("Local shortcuts unavailable");
```

- [ ] **Step 2: Run the new test and confirm failure**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/browse-first-paint.useinput.test.tsx
```

Expected: FAIL because `loadIdleContext` is not accepted or rendered.

- [ ] **Step 3: Implement deferred idle-context state**

In `BrowseShell`, preserve the existing prop as initial state:

```ts
const [activeIdleContext, setActiveIdleContext] = useState(idleContext);
const [idleContextStatus, setIdleContextStatus] = useState<"idle" | "loading" | "ready" | "error">(
  loadIdleContext ? "loading" : "ready",
);
const [showIdleLoadingHint, setShowIdleLoadingHint] = useState(false);
```

Load after mount with stale/unmount guards:

```ts
useEffect(() => {
  if (!loadIdleContext) return;
  const request = idleContextRequestGateRef.current.begin();
  let active = true;
  const timer = setTimeout(() => {
    if (active) setShowIdleLoadingHint(true);
  }, 150);

  void loadIdleContext()
    .then((next) => {
      if (!active || !idleContextRequestGateRef.current.isCurrent(request)) return;
      setActiveIdleContext(next);
      setIdleContextStatus("ready");
    })
    .catch(() => {
      if (!active || !idleContextRequestGateRef.current.isCurrent(request)) return;
      setIdleContextStatus("error");
    })
    .finally(() => {
      clearTimeout(timer);
      if (active) setShowIdleLoadingHint(false);
    });

  return () => {
    active = false;
    clearTimeout(timer);
    idleContextRequestGateRef.current.invalidate();
  };
}, [loadIdleContext]);
```

Declare the dedicated gate beside the existing request gates:

```ts
const idleContextRequestGateRef = useRef(createLatestRequestGate());
```

The search and idle-context gates remain independent: search supersession cannot
invalidate personal hydration, and personal cleanup cannot invalidate a search.

Replace idle-model/action reads of the prop with `activeIdleContext`. Do not
dispatch a focus-zone event when it changes.

Use this empty-input hint:

```tsx
hint={
  commandMode
    ? undefined
    : displayOptions.length === 0
      ? "Type a title · / commands · /filters for guided search"
      : undefined
}
```

Below the empty state, render:

```tsx
{
  idleContextStatus === "loading" && showIdleLoadingHint ? (
    <Text color={palette.dim} dimColor>
      Loading your local shortcuts…
    </Text>
  ) : idleContextStatus === "error" ? (
    <Text color={palette.dim} dimColor>
      Local shortcuts unavailable · search is ready
    </Text>
  ) : null;
}
```

- [ ] **Step 4: Run first-paint and existing browse tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/browse-first-paint.useinput.test.tsx test/unit/app-shell/browse-idle-actions.test.ts test/unit/app-shell/browse-idle-context.test.ts test/unit/app-shell/calendar-navigation.useinput.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the focused browse hydration**

```sh
git add apps/cli/src/app-shell/types.ts apps/cli/src/app-shell/browse-shell.tsx apps/cli/test/unit/app-shell/browse-first-paint.useinput.test.tsx
git commit -m "perf(cli): hydrate home shortcuts after first paint"
```

### Task 5: Integrate Search-Ready Startup and Milestone Diagnostics

**Files:**

- Create: `apps/cli/src/app/search/search-startup-policy.ts`
- Create: `apps/cli/test/unit/app/search/search-startup-policy.test.ts`
- Create: `apps/cli/src/services/diagnostics/cli-startup-milestone.ts`
- Create: `apps/cli/test/unit/services/diagnostics/cli-startup-milestone.test.ts`
- Modify: `apps/cli/src/app/search/SearchPhase.ts`
- Modify: `apps/cli/src/main.ts`

**Interfaces:**

- Produces:

```ts
export function shouldDeferBrowseIdleContext(input: {
  readonly query: string;
  readonly resultCount: number;
  readonly initialRoute?: SearchStartupRoute;
}): boolean;

export type CliStartupMilestone =
  | "shell-module-loaded"
  | "shell-mounted"
  | "browse-mounted"
  | "idle-context-ready"
  | "idle-context-failed";

export function recordCliStartupMilestone(
  diagnostics: Pick<DiagnosticsService, "record">,
  milestone: CliStartupMilestone,
): void;
```

- [ ] **Step 1: Write startup-policy and milestone tests**

`search-startup-policy.test.ts`:

```ts
import { expect, test } from "bun:test";

import { shouldDeferBrowseIdleContext } from "@/app/search/search-startup-policy";

test("only a normal empty interactive launch defers personal context", () => {
  expect(shouldDeferBrowseIdleContext({ query: "", resultCount: 0 })).toBe(true);
  expect(shouldDeferBrowseIdleContext({ query: "Dune", resultCount: 0 })).toBe(false);
  expect(shouldDeferBrowseIdleContext({ query: "", resultCount: 1 })).toBe(false);
  for (const initialRoute of ["history", "calendar", "recommendation", "random"] as const) {
    expect(shouldDeferBrowseIdleContext({ query: "", resultCount: 0, initialRoute })).toBe(false);
  }
});
```

`cli-startup-milestone.test.ts`:

```ts
import { expect, test } from "bun:test";

import { recordCliStartupMilestone } from "@/services/diagnostics/cli-startup-milestone";

test("records a privacy-safe startup milestone", () => {
  const events: unknown[] = [];
  recordCliStartupMilestone({ record: (event) => events.push(event) } as never, "browse-mounted");

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    category: "session",
    operation: "session.startup.browse-mounted",
    context: { elapsedMs: expect.any(Number) },
  });
  expect(JSON.stringify(events[0])).not.toContain("query");
  expect(JSON.stringify(events[0])).not.toContain("title");
});
```

- [ ] **Step 2: Run the new tests and confirm failure**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app/search/search-startup-policy.test.ts test/unit/services/diagnostics/cli-startup-milestone.test.ts
```

Expected: FAIL because the two helpers do not exist.

- [ ] **Step 3: Implement the pure policy and diagnostics helper**

`search-startup-policy.ts`:

```ts
export type SearchStartupRoute =
  "trending" | "recommendation" | "calendar" | "random" | "surprise" | "history";

export function shouldDeferBrowseIdleContext({
  query,
  resultCount,
  initialRoute,
}: {
  readonly query: string;
  readonly resultCount: number;
  readonly initialRoute?: SearchStartupRoute;
}): boolean {
  return query.trim().length === 0 && resultCount === 0 && initialRoute === undefined;
}
```

Import `SearchStartupRoute` into `SearchPhase.ts` and define
`SearchPhaseInput["initialRoute"]` with that type. The policy module never
imports the phase.

`cli-startup-milestone.ts`:

```ts
import type { DiagnosticsService } from "./DiagnosticsService";
import { buildDiagnosticEvent } from "./diagnostic-event-helpers";

export type CliStartupMilestone =
  | "shell-module-loaded"
  | "shell-mounted"
  | "browse-mounted"
  | "idle-context-ready"
  | "idle-context-failed";

export function recordCliStartupMilestone(
  diagnostics: Pick<DiagnosticsService, "record">,
  milestone: CliStartupMilestone,
): void {
  diagnostics.record(
    buildDiagnosticEvent({
      category: "session",
      operation: `session.startup.${milestone}`,
      status: milestone.endsWith("failed") ? "failed" : "succeeded",
      severity: milestone.endsWith("failed") ? "recoverable" : "healthy",
      recommendedAction: "none",
      message: `CLI startup milestone: ${milestone}`,
      context: { elapsedMs: Math.round(performance.now()) },
    }),
  );
}
```

- [ ] **Step 4: Mount browse before local personal projection**

In `SearchPhase.execute`, compute the policy before building history/display
context. On the normal empty launch:

```ts
const deferIdleContext = shouldDeferBrowseIdleContext({
  query: currentState.searchQuery,
  resultCount: currentState.searchResults.length,
  initialRoute: pendingInitialRoute,
});
```

Skip empty result enrichment:

```ts
const browseContext =
  currentState.searchResults.length === 0
    ? {
        historyMap: {},
        enrichments: new Map(),
        queueTitleIds: new Set<string>(),
        followPreferenceByTitleId: new Map(),
      }
    : await loadBrowseDisplayContext(container, currentState.searchResults);
```

Build an eager bundle only for non-deferred launches. For the normal empty
launch, pass this loader:

```ts
let latestIdleContext: BrowseIdleContext | undefined;
let continueWatchingSelection: ContinueWatchingSelection | null = null;

const loadIdleContext = deferIdleContext
  ? async () => {
      try {
        const allHistory = readLatestHistoryByTitle(container.historyRepository);
        const bundle = await buildBrowseIdleContext(container, {
          preloadedHistory: allHistory,
        });
        latestIdleContext = bundle.idleContext;
        continueWatchingSelection = bundle.continueWatchingSelection;
        recordCliStartupMilestone(diagnosticsService, "idle-context-ready");
        return bundle.idleContext;
      } catch (error) {
        recordCliStartupMilestone(diagnosticsService, "idle-context-failed");
        throw error;
      }
    }
  : undefined;
```

Move the existing local history read, release-reconciliation enqueue, and
one-per-session history-healer scheduling into the deferred loader for the
normal empty launch. Retain their current guarded, fire-and-forget semantics.
Non-deferred launches keep the existing eager path because already-loaded
results need history and enrichment before projection.

Mount and record without awaiting the shell result first:

```ts
const outcomePromise = openBrowseShell({
  // existing props
  idleContext: eagerIdleBundle?.idleContext,
  loadIdleContext,
});
recordCliStartupMilestone(diagnosticsService, "browse-mounted");
const outcome = await outcomePromise;
```

Use `latestIdleContext` and `continueWatchingSelection` for idle-row outcomes.

- [ ] **Step 5: Record shell module and mount milestones**

In `main.ts`:

```ts
const { launchSessionApp } = await import("./app-shell/ink-shell");
recordCliStartupMilestone(container.diagnosticsService, "shell-module-loaded");
launchSessionApp(container);
recordCliStartupMilestone(container.diagnosticsService, "shell-mounted");
```

Keep the existing debug logger timing for the shell import.

- [ ] **Step 6: Run focused startup and browse tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app/search/search-startup-policy.test.ts test/unit/services/diagnostics/cli-startup-milestone.test.ts test/unit/app-shell/browse-first-paint.useinput.test.tsx test/unit/app-shell/browse-idle-context.test.ts test/unit/main-args.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the startup integration**

```sh
git add apps/cli/src/app/search/search-startup-policy.ts apps/cli/test/unit/app/search/search-startup-policy.test.ts apps/cli/src/services/diagnostics/cli-startup-milestone.ts apps/cli/test/unit/services/diagnostics/cli-startup-milestone.test.ts apps/cli/src/app/search/SearchPhase.ts apps/cli/src/main.ts
git commit -m "perf(cli): make search the first useful startup paint"
```

### Task 6: Reconcile Dependencies and Run the Full Gate

**Files:**

- Verify only; do not intentionally modify source files.
- If formatting changes feature files, stage them with the owning feature
  commit or a final formatting commit.

**Interfaces:**

- Consumes all prior tasks.
- Produces verified CLI behavior and comparative startup evidence.

- [ ] **Step 1: Confirm the dirty-tree boundary**

Run:

```sh
git status --short
```

Expected: the user's package/lock/generated-metadata edits remain present and
unstaged; feature files are clean after their commits.

- [ ] **Step 2: Reconcile the local installation with the current lockfile**

Run:

```sh
bun install --frozen-lockfile
```

Expected: dependencies install without changing `bun.lock`. If it reports that
the lockfile is inconsistent with the user's package edits, stop and report the
exact mismatch instead of rewriting the lockfile.

- [ ] **Step 3: Run the focused feature suite**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/command-router.test.ts test/unit/app-shell/command-registry.coverage.test.ts test/unit/app-shell/panel-data.test.ts test/unit/app/bootstrap/startup-setup.test.ts test/unit/app-shell/palette-workflow-port.test.ts test/unit/app-shell/browse-first-paint.useinput.test.tsx test/unit/app/search/search-startup-policy.test.ts test/unit/services/diagnostics/cli-startup-milestone.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run repository verification**

Run in order:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run build
bun run test
```

Expected: every available gate passes. Re-run `git diff --check` after `fmt`.

- [ ] **Step 5: Run manual startup and Stats smokes**

With an isolated completed-onboarding profile, run:

```sh
bun run dev -- --debug
```

Verify:

- the focused search input is the first useful surface;
- typing immediately does not get lost when personal shortcuts appear;
- `/stats` opens from browse;
- `/stats` opens from post-playback or an active-playback palette when those
  surfaces are available;
- debug diagnostics order is shell module, shell mount, browse mount, then idle
  context;
- no setup screen or workflow import is observed for completed onboarding.

Repeat the import timing probe from the design on the same installation and
record the before/after values in the final handoff. Do not establish a fixed CI
millisecond threshold.

- [ ] **Step 6: Inspect final scope**

Run:

```sh
git status --short
git log -6 --oneline
git diff --check
```

Expected: only the user's pre-existing unrelated edits remain uncommitted, all
feature commits are present, and no whitespace errors remain.
