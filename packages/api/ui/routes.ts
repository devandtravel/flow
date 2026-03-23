export const dashboardRouteStateScript = `
function loadPersistedState() {
  const storedTaskId = safeReadStorage(storageKeys.selectedTaskId);
  const storedView = safeReadStorage(storageKeys.activeView);
  const storedPolling = safeReadStorage(storageKeys.pollingPaused);
  const storedTaskFilter = safeReadStorage(storageKeys.taskFilter);
  const storedEventLevelFilter = safeReadStorage(storageKeys.eventLevelFilter);
  const storedApprovalFilter = safeReadStorage(storageKeys.approvalFilter);
  const storedArtifactRunFilter = safeReadStorage(storageKeys.artifactRunFilter);
  const storedArtifactTypeFilter = safeReadStorage(storageKeys.artifactTypeFilter);
  const storedArtifactId = safeReadStorage(storageKeys.selectedArtifactId);
  if (storedTaskId) {
    state.selectedTaskId = storedTaskId;
  }
  const storedRunId = safeReadStorage(storageKeys.selectedRunId);
  if (storedView === 'overview' || storedView === 'artifacts' || storedView === 'logs' || storedView === 'run') {
    state.activeView = storedView;
  }
  if (storedRunId) {
    state.selectedRunId = storedRunId;
  }
  if (storedArtifactId) {
    state.selectedArtifactId = storedArtifactId;
  }
  if (storedPolling === 'true') {
    state.pollingPaused = true;
  }
  state.compactMode = true;
  state.taskFilter = storedTaskFilter;
  state.eventLevelFilter = storedEventLevelFilter;
  state.approvalFilter = storedApprovalFilter;
  state.artifactRunFilter = storedArtifactRunFilter;
  state.artifactTypeFilter = storedArtifactTypeFilter;
  applyRouteState();
}

function persistUiState(historyMode) {
  safeWriteStorage(storageKeys.selectedTaskId, state.selectedTaskId);
  safeWriteStorage(storageKeys.selectedRunId, state.selectedRunId);
  safeWriteStorage(storageKeys.selectedArtifactId, state.selectedArtifactId);
  safeWriteStorage(storageKeys.activeView, state.activeView);
  safeWriteStorage(storageKeys.pollingPaused, state.pollingPaused ? 'true' : 'false');
  safeWriteStorage(storageKeys.taskFilter, state.taskFilter);
  safeWriteStorage(storageKeys.eventLevelFilter, state.eventLevelFilter);
  safeWriteStorage(storageKeys.approvalFilter, state.approvalFilter);
  safeWriteStorage(storageKeys.artifactRunFilter, state.artifactRunFilter);
  safeWriteStorage(storageKeys.artifactTypeFilter, state.artifactTypeFilter);
  syncRouteState(historyMode || 'replace');
}

function applyRouteState() {
  const segments = window.location.pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return;
  }

  if (segments[0] === 'logs') {
    state.activeView = 'logs';
    return;
  }

  if (segments[0] === 'task' && typeof segments[1] === 'string') {
    state.selectedTaskId = segments[1];
    state.activeView = segments[2] === 'artifacts' ? 'artifacts' : 'overview';
    return;
  }

  if (segments[0] === 'run' && typeof segments[1] === 'string') {
    state.selectedRunId = segments[1];
    state.activeView = 'run';
    return;
  }

  if (segments[0] === 'artifact' && typeof segments[1] === 'string') {
    state.selectedArtifactId = segments[1];
    state.activeView = 'artifacts';
  }
}

function buildRoutePath() {
  if (state.activeView === 'logs') {
    return '/logs';
  }
  if (state.activeView === 'run' && state.selectedRunId) {
    return '/run/' + encodeURIComponent(state.selectedRunId);
  }
  if (state.activeView === 'artifacts' && state.selectedArtifactId) {
    return '/artifact/' + encodeURIComponent(state.selectedArtifactId);
  }
  if (state.activeView === 'artifacts' && state.selectedTaskId) {
    return '/task/' + encodeURIComponent(state.selectedTaskId) + '/artifacts';
  }
  if (state.selectedTaskId) {
    return '/task/' + encodeURIComponent(state.selectedTaskId);
  }
  return '/';
}

function syncRouteState(historyMode) {
  const nextPath = buildRoutePath();
  const currentUrl = window.location.pathname + window.location.search;
  if (currentUrl === nextPath) {
    return;
  }
  if (historyMode === 'push') {
    window.history.pushState(null, '', nextPath);
    return;
  }
  window.history.replaceState(null, '', nextPath);
}
`.trim();
