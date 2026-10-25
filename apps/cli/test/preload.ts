function configureTestEnvironment(): void {
  /** Block xdg-open / browser spawns during `bun test` unless a test opts out explicitly. */
  process.env.KUNAI_DISABLE_EXTERNAL_URL ??= "1";

  // Local test runners need the same privacy guarantee as CI, even in a TTY
  // with CI=0 or an inherited DO_NOT_TRACK=0. Consent/ingest unit fixtures may
  // inject env: {} only alongside isolated config and mocked/local delivery.
  process.env.DO_NOT_TRACK = "1";
}

configureTestEnvironment();
