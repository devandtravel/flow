import { dashboardArtifactViewsScript } from './artifacts';
import { dashboardCopyScript } from './copy';
import { dashboardDialogsScript } from './dialogs';
import { dashboardLogsScript } from './logs';
import { dashboardRouteStateScript } from './routes';
import { dashboardRunInsightsScript } from './run-insights';
import { dashboardTaskViewsScript } from './task-views';

export const dashboardScript = `
${dashboardCopyScript}
${dashboardDialogsScript}
${dashboardLogsScript}
${dashboardRunInsightsScript}

const terminalStates = ['completed', 'failed', 'escalated', 'blocked', 'cancelled', 'rolled_back'];
const storageKeys = {
  selectedTaskId: 'flow.ui.selectedTaskId',
  selectedRunId: 'flow.ui.selectedRunId',
  selectedArtifactId: 'flow.ui.selectedArtifactId',
  activeView: 'flow.ui.activeView',
  pollingPaused: 'flow.ui.pollingPaused',
  taskFilter: 'flow.ui.taskFilter',
  eventLevelFilter: 'flow.ui.eventLevelFilter',
  approvalFilter: 'flow.ui.approvalFilter',
  artifactRunFilter: 'flow.ui.artifactRunFilter',
  artifactTypeFilter: 'flow.ui.artifactTypeFilter',
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
  compactMode: true,
  lastUpdatedAt: '',
  lastError: '',
  streamConnected: false,
  streamStateLabel: '',
  taskFilter: '',
  eventLevelFilter: '',
  approvalFilter: '',
  artifactRunFilter: '',
  artifactTypeFilter: '',
  taskRunCursor: '',
  runEventCursor: '',
  artifactCursor: '',
  lastLoadedData: null,
};

const pageSize = {
  runs: 6,
  artifacts: 12,
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

${dashboardRouteStateScript}

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

function recoverMissingSelection(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.message.includes('Task ') && error.message.includes(' not found')) {
    state.selectedTaskId = '';
    state.selectedRunId = '';
    state.selectedArtifactId = '';
    if (state.activeView === 'run' || state.activeView === 'artifacts') {
      state.activeView = 'overview';
    }
    persistUiState();
    return true;
  }

  if (error.message.includes('Run ') && error.message.includes(' not found')) {
    state.selectedRunId = '';
    if (state.activeView === 'run') {
      state.activeView = 'overview';
    }
    persistUiState();
    return true;
  }

  if (error.message.includes('Artifact ') && error.message.includes(' not found')) {
    state.selectedArtifactId = '';
    if (state.activeView === 'artifacts') {
      state.activeView = 'overview';
    }
    persistUiState();
    return true;
  }

  return false;
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
    queued: 'В очереди',
    planning: 'Планирование',
    validating: 'Проверка плана',
    executing: 'Исполнение',
    awaiting_approval: 'Ожидает подтверждения',
    verifying: 'Проверка результата',
    completed: 'Завершено',
    failed: 'Ошибка',
    retryable: 'Доступен повтор',
    blocked: 'Заблокировано',
    cancelled: 'Отменено',
    rolled_back: 'Откат выполнен',
    escalated: 'Требует оператора',
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
    '<div class="eyebrow">Фильтры</div>',
    '<h3>Параметры отображения</h3>',
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
        { value: 'pending', label: 'Ожидает' },
        { value: 'approved', label: 'Подтверждено' },
        { value: 'rejected', label: 'Отклонено' },
        { value: 'consumed', label: 'Использовано' },
      ], state.approvalFilter) +
    '</select></div>',
    '</div>',
    '</section>',
  ].join('');
}

function renderPager(kind, page) {
  if (!page || typeof page.total !== 'number' || page.total <= page.limit) {
    return '';
  }

  const previousCursor = typeof page.previousCursor === 'string' ? page.previousCursor : '';
  const nextCursor = typeof page.nextCursor === 'string' ? page.nextCursor : '';
  const canGoBack = previousCursor.length > 0;
  const canGoForward = nextCursor.length > 0;

  return [
    '<div class="toolbar pager">',
    '<button type="button" class="button secondary" data-page-kind="' + escapeHtml(kind) + '" data-page-cursor="' + escapeHtml(previousCursor) + '"' + (canGoBack ? '' : ' disabled') + '>Назад</button>',
    '<div class="meta">Показано ' + escapeHtml(String(page.offset + 1)) + '–' + escapeHtml(String(Math.min(page.offset + page.limit, page.total))) + ' из ' + escapeHtml(String(page.total)) + '</div>',
    '<button type="button" class="button secondary" data-page-kind="' + escapeHtml(kind) + '" data-page-cursor="' + escapeHtml(nextCursor) + '"' + (canGoForward ? '' : ' disabled') + '>Далее</button>',
    '</div>',
  ].join('');
}

function renderTaskActions(actions, taskId) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return '';
  }

  return [
    '<section class="stack">',
    '<div class="section-heading">' + escapeHtml(copy.operatorActions) + '</div>',
    '<div class="toolbar">',
    actions
      .map((action) => {
        const toneClass = action.tone === 'danger' ? ' danger' : action.tone === 'warning' ? ' warning' : ' secondary';
        return '<button type="button" class="button' + toneClass + '" data-task-action="' + escapeHtml(action.action) + '" data-task-action-id="' + escapeHtml(taskId) + '">' + escapeHtml(action.label) + '</button>';
      })
      .join(''),
    '</div>',
    '</section>',
  ].join('');
}

function isTaskDeletable(task) {
  return task && ['completed', 'failed', 'blocked', 'cancelled', 'rolled_back', 'escalated'].includes(task.state);
}

function isTaskStoppable(task) {
  return task && ['queued', 'planning', 'validating', 'executing', 'awaiting_approval', 'verifying', 'retryable'].includes(task.state);
}

function getTaskControl(task) {
  if (!task || typeof task !== 'object' || !task.control || typeof task.control !== 'object') {
    return {
      stopRequested: false,
      deleteAfterStop: false,
    };
  }

  return {
    stopRequested: task.control.stopRequested === true,
    deleteAfterStop: task.control.deleteAfterStop === true,
  };
}

function isTaskStopPending(task) {
  const control = getTaskControl(task);
  return control.stopRequested;
}

function isTaskDeletePending(task) {
  const control = getTaskControl(task);
  return control.stopRequested && control.deleteAfterStop;
}

function renderTaskGoal(value) {
  const text = typeof value === 'string' ? value : '';
  return '<span class="task-goal-clamp" title="' + escapeHtml(text) + '">' + escapeHtml(text) + '</span>';
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
      label: copy.stateIdle,
      tone: '',
      detail: 'Активные задачи отсутствуют.',
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
      summary: 'План подготовлен и передан на проверку.',
      facts: [
        { label: 'steps', value: steps },
        { label: 'confidence', value: confidence },
      ],
      raw: payload,
    };
  }
  if (event.message === 'plan_invalid') {
    const feedback = payload && Array.isArray(payload.feedback)
      ? payload.feedback.filter((item) => typeof item === 'string')
      : [];
    const doNotRepeatRules = payload && Array.isArray(payload.doNotRepeatRules)
      ? payload.doNotRepeatRules.filter((item) => typeof item === 'string')
      : [];
    return {
      title: 'План отклонён проверкой',
      summary: feedback[0] || 'Проверка плана завершилась отклонением. Ожидается повторное построение.',
      facts: [
        { label: 'feedback', value: String(feedback.length) },
        { label: 'rules', value: String(doNotRepeatRules.length) },
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
  if (event.message === 'task_stop_requested') {
    const deleteAfterStop = payload && payload.deleteAfterStop === true;
    const state = payload && typeof payload.state === 'string' ? payload.state : '';
    return {
      title: deleteAfterStop ? 'Ожидание удаления после остановки' : 'Ожидание безопасной остановки',
      summary: deleteAfterStop
        ? 'Задача будет удалена после ближайшей безопасной точки остановки.'
        : 'Выполнение будет остановлено после ближайшей безопасной точки.',
      facts: [
        { label: 'state', value: state ? getStateLabel(state) : '' },
        { label: 'after stop', value: deleteAfterStop ? 'delete' : 'keep' },
      ],
      raw: payload,
    };
  }
  if (event.message === 'task_stopped') {
    const reason = payload && typeof payload.reason === 'string' ? payload.reason : '';
    const deleteAfterStop = payload && payload.deleteAfterStop === true;
    return {
      title: deleteAfterStop ? 'Задача остановлена перед удалением' : 'Задача остановлена',
      summary: reason || 'Исполнение остановлено на безопасной границе.',
      facts: [
        { label: 'after stop', value: deleteAfterStop ? 'delete' : 'keep' },
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
      : '<div class="meta">Замечания evaluator отсутствуют.</div>',
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
      const stopPending = isTaskStopPending(task);
      const deletePending = isTaskDeletePending(task);
      const stopButton = isTaskStoppable(task)
        ? '<button type="button" class="button warning task-stop-button" data-task-stop-id="' + escapeHtml(task.id) + '"' + (stopPending ? ' disabled' : '') + '>' + escapeHtml(stopPending ? copy.stopRequested : copy.stopTask) + '</button>'
        : '';
      const deleteButton = '<button type="button" class="button danger task-delete-button" data-task-delete-id="' + escapeHtml(task.id) + '"' + (deletePending ? ' disabled' : '') + '>' + escapeHtml(deletePending ? copy.deleteRequested : copy.deleteTask) + '</button>';
      const controlMeta = stopPending
        ? '<div class="meta">' + escapeHtml(deletePending ? copy.deleteRequested : copy.stopRequested) + '</div>'
        : '';
      return [
        '<article class="card task-card' + selected + '">',
        '<button type="button" class="task-card-main" data-task-id="' + escapeHtml(task.id) + '">',
        '<div class="card-title">',
        '<div class="stack gap-xs task-card-copy">',
        '<strong>' + renderTaskGoal(task.goal) + '</strong>',
        '<div class="meta mono">' + escapeHtml(task.id) + '</div>',
        '</div>',
        renderPill(getStateLabel(task.state), getStateTone(task.state)),
        '</div>',
        '<div class="meta">target: ' + escapeHtml(task.target_id) + '</div>',
        controlMeta,
        '<div class="meta">' + escapeHtml(formatRelativeTime(task.updated_at)) + '</div>',
        '</button>',
        '<div class="task-card-actions">' + stopButton + deleteButton + '</div>',
        '</article>',
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
    return '<div class="empty">Контуры не настроены.</div>';
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
    return '<div class="empty">Сводка обслуживания недоступна.</div>';
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
    return '<div class="empty">Метрики недоступны.</div>';
  }
  const failureTypes = metrics.failure_types && typeof metrics.failure_types === 'object' ? metrics.failure_types : {};
  const failureItems = Object.entries(failureTypes).map((entry) => entry[0] + ': ' + String(entry[1]));
  return [
    '<section class="panel stack">',
    '<div class="toolbar spread">',
    '<h2>Метрики</h2>',
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

${dashboardArtifactViewsScript}
${dashboardTaskViewsScript}

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
    '<div class="field"><label>' + escapeHtml(copy.goalLabel) + '</label><textarea id="goalInput" placeholder="' + escapeHtml(copy.goalPlaceholder) + '"></textarea></div>',
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
    '<h2>' + escapeHtml(copy.heroTitle) + '</h2>',
    '<div id="statusDetail" class="meta">' + escapeHtml(copy.heroSubtitle) + '</div>',
    '</div>',
    '<div class="toolbar">',
    '<button id="pollingToggleButton" type="button" class="button ghost"></button>',
    '<span id="runtimeHealth"></span>',
    '</div>',
    '</div>',
    '<div class="status-strip">',
    '<div class="status-card"><div class="meta">текущее состояние</div><div id="statusCurrentTask" class="status-value"></div></div>',
    '<div class="status-card"><div class="meta">выбранная задача</div><div id="statusSelectedTask" class="status-value"></div></div>',
    '<div class="status-card"><div class="meta">последнее обновление</div><div id="statusLastUpdated" class="status-value"></div></div>',
    '<div class="status-card"><div class="meta">обновление</div><div id="statusPolling" class="status-value"></div></div>',
    '</div>',
    '<div class="kpi-grid">',
    '<div class="kpi"><div class="meta">mode</div><div id="kpiMode" class="kpi-value"></div></div>',
    '<div class="kpi"><div class="meta">autonomy</div><div id="kpiAutonomy" class="kpi-value"></div></div>',
    '<div class="kpi"><div class="meta">tasks</div><div id="kpiTasks" class="kpi-value"></div></div>',
    '<div class="kpi"><div class="meta">ожидающие подтверждения</div><div id="kpiApprovals" class="kpi-value"></div></div>',
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
    '<div id="dialogRoot"></div>',
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

    const deleteAllTasksNode = event.target.closest('[data-delete-all-tasks]');
    if (deleteAllTasksNode instanceof HTMLElement) {
      void deleteAllTasks();
      return;
    }

    const stopAllTasksNode = event.target.closest('[data-stop-all-tasks]');
    if (stopAllTasksNode instanceof HTMLElement) {
      void stopAllTasks();
      return;
    }

    const deleteTaskNode = event.target.closest('[data-task-delete-id]');
    if (deleteTaskNode instanceof HTMLElement) {
      const taskId = deleteTaskNode.getAttribute('data-task-delete-id');
      if (taskId) {
        void deleteTask(taskId);
      }
      return;
    }

    const stopTaskNode = event.target.closest('[data-task-stop-id]');
    if (stopTaskNode instanceof HTMLElement) {
      const taskId = stopTaskNode.getAttribute('data-task-stop-id');
      if (taskId) {
        void stopTask(taskId);
      }
      return;
    }

    const taskNode = event.target.closest('[data-task-id]');
    if (taskNode instanceof HTMLElement) {
      const taskId = taskNode.getAttribute('data-task-id');
      if (taskId && taskId !== state.selectedTaskId) {
        state.selectedTaskId = taskId;
        state.selectedRunId = '';
        state.selectedArtifactId = '';
        state.taskRunCursor = '';
        state.runEventCursor = '';
        state.artifactCursor = '';
        state.activeView = 'overview';
        persistUiState('push');
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

    const taskActionNode = event.target.closest('[data-task-action]');
    if (taskActionNode instanceof HTMLElement) {
      const action = taskActionNode.getAttribute('data-task-action');
      const taskId = taskActionNode.getAttribute('data-task-action-id');
      if (taskId && (action === 'retry' || action === 'replan' || action === 'escalate' || action === 'cancel')) {
        void runTaskAction(taskId, action);
      }
      return;
    }

    const artifactNode = event.target.closest('[data-artifact-id]');
    if (artifactNode instanceof HTMLElement) {
      const artifactId = artifactNode.getAttribute('data-artifact-id');
      if (artifactId && artifactId !== state.selectedArtifactId) {
        state.selectedArtifactId = artifactId;
        state.activeView = 'artifacts';
        persistUiState('push');
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
        persistUiState('push');
        void refreshDashboard({ showLoading: false, force: true });
      }
      return;
    }

    const pagerNode = event.target.closest('[data-page-kind]');
    if (pagerNode instanceof HTMLElement) {
      const pageKind = pagerNode.getAttribute('data-page-kind');
      const pageCursor = pagerNode.getAttribute('data-page-cursor') ?? '';
      if (pageKind === 'runs') {
        state.taskRunCursor = pageCursor;
      }
      if (pageKind === 'run-events') {
        state.runEventCursor = pageCursor;
      }
      if (pageKind === 'artifacts') {
        state.artifactCursor = pageCursor;
      }
      void refreshDashboard({ showLoading: false, force: true });
      return;
    }

    const tabNode = event.target.closest('[data-view]');
    if (tabNode instanceof HTMLElement) {
      const nextView = tabNode.getAttribute('data-view');
      if (nextView === 'overview' || nextView === 'artifacts' || nextView === 'logs' || nextView === 'run') {
        state.activeView = nextView;
        persistUiState('push');
        void refreshDashboard({ showLoading: false, force: true });
      }
      return;
    }

    const dialogCancelNode = event.target.closest('[data-dialog-cancel]');
    if (dialogCancelNode instanceof HTMLElement) {
      closeDialog(false);
      return;
    }

    const dialogConfirmNode = event.target.closest('[data-dialog-confirm]');
    if (dialogConfirmNode instanceof HTMLElement) {
      closeDialog(true);
      return;
    }

    const dialogDismissNode = event.target.closest('[data-dialog-dismiss]');
    if (dialogDismissNode instanceof HTMLElement && event.target === dialogDismissNode) {
      closeDialog(false);
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
        state.taskRunCursor = '';
      }
      if (filterType === 'event-level') {
        state.eventLevelFilter = filterNode.value;
        state.runEventCursor = '';
      }
      if (filterType === 'approval-status') {
        state.approvalFilter = filterNode.value;
      }
      if (filterType === 'artifact-run') {
        state.artifactRunFilter = filterNode.value;
        state.artifactCursor = '';
      }
      if (filterType === 'artifact-type') {
        state.artifactTypeFilter = filterNode.value;
        state.artifactCursor = '';
      }
    persistUiState();
    if (filterType === 'artifact-run' || filterType === 'artifact-type') {
      void refreshDashboard({ showLoading: false, force: true });
      return;
    }
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

  document.addEventListener('keydown', (event) => {
    if (!dialogState.open) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog(false);
      return;
    }

    if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      closeDialog(true);
    }
  });

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
      state.taskRunCursor = '';
      state.runEventCursor = '';
      state.artifactCursor = '';
      goalInput.value = '';
      persistUiState('push');
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

async function runTaskAction(taskId, action) {
  state.lastError = '';
  updateNotification();
  try {
    await fetchJson('/tasks/' + encodeURIComponent(taskId) + '/actions/' + action, {
      method: 'POST',
    });
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : 'Не удалось выполнить действие над задачей.';
  } finally {
    updateNotification();
    await refreshDashboard({ showLoading: false, force: true });
  }
}

async function deleteTask(taskId) {
  const confirmed = await openConfirmDialog({
    title: copy.deleteTaskTitle,
    message: copy.deleteTaskConfirm,
    confirmLabel: copy.deleteTask,
    cancelLabel: copy.cancelAction,
    tone: 'danger',
  });
  if (!confirmed) {
    return;
  }

  state.lastError = '';
  updateNotification();
  try {
    await fetchJson('/tasks/' + encodeURIComponent(taskId), {
      method: 'DELETE',
    });
    if (state.selectedTaskId === taskId) {
      state.selectedTaskId = '';
      state.selectedRunId = '';
      state.selectedArtifactId = '';
      state.taskRunCursor = '';
      state.runEventCursor = '';
      state.artifactCursor = '';
      if (state.activeView !== 'overview' && state.activeView !== 'logs') {
        state.activeView = 'overview';
      }
      persistUiState('replace');
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : 'Не удалось удалить задачу.';
  } finally {
    updateNotification();
    await refreshDashboard({ showLoading: false, force: true });
  }
}

async function deleteAllTasks() {
  const confirmed = await openConfirmDialog({
    title: copy.deleteAllTasksTitle,
    message: copy.deleteAllTasksConfirm,
    confirmLabel: copy.deleteAllTasks,
    cancelLabel: copy.cancelAction,
    tone: 'danger',
  });
  if (!confirmed) {
    return;
  }

  state.lastError = '';
  updateNotification();
  try {
    await fetchJson('/tasks', {
      method: 'DELETE',
    });
    state.selectedTaskId = '';
    state.selectedRunId = '';
    state.selectedArtifactId = '';
    state.taskRunCursor = '';
    state.runEventCursor = '';
    state.artifactCursor = '';
    if (state.activeView !== 'overview' && state.activeView !== 'logs') {
      state.activeView = 'overview';
    }
    persistUiState('replace');
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : 'Не удалось удалить задачи.';
  } finally {
    updateNotification();
    await refreshDashboard({ showLoading: false, force: true });
  }
}

async function stopTask(taskId) {
  const confirmed = await openConfirmDialog({
    title: copy.stopTaskTitle,
    message: copy.stopTaskConfirm,
    confirmLabel: copy.stopTask,
    cancelLabel: copy.cancelAction,
    tone: 'warning',
  });
  if (!confirmed) {
    return;
  }

  state.lastError = '';
  updateNotification();
  try {
    await fetchJson('/tasks/' + encodeURIComponent(taskId) + '/stop', {
      method: 'POST',
    });
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : 'Не удалось остановить задачу.';
  } finally {
    updateNotification();
    await refreshDashboard({ showLoading: false, force: true });
  }
}

async function stopAllTasks() {
  const confirmed = await openConfirmDialog({
    title: copy.stopAllTasksTitle,
    message: copy.stopAllTasksConfirm,
    confirmLabel: copy.stopAllTasks,
    cancelLabel: copy.cancelAction,
    tone: 'warning',
  });
  if (!confirmed) {
    return;
  }

  state.lastError = '';
  updateNotification();
  try {
    await fetchJson('/tasks/stop-all', {
      method: 'POST',
    });
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : 'Не удалось остановить задачи.';
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

function applyDensityMode() {
  document.body.classList.add('compact');
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
  setText('statusDetail', copy.heroSubtitle);
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
  let runView = null;
  let artifactContent = null;
  let logs = null;

  if (state.activeView === 'run' && state.selectedRunId) {
    const runQuery = new URLSearchParams({
      limit: String(pageSize.runs),
    });
    if (state.runEventCursor) {
      runQuery.set('cursor', state.runEventCursor);
    }
    if (state.eventLevelFilter) {
      runQuery.set('level', state.eventLevelFilter);
    }
    runView = await fetchJson('/runs/' + encodeURIComponent(state.selectedRunId) + '/view?' + runQuery.toString());
    if (runView && runView.task && typeof runView.task.id === 'string') {
      state.selectedTaskId = runView.task.id;
    }
  }

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
  query.set('runLimit', String(pageSize.runs));
  if (state.taskRunCursor) {
    query.set('cursor', state.taskRunCursor);
  }
  let dashboard = await fetchJson('/dashboard/state' + (query.toString() ? '?' + query.toString() : ''));
  const resolvedSelectedTaskIdFromDashboard =
    dashboard &&
    typeof dashboard === 'object' &&
    dashboard.selection &&
    typeof dashboard.selection === 'object' &&
    typeof dashboard.selection.resolvedTaskId === 'string'
      ? dashboard.selection.resolvedTaskId
      : '';
  const hasResolvedSelectedTask =
    resolvedSelectedTaskIdFromDashboard.length > 0;

  const requestedTaskMissing =
    dashboard &&
    typeof dashboard === 'object' &&
    dashboard.selection &&
    typeof dashboard.selection === 'object' &&
    dashboard.selection.requestedTaskMissing === true;

  let effectiveSelectedTaskId = state.selectedTaskId;
  if (requestedTaskMissing) {
    effectiveSelectedTaskId = '';
    state.selectedTaskId = '';
    state.selectedRunId = '';
    state.selectedArtifactId = '';
    if (state.activeView === 'run' || state.activeView === 'artifacts') {
      state.activeView = 'overview';
    }
    persistUiState();
  }

  if (Array.isArray(dashboard.tasks)) {
    const preferredTaskId = hasResolvedSelectedTask
      ? resolvedSelectedTaskIdFromDashboard
      : getPreferredTaskId(dashboard.tasks);
    if (preferredTaskId && preferredTaskId !== effectiveSelectedTaskId) {
      effectiveSelectedTaskId = preferredTaskId;
      state.selectedTaskId = preferredTaskId;
      persistUiState();
      query.set('taskId', state.selectedTaskId);
      dashboard = await fetchJson('/dashboard/state?' + query.toString());
    } else if (!preferredTaskId) {
      effectiveSelectedTaskId = '';
    }
  }

  let taskView = null;
  let artifactBrowser = null;

  if (effectiveSelectedTaskId) {
    const taskQuery = new URLSearchParams({
      limit: String(pageSize.runs),
    });
    if (state.taskRunCursor) {
      taskQuery.set('cursor', state.taskRunCursor);
    }
    taskView = await fetchJson('/tasks/' + encodeURIComponent(effectiveSelectedTaskId) + '/view?' + taskQuery.toString());
  }

  if (effectiveSelectedTaskId) {
    const artifactQuery = new URLSearchParams({
      limit: String(pageSize.artifacts),
    });
    if (state.artifactCursor) {
      artifactQuery.set('cursor', state.artifactCursor);
    }
    if (state.artifactRunFilter) {
      artifactQuery.set('runId', state.artifactRunFilter);
    }
    if (state.artifactTypeFilter) {
      artifactQuery.set('artifactType', state.artifactTypeFilter);
    }
    artifactBrowser = await fetchJson('/tasks/' + encodeURIComponent(effectiveSelectedTaskId) + '/artifacts/browser?' + artifactQuery.toString());
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
    state.selectedTaskId = '';
    state.selectedArtifactId = '';
  }

  if (state.activeView === 'artifacts' && state.selectedArtifactId) {
    artifactContent = await fetchJson('/artifacts/' + encodeURIComponent(state.selectedArtifactId) + '/view');
    if (artifactContent && artifactContent.artifact && typeof artifactContent.artifact.taskId === 'string') {
      state.selectedTaskId = artifactContent.artifact.taskId;
    }
    if (artifactContent && artifactContent.artifact && typeof artifactContent.artifact.runId === 'string') {
      state.selectedRunId = artifactContent.artifact.runId;
    }
  }

  if (state.activeView === 'logs') {
    logs = await fetchJson('/logs/runtime/view?limit=200');
  }

  return {
    dashboard,
    taskView,
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

  if (!state.selectedRunId && loadedData.taskView && Array.isArray(loadedData.taskView.runs) && loadedData.taskView.runs[0]) {
    state.selectedRunId = loadedData.taskView.runs[0].run.id;
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
        : renderOverview(loadedData.taskView, dashboard.maintenance.summary, dashboard.metrics, tasks);

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
  const allowRecovery = !options || options.allowRecovery !== false;
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
    if (allowRecovery && recoverMissingSelection(error)) {
      state.lastError = '';
      await refreshDashboard({ showLoading: false, force: true, allowRecovery: false });
      return;
    }
    state.lastError = error instanceof Error ? error.message : 'Не удалось обновить dashboard.';
    updateNotification();
  } finally {
    state.refreshInFlight = false;
  }
}

window.addEventListener('popstate', () => {
  applyRouteState();
  persistUiState('replace');
  void refreshDashboard({ showLoading: false, force: true });
});

window.addEventListener('beforeunload', () => {
  disconnectStream();
});

loadPersistedState();
applyDensityMode();

void refreshDashboard({ showLoading: true, force: true }).then(() => {
  if (!state.pollingPaused) {
    connectStream();
    updatePollingUi();
  }
});
`.trim();
