export const dashboardRunInsightsScript = `
function renderPlanPreviewBlock(summary) {
  if (!summary || !summary.planPreview) {
    return '';
  }

  const preview = summary.planPreview;
  const assumptions = Array.isArray(preview.assumptions) ? preview.assumptions : [];
  const risks = Array.isArray(preview.risks) ? preview.risks : [];
  const steps = Array.isArray(preview.steps) ? preview.steps : [];

  return [
    '<section class="panel stack card-soft">',
    '<div class="section-heading">' + escapeHtml(copy.planPreview) + '</div>',
    createKeyFacts([
      { label: copy.attempt, value: summary.attempt ? summary.attempt.label : 'n/a' },
      { label: 'confidence', value: typeof preview.confidence === 'number' ? preview.confidence.toFixed(2) : 'n/a' },
      { label: 'steps', value: String(steps.length) },
    ]),
    assumptions.length > 0
      ? '<div><div class="summary-title">Допущения</div>' + createBulletList(assumptions) + '</div>'
      : '',
    risks.length > 0
      ? '<div><div class="summary-title">Риски</div>' + createBulletList(risks) + '</div>'
      : '',
    steps.length > 0
      ? '<div><div class="summary-title">Шаги плана</div><div class="list">' + steps.map((step, index) => [
          '<article class="card stack card-soft">',
          '<div class="toolbar spread">',
          '<strong>' + escapeHtml(step.tool || 'unknown') + '</strong>',
          renderPill('Шаг ' + String(index + 1), ''),
          '</div>',
          '<div class="summary-text">' + escapeHtml(step.rationale || 'Рационализация шага не указана.') + '</div>',
          '</article>',
        ].join('')).join('') + '</div></div>'
      : '',
    '</section>',
  ].join('');
}

function renderCriticFeedbackBlock(summary) {
  if (!summary || !summary.criticFeedback) {
    return '';
  }

  const feedback = Array.isArray(summary.criticFeedback.feedback) ? summary.criticFeedback.feedback : [];
  const failureClasses = Array.isArray(summary.criticFeedback.failureClasses) ? summary.criticFeedback.failureClasses : [];
  const doNotRepeatRules = Array.isArray(summary.criticFeedback.doNotRepeatRules) ? summary.criticFeedback.doNotRepeatRules : [];

  return [
    '<section class="panel stack card-soft">',
    '<div class="section-heading">' + escapeHtml(copy.criticFeedback) + '</div>',
    feedback.length > 0
      ? '<div><div class="summary-title">Причины отклонения</div>' + createBulletList(feedback) + '</div>'
      : '<div class="meta">Замечания проверки плана отсутствуют.</div>',
    failureClasses.length > 0
      ? '<div><div class="summary-title">' + escapeHtml(copy.failureClasses) + '</div>' + createBulletList(failureClasses) + '</div>'
      : '',
    doNotRepeatRules.length > 0
      ? '<div><div class="summary-title">' + escapeHtml(copy.doNotRepeatRules) + '</div>' + createBulletList(doNotRepeatRules) + '</div>'
      : '',
    '</section>',
  ].join('');
}

function renderRunSummaryCard(runEntry) {
  const run = runEntry.run;
  const summary = runEntry.summary;
  return [
    '<button type="button" class="card stack run-summary-card" data-run-id="' + escapeHtml(run.id) + '">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">' + escapeHtml(summary.attempt.label) + '</div>',
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
    summary.latestEventTitle
      ? '<div class="meta">Последний сигнал: ' + escapeHtml(summary.latestEventTitle) + '</div>'
      : '<div class="meta">События запуска ещё не зафиксированы.</div>',
    summary.criticFeedback
      ? '<div class="meta">Запуск завершился с отклонением плана.</div>'
      : '',
    '</button>',
  ].join('');
}

function renderTaskHeader(taskView) {
  const latestRun = Array.isArray(taskView.runs) && taskView.runs.length > 0 ? taskView.runs[0] : null;
  const summary = taskView.summary && typeof taskView.summary === 'object' ? taskView.summary : null;
  const stopPending = taskView.control && taskView.control.stopRequested === true;
  const deletePending = stopPending && taskView.control.deleteAfterStop === true;
  const stopButton = isTaskStoppable(taskView.task)
    ? '<button type="button" class="button warning" data-task-stop-id="' + escapeHtml(taskView.task.id) + '"' + (stopPending ? ' disabled' : '') + '>' + escapeHtml(stopPending ? copy.stopRequested : copy.stopTask) + '</button>'
    : '';
  const deleteButton =
    '<button type="button" class="button danger" data-task-delete-id="' + escapeHtml(taskView.task.id) + '"' + (deletePending ? ' disabled' : '') + '>' + escapeHtml(deletePending ? copy.deleteRequested : copy.deleteTask) + '</button>';

  return [
    '<section class="panel stack task-header-panel">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">' + escapeHtml(copy.selectedTask) + '</div>',
    '<h2 class="task-heading-clamp" title="' + escapeHtml(taskView.task.goal) + '">' + escapeHtml(taskView.task.goal) + '</h2>',
    '<div class="meta mono">' + escapeHtml(taskView.task.id) + '</div>',
    '</div>',
    renderPill(getStateLabel(taskView.task.state), getStateTone(taskView.task.state)),
    '</div>',
    '<div class="summary-text">' +
      escapeHtml(
        latestRun
          ? 'Последний запуск: ' + latestRun.summary.attempt.label + ', состояние ' + getStateLabel(latestRun.run.status).toLowerCase() + ', подтверждено шагов ' + String(latestRun.summary.completedSteps) + ', изменено файлов ' + String(latestRun.summary.changedFiles.length) + '.'
          : 'Задача создана. Запуски ещё не зафиксированы.',
      ) +
    '</div>',
    stopPending ? '<div class="meta">' + escapeHtml(deletePending ? copy.deleteRequested : copy.stopRequested) + '</div>' : '',
    createKeyFacts([
      { label: 'target', value: taskView.task.target_id },
      { label: 'updated', value: formatRelativeTime(summary ? summary.updatedAt : taskView.task.updated_at) },
      { label: 'runs', value: String(taskView.runsPage.total) },
      { label: 'approvals', value: String(Array.isArray(taskView.approvals) ? taskView.approvals.length : 0) },
    ]),
    '<div class="toolbar">' + stopButton + deleteButton + '</div>',
    renderTaskActions(taskView.actions, taskView.task.id),
    latestRun ? renderPlanPreviewBlock(latestRun.summary) : '',
    latestRun ? renderCriticFeedbackBlock(latestRun.summary) : '',
    latestRun
      ? '<section class="stack"><div class="section-heading">Запуски</div><div class="grid two">' + taskView.runs.map(renderRunSummaryCard).join('') + '</div></section>'
      : '',
    '</section>',
  ].join('');
}
`.trim();
