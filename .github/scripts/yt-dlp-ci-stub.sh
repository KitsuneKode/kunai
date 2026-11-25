#!/bin/sh
# CI presence stub for yt-dlp. The YouTube-provider resolve tests gate on
# `Bun.which("yt-dlp")` and inject their metadata service, so the binary must
# exist but is never run. Installing a stub instead of the moving upstream
# `latest` asset keeps third-party code out of the test job, which can see
# the remote-cache token (security review M5, #777).
if [ "${1:-}" = "--version" ]; then
  echo "0000.00.00-ci-stub"
  exit 0
fi
echo "yt-dlp CI stub: a test invoked yt-dlp ($*); tests must inject their metadata service" >&2
exit 97
