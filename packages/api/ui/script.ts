export const dashboardScript = `
const copy = {
  title: 'FLOW Control Plane',
  subtitle: 'Понятный контроль задач, approvals, артефактов и логов без сырого шума',
  createTask: 'Новая задача',
  goalLabel: 'Goal',
  targetLabel: 'Target',
  createButton: 'Создать задачу',
  refreshButton: 'Обновить',
  approvals: 'Approvals',
  tasks: 'Задачи',
  runtime: 'Runtime',
  selectedTask: 'Выбранная задача',
  noTaskSelected: 'Выбери задачу слева, чтобы увидеть историю, шаги и артефакты.',
  maintenance: 'Maintenance',
  targets: 'Targets',
  schedules: 'Schedules',
  loading: 'Обновляю состояние FLOW...',
  viewOverview: 'Overview',
  viewArtifacts: 'Artifacts',
  viewLogs: 'Logs',
  viewRun: 'Run',
  pausePolling: 'Pause polling',
  resumePolling: 'Resume polling',
  noArtifacts: 'Для выбранной задачи артефактов пока нет.',
  noLogs: 'Логи пока пусты.',
  rawDetails: 'Показать технические детали',
  hiddenNoise: 'Сырые payload и JSON скрыты, но доступны по требованию.',
  dashboardReady: 'Control Plane готов к работе.',
  streamConnected: 'Live stream connected',
  streamConnecting: 'Connecting stream…',
  streamPaused: 'Live updates paused',
  filterTasks: 'Task state',
  filterEvents: 'Event level',
  filterApprovals: 'Approval status',
  allStates: 'All states',
  allLevels: 'All levels',
  allApprovals: 'All approvals',
};

const terminalStates = ['completed', 'failed', 'escalated', 'blocked', 'cancelled', 'rolled_back'];
const storageKeys = {
  selectedTaskId: 'flow.ui.selectedTaskId',
  selectedRunId: 'flow.ui.selectedRunId',
  activeView: 'flow.ui.activeView',
  pollingPaused: 'flow.ui.pollingPaused',
  taskFilter: 'flow.ui.taskFilter',
  eventLevelFilter: 'flow.ui.eventLevelFilter',
  approvalFilter: 'flow.ui.approvalFilter',
};

const state = {
  selectedTaskId: '',
  selectedRunId: '',
  targetId: '',
  selectedArtifactId: '',
  busy: false,
  pollingPaused: false,
  refreshInFlight: false,
  shellReady: false,
  activeView: 'overview',
  lastUpdatedAt: '',
  lastError: '',
  streamConnected: false,
  streamStateLabel: '',
  taskFilter: '',
  eventLevelFilter: '',
  approvalFilter: '',
  lastLoadedData: null,
};

let streamConnection = null;
let scheduledRefreshHandle = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeReadStorage(key) {
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function safeWriteStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function loadPersistedState() {
  const storedTaskId = safeReadStorage(storageKeys.selectedTaskId);
  const storedView = safeReadStorage(storageKeys.activeView);
  const storedPolling = safeReadStorage(storageKeys.pollingPaused);
  const storedTaskFilter = safeReadStorage(storageKeys.taskFilter);
  const storedEventLevelFilter = safeReadStorage(storageKeys.eventLevelFilter);
  const storedApprovalFilter = safeReadStorage(storageKeys.approvalFilter);
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
  if (storedPolling === 'true') {
    state.pollingPaused = true;
  }
  state.taskFilter = storedTaskFilter;
  state.eventLevelFilter = storedEventLevelFilter;
  state.approvalFilter = storedApprovalFilter;
  applyHashState();
}

function persistUiState() {
  safeWriteStorage(storageKeys.selectedTaskId, state.selectedTaskId);
  safeWriteStorage(storageKeys.selectedRunId, state.selectedRunId);
  safeWriteStorage(storageKeys.activeView, state.activeView);
  safeWriteStorage(storageKeys.pollingPaused, state.pollingPaused ? 'true' : 'false');
  safeWriteStorage(storageKeys.taskFilter, state.taskFilter);
  safeWriteStorage(storageKeys.eventLevelFilter, state.eventLevelFilter);
  safeWriteStorage(storageKeys.approvalFilter, state.approvalFilter);
  syncHashState();
}

function applyHashState() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  if (!hash) {
    return;
  }
  const params = new URLSearchParams(hash);
  const taskId = params.get('task');
  const runId = params.get('run');
  const view = params.get('view');
  if (taskId) {
    state.selectedTaskId = taskId;
  }
  if (runId) {
    state.selectedRunId = runId;
  }
  if (view === 'overview' || view === 'artifacts' || view === 'logs' || view === 'run') {
    state.activeView = view;
  }
}

function syncHashState() {
  const params = new URLSearchParams();
  if (state.selectedTaskId) {
    params.set('task', state.selectedTaskId);
  }
  if (state.selectedRunId) {
    params.set('run', state.selectedRunId);
  }
  if (state.activeView !== 'overview') {
    params.set('view', state.activeView);
  }
  const nextHash = params.toString();
  const nextUrl = nextHash ? window.location.pathname + '#' + nextHash : window.location.pathname;
  window.history.replaceState(null, '', nextUrl);
}

function scheduleRefreshFromStream() {
  if (state.pollingPaused) {
    return;
  }
  if (scheduledRefreshHandle !== null) {
    window.clearTimeout(scheduledRefreshHandle);
  }
  scheduledRefreshHandle = window.setTimeout(() => {
    scheduledRefreshHandle = null;
    void refreshDashboard({ showLoading: false, force: true });
  }, 120);
}

function disconnectStream() {
  if (streamConnection) {
    streamConnection.close();
    streamConnection = null;
  }
  state.streamConnected = false;
  state.streamStateLabel = state.pollingPaused ? copy.streamPaused : copy.streamConnecting;
}

function connectStream() {
  if (state.pollingPaused || streamConnection) {
    return;
  }
  state.streamStateLabel = copy.streamConnecting;
  const connection = new EventSource('/stream');
  streamConnection = connection;

  connection.onopen = () => {
    state.streamConnected = true;
    state.streamStateLabel = copy.streamConnected;
    updatePollingUi();
  };

  connection.onerror = () => {
    state.streamConnected = false;
    state.streamStateLabel = copy.streamConnecting;
    updatePollingUi();
  };

  connection.onmessage = () => {
    state.streamConnected = true;
    state.streamStateLabel = copy.streamConnected;
    updatePollingUi();
    scheduleRefreshFromStream();
  };
}

function matchesTaskFilter(task) {
  return state.taskFilter.length === 0 || task.state === state.taskFilter;
}

function matchesApprovalFilter(approval) {
  return state.approvalFilter.length === 0 || approval.status === state.approvalFilter;
}

function matchesEventLevel(event) {
  return state.eventLevelFilter.length === 0 || event.level === state.eventLevelFilter;
}

function parseJson(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : response.statusText;
    throw new Error(message);
  }
  return payload;
}

function renderPill(label, tone) {
  return '<span class="pill ' + tone + '">' + escapeHtml(label) + '</span>';
}

function getStateTone(status) {
  if (status === 'completed') {
    return 'success';
  }
  if (status === 'failed' || status === 'escalated' || status === 'blocked' || status === 'cancelled') {
    return 'danger';
  }
  if (status === 'awaiting_approval' || status === 'retryable' || status === 'verifying') {
    return 'warning';
  }
  return '';
}

function getStateLabel(status) {
  const labels = {
    queued: 'Queued',
    planning: 'Planning',
    validating: 'Validating',
    executing: 'Running',
    awaiting_approval: 'Awaiting approval',
    verifying: 'Verifying',
    completed: 'Completed',
    failed: 'Failed',
    retryable: 'Needs retry',
    blocked: 'Blocked',
    cancelled: 'Cancelled',
    rolled_back: 'Rolled back',
    escalated: 'Escalated',
  };
  return labels[status] || status;
}

function formatJson(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function getElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error('Missing UI element: ' + id);
  }
  return element;
}

function setHtml(id, html) {
  getElement(id).innerHTML = html;
}

function setText(id, text) {
  getElement(id).textContent = text;
}

function formatDateTime(value) {
  if (!value) {
    return 'never';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatRelativeTime(value) {
  if (!value) {
    return 'never';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  if (Math.abs(diffMinutes) < 1) {
    return 'just now';
  }
  const formatter = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, 'minute');
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour');
  }
  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, 'day');
}

function createKeyFacts(items) {
  const filtered = items.filter((item) => item && item.value);
  if (filtered.length === 0) {
    return '';
  }
  return [
    '<div class="fact-grid">',
    filtered
      .map((item) => [
        '<div class="fact-card">',
        '<div class="fact-label">' + escapeHtml(item.label) + '</div>',
        '<div class="fact-value">' + escapeHtml(item.value) + '</div>',
        '</div>',
      ].join(''))
      .join(''),
    '</div>',
  ].join('');
}

function createDetailList(items) {
  const filtered = items.filter((item) => item && item.value);
  if (filtered.length === 0) {
    return '';
  }
  return [
    '<dl class="detail-list">',
    filtered
      .map((item) => [
        '<div class="detail-row">',
        '<dt>' + escapeHtml(item.label) + '</dt>',
        '<dd>' + escapeHtml(item.value) + '</dd>',
        '</div>',
      ].join(''))
      .join(''),
    '</dl>',
  ].join('');
}

function createBulletList(items) {
  const filtered = items.filter((item) => typeof item === 'string' && item.length > 0);
  if (filtered.length === 0) {
    return '';
  }
  return [
    '<ul class="bullet-list">',
    filtered.map((item) => '<li>' + escapeHtml(item) + '</li>').join(''),
    '</ul>',
  ].join('');
}

function createRawDetails(label, payload) {
  if (payload === null || payload === undefined) {
    return '';
  }
  return [
    '<details class="raw-details">',
    '<summary>' + escapeHtml(label) + '</summary>',
    '<pre>' + formatJson(payload) + '</pre>',
    '</details>',
  ].join('');
}

function renderSelectOptions(options, selectedValue) {
  return options
    .map((option) => {
      const selected = option.value === selectedValue ? ' selected' : '';
      return '<option value="' + escapeHtml(option.value) + '"' + selected + '>' + escapeHtml(option.label) + '</option>';
    })
    .join('');
}

function renderFilterBar() {
  return [
    '<section class="panel stack filter-panel">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">View controls</div>',
    '<h3>Signals over noise</h3>',
    '</div>',
    '<div class="meta">' + escapeHtml(copy.hiddenNoise) + '</div>',
    '</div>',
    '<div class="filter-grid">',
    '<div class="field"><label>' + escapeHtml(copy.filterTasks) + '</label><select data-filter="task-state">' +
      renderSelectOptions([
        { value: '', label: copy.allStates },
        { value: 'queued', label: getStateLabel('queued') },
        { value: 'planning', label: getStateLabel('planning') },
        { value: 'executing', label: getStateLabel('executing') },
        { value: 'awaiting_approval', label: getStateLabel('awaiting_approval') },
        { value: 'completed', label: getStateLabel('completed') },
        { value: 'failed', label: getStateLabel('failed') },
        { value: 'escalated', label: getStateLabel('escalated') },
      ], state.taskFilter) +
    '</select></div>',
    '<div class="field"><label>' + escapeHtml(copy.filterEvents) + '</label><select data-filter="event-level">' +
      renderSelectOptions([
        { value: '', label: copy.allLevels },
        { value: 'info', label: 'Info' },
        { value: 'warning', label: 'Warning' },
        { value: 'error', label: 'Error' },
      ], state.eventLevelFilter) +
    '</select></div>',
    '<div class="field"><label>' + escapeHtml(copy.filterApprovals) + '</label><select data-filter="approval-status">' +
      renderSelectOptions([
        { value: '', label: copy.allApprovals },
        { value: 'pending', label: 'Pending' },
        { value: 'approved', label: 'Approved' },
        { value: 'rejected', label: 'Rejected' },
        { value: 'consumed', label: 'Consumed' },
      ], state.approvalFilter) +
    '</select></div>',
    '</div>',
    '</section>',
  ].join('');
}

function normalizeChangedFiles(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === 'string');
}

function summarizeToolInput(tool, input) {
  if (!input || typeof input !== 'object') {
    return 'Нет входных параметров.';
  }
  if (tool === 'fs.read_file' && typeof input.path === 'string') {
    return 'Чтение файла ' + input.path;
  }
  if (tool === 'fs.write_file' && typeof input.path === 'string') {
    return 'Запись файла ' + input.path;
  }
  if (tool === 'fs.list_dir' && typeof input.path === 'string') {
    return 'Просмотр директории ' + input.path;
  }
  if (tool === 'git.create_branch' && typeof input.branch === 'string') {
    return 'Создание ветки ' + input.branch;
  }
  if (tool === 'git.commit' && typeof input.message === 'string') {
    return 'Коммит: ' + input.message;
  }
  if (tool === 'repo.apply_patch' && typeof input.patch === 'string') {
    const changedFiles = (input.patch.match(/^\\+\\+\\+ b\\//gm) || []).length;
    return changedFiles > 0 ? 'Применение патча к ' + String(changedFiles) + ' файлам' : 'Применение патча';
  }
  if (tool === 'http.fetch' && typeof input.url === 'string') {
    return 'Запрос к ' + input.url;
  }
  if (tool === 'shell.exec' && typeof input.command === 'string') {
    return 'Выполнение команды ' + input.command;
  }
  if (tool === 'repo.run_checks') {
    return 'Запуск quality checks';
  }
  if (tool === 'repo.run_tests') {
    return 'Запуск тестов';
  }
  if (tool === 'repo.build') {
    return 'Сборка проекта';
  }
  const keys = Object.keys(input);
  return keys.length > 0 ? 'Параметры: ' + keys.join(', ') : 'Нет входных параметров.';
}

function summarizeToolOutput(output) {
  if (!output || typeof output !== 'object') {
    return {
      title: 'Результат недоступен',
      summary: 'Инструмент ещё не вернул итог.',
      facts: [],
      changedFiles: [],
      raw: output,
    };
  }

  if (output.success === false) {
    return {
      title: 'Шаг завершился ошибкой',
      summary: typeof output.error === 'string' ? output.error : 'Инструмент вернул ошибку.',
      facts: [],
      changedFiles: [],
      raw: output,
    };
  }

  const resultOutput = output.output && typeof output.output === 'object' ? output.output : {};
  const evidence = output.evidence && typeof output.evidence === 'object' ? output.evidence : {};
  const evidenceSummary = typeof evidence.summary === 'string' ? evidence.summary : 'Шаг завершён успешно.';
  const changedFiles = normalizeChangedFiles(output.changedFiles);

  const facts = [];
  if (typeof resultOutput.status === 'number') {
    facts.push({ label: 'exit status', value: String(resultOutput.status) });
  }
  if (typeof resultOutput.path === 'string') {
    facts.push({ label: 'path', value: resultOutput.path });
  }
  if (typeof resultOutput.command === 'string') {
    const args = Array.isArray(resultOutput.args) ? resultOutput.args.filter((item) => typeof item === 'string').join(' ') : '';
    facts.push({ label: 'command', value: [resultOutput.command, args].filter(Boolean).join(' ') });
  }
  if (typeof resultOutput.stdout === 'string' && resultOutput.stdout.length > 0) {
    facts.push({ label: 'stdout', value: resultOutput.stdout.split('\\n')[0] });
  }
  if (changedFiles.length > 0) {
    facts.push({ label: 'changed files', value: String(changedFiles.length) });
  }

  return {
    title: 'Шаг завершён',
    summary: evidenceSummary,
    facts,
    changedFiles,
    raw: output,
  };
}

function collectRunChangedFiles(run) {
  return run.steps.flatMap((step) => {
    const output = parseJson(step.output_json);
    const summary = summarizeToolOutput(output);
    return summary.changedFiles;
  });
}

function summarizeRun(run) {
  const evaluation = Array.isArray(run.evaluations) && run.evaluations.length > 0 ? run.evaluations[run.evaluations.length - 1] : null;
  const changedFiles = collectRunChangedFiles(run);
  const filteredEvents = Array.isArray(run.events) ? run.events.filter(matchesEventLevel) : [];
  const latestEvent = filteredEvents.length > 0 ? filteredEvents[filteredEvents.length - 1] : null;
  const completedSteps = Array.isArray(run.steps) ? run.steps.filter((step) => step.status === 'completed').length : 0;
  const failedSteps = Array.isArray(run.steps) ? run.steps.filter((step) => step.status === 'failed').length : 0;

  return {
    changedFiles,
    latestEvent,
    completedSteps,
    failedSteps,
    score: evaluation ? evaluation.score : null,
  };
}

function renderRunSummaryCard(run) {
  const summary = summarizeRun(run);
  return [
    '<button type="button" class="card stack run-summary-card" data-run-id="' + escapeHtml(run.id) + '">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">Run ' + String(run.iteration + 1) + '</div>',
    '<strong class="mono">' + escapeHtml(run.id) + '</strong>',
    '</div>',
    renderPill(getStateLabel(run.status), getStateTone(run.status)),
    '</div>',
    createKeyFacts([
      { label: 'completed steps', value: String(summary.completedSteps) },
      { label: 'failed steps', value: String(summary.failedSteps) },
      { label: 'changed files', value: String(summary.changedFiles.length) },
      { label: 'score', value: summary.score === null ? 'n/a' : String(summary.score) },
    ]),
    summary.latestEvent
      ? '<div class="meta">Последний сигнал: ' + escapeHtml(describeEvent(summary.latestEvent).title) + '</div>'
      : '<div class="meta">События ещё не записаны.</div>',
    '</button>',
  ].join('');
}

function renderTaskHeader(timeline) {
  const latestRun = Array.isArray(timeline.runs) && timeline.runs.length > 0 ? timeline.runs[0] : null;
  const latestRunSummary = latestRun ? summarizeRun(latestRun) : null;

  return [
    '<section class="panel stack task-header-panel">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">' + escapeHtml(copy.selectedTask) + '</div>',
    '<h2>' + escapeHtml(timeline.task.goal) + '</h2>',
    '<div class="meta mono">' + escapeHtml(timeline.task.id) + '</div>',
    '</div>',
    renderPill(getStateLabel(timeline.task.state), getStateTone(timeline.task.state)),
    '</div>',
    '<div class="summary-text">' +
      escapeHtml(
        latestRunSummary
          ? 'Последний run: ' + getStateLabel(latestRun.status) + ', ' + String(latestRunSummary.completedSteps) + ' подтверждённых шагов и ' + String(latestRunSummary.changedFiles.length) + ' изменённых файлов.'
          : 'Задача создана, но run ещё не стартовал.',
      ) +
    '</div>',
    createKeyFacts([
      { label: 'target', value: timeline.task.target_id },
      { label: 'updated', value: formatRelativeTime(timeline.task.updated_at) },
      { label: 'runs', value: String(timeline.page.total) },
      { label: 'approvals', value: String(Array.isArray(timeline.approvals) ? timeline.approvals.length : 0) },
    ]),
    latestRun
      ? '<section class="stack"><div class="section-heading">Run summaries</div><div class="grid two">' + timeline.runs.map(renderRunSummaryCard).join('') + '</div></section>'
      : '',
    '</section>',
  ].join('');
}

function describeTaskState(tasks) {
  const activeTask = tasks.find((task) => !terminalStates.includes(task.state));
  if (activeTask) {
    return {
      label: getStateLabel(activeTask.state),
      tone: getStateTone(activeTask.state),
      detail: activeTask.goal,
    };
  }
  if (tasks.length === 0) {
    return {
      label: 'Idle',
      tone: '',
      detail: 'Нет активных задач',
    };
  }
  return {
    label: getStateLabel(tasks[0].state),
    tone: getStateTone(tasks[0].state),
    detail: tasks[0].goal,
  };
}

function getPreferredTaskId(tasks) {
  if (state.selectedTaskId && tasks.some((task) => task.id === state.selectedTaskId)) {
    return state.selectedTaskId;
  }
  const activeTask = tasks.find((task) => !terminalStates.includes(task.state));
  if (activeTask) {
    return activeTask.id;
  }
  return tasks[0] ? tasks[0].id : '';
}

function ensureSelectedArtifactId(artifacts) {
  if (artifacts.length === 0) {
    state.selectedArtifactId = '';
    return;
  }
  if (state.selectedArtifactId && artifacts.some((artifact) => artifact.id === state.selectedArtifactId)) {
    return;
  }
  const preferredArtifact = artifacts.find((artifact) => artifact.type === 'report') || artifacts[0];
  state.selectedArtifactId = preferredArtifact.id;
}

function renderStep(step) {
  const input = parseJson(step.input_json);
  const expected = parseJson(step.expected_json);
  const output = parseJson(step.output_json);
  const outputSummary = summarizeToolOutput(output);

  return [
    '<article class="card stack card-soft">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">Step ' + String(step.index + 1) + '</div>',
    '<strong>' + escapeHtml(step.tool) + '</strong>',
    '<div class="meta">' + escapeHtml(summarizeToolInput(step.tool, input)) + '</div>',
    '</div>',
    renderPill(getStateLabel(step.status), getStateTone(step.status)),
    '</div>',
    createKeyFacts(outputSummary.facts),
    '<div class="summary-block">',
    '<div class="summary-title">' + escapeHtml(outputSummary.title) + '</div>',
    '<div class="summary-text">' + escapeHtml(outputSummary.summary) + '</div>',
    '</div>',
    outputSummary.changedFiles.length > 0
      ? '<div class="meta">Изменены: ' + escapeHtml(outputSummary.changedFiles.join(', ')) + '</div>'
      : '',
    createRawDetails(copy.rawDetails + ': input', input),
    createRawDetails(copy.rawDetails + ': expected', expected),
    createRawDetails(copy.rawDetails + ': result', outputSummary.raw),
    '</article>',
  ].join('');
}

function describeEvent(event) {
  const payload = parseJson(event.payload_json);
  if (event.message === 'planning_started') {
    return {
      title: 'Планирование началось',
      summary: payload && payload.targetId ? 'Target: ' + payload.targetId : 'FLOW собирает следующий безопасный план.',
      facts: payload ? [{ label: 'task', value: typeof payload.taskId === 'string' ? payload.taskId : '' }] : [],
      raw: payload,
    };
  }
  if (event.message === 'planning_completed') {
    const steps = payload && typeof payload.stepCount === 'number' ? String(payload.stepCount) : '';
    const confidence = payload && typeof payload.confidence === 'number' ? String(payload.confidence) : '';
    return {
      title: 'План подготовлен',
      summary: 'План валиден и готов к исполнению.',
      facts: [
        { label: 'steps', value: steps },
        { label: 'confidence', value: confidence },
      ],
      raw: payload,
    };
  }
  if (event.message === 'step_started') {
    return {
      title: 'Шаг запущен',
      summary:
        payload && typeof payload.tool === 'string'
          ? 'Старт инструмента ' + payload.tool
          : 'FLOW выполняет следующий bounded step.',
      facts: [
        { label: 'tool', value: payload && typeof payload.tool === 'string' ? payload.tool : '' },
        { label: 'step', value: payload && typeof payload.stepIndex === 'number' ? String(payload.stepIndex + 1) : '' },
      ],
      raw: payload,
    };
  }
  if (event.message === 'step_completed') {
    const changedFiles = payload && Array.isArray(payload.changedFiles)
      ? payload.changedFiles.filter((item) => typeof item === 'string')
      : [];
    return {
      title: 'Шаг завершён',
      summary:
        payload && typeof payload.evidence === 'string'
          ? payload.evidence
          : payload && payload.verified === true
            ? 'Результат подтверждён verifier.'
            : 'Шаг завершён без подтверждения verifier.',
      facts: [
        { label: 'verified', value: payload && typeof payload.verified === 'boolean' ? String(payload.verified) : '' },
        { label: 'changed files', value: changedFiles.length > 0 ? String(changedFiles.length) : '' },
      ],
      raw: payload,
    };
  }
  if (event.message === 'run_completed') {
    return {
      title: 'Run завершён',
      summary:
        payload && typeof payload.finalState === 'string'
          ? 'Итоговое состояние: ' + getStateLabel(payload.finalState)
          : 'FLOW завершил run.',
      facts: [
        { label: 'state', value: payload && typeof payload.finalState === 'string' ? payload.finalState : '' },
        { label: 'artifacts', value: payload && typeof payload.artifactCount === 'number' ? String(payload.artifactCount) : '' },
      ],
      raw: payload,
    };
  }
  return {
    title: event.message,
    summary: 'Системное событие runtime.',
    facts: [],
    raw: payload,
  };
}

function renderEvent(event) {
  const described = describeEvent(event);
  return [
    '<article class="event-card ' + escapeHtml(event.level) + '">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<strong>' + escapeHtml(described.title) + '</strong>',
    '<div class="meta">' + escapeHtml(described.summary) + '</div>',
    '</div>',
    '<span class="meta mono">' + escapeHtml(formatDateTime(event.created_at)) + '</span>',
    '</div>',
    createKeyFacts(described.facts),
    createRawDetails(copy.rawDetails + ': event payload', described.raw),
    '</article>',
  ].join('');
}

function renderEvaluation(evaluation) {
  const issuesEnvelope = parseJson(evaluation.issues_json);
  const suggestionsEnvelope = parseJson(evaluation.suggestions_json);
  const issues = issuesEnvelope && Array.isArray(issuesEnvelope.issues) ? issuesEnvelope.issues.filter((item) => typeof item === 'string') : [];
  const suggestions = suggestionsEnvelope && Array.isArray(suggestionsEnvelope.suggestions)
    ? suggestionsEnvelope.suggestions.filter((item) => typeof item === 'string')
    : [];

  return [
    '<article class="card stack card-soft">',
    '<div class="toolbar spread">',
    '<strong>Evaluation</strong>',
    renderPill('score ' + String(evaluation.score), evaluation.score >= 0.75 ? 'success' : 'warning'),
    '</div>',
    issues.length > 0
      ? '<div><div class="summary-title">Issues</div>' + createBulletList(issues) + '</div>'
      : '<div class="meta">Проблем evaluator не нашёл.</div>',
    suggestions.length > 0
      ? '<div><div class="summary-title">Suggestions</div>' + createBulletList(suggestions) + '</div>'
      : '',
    createRawDetails(copy.rawDetails + ': evaluation', {
      score: evaluation.score,
      issues,
      suggestions,
    }),
    '</article>',
  ].join('');
}

function renderTasks(tasks) {
  const filteredTasks = tasks.filter(matchesTaskFilter);
  if (filteredTasks.length === 0) {
    return '<div class="empty">Задач пока нет.</div>';
  }
  return filteredTasks
    .map((task) => {
      const selected = task.id === state.selectedTaskId ? ' selected' : '';
      return [
        '<button type="button" class="card task-card' + selected + '" data-task-id="' + escapeHtml(task.id) + '">',
        '<div class="card-title">',
        '<div class="stack gap-xs">',
        '<strong>' + escapeHtml(task.goal) + '</strong>',
        '<div class="meta mono">' + escapeHtml(task.id) + '</div>',
        '</div>',
        renderPill(getStateLabel(task.state), getStateTone(task.state)),
        '</div>',
        '<div class="meta">target: ' + escapeHtml(task.target_id) + '</div>',
        '<div class="meta">' + escapeHtml(formatRelativeTime(task.updated_at)) + '</div>',
        '</button>',
      ].join('');
    })
    .join('');
}

function summarizeApprovalInput(tool, inputJson) {
  const input = parseJson(inputJson);
  return summarizeToolInput(tool, input);
}

function renderApprovals(approvals) {
  const filteredApprovals = approvals.filter(matchesApprovalFilter);
  if (filteredApprovals.length === 0) {
    return '<div class="empty">Ожидающих approvals нет.</div>';
  }
  return filteredApprovals
    .map((approval) => [
      '<article class="card stack">',
      '<div class="card-title">',
      '<div class="stack gap-xs">',
      '<strong>' + escapeHtml(approval.tool) + '</strong>',
      '<div class="meta mono">' + escapeHtml(approval.id) + '</div>',
      '</div>',
      renderPill(approval.status === 'pending' ? 'Needs approval' : approval.status, getStateTone(approval.status)),
      '</div>',
      '<div class="summary-text">' + escapeHtml(summarizeApprovalInput(approval.tool, approval.input_json)) + '</div>',
      '<div class="meta">' + escapeHtml(approval.reason) + '</div>',
      approval.status === 'pending'
        ? '<div class="toolbar"><button type="button" class="button" data-approve-id="' + escapeHtml(approval.id) + '">Approve</button><button type="button" class="button danger" data-reject-id="' + escapeHtml(approval.id) + '">Reject</button></div>'
        : '',
      createRawDetails(copy.rawDetails + ': approval input', parseJson(approval.input_json)),
      '</article>',
    ].join(''))
    .join('');
}

function renderTargets(targets) {
  if (targets.length === 0) {
    return '<div class="empty">Targets не настроены.</div>';
  }
  return targets
    .map((target) => {
      const capabilities = Array.isArray(target.capabilities) ? target.capabilities : [];
      return [
        '<article class="card stack">',
        '<div class="card-title">',
        '<strong>' + escapeHtml(target.id) + '</strong>',
        renderPill(String(capabilities.length) + ' caps', ''),
        '</div>',
        '<div class="meta mono">' + escapeHtml(target.root) + '</div>',
        '<div class="meta">' + escapeHtml(capabilities.join(', ')) + '</div>',
        '</article>',
      ].join('');
    })
    .join('');
}

function renderSchedules(schedules) {
  if (schedules.length === 0) {
    return '<div class="empty">Расписаний нет.</div>';
  }
  return schedules
    .map((schedule) => [
      '<article class="card stack">',
      '<div class="card-title">',
      '<strong>' + escapeHtml(schedule.id) + '</strong>',
      renderPill(schedule.enabled === 1 ? 'enabled' : 'disabled', schedule.enabled === 1 ? 'success' : ''),
      '</div>',
      '<div class="summary-text">' + escapeHtml(schedule.goal) + '</div>',
      createKeyFacts([
        { label: 'interval', value: String(schedule.interval_seconds) + 's' },
        { label: 'target', value: schedule.target_id || 'default' },
      ]),
      '</article>',
    ].join(''))
    .join('');
}

function renderMaintenance(maintenance) {
  if (!maintenance || typeof maintenance !== 'object') {
    return '<div class="empty">Maintenance summary недоступен.</div>';
  }
  const status = maintenance.status && typeof maintenance.status === 'object' ? maintenance.status : {};
  const totals = maintenance.totals && typeof maintenance.totals === 'object' ? maintenance.totals : {};
  const latestEvent = maintenance.latestEvent && typeof maintenance.latestEvent === 'object' ? maintenance.latestEvent : null;

  return [
    '<section class="panel stack">',
    '<div class="toolbar spread">',
    '<div>',
    '<h2>' + escapeHtml(copy.maintenance) + '</h2>',
    '<div class="meta">' + escapeHtml(copy.hiddenNoise) + '</div>',
    '</div>',
    renderPill(status.due === true ? 'due' : 'healthy', status.due === true ? 'warning' : 'success'),
    '</div>',
    createKeyFacts([
      { label: 'interval', value: status.intervalSeconds ? String(status.intervalSeconds) + 's' : 'manual' },
      { label: 'last run', value: status.lastRunAt ? formatRelativeTime(status.lastRunAt) : 'never' },
      { label: 'next run', value: status.nextRunAt ? formatRelativeTime(status.nextRunAt) : 'n/a' },
      { label: 'mode', value: status.dryRunDefault === true ? 'dry-run default' : 'execute default' },
    ]),
    createDetailList([
      { label: 'all cleanups', value: typeof totals.all === 'number' ? String(totals.all) : '' },
      { label: 'executed', value: typeof totals.executed === 'number' ? String(totals.executed) : '' },
      { label: 'dry-runs', value: typeof totals.dryRun === 'number' ? String(totals.dryRun) : '' },
      { label: 'worker due', value: typeof totals.workerDue === 'number' ? String(totals.workerDue) : '' },
      { label: 'cli manual', value: typeof totals.cliManual === 'number' ? String(totals.cliManual) : '' },
      { label: 'api manual', value: typeof totals.apiManual === 'number' ? String(totals.apiManual) : '' },
    ]),
    latestEvent
      ? '<div class="meta">Последний maintenance event: ' + escapeHtml(formatDateTime(latestEvent.created_at)) + '</div>'
      : '<div class="meta">Maintenance events пока не записаны.</div>',
    latestEvent ? createRawDetails(copy.rawDetails + ': latest maintenance event', latestEvent) : '',
    '</section>',
  ].join('');
}

function renderMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') {
    return '<div class="empty">Metrics недоступны.</div>';
  }
  const failureTypes = metrics.failure_types && typeof metrics.failure_types === 'object' ? metrics.failure_types : {};
  const failureItems = Object.entries(failureTypes).map((entry) => entry[0] + ': ' + String(entry[1]));
  return [
    '<section class="panel stack">',
    '<div class="toolbar spread">',
    '<h2>Metrics</h2>',
    renderPill(metrics.success_rate >= 0.8 ? 'healthy' : 'watch', metrics.success_rate >= 0.8 ? 'success' : 'warning'),
    '</div>',
    createKeyFacts([
      { label: 'success rate', value: typeof metrics.success_rate === 'number' ? (metrics.success_rate * 100).toFixed(0) + '%' : '' },
      { label: 'avg steps', value: typeof metrics.avg_steps === 'number' ? metrics.avg_steps.toFixed(1) : '' },
      { label: 'retries', value: typeof metrics.retry_count === 'number' ? String(metrics.retry_count) : '' },
    ]),
    failureItems.length > 0
      ? '<div><div class="summary-title">Failure types</div>' + createBulletList(failureItems) + '</div>'
      : '<div class="meta">Пока нет накопленных failure types.</div>',
    '</section>',
  ].join('');
}

function renderRun(run) {
  const filteredEvents = run.events.filter(matchesEventLevel);
  return [
    '<section class="panel stack">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">Run ' + String(run.iteration + 1) + '</div>',
    '<h3 class="mono">' + escapeHtml(run.id) + '</h3>',
    '<div class="meta">started ' + escapeHtml(formatDateTime(run.started_at)) + '</div>',
    '</div>',
    renderPill(getStateLabel(run.status), getStateTone(run.status)),
    '</div>',
    filteredEvents.length > 0
      ? '<div class="stack section-group"><div class="section-heading">Events</div>' + filteredEvents.map(renderEvent).join('') + '</div>'
      : '<div class="empty">События этого run скрыты текущим фильтром.</div>',
    run.steps.length > 0
      ? '<div class="stack section-group"><div class="section-heading">Steps</div>' + run.steps.map(renderStep).join('') + '</div>'
      : '',
    run.evaluations.length > 0
      ? '<div class="stack section-group"><div class="section-heading">Evaluations</div>' + run.evaluations.map(renderEvaluation).join('') + '</div>'
      : '',
    '</section>',
  ].join('');
}

function renderOverview(timeline, maintenance, metrics) {
  const overviewBody = !timeline || !timeline.task
    ? '<section class="panel stack"><div class="empty">' + escapeHtml(copy.noTaskSelected) + '</div></section>'
    : [
        renderTaskHeader(timeline),
        Array.isArray(timeline.approvals) && timeline.approvals.length > 0
          ? '<section class="stack"><div class="section-heading">Task approvals</div>' + renderApprovals(timeline.approvals) + '</section>'
          : '',
        Array.isArray(timeline.runs) && timeline.runs.length > 0
          ? '<section class="stack">' + timeline.runs.map(renderRun).join('') + '</section>'
          : '<div class="empty">Запусков ещё нет.</div>',
        '</section>',
      ].join('');

  return [
    '<section class="split">',
    '<section class="panel stack"><div class="toolbar spread"><h2>' + escapeHtml(copy.tasks) + '</h2>' + renderPill('live queue', '') + '</div><div id="tasksList" class="list"></div></section>',
    '<section class="stack">' + overviewBody + '</section>',
    '</section>',
    renderFilterBar(),
    '<section class="grid two">',
    renderMaintenance(maintenance),
    renderMetrics(metrics),
    '</section>',
  ].join('');
}

function summarizeArtifactPayload(artifact, content) {
  if (artifact.summary) {
    return {
      title: artifact.summary.title,
      summary: artifact.summary.summary,
      facts: Array.isArray(artifact.summary.facts) ? artifact.summary.facts : [],
      bullets: Array.isArray(artifact.summary.changedFiles) ? artifact.summary.changedFiles : [],
      patch: artifact.summary.patch,
      raw: artifact.summary.rawJson ? artifact.summary.rawJson : artifact.summary.rawText,
    };
  }

  const parsed = parseJson(content);
  if (!parsed || typeof parsed !== 'object') {
    return {
      title: artifact.type,
      summary: 'Текстовый артефакт без структурированного JSON.',
      facts: [
        { label: 'path', value: artifact.path },
        { label: 'created', value: formatDateTime(artifact.created_at) },
      ],
      bullets: [],
      patch: null,
      raw: content,
    };
  }

  if (artifact.type === 'request') {
    return {
      title: 'Запрос к инструменту',
      summary: parsed.step && parsed.step.tool ? 'Подготовка шага ' + parsed.step.tool : 'Исходный request для bounded tool.',
      facts: [
        { label: 'tool', value: parsed.step && typeof parsed.step.tool === 'string' ? parsed.step.tool : artifact.tool },
        { label: 'rationale', value: parsed.step && typeof parsed.step.rationale === 'string' ? parsed.step.rationale : '' },
      ],
      bullets: [],
      patch: null,
      raw: parsed,
    };
  }

  if (artifact.type === 'result') {
    const summary = summarizeToolOutput(parsed);
    return {
      title: 'Результат инструмента',
      summary: summary.summary,
      facts: summary.facts,
      bullets: summary.changedFiles,
      patch: null,
      raw: summary.raw,
    };
  }

  if (artifact.type === 'verification') {
    return {
      title: 'Проверка результата',
      summary: parsed.verified === true ? 'Verifier подтвердил результат.' : 'Verifier не подтвердил результат.',
      facts: [
        { label: 'verified', value: typeof parsed.verified === 'boolean' ? String(parsed.verified) : '' },
        { label: 'evidence', value: typeof parsed.evidence === 'string' ? parsed.evidence : '' },
      ],
      bullets: [],
      patch: null,
      raw: parsed,
    };
  }

  if (artifact.type === 'report') {
    const changedFiles = normalizeChangedFiles(parsed.changedFiles);
    return {
      title: 'Итоговый report',
      summary: parsed.success === true ? 'Шаг успешно завершился.' : 'Шаг завершился без успеха.',
      facts: [
        { label: 'success', value: typeof parsed.success === 'boolean' ? String(parsed.success) : '' },
        { label: 'changed files', value: changedFiles.length > 0 ? String(changedFiles.length) : '0' },
      ],
      bullets: changedFiles,
      patch: null,
      raw: parsed,
    };
  }

  return {
    title: artifact.type,
    summary: 'Технический артефакт.',
    facts: [
      { label: 'path', value: artifact.path },
      { label: 'created', value: formatDateTime(artifact.created_at) },
    ],
    bullets: [],
    patch: null,
    raw: parsed,
  };
}

function renderPatchPreview(patch) {
  if (!patch) {
    return '';
  }
  return [
    '<section class="stack">',
    '<div class="section-heading">Patch preview</div>',
    createKeyFacts([
      { label: 'files', value: String(patch.fileCount) },
      { label: 'hunks', value: String(patch.hunkCount) },
      { label: 'additions', value: String(patch.additions) },
      { label: 'deletions', value: String(patch.deletions) },
    ]),
    patch.files.length > 0
      ? '<div class="list">' + patch.files.map((file) => [
          '<div class="card card-soft stack">',
          '<strong>' + escapeHtml(file.path) + '</strong>',
          '<div class="meta">+' + escapeHtml(String(file.additions)) + ' / -' + escapeHtml(String(file.deletions)) + '</div>',
          '</div>',
        ].join('')).join('') + '</div>'
      : '',
    '</section>',
  ].join('');
}

function renderArtifacts(artifactBrowser, artifactContent) {
  const hasRuns = artifactBrowser && Array.isArray(artifactBrowser.runs) && artifactBrowser.runs.length > 0;
  const artifactList = !hasRuns
    ? '<div class="empty">' + escapeHtml(copy.noArtifacts) + '</div>'
    : artifactBrowser.runs
        .map((runGroup) => [
          '<section class="artifact-group">',
          '<div class="group-heading">Run ' + escapeHtml(runGroup.runId) + '</div>',
          runGroup.steps
            .map((stepGroup) => [
              '<div class="artifact-step-group">',
              '<div class="meta">Step ' + String(stepGroup.stepIndex + 1) + ' · ' + escapeHtml(stepGroup.tool) + '</div>',
              '<div class="list">',
              stepGroup.artifacts
                .map((artifact) => {
                  const selected = artifact.id === state.selectedArtifactId ? ' selected' : '';
                  return [
                    '<button type="button" class="card artifact-card' + selected + '" data-artifact-id="' + escapeHtml(artifact.id) + '">',
                    '<div class="card-title">',
                    '<div class="stack gap-xs">',
                    '<strong>' + escapeHtml(artifact.summary.title) + '</strong>',
                    '<div class="meta mono">' + escapeHtml(artifact.id) + '</div>',
                    '</div>',
                    renderPill(artifact.tool, ''),
                    '</div>',
                    '<div class="summary-text">' + escapeHtml(artifact.summary.summary) + '</div>',
                    '<div class="meta">' + escapeHtml(formatRelativeTime(artifact.created_at)) + '</div>',
                    '</button>',
                  ].join('');
                })
                .join(''),
              '</div>',
              '</div>',
            ].join(''))
            .join(''),
          '</section>',
        ].join(''))
        .join('');

  const artifactPreview = artifactContent
    ? (function () {
        const summary = summarizeArtifactPayload(artifactContent.artifact, artifactContent.content);
        return [
          '<section class="panel stack">',
          '<div class="toolbar spread">',
          '<div class="stack gap-xs">',
          '<div class="eyebrow">Artifact preview</div>',
          '<h2>' + escapeHtml(summary.title) + '</h2>',
          '<div class="meta mono">' + escapeHtml(artifactContent.artifact.path) + '</div>',
          '</div>',
          renderPill(artifactContent.artifact.type, ''),
          '</div>',
          '<div class="summary-text">' + escapeHtml(summary.summary) + '</div>',
          createKeyFacts(summary.facts),
          summary.bullets.length > 0
            ? '<div><div class="section-heading">Changed files</div>' + createBulletList(summary.bullets) + '</div>'
            : '',
          renderPatchPreview(summary.patch),
          createRawDetails(copy.rawDetails + ': artifact content', summary.raw),
          '</section>',
        ].join('');
      })()
    : '<section class="panel stack"><div class="empty">Выбери артефакт для просмотра.</div></section>';

  return [
    '<section class="split">',
    '<section class="panel stack"><div class="toolbar spread"><h2>Artifacts</h2>' + renderPill('task scope', '') + '</div><div class="list">' + artifactList + '</div></section>',
    '<section class="stack">' + artifactPreview + '</section>',
    '</section>',
  ].join('');
}

function renderRunPage(runView) {
  if (!runView || !runView.run) {
    return '<section class="panel stack"><div class="empty">Выбери run для просмотра.</div></section>';
  }

  return [
    '<section class="stack">',
    '<section class="panel stack task-header-panel">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">Run permalink</div>',
    '<h2>' + escapeHtml(runView.task.goal) + '</h2>',
    '<div class="meta mono">' + escapeHtml(runView.run.id) + '</div>',
    '</div>',
    renderPill(getStateLabel(runView.run.status), getStateTone(runView.run.status)),
    '</div>',
    '<div class="summary-text">' +
      escapeHtml(
        runView.summary.latestEventTitle
          ? 'Последний сигнал: ' + runView.summary.latestEventTitle
          : 'Run открыт в permalink-режиме.',
      ) +
    '</div>',
    createKeyFacts([
      { label: 'task', value: runView.task.id },
      { label: 'completed steps', value: String(runView.summary.completedSteps) },
      { label: 'failed steps', value: String(runView.summary.failedSteps) },
      { label: 'changed files', value: String(runView.summary.changedFiles.length) },
      { label: 'score', value: runView.summary.score === null ? 'n/a' : String(runView.summary.score) },
    ]),
    runView.summary.changedFiles.length > 0
      ? '<div><div class="section-heading">Changed files</div>' + createBulletList(runView.summary.changedFiles) + '</div>'
      : '',
    '</section>',
    renderRun({
      id: runView.run.id,
      status: runView.run.status,
      iteration: runView.run.iteration,
      started_at: runView.run.started_at,
      events: runView.events,
      steps: runView.steps,
      evaluations: runView.evaluations,
    }),
    '</section>',
  ].join('');
}

function parsePinoLevel(value) {
  if (typeof value === 'number') {
    if (value >= 50) {
      return 'error';
    }
    if (value >= 40) {
      return 'warning';
    }
    return 'info';
  }
  return 'info';
}

function parseLogEntries(logs) {
  if (!logs || typeof logs.content !== 'string' || logs.content.length === 0) {
    return [];
  }
  return logs.content
    .split('\\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed = parseJson(line);
      if (!parsed || typeof parsed !== 'object') {
        return {
          title: 'Runtime log',
          summary: line,
          level: 'info',
          time: '',
          details: null,
        };
      }
      const title = typeof parsed.msg === 'string'
        ? parsed.msg
        : typeof parsed.message === 'string'
          ? parsed.message
          : 'Runtime log';
      const time = typeof parsed.time === 'number'
        ? formatDateTime(new Date(parsed.time).toISOString())
        : typeof parsed.time === 'string'
          ? formatDateTime(parsed.time)
          : '';
      const detailEntries = Object.entries(parsed).filter((entry) => !['msg', 'message', 'level', 'time'].includes(entry[0]));
      const detailObject = Object.fromEntries(detailEntries);
      return {
        title,
        summary: detailEntries.length > 0 ? 'Системное сообщение runtime.' : '',
        level: parsePinoLevel(parsed.level),
        time,
        details: Object.keys(detailObject).length > 0 ? detailObject : null,
      };
    });
}

function renderLogs(logs) {
  if (!logs) {
    return '<section class="panel stack"><div class="empty">' + escapeHtml(copy.noLogs) + '</div></section>';
  }
  const entries = parseLogEntries(logs);
  return [
    '<section class="panel stack">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">Runtime logs</div>',
    '<h2>Operational feed</h2>',
    '<div class="meta mono">' + escapeHtml(logs.path) + '</div>',
    '</div>',
    renderPill('tail ' + String(logs.tail), ''),
    '</div>',
    entries.length === 0
      ? '<div class="empty">' + escapeHtml(copy.noLogs) + '</div>'
      : '<div class="stack">' + entries.map((entry) => [
          '<article class="event-card ' + escapeHtml(entry.level) + '">',
          '<div class="toolbar spread">',
          '<div class="stack gap-xs">',
          '<strong>' + escapeHtml(entry.title) + '</strong>',
          entry.summary ? '<div class="meta">' + escapeHtml(entry.summary) + '</div>' : '',
          '</div>',
          entry.time ? '<span class="meta mono">' + escapeHtml(entry.time) + '</span>' : '',
          '</div>',
          entry.details ? createRawDetails(copy.rawDetails + ': log entry', entry.details) : '',
          '</article>',
        ].join('')).join('') + '</div>',
    '</section>',
  ].join('');
}

function renderShell() {
  if (state.shellReady) {
    return;
  }

  const app = document.getElementById('app');
  if (!app) {
    return;
  }

  app.innerHTML = [
    '<div class="layout">',
    '<aside class="sidebar stack">',
    '<div class="brand stack">',
    '<div class="eyebrow">Agent Runtime</div>',
    '<h1>' + escapeHtml(copy.title) + '</h1>',
    '<p>' + escapeHtml(copy.subtitle) + '</p>',
    '</div>',
    '<section class="panel stack panel-accent">',
    '<div class="toolbar spread">',
    '<h2>' + escapeHtml(copy.createTask) + '</h2>',
    '<button id="refreshButton" type="button" class="button secondary">' + escapeHtml(copy.refreshButton) + '</button>',
    '</div>',
    '<div class="field"><label>' + escapeHtml(copy.goalLabel) + '</label><textarea id="goalInput" placeholder="Например: Проанализируй bounded tools для twilx"></textarea></div>',
    '<div class="field"><label>' + escapeHtml(copy.targetLabel) + '</label><select id="targetSelect"></select></div>',
    '<button id="createTaskButton" type="button" class="button">' + escapeHtml(copy.createButton) + '</button>',
    '</section>',
    '<section class="panel stack"><div class="toolbar spread"><h2>' + escapeHtml(copy.approvals) + '</h2><span id="approvalsCount"></span></div><div id="approvalsList" class="list"></div></section>',
    '<section class="panel stack"><h2>' + escapeHtml(copy.targets) + '</h2><div id="targetsList" class="list"></div></section>',
    '<section class="panel stack"><h2>' + escapeHtml(copy.schedules) + '</h2><div id="schedulesList" class="list"></div></section>',
    '</aside>',
    '<main class="content">',
    '<section class="panel hero-panel stack">',
    '<div class="toolbar spread">',
    '<div class="stack hero-copy">',
    '<div class="eyebrow">' + escapeHtml(copy.runtime) + '</div>',
    '<h2>Live orchestration surface</h2>',
    '<div id="statusDetail" class="meta">' + escapeHtml(copy.dashboardReady) + '</div>',
    '</div>',
    '<div class="toolbar">',
    '<button id="pollingToggleButton" type="button" class="button ghost"></button>',
    '<span id="runtimeHealth"></span>',
    '</div>',
    '</div>',
    '<div class="status-strip">',
    '<div class="status-card"><div class="meta">current flow</div><div id="statusCurrentTask" class="status-value"></div></div>',
    '<div class="status-card"><div class="meta">selected task</div><div id="statusSelectedTask" class="status-value"></div></div>',
    '<div class="status-card"><div class="meta">last refresh</div><div id="statusLastUpdated" class="status-value"></div></div>',
    '<div class="status-card"><div class="meta">polling</div><div id="statusPolling" class="status-value"></div></div>',
    '</div>',
    '<div class="kpi-grid">',
    '<div class="kpi"><div class="meta">mode</div><div id="kpiMode" class="kpi-value"></div></div>',
    '<div class="kpi"><div class="meta">autonomy</div><div id="kpiAutonomy" class="kpi-value"></div></div>',
    '<div class="kpi"><div class="meta">tasks</div><div id="kpiTasks" class="kpi-value"></div></div>',
    '<div class="kpi"><div class="meta">pending approvals</div><div id="kpiApprovals" class="kpi-value"></div></div>',
    '</div>',
    '<div id="notificationBar"></div>',
    '</section>',
    '<section class="toolbar tabs" id="viewTabs">',
    '<button type="button" class="tab-button" data-view="overview">' + escapeHtml(copy.viewOverview) + '</button>',
    '<button type="button" class="tab-button" data-view="run">' + escapeHtml(copy.viewRun) + '</button>',
    '<button type="button" class="tab-button" data-view="artifacts">' + escapeHtml(copy.viewArtifacts) + '</button>',
    '<button type="button" class="tab-button" data-view="logs">' + escapeHtml(copy.viewLogs) + '</button>',
    '</section>',
    '<section id="viewContent" class="stack"></section>',
    '</main>',
    '</div>',
  ].join('');

  bindShellEvents();
  state.shellReady = true;
}

function bindShellEvents() {
  const targetSelect = getElement('targetSelect');
  if (targetSelect instanceof HTMLSelectElement) {
    targetSelect.addEventListener('change', () => {
      state.targetId = targetSelect.value;
    });
  }

  const refreshButton = getElement('refreshButton');
  if (refreshButton instanceof HTMLButtonElement) {
    refreshButton.addEventListener('click', () => {
      void refreshDashboard({ showLoading: false, force: true });
    });
  }

  const createTaskButton = getElement('createTaskButton');
  const goalInput = getElement('goalInput');
  if (createTaskButton instanceof HTMLButtonElement && goalInput instanceof HTMLTextAreaElement && targetSelect instanceof HTMLSelectElement) {
    createTaskButton.addEventListener('click', () => {
      void submitTask(goalInput, targetSelect);
    });
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }

    const taskNode = event.target.closest('[data-task-id]');
    if (taskNode instanceof HTMLElement) {
      const taskId = taskNode.getAttribute('data-task-id');
      if (taskId && taskId !== state.selectedTaskId) {
        state.selectedTaskId = taskId;
        state.selectedRunId = '';
        state.selectedArtifactId = '';
        persistUiState();
        void refreshDashboard({ showLoading: false, force: true });
      }
      return;
    }

    const approveNode = event.target.closest('[data-approve-id]');
    if (approveNode instanceof HTMLElement) {
      const approvalId = approveNode.getAttribute('data-approve-id');
      if (approvalId) {
        void runApprovalAction(approvalId, 'approve');
      }
      return;
    }

    const rejectNode = event.target.closest('[data-reject-id]');
    if (rejectNode instanceof HTMLElement) {
      const approvalId = rejectNode.getAttribute('data-reject-id');
      if (approvalId) {
        void runApprovalAction(approvalId, 'reject');
      }
      return;
    }

    const artifactNode = event.target.closest('[data-artifact-id]');
    if (artifactNode instanceof HTMLElement) {
      const artifactId = artifactNode.getAttribute('data-artifact-id');
      if (artifactId && artifactId !== state.selectedArtifactId) {
        state.selectedArtifactId = artifactId;
        persistUiState();
        void refreshDashboard({ showLoading: false, force: true });
      }
      return;
    }

    const runNode = event.target.closest('[data-run-id]');
    if (runNode instanceof HTMLElement) {
      const runId = runNode.getAttribute('data-run-id');
      if (runId) {
        state.selectedRunId = runId;
        state.activeView = 'run';
        persistUiState();
        void refreshDashboard({ showLoading: false, force: true });
      }
      return;
    }

    const tabNode = event.target.closest('[data-view]');
    if (tabNode instanceof HTMLElement) {
      const nextView = tabNode.getAttribute('data-view');
      if (nextView === 'overview' || nextView === 'artifacts' || nextView === 'logs' || nextView === 'run') {
        state.activeView = nextView;
        persistUiState();
        void refreshDashboard({ showLoading: false, force: true });
      }
    }
  });

  document.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const filterNode = event.target.closest('[data-filter]');
    if (!(filterNode instanceof HTMLSelectElement)) {
      return;
    }
    const filterType = filterNode.getAttribute('data-filter');
    if (filterType === 'task-state') {
      state.taskFilter = filterNode.value;
    }
    if (filterType === 'event-level') {
      state.eventLevelFilter = filterNode.value;
    }
    if (filterType === 'approval-status') {
      state.approvalFilter = filterNode.value;
    }
    persistUiState();
    if (state.lastLoadedData) {
      updateViewContent(state.lastLoadedData);
    }
  });

  const pollingToggleButton = getElement('pollingToggleButton');
  if (pollingToggleButton instanceof HTMLButtonElement) {
    pollingToggleButton.addEventListener('click', () => {
      state.pollingPaused = !state.pollingPaused;
      persistUiState();
      if (state.pollingPaused) {
        disconnectStream();
      } else {
        connectStream();
      }
      updatePollingUi();
      if (!state.pollingPaused) {
        void refreshDashboard({ showLoading: false, force: true });
      }
    });
  }
}

async function submitTask(goalInput, targetSelect) {
  const goal = goalInput.value.trim();
  if (goal.length === 0 || state.busy) {
    return;
  }

  state.busy = true;
  state.lastError = '';
  setBusyState();
  updateNotification();
  try {
    const task = await fetchJson('/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal,
        targetId: targetSelect.value || undefined,
      }),
    });
    if (task && typeof task === 'object' && 'id' in task && typeof task.id === 'string') {
      state.selectedTaskId = task.id;
      state.selectedRunId = '';
      state.activeView = 'overview';
      state.selectedArtifactId = '';
      goalInput.value = '';
      persistUiState();
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : 'Не удалось создать задачу.';
  } finally {
    state.busy = false;
    setBusyState();
    updateNotification();
    await refreshDashboard({ showLoading: false, force: true });
  }
}

async function runApprovalAction(approvalId, action) {
  state.lastError = '';
  updateNotification();
  try {
    await fetchJson('/approvals/' + approvalId + '/' + action, { method: 'POST' });
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : 'Не удалось обновить approval.';
  } finally {
    updateNotification();
    await refreshDashboard({ showLoading: false, force: true });
  }
}

function updatePollingUi() {
  const pollingToggleButton = document.getElementById('pollingToggleButton');
  if (pollingToggleButton instanceof HTMLButtonElement) {
    pollingToggleButton.textContent = state.pollingPaused ? copy.resumePolling : copy.pausePolling;
  }
  const streamLabel = state.pollingPaused ? copy.streamPaused : state.streamConnected ? copy.streamConnected : copy.streamConnecting;
  setText('statusPolling', streamLabel);
}

function setBusyState() {
  const createTaskButton = document.getElementById('createTaskButton');
  const refreshButton = document.getElementById('refreshButton');
  if (createTaskButton instanceof HTMLButtonElement) {
    createTaskButton.disabled = state.busy;
  }
  if (refreshButton instanceof HTMLButtonElement) {
    refreshButton.disabled = state.busy;
  }
}

function updateTargetSelect(targets) {
  const targetSelect = getElement('targetSelect');
  if (!(targetSelect instanceof HTMLSelectElement)) {
    return;
  }

  const previousValue = state.targetId || targetSelect.value;
  targetSelect.innerHTML = targets
    .map((target) => '<option value="' + escapeHtml(target.id) + '">' + escapeHtml(target.id) + '</option>')
    .join('');

  if (!state.targetId && targets.length > 0) {
    state.targetId = targets[0].id;
  }

  if (state.targetId && targets.some((target) => target.id === state.targetId)) {
    targetSelect.value = state.targetId;
    return;
  }

  targetSelect.value = previousValue;
  state.targetId = targetSelect.value;
}

function updateStatusBar(tasks, health) {
  const taskState = describeTaskState(tasks);
  const selectedTask = tasks.find((task) => task.id === state.selectedTaskId);
  setHtml('runtimeHealth', renderPill(health.status, 'success'));
  setHtml('statusCurrentTask', renderPill(taskState.label, taskState.tone));
  setHtml(
    'statusSelectedTask',
    selectedTask ? renderPill(getStateLabel(selectedTask.state), getStateTone(selectedTask.state)) : renderPill('None', ''),
  );
  setText('statusLastUpdated', state.lastUpdatedAt ? formatRelativeTime(state.lastUpdatedAt) : 'waiting');
  setText('statusDetail', taskState.detail);
}

function updateTabs() {
  document.querySelectorAll('[data-view]').forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const view = node.getAttribute('data-view');
    node.classList.toggle('active', view === state.activeView);
  });
}

function updateNotification() {
  const notificationBar = document.getElementById('notificationBar');
  if (!(notificationBar instanceof HTMLElement)) {
    return;
  }
  if (!state.lastError) {
    notificationBar.innerHTML = '';
    return;
  }
  notificationBar.innerHTML = '<div class="notification error">' + escapeHtml(state.lastError) + '</div>';
}

async function loadDashboardData() {
  const query = new URLSearchParams();
  if (state.selectedTaskId) {
    query.set('taskId', state.selectedTaskId);
  }
  if (state.taskFilter) {
    query.set('taskState', state.taskFilter);
  }
  if (state.approvalFilter) {
    query.set('approvalStatus', state.approvalFilter);
  }
  if (state.eventLevelFilter) {
    query.set('eventLevel', state.eventLevelFilter);
  }
  let dashboard = await fetchJson('/dashboard/state' + (query.toString() ? '?' + query.toString() : ''));

  if (Array.isArray(dashboard.tasks)) {
    const preferredTaskId = getPreferredTaskId(dashboard.tasks);
    if (preferredTaskId && preferredTaskId !== state.selectedTaskId) {
      state.selectedTaskId = preferredTaskId;
      persistUiState();
      query.set('taskId', state.selectedTaskId);
      dashboard = await fetchJson('/dashboard/state?' + query.toString());
    }
  }

  let artifactBrowser = null;
  let artifactContent = null;
  let logs = null;
  let runView = null;

  if (state.selectedTaskId) {
    artifactBrowser = await fetchJson('/tasks/' + encodeURIComponent(state.selectedTaskId) + '/artifacts/browser');
    const artifactItems =
      artifactBrowser && Array.isArray(artifactBrowser.runs)
        ? artifactBrowser.runs.flatMap((runGroup) =>
            Array.isArray(runGroup.steps)
              ? runGroup.steps.flatMap((stepGroup) =>
                  Array.isArray(stepGroup.artifacts)
                    ? stepGroup.artifacts.map((artifactEntry) => artifactEntry.artifact)
                    : [],
                )
              : [],
          )
        : [];
    ensureSelectedArtifactId(artifactItems);
  } else {
    state.selectedArtifactId = '';
  }

  if (state.activeView === 'artifacts' && state.selectedArtifactId) {
    artifactContent = await fetchJson('/artifacts/' + encodeURIComponent(state.selectedArtifactId) + '/view');
  }

  if (state.activeView === 'run' && state.selectedRunId) {
    const runQuery = new URLSearchParams();
    if (state.eventLevelFilter) {
      runQuery.set('eventLevel', state.eventLevelFilter);
    }
    runView = await fetchJson('/runs/' + encodeURIComponent(state.selectedRunId) + '/view' + (runQuery.toString() ? '?' + runQuery.toString() : ''));
  }

  if (state.activeView === 'logs') {
    logs = await fetchJson('/logs/runtime?tail=400');
  }

  return {
    dashboard,
    artifactBrowser,
    artifactContent,
    logs,
    runView,
  };
}

function updateViewContent(loadedData) {
  state.lastLoadedData = loadedData;
  const dashboard = loadedData.dashboard;
  const tasks = Array.isArray(dashboard.tasks) ? dashboard.tasks : [];
  const approvals = Array.isArray(dashboard.approvals) ? dashboard.approvals : [];
  const targets = Array.isArray(dashboard.targets) ? dashboard.targets : [];
  const schedules = Array.isArray(dashboard.schedules) ? dashboard.schedules : [];
  const health = dashboard.health && typeof dashboard.health === 'object'
    ? dashboard.health
    : { status: 'unknown', mode: 'unknown', autonomy: 'unknown' };

  if (!state.selectedRunId && dashboard.timeline && Array.isArray(dashboard.timeline.runs) && dashboard.timeline.runs[0]) {
    state.selectedRunId = dashboard.timeline.runs[0].id;
    persistUiState();
  }

  updateTargetSelect(targets);
  setHtml('approvalsList', renderApprovals(approvals));
  setHtml('targetsList', renderTargets(targets));
  setHtml('schedulesList', renderSchedules(schedules));
  setHtml('approvalsCount', renderPill(String(approvals.filter((approval) => approval.status === 'pending').length), 'warning'));
  updateStatusBar(tasks, health);
  updateTabs();
  updatePollingUi();
  updateNotification();

  setText('kpiMode', String(health.mode));
  setText('kpiAutonomy', String(health.autonomy));
  setText('kpiTasks', String(tasks.length));
  setText('kpiApprovals', String(approvals.filter((approval) => approval.status === 'pending').length));

  const content = state.activeView === 'artifacts'
    ? renderArtifacts(loadedData.artifactBrowser, loadedData.artifactContent)
    : state.activeView === 'logs'
      ? renderLogs(loadedData.logs)
      : state.activeView === 'run'
        ? renderRunPage(loadedData.runView)
        : renderOverview(dashboard.timeline, dashboard.maintenance.summary, dashboard.metrics);

  setHtml('viewContent', content);

  if (state.activeView === 'overview') {
    setHtml('tasksList', renderTasks(tasks));
  }

  setBusyState();
}

function renderLoadingState() {
  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  app.innerHTML = '<div class="layout"><main class="content"><section class="panel"><div class="empty">' + escapeHtml(copy.loading) + '</div></section></main></div>';
}

async function refreshDashboard(options) {
  const showLoading = options && options.showLoading === true;
  const force = options && options.force === true;
  if (state.refreshInFlight && !force) {
    return;
  }

  state.refreshInFlight = true;
  try {
    if (!state.shellReady && showLoading) {
      renderLoadingState();
    }

    renderShell();
    const loadedData = await loadDashboardData();
    state.lastUpdatedAt = new Date().toISOString();
    state.lastError = '';
    persistUiState();
    updateViewContent(loadedData);
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : 'Не удалось обновить dashboard.';
    updateNotification();
  } finally {
    state.refreshInFlight = false;
  }
}

window.addEventListener('hashchange', () => {
  applyHashState();
  persistUiState();
  void refreshDashboard({ showLoading: false, force: true });
});

window.addEventListener('beforeunload', () => {
  disconnectStream();
});

loadPersistedState();

void refreshDashboard({ showLoading: true, force: true }).then(() => {
  if (!state.pollingPaused) {
    connectStream();
    updatePollingUi();
  }
});
`.trim();
