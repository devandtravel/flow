#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

WORKSPACE_ROOT="${1:-${FLOW_LAUNCH_WORKSPACE:-}}"
PROVIDER="${FLOW_LAUNCH_PROVIDER:-mock}"
GOAL="${FLOW_LAUNCH_GOAL:-write launch output}"

if [[ -z "${WORKSPACE_ROOT}" ]]; then
  if [[ "${PROVIDER}" == "mock" ]]; then
    WORKSPACE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/flow-launch.XXXXXX")"
  else
    echo "An explicit workspace is required for non-mock launch provider." >&2
    exit 1
  fi
fi

AUTONOMY="${FLOW_LAUNCH_AUTONOMY:-}"
if [[ -z "${AUTONOMY}" ]]; then
  if [[ "${PROVIDER}" == "mock" ]]; then
    AUTONOMY="autonomous"
  else
    AUTONOMY="supervised"
  fi
fi

KEEP_WORKSPACE="${FLOW_LAUNCH_KEEP_WORKSPACE:-true}"

if [[ ! -d "${REPO_ROOT}/dist" ]]; then
  echo "dist directory is missing. Run 'pnpm build' before launch." >&2
  exit 1
fi

mkdir -p "${WORKSPACE_ROOT}"

(
  cd "${WORKSPACE_ROOT}"
  node "${REPO_ROOT}/dist/packages/cli/index.js" init --mode project >/dev/null
)

(
  cd "${REPO_ROOT}"
  node - "${WORKSPACE_ROOT}/.agent/config.yaml" "${PROVIDER}" "${AUTONOMY}" <<'NODE'
const fs = require('node:fs');
const YAML = require('yaml');

const configPath = process.argv[2];
const provider = process.argv[3];
const autonomy = process.argv[4];
const config = YAML.parse(fs.readFileSync(configPath, 'utf8'));

config.llm.provider = provider;
config.autonomy.mode = autonomy;

if (provider === 'mock') {
  config.maintenance.cleanup.dry_run_default = true;
}

fs.writeFileSync(configPath, YAML.stringify(config), 'utf8');
NODE
)

RUN_OUTPUT_FILE="${WORKSPACE_ROOT}/.agent/launch-run.json"
MAINTENANCE_OUTPUT_FILE="${WORKSPACE_ROOT}/.agent/launch-maintenance-summary.json"

(
  cd "${WORKSPACE_ROOT}"
  node "${REPO_ROOT}/dist/packages/cli/index.js" run "${GOAL}" > "${RUN_OUTPUT_FILE}"
  node "${REPO_ROOT}/dist/packages/cli/index.js" maintenance-summary > "${MAINTENANCE_OUTPUT_FILE}"
)

OUTPUT_FILE="${WORKSPACE_ROOT}/agent-output.txt"
if [[ ! -f "${OUTPUT_FILE}" ]]; then
  echo "Launch run did not produce ${OUTPUT_FILE}" >&2
  exit 1
fi

(
  cd "${REPO_ROOT}"
  node - "${RUN_OUTPUT_FILE}" "${MAINTENANCE_OUTPUT_FILE}" "${WORKSPACE_ROOT}" "${PROVIDER}" "${AUTONOMY}" "${GOAL}" "${KEEP_WORKSPACE}" <<'NODE'
const fs = require('node:fs');

const runOutputPath = process.argv[2];
const maintenanceOutputPath = process.argv[3];
const workspaceRoot = process.argv[4];
const provider = process.argv[5];
const autonomy = process.argv[6];
const goal = process.argv[7];
const keepWorkspace = process.argv[8] === 'true';

const runOutput = JSON.parse(fs.readFileSync(runOutputPath, 'utf8'));
const maintenanceSummary = JSON.parse(fs.readFileSync(maintenanceOutputPath, 'utf8'));

if (!runOutput || typeof runOutput !== 'object' || !('state' in runOutput)) {
  throw new Error('Launch output is missing task state.');
}

process.stdout.write(
  JSON.stringify(
    {
      workspaceRoot,
      provider,
      autonomy,
      goal,
      keepWorkspace,
      taskState: runOutput.state,
      runId: runOutput.runId,
      outputFile: `${workspaceRoot}/agent-output.txt`,
      maintenanceOperation: maintenanceSummary.operation,
      maintenanceTotalEvents: maintenanceSummary.totals.all,
    },
    null,
    2,
  ),
);
NODE
)
