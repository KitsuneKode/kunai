#!/usr/bin/env bun
// =============================================================================
// KitsuneSnipe - Legacy Compatibility Entrypoint
//
// The canonical fullscreen runtime now lives in src/main.ts.
// This wrapper exists only so older local habits or docs that still invoke
// `bun run index.ts` continue to work while the legacy migration residue is
// being retired.
// =============================================================================

import { startCli } from "@/main";

void startCli(process.argv.slice(2));
