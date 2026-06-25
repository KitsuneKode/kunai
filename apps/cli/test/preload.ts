/** Block xdg-open / browser spawns during `bun test` unless a test opts out explicitly. */
process.env.KUNAI_DISABLE_EXTERNAL_URL ??= "1";
