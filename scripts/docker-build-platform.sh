#!/usr/bin/env bash
# Build the Docker image for a single platform locally (same as CI publish workflow).
# Use this to validate arm/v7 (HC2) or other targets before pushing to main.
#
# Usage:
#   ./scripts/docker-build-platform.sh                    # defaults to linux/arm/v7
#   ./scripts/docker-build-platform.sh linux/arm64
#   ./scripts/docker-build-platform.sh linux/amd64 videosphere:amd64-test
#
# Cross-arch on amd64 (arm/v7, arm64) needs QEMU. One-time host setup (Ubuntu/Debian):
#   sudo apt install qemu-user-static binfmt-support
#   sudo podman run --rm --privileged docker.io/tonistiigi/binfmt:latest --install all
set -euo pipefail

PLATFORM="${1:-linux/arm/v7}"
TAG="${2:-videosphere:local-test}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Prefer podman when available; fall back to docker buildx.
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
  armv7l|armv6l) NATIVE_PLATFORM="linux/arm/v7" ;;
esac

needs_qemu() {
  [[ "$PLATFORM" != "$NATIVE_PLATFORM" && "$PLATFORM" != linux/amd64 ]]
}

qemu_ready() {
  # binfmt_misc registers qemu-* handlers when cross-arch emulation is available.
  if [ -r /proc/sys/fs/binfmt_misc/status ]; then
    grep -q 'qemu' /proc/sys/fs/binfmt_misc/status 2>/dev/null && return 0
  fi
  command -v qemu-arm-static >/dev/null 2>&1
}

install_qemu_hint() {
  cat >&2 <<EOF

Cross-arch build requires QEMU on this $HOST_ARCH host.

One-time setup (Ubuntu/Debian):
  sudo apt install qemu-user-static binfmt-support
  sudo $BUILDER run --rm --privileged docker.io/tonistiigi/binfmt:latest --install all

Then re-run:
  $0 $PLATFORM $TAG

EOF
}

if needs_qemu && ! qemu_ready; then
  echo "error: QEMU binfmt is not configured for $PLATFORM builds." >&2
  install_qemu_hint
  exit 1
fi

echo "Building $TAG for $PLATFORM using $BUILDER (native: $NATIVE_PLATFORM)..."

if [ "$BUILDER" = podman ]; then
  podman build \
    --platform "$PLATFORM" \
    -f "$ROOT/Dockerfile" \
    -t "$TAG" \
    "$ROOT"
else
  BUILDER_NAME="${BUILDER_NAME:-videosphere-builder}"
  if ! docker buildx version >/dev/null 2>&1; then
    echo "error: docker buildx is required" >&2
    exit 1
  fi
  docker buildx create --name "$BUILDER_NAME" --use 2>/dev/null || docker buildx use "$BUILDER_NAME"
  docker run --rm --privileged docker.io/tonistiigi/binfmt:latest --install all >/dev/null 2>&1 || true
  docker buildx build \
    --platform "$PLATFORM" \
    -f "$ROOT/Dockerfile" \
    -t "$TAG" \
    --load \
    "$ROOT"
fi

echo ""
echo "Success: $TAG ($PLATFORM)"
