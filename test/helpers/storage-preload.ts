import { installTestStorageIsolation, mountTestStorageIsolation } from "./install-test-storage";
import { beginTestScratch, finishTestScratch } from "./test-scratch";

// Runs before any test module loads, so code that resolves its storage roots
// at import time already sees the throwaway profile. The scratch directory is
// the process TMPDIR; its afterAll runs after the profile cleanup because
// Bun invokes preload hooks in registration order.
const scratch = beginTestScratch();
if (scratch) {
  scratch.profileCleanup = mountTestStorageIsolation();
  finishTestScratch(scratch);
} else {
  installTestStorageIsolation();
}
