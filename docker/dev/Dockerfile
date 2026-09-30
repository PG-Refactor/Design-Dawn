# Design Dawn development image (Phase 0). See docs/environment.md.
FROM ubuntu:24.04

ARG NODE_VERSION=24.21.0
# Keep in sync with rust-toolchain.toml.
ARG RUST_VERSION=1.98.1
ARG DEV_USER=dev
ARG DEV_UID=1000
ARG DEV_GID=1000

ENV DEBIAN_FRONTEND=noninteractive

# Tauri 2 Linux build dependencies + runtime helpers (fonts, mesa, xwininfo).
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      file \
      fonts-noto-cjk \
      git \
      libayatana-appindicator3-dev \
      libgl1-mesa-dri \
      librsvg2-dev \
      libssl-dev \
      libwebkit2gtk-4.1-dev \
      libxdo-dev \
      pkg-config \
      wget \
      x11-utils \
      xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Node.js from the official tarball, verified against the published SHA256 list.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) node_arch=x64 ;; \
      arm64) node_arch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${archive}"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " ${archive}\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "${archive}" -C /usr/local --strip-components=1 --no-same-owner; \
    rm -f "${archive}" SHASUMS256.txt; \
    node --version; npm --version

# Ubuntu 24.04 ships a user "ubuntu" with UID/GID 1000; replace it with "dev".
RUN set -eux; \
    if id ubuntu >/dev/null 2>&1; then userdel -r ubuntu; fi; \
    if getent group ubuntu >/dev/null; then groupdel ubuntu; fi; \
    groupadd --gid "${DEV_GID}" "${DEV_USER}"; \
    useradd --uid "${DEV_UID}" --gid "${DEV_GID}" --create-home --shell /bin/bash "${DEV_USER}"; \
    # Mount points for compose named volumes. Pre-creating them owned by the
    # dev user makes Docker initialise the volumes with that ownership.
    mkdir -p /workspace/node_modules /workspace/src-tauri/target \
             "/home/${DEV_USER}/.cargo/registry" "/home/${DEV_USER}/.cargo/git" \
             "/home/${DEV_USER}/.npm"; \
    chown -R "${DEV_UID}:${DEV_GID}" /workspace "/home/${DEV_USER}"

USER ${DEV_USER}
ENV RUSTUP_HOME=/home/${DEV_USER}/.rustup \
    CARGO_HOME=/home/${DEV_USER}/.cargo
ENV PATH=/home/${DEV_USER}/.cargo/bin:${PATH}

RUN curl -fsSL --proto '=https' --tlsv1.2 https://sh.rustup.rs -o /tmp/rustup-init.sh \
    && sh /tmp/rustup-init.sh -y --no-modify-path --profile minimal \
         --default-toolchain "${RUST_VERSION}" -c rustfmt -c clippy \
    && rm /tmp/rustup-init.sh \
    && rustc --version && cargo --version

WORKDIR /workspace
