import { installTestStorageIsolation } from "./install-test-storage";

// Runs before any test module loads, so code that resolves its storage roots
// at import time already sees the throwaway profile.
installTestStorageIsolation();
