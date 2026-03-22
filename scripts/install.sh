#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-/opt/flow-agent}"
MODE="${2:-system}"
SERVICE_NAME="${3:-flow-agent}"

if [[ ! -d "dist" ]]; then
  echo "dist directory is missing. Run 'pnpm build' before install." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to install FLOW." >&2
  exit 1
fi

if [[ "${MODE}" != "project" && "${MODE}" != "system" ]]; then
  echo "mode must be either 'project' or 'system'." >&2
  exit 1
fi

mkdir -p "${ROOT_DIR}"
mkdir -p "${ROOT_DIR}/templates"

cp -R dist "${ROOT_DIR}/dist"
cp -R templates "${ROOT_DIR}/templates"
install -m 755 scripts/install.sh "${ROOT_DIR}/install.sh"

(
  cd "${ROOT_DIR}"
  node dist/packages/cli/index.js init --mode "${MODE}"
)

if [[ "${MODE}" == "system" ]]; then
  install -m 644 scripts/flow-agent.service "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}.service"
  echo "Installed FLOW system service: ${SERVICE_NAME}"
else
  echo "Installed FLOW project runtime into ${ROOT_DIR}"
fi
