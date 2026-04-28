#!/usr/bin/env bun
// =============================================================================
// Kunai - Legacy Compatibility Entrypoint
//
// The canonical fullscreen runtime lives in apps/cli/src/main.ts.
// This wrapper exists only so older local habits or docs that still invoke
// `bun run --cwd apps/cli index.ts` continue to work while the legacy migration residue is
// being retired.
// =============================================================================

import { startCli } from "@/main";

void startCli(process.argv.slice(2));
