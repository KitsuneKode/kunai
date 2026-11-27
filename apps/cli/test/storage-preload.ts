import { installTestStorageIsolation } from "../../../test/helpers/install-test-storage";
import { installProfileGuard } from "./helpers/profile-guard";

// Order matters: the guard snapshots the developer's real profile (and any
// valid inherited KUNAI_CONFIG_DIR profile) *before* storage isolation moves
// HOME/XDG/APPDATA/KUNAI_CONFIG_DIR to the throwaway root.
installProfileGuard();
installTestStorageIsolation();
