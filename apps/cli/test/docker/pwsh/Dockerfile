# Local PowerShell harness for install.ps1.
#
# The pwsh installer tests are the one part of the release gate that cannot run
# on a Linux workstation, so they used to be provable only on Windows CI. This
# image gives the same assertions a local home: PowerShell runs the real
# install.ps1, and Bun runs the real test file that drives it.
#
# PowerShell ships as a self-contained tarball, so we take it directly from the
# pinned GitHub release rather than adding Microsoft's apt repository — fewer
# moving parts, and the version is visible here instead of floating.

FROM oven/bun:1.3.14-debian

ARG POWERSHELL_VERSION=7.4.6

# libicu is PowerShell's only native prerequisite worth naming; ca-certificates
# and curl are for the download itself. The ICU soname is bumped every Debian
# release (72 on bookworm, 76 on trixie), so resolve it from the package index
# instead of pinning a number that silently breaks on the next base-image bump.
RUN apt-get update \
  && ICU_PACKAGE="$(apt-cache search --names-only '^libicu[0-9]+$' \
       | cut -d' ' -f1 | sort --version-sort | tail -n1)" \
  && test -n "${ICU_PACKAGE}" \
  && echo "[pwsh-harness] using ${ICU_PACKAGE}" \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    "${ICU_PACKAGE}" \
    nodejs \
    npm \
  && rm -rf /var/lib/apt/lists/*

# install.ps1 shells out to node/npm for its package-manager methods, and its
# `Require-Cmd` preflight fails closed when they are absent. The Bun base image
# ships neither, so without these the npm/bun tests fail on the preflight rather
# than on anything they mean to assert.

RUN curl -fsSL \
    "https://github.com/PowerShell/PowerShell/releases/download/v${POWERSHELL_VERSION}/powershell-${POWERSHELL_VERSION}-linux-x64.tar.gz" \
    -o /tmp/powershell.tar.gz \
  && mkdir -p /opt/microsoft/powershell/7 \
  && tar zxf /tmp/powershell.tar.gz -C /opt/microsoft/powershell/7 \
  && chmod +x /opt/microsoft/powershell/7/pwsh \
  && ln -s /opt/microsoft/powershell/7/pwsh /usr/bin/pwsh \
  && rm /tmp/powershell.tar.gz

# Fail the build rather than the test run if pwsh cannot actually start.
RUN pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'

WORKDIR /repo
ENTRYPOINT ["/bin/bash"]
