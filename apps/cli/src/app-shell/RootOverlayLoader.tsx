import type { Container } from "@/container";
import type { SessionState } from "@/domain/session/SessionState";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";

import { cancelRootOverlay } from "./cancel-root-overlay";
import type { RootOwnedOverlay } from "./root-shell-state";
import { palette } from "./shell-theme";

type RootOverlayModule = typeof import("./root-overlay-shell");

type RootOverlayLoaderProps = {
  readonly overlay: RootOwnedOverlay;
  readonly state: SessionState;
  readonly container: Container;
  readonly onRedraw: () => void;
};

let loadedModule: RootOverlayModule | null = null;
let loadingPromise: Promise<RootOverlayModule> | null = null;

type RootOverlayModuleImport = () => Promise<RootOverlayModule>;
const defaultRootOverlayModuleImport: RootOverlayModuleImport = () =>
  import("./root-overlay-shell");
let importRootOverlayModule: RootOverlayModuleImport = defaultRootOverlayModuleImport;

/** Test seam: swap the dynamic import and reset the module cache. Pass null to restore. */
export function setRootOverlayModuleImportForTests(next: RootOverlayModuleImport | null): void {
  importRootOverlayModule = next ?? defaultRootOverlayModuleImport;
  loadedModule = null;
  loadingPromise = null;
}

function loadRootOverlayModule(): Promise<RootOverlayModule> {
  if (loadedModule) return Promise.resolve(loadedModule);
  loadingPromise ??= importRootOverlayModule().then(
    (module) => {
      loadedModule = module;
      return module;
    },
    (error: unknown) => {
      loadingPromise = null;
      throw error;
    },
  );
  return loadingPromise;
}

export function RootOverlayLoader(props: RootOverlayLoaderProps): React.ReactElement {
  const [module, setModule] = useState(loadedModule);
  const [loadError, setLoadError] = useState(false);

  useInput(
    (_input, key) => {
      if (key.escape) {
        cancelRootOverlay(props.overlay, props.container.stateManager);
      }
    },
    { isActive: module === null },
  );

  useEffect(() => {
    if (module) return undefined;
    let active = true;
    void loadRootOverlayModule().then(
      (loaded) => {
        if (active) setModule(loaded);
        return undefined;
      },
      () => {
        if (active) setLoadError(true);
        return undefined;
      },
    );
    return () => {
      active = false;
    };
  }, [module]);

  if (loadError) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={palette.danger} bold>
          Panel unavailable
        </Text>
        <Text color={palette.muted}>Esc to close, then try again.</Text>
      </Box>
    );
  }

  if (!module) {
    return (
      <Box paddingX={1}>
        <Text color={palette.muted}>Opening panel… · Esc closes</Text>
      </Box>
    );
  }

  const RootOverlayShell = module.RootOverlayShell;
  return <RootOverlayShell {...props} />;
}
