#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/flow-smoke.XXXXXX")"

cleanup() {
  rm -rf "${TMP_DIR}"
}

trap cleanup EXIT

if [[ ! -d "${REPO_ROOT}/dist" ]]; then
  echo "dist directory is missing. Run 'pnpm build' before smoke." >&2
  exit 1
fi

FLOW_LAUNCH_PROVIDER=mock \
FLOW_LAUNCH_AUTONOMY=autonomous \
FLOW_LAUNCH_GOAL="write smoke output" \
FLOW_LAUNCH_KEEP_WORKSPACE=false \
bash "${REPO_ROOT}/scripts/launch-project.sh" "${TMP_DIR}" >/dev/null

(
  cd "${TMP_DIR}"
  node "${REPO_ROOT}/dist/packages/cli/index.js" cleanup --dry-run --keep-latest-artifacts 1 --keep-latest-run-events 1 --keep-latest-memory-entries 1 >/dev/null
  node "${REPO_ROOT}/dist/packages/cli/index.js" maintenance-summary >/dev/null
)

echo "FLOW smoke passed"
