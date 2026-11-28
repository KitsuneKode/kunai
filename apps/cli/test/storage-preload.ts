import {
  installTestStorageIsolation,
  mountTestStorageIsolation,
} from "../../../test/helpers/install-test-storage";
import { beginTestScratch, finishTestScratch } from "../../../test/helpers/test-scratch";
import { installProfileGuard } from "./helpers/profile-guard";

// Scratch removal is registered first. Bun runs preload afterAll hooks in
// registration order and skips the rest when one throws, so a profile-guard
// failure must not skip temp cleanup. The scratch hook itself never throws:
// it records a leak and finishTestScratch's hook, registered last, rethrows
// it, so a temp leak cannot skip the profile guard either. The guard still
// snapshots the real profile before storage isolation rewrites HOME:
// beginTestScratch only redirects TMPDIR/TMP/TEMP.
const scratch = beginTestScratch();
installProfileGuard();
if (scratch) {
  scratch.profileCleanup = mountTestStorageIsolation();
  finishTestScratch(scratch);
} else {
  installTestStorageIsolation();
}
