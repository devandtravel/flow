export const dashboardTaskViewsScript = `
function renderRun(run) {
  const filteredEvents = run.events.filter(matchesEventLevel);
  return [
    '<section class="panel stack">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">Запуск ' + String(run.iteration + 1) + '</div>',
    '<h3 class="mono">' + escapeHtml(run.id) + '</h3>',
    '<div class="meta">Старт: ' + escapeHtml(formatDateTime(run.started_at)) + '</div>',
    '</div>',
    renderPill(getStateLabel(run.status), getStateTone(run.status)),
    '</div>',
    filteredEvents.length > 0
      ? '<div class="stack section-group"><div class="section-heading">События</div>' + filteredEvents.map(renderEvent).join('') + '</div>'
      : '<div class="empty">События запуска не соответствуют выбранному фильтру.</div>',
    run.steps.length > 0
      ? '<div class="stack section-group"><div class="section-heading">Шаги</div>' + run.steps.map(renderStep).join('') + '</div>'
      : '',
    run.evaluations.length > 0
      ? '<div class="stack section-group"><div class="section-heading">Оценка</div>' + run.evaluations.map(renderEvaluation).join('') + '</div>'
      : '',
    '</section>',
  ].join('');
}

function renderOverview(taskView, maintenance, metrics) {
  const overviewBody = !taskView || !taskView.task
    ? '<section class="panel stack"><div class="empty">' + escapeHtml(copy.noTaskSelected) + '</div></section>'
    : [
        renderTaskHeader(taskView),
        Array.isArray(taskView.approvals) && taskView.approvals.length > 0
          ? '<section class="stack"><div class="section-heading">Подтверждения задачи</div>' + renderApprovals(taskView.approvals) + '</section>'
          : '',
        Array.isArray(taskView.runs) && taskView.runs.length > 0
          ? '<section class="panel stack"><div class="toolbar spread"><h3>Запуски</h3>' + renderPill(String(taskView.runsPage.total), '') + '</div>' + renderPager('runs', taskView.runsPage) + '<div class="grid two">' + taskView.runs.map(renderRunSummaryCard).join('') + '</div></section>'
          : '<div class="empty">Запуски ещё не создавались.</div>',
        '</section>',
      ].join('');

  return [
    '<section class="split">',
    '<section class="panel stack"><div class="toolbar spread"><h2>' + escapeHtml(copy.tasks) + '</h2>' + renderPill('Активный список', '') + '</div><div id="tasksList" class="list"></div></section>',
    '<section class="stack">' + overviewBody + '</section>',
    '</section>',
    renderFilterBar(),
    '<section class="grid two">',
    renderMaintenance(maintenance),
    renderMetrics(metrics),
    '</section>',
  ].join('');
}

function renderRunPage(runView) {
  if (!runView || !runView.run) {
    return '<section class="panel stack"><div class="empty">Выберите запуск для просмотра.</div></section>';
  }

  return [
    '<section class="stack run-view-panel">',
    '<section class="panel stack task-header-panel">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">Запуск</div>',
    '<h2>' + escapeHtml(runView.task.goal) + '</h2>',
    '<div class="meta mono">' + escapeHtml(runView.run.id) + '</div>',
    '</div>',
    renderPill(getStateLabel(runView.run.status), getStateTone(runView.run.status)),
    '</div>',
    '<div class="summary-text">' +
      escapeHtml(
        runView.summary.latestEventTitle
          ? 'Последний сигнал: ' + runView.summary.latestEventTitle
          : 'Запуск открыт в режиме permalink.',
      ) +
    '</div>',
    createKeyFacts([
      { label: 'task', value: runView.task.id },
      { label: 'подтверждённые шаги', value: String(runView.summary.completedSteps) },
      { label: 'ошибки шагов', value: String(runView.summary.failedSteps) },
      { label: 'изменённые файлы', value: String(runView.summary.changedFiles.length) },
      { label: 'score', value: runView.summary.score === null ? 'n/a' : String(runView.summary.score) },
    ]),
    renderTaskActions(runView.taskActions, runView.task.id),
    runView.summary.changedFiles.length > 0
      ? '<div><div class="section-heading">Изменённые файлы</div>' + createBulletList(runView.summary.changedFiles) + '</div>'
      : '',
    '</section>',
    renderPager('run-events', runView.eventsPage),
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

function renderLogs(logs) {
  if (!logs) {
    return '<section class="panel stack"><div class="empty">' + escapeHtml(copy.noLogs) + '</div></section>';
  }
  const entries = parseLogEntries(logs);
  return [
    '<section class="panel stack">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">Журналы runtime</div>',
    '<h2>Операционный журнал</h2>',
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
`.trim();
