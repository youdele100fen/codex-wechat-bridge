#!/usr/bin/env bash

set -euo pipefail

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "codex-wechat-bridge currently supports macOS only." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or later is required, but 'node' was not found." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "${NODE_MAJOR}" -lt 18 ]]; then
  echo "Node.js 18 or later is required, but found $(node -v)." >&2
  exit 1
fi

for cmd in codex npx osascript; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Required command not found: ${cmd}" >&2
    exit 1
  fi
done

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"

mkdir -p "${BIN_DIR}"
chmod +x "${REPO_DIR}/codex-wechat-bridge.mjs"

ln -sf "${REPO_DIR}/codex-wechat-bridge.mjs" "${BIN_DIR}/codex-wechat-bridge"
ln -sf "${REPO_DIR}/codex-wechat-bridge.mjs" "${BIN_DIR}/codex-wechat"

echo "Installed command links:"
echo "  ${BIN_DIR}/codex-wechat-bridge"
echo "  ${BIN_DIR}/codex-wechat"

if ! open -Ra "Codex" >/dev/null 2>&1; then
  echo
  echo "Warning: Codex Desktop was not found by Launch Services."
  echo "Install Codex Desktop before using WeChat prompt submission."
fi

if [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
  SHELL_NAME="$(basename "${SHELL:-zsh}")"
  RC_FILE="${HOME}/.zshrc"
  if [[ "${SHELL_NAME}" == "bash" ]]; then
    RC_FILE="${HOME}/.bashrc"
  fi

  echo
  echo "Add ${BIN_DIR} to your PATH, then restart the terminal:"
  echo "  echo 'export PATH=\"${BIN_DIR}:\$PATH\"' >> ${RC_FILE}"
  echo "  source ${RC_FILE}"
else
  echo
  echo "Your PATH already includes ${BIN_DIR}."
fi

echo
echo "Next steps:"
echo "  codex-wechat setup"
echo "  codex-wechat doctor"
echo "  codex-wechat start"
