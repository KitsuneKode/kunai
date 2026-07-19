# Maintainer-only reproduction image for Kunai support bundles.
# NOT a shipped user feature — local debugging / issue triage only.
#
# Stack: Alpine + Bun (UPX-compressed single binary) + mpv.
# Size target: under ~200 MB (assert via assert-image-size.sh).
#
#   docker build -t kunai-repro:local -f apps/cli/test/docker/repro/Dockerfile apps/cli/test/docker/repro
#
# Bun is copied from oven/bun:alpine and compressed so the full mpv codec
# stack can stay intact without blowing the size budget.

FROM oven/bun:1-alpine AS bunsrc

FROM alpine:3.20 AS pack
RUN apk add --no-cache upx
COPY --from=bunsrc /usr/local/bin/bun /tmp/bun
RUN upx -q --lzma /tmp/bun

FROM alpine:3.20
LABEL org.opencontainers.image.title="kunai-repro" \
  org.opencontainers.image.description="Maintainer-only Kunai support-bundle reproduction harness (not shipped to end users)" \
  org.opencontainers.image.source="https://github.com/kitsunekode/kitsunesnipe"
ENV PATH="/usr/local/bin:${PATH}"
RUN apk add --no-cache bash ca-certificates libstdc++ libgcc mpv \
  && rm -rf /usr/share/locale /usr/share/man /usr/share/doc /var/cache/apk/* \
  && adduser -D -u 1000 -h /home/repro repro
COPY --from=pack /tmp/bun /usr/local/bin/bun
RUN bun --version \
  && mpv --version 2>&1 | head -1
WORKDIR /work
USER repro
ENTRYPOINT ["/bin/bash"]
