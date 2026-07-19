# Disposable environment for installer scenarios.
#
# Runs as a non-root user with a real HOME, because install.sh writes to
# ~/.local/bin and ~/.local/share — running as root would exercise paths no
# user actually hits. node+npm are present so the npm-contamination scenario
# can create a competing global install.
FROM node:22-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash tester \
	&& mkdir -p /opt/fake-release \
	&& chown -R tester:tester /opt/fake-release

# npm's default global prefix is root-owned; give the test user its own so a
# global install succeeds without sudo, as it would on a developer machine.
RUN mkdir -p /home/tester/.npm-global \
	&& chown -R tester:tester /home/tester/.npm-global

USER tester
WORKDIR /home/tester

ENV NPM_CONFIG_PREFIX=/home/tester/.npm-global
# npm's global bin deliberately precedes ~/.local/bin: this is the common
# real-world ordering and the one under which a stale shim can shadow a newer
# native install. The scenario exists to find out whether it does.
ENV PATH=/home/tester/.npm-global/bin:/home/tester/.local/bin:$PATH

ENTRYPOINT ["/bin/bash"]
