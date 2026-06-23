#!/usr/bin/env bash
# Build the Docker image for a single platform locally (same as CI publish workflow).
#
# Usage:
#   ./scripts/docker-build-platform.sh linux/arm64
#   ./scripts/docker-build-platform.sh linux/amd64 videosphere:amd64-test
#
# Cross-arch on amd64 (arm64) needs QEMU. One-time host setup (Ubuntu/Debian):
#   sudo apt install qemu-user-static binfmt-support
#   sudo podman run --rm --privileged docker.io/tonistiigi/binfmt:latest --install all
set -euo pipefail

PLATFORM="${1:-linux/arm64}"
TAG="${2:-videosphere:local-test}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if command -v podman >/dev/null 2>&1; then
  BUILDER=podman
elif command -v docker >/dev/null 2>&1; then
  BUILDER=docker
else
  echo "error: podman or docker is required" >&2
  exit 1
fi

HOST_ARCH="$(uname -m)"
NATIVE_PLATFORM="linux/amd64"
case "$HOST_ARCH" in
  aarch64|arm64) NATIVE_PLATFORM="linux/arm64" ;;
esac

needs_qemu() {
  [[ "$PLATFORM" != "$NATIVE_PLATFORM" ]]
}

qemu_ready() {
  if [ -r /proc/sys/fs/binfmt_misc/status ]; then
    grep -q 'qemu' /proc/sys/fs/binfmt_misc/status 2>/dev/null && return 0
  fi
  command -v qemu-aarch64-static >/dev/null 2>&1 || command -v qemu-arm-static >/dev/null 2>&1
}

if needs_qemu && ! qemu_ready; then
  cat >&2 <<EOF
error: QEMU binfmt is not configured for $PLATFORM builds on $HOST_ARCH.

  sudo apt install qemu-user-static binfmt-support
  sudo $BUILDER run --rm --privileged docker.io/tonistiigi/binfmt:latest --install all

Then re-run: $0 $PLATFORM $TAG
EOF
  exit 1
fi

echo "Building $TAG for $PLATFORM using $BUILDER..."

if [ "$BUILDER" = podman ]; then
  podman build --platform "$PLATFORM" -f "$ROOT/Dockerfile" -t "$TAG" "$ROOT"
else
  BUILDER_NAME="${BUILDER_NAME:-videosphere-builder}"
  docker buildx create --name "$BUILDER_NAME" --use 2>/dev/null || docker buildx use "$BUILDER_NAME"
  docker run --rm --privileged docker.io/tonistiigi/binfmt:latest --install all >/dev/null 2>&1 || true
  docker buildx build --platform "$PLATFORM" -f "$ROOT/Dockerfile" -t "$TAG" --load "$ROOT"
fi

echo "Success: $TAG ($PLATFORM)"
