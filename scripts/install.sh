#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-/opt/flow-agent}"
mkdir -p "$ROOT_DIR"
cp -R dist "$ROOT_DIR/dist"
cp -R templates "$ROOT_DIR/templates"
install -m 644 scripts/flow-agent.service /etc/systemd/system/flow-agent.service
systemctl daemon-reload
systemctl enable flow-agent.service
