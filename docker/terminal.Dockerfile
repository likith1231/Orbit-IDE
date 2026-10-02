# Image for the in-browser terminal: one container per project, workspace mounted at /workspace.
# Build:  docker build -t orbit-terminal:latest -f docker/terminal.Dockerfile docker
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      git curl wget ca-certificates less nano vim-tiny \
      build-essential procps unzip zip jq \
 && rm -rf /var/lib/apt/lists/* \
 && ln -sf /usr/bin/python3 /usr/local/bin/python \
 # Let "pip install" work without a venv inside this throwaway container.
 && rm -f /usr/lib/python3*/EXTERNALLY-MANAGED

ENV TERM=xterm-256color \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    npm_config_update_notifier=false

WORKDIR /workspace
CMD ["sleep", "infinity"]
