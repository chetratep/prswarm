#!/usr/bin/env bash
# Installs the latest published PRSwarm release for Linux/macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/chetratep/prswarm/main/install.sh | bash
#
# Draft releases are never installed by this script — GitHub's
# /releases/latest API only ever returns the latest *published* release,
# which is exactly the point of drafting first (see .github/workflows/release.yml):
# nothing reaches an end user until someone hits "Publish" on GitHub.
#
# Env vars:
#   PRSWARM_VERSION   Install this tag instead of latest (e.g. v1.2.3)
#   PRSWARM_INSTALL_DIR   Install directory (default: $HOME/.local/bin)
set -euo pipefail

REPO="chetratep/prswarm"
INSTALL_DIR="${PRSWARM_INSTALL_DIR:-$HOME/.local/bin}"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Linux) platform="linux" ;;
  Darwin) platform="macos" ;;
  *)
    echo "Unsupported OS: $os (this script only supports Linux and macOS — use install.ps1 on Windows)" >&2
    exit 1
    ;;
esac

case "$arch" in
  x86_64|amd64) platform_arch="${platform}-x64" ;;
  arm64|aarch64) platform_arch="${platform}-arm64" ;;
  *)
    echo "Unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

asset="prswarm-${platform_arch}"

if [ -n "${PRSWARM_VERSION:-}" ]; then
  tag="$PRSWARM_VERSION"
else
  tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | head -1 | sed -E 's/.*"tag_name": ?"([^"]+)".*/\1/')"
  if [ -z "$tag" ]; then
    echo "Could not determine the latest release tag. Set PRSWARM_VERSION to install a specific one." >&2
    exit 1
  fi
fi

url="https://github.com/${REPO}/releases/download/${tag}/${asset}"
checksums_url="https://github.com/${REPO}/releases/download/${tag}/SHA256SUMS.txt"

echo "Installing PRSwarm ${tag} (${platform_arch})..."

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

curl -fsSL "$url" -o "${tmp_dir}/${asset}"

# Verify against the release's checksums file when it's available — don't
# fail the install if it isn't (an older release, or a manual re-run before
# that step existed), just skip verification.
if curl -fsSL "$checksums_url" -o "${tmp_dir}/SHA256SUMS.txt" 2>/dev/null; then
  expected="$(grep " ${asset}\$" "${tmp_dir}/SHA256SUMS.txt" | awk '{print $1}')"
  if [ -n "$expected" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "${tmp_dir}/${asset}" | awk '{print $1}')"
    else
      actual="$(shasum -a 256 "${tmp_dir}/${asset}" | awk '{print $1}')"
    fi
    if [ "$expected" != "$actual" ]; then
      echo "Checksum mismatch for ${asset} — expected ${expected}, got ${actual}. Aborting." >&2
      exit 1
    fi
    echo "Checksum verified."
  fi
fi

mkdir -p "$INSTALL_DIR"
install -m 755 "${tmp_dir}/${asset}" "${INSTALL_DIR}/prswarm"

echo "Installed to ${INSTALL_DIR}/prswarm"

case ":$PATH:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo ""
    echo "${INSTALL_DIR} isn't on your PATH. Add this to your shell profile:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

echo ""
echo "Run it with: prswarm"
