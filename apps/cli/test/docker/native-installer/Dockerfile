# Isolated native-installer smoke images. Build once; run many times without touching the host.
#
#   docker build -t kunai-installer-smoke:glibc -f Dockerfile --target glibc .
#   docker build -t kunai-installer-smoke:musl  -f Dockerfile --target musl .

# glibc ships without `zstd`, so install.sh takes the .tar.gz; musl adds it and
# takes the .tar.zst. Between them both archive paths run in the matrix.
FROM debian:bookworm-slim AS glibc
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash curl ca-certificates python3 coreutils util-linux \
  && rm -rf /var/lib/apt/lists/*
ENV KUNAI_TEST_HOME=/tmp/kunai-home
WORKDIR /work

FROM alpine:3.20 AS musl
# The CI fixture is a real Bun musl executable. Install its loader dependencies
# explicitly so clean-install can run it without relying on mpv.
RUN apk add --no-cache bash curl ca-certificates python3 coreutils util-linux zstd libstdc++ libgcc
ENV KUNAI_TEST_HOME=/tmp/kunai-home
WORKDIR /work
