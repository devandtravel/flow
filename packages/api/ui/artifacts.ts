export const dashboardArtifactViewsScript = `
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
      summary: 'Текстовый артефакт без структурированного содержимого.',
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
      summary: parsed.step && parsed.step.tool ? 'Подготовка шага ' + parsed.step.tool : 'Исходный запрос к bounded tool.',
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
      title: 'Итоговый отчёт',
      summary: parsed.success === true ? 'Шаг завершился успешно.' : 'Шаг завершился без успешного результата.',
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

  const fileLinks = patch.files.length > 0
    ? '<nav class="patch-tree"><div class="section-heading">' + escapeHtml(copy.patchFiles) + '</div><div class="stack">' + patch.files.map((file, fileIndex) => {
        const fileId = 'patch-file-' + String(fileIndex);
        const hunkLinks = file.hunks.length > 0
          ? '<div class="patch-tree-hunks"><div class="meta">' + escapeHtml(copy.patchHunks) + '</div>' + file.hunks.map((hunk, hunkIndex) => '<a class="patch-tree-link" href="#' + escapeHtml(fileId + '-hunk-' + String(hunkIndex)) + '">' + escapeHtml(hunk.header) + '</a>').join('') + '</div>'
          : '';
        return [
          '<div class="card card-soft stack patch-tree-card">',
          '<a class="patch-tree-link mono" href="#' + escapeHtml(fileId) + '">' + escapeHtml(file.path) + '</a>',
          hunkLinks,
          '</div>',
        ].join('');
      }).join('') + '</div></nav>'
    : '';

  const fileSections = patch.files.length > 0
    ? '<div class="stack">' + patch.files.map((file, fileIndex) => [
        '<article class="card card-soft stack patch-file-card" id="' + escapeHtml('patch-file-' + String(fileIndex)) + '">',
        '<div class="toolbar spread">',
        '<strong class="mono">' + escapeHtml(file.path) + '</strong>',
        '<div class="toolbar"><span class="delta add">+' + escapeHtml(String(file.additions)) + '</span><span class="delta delete">-' + escapeHtml(String(file.deletions)) + '</span></div>',
        '</div>',
        file.hunks.length > 0
          ? '<div class="stack">' + file.hunks.map((hunk, hunkIndex) => [
              '<section class="patch-hunk" id="' + escapeHtml('patch-file-' + String(fileIndex) + '-hunk-' + String(hunkIndex)) + '">',
              '<div class="patch-hunk-header mono">' + escapeHtml(hunk.header) + '</div>',
              '<div class="patch-lines">',
              hunk.lines.map((line) => {
                const lineKindClass = line.kind === 'add' ? 'add' : line.kind === 'delete' ? 'delete' : 'context';
                const oldLineNumber = line.oldLineNumber === null ? '' : String(line.oldLineNumber);
                const newLineNumber = line.newLineNumber === null ? '' : String(line.newLineNumber);
                const prefix = line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' ';
                return [
                  '<div class="patch-line ' + lineKindClass + '">',
                  '<span class="patch-line-number">' + escapeHtml(oldLineNumber) + '</span>',
                  '<span class="patch-line-number">' + escapeHtml(newLineNumber) + '</span>',
                  '<span class="patch-line-prefix">' + escapeHtml(prefix) + '</span>',
                  '<code class="patch-line-content">' + escapeHtml(line.content) + '</code>',
                  '</div>',
                ].join('');
              }).join(''),
              '</div>',
              '</section>',
            ].join('')).join('') + '</div>'
          : '<div class="meta">Фрагменты не обнаружены.</div>',
        '</article>',
      ].join('')).join('') + '</div>'
    : '';

  return [
    '<section class="stack">',
    '<div class="section-heading">Структура diff</div>',
    createKeyFacts([
      { label: 'files', value: String(patch.fileCount) },
      { label: 'hunks', value: String(patch.hunkCount) },
      { label: 'additions', value: String(patch.additions) },
      { label: 'deletions', value: String(patch.deletions) },
    ]),
    fileLinks,
    fileSections,
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
              '<div class="meta">Шаг ' + String(stepGroup.stepIndex + 1) + ' · ' + escapeHtml(stepGroup.tool) + '</div>',
              '<div class="list">',
              stepGroup.artifacts
                .map((artifactItem) => {
                  const selected = artifactItem.artifact.id === state.selectedArtifactId ? ' selected' : '';
                  return [
                    '<button type="button" class="card artifact-card' + selected + '" data-artifact-id="' + escapeHtml(artifactItem.artifact.id) + '">',
                    '<div class="card-title">',
                    '<div class="stack gap-xs">',
                    '<strong>' + escapeHtml(artifactItem.summary.title) + '</strong>',
                    '<div class="meta mono">' + escapeHtml(artifactItem.artifact.id) + '</div>',
                    '</div>',
                    renderPill(artifactItem.artifact.tool, ''),
                    '</div>',
                    '<div class="summary-text">' + escapeHtml(artifactItem.summary.summary) + '</div>',
                    '<div class="meta">' + escapeHtml(formatRelativeTime(artifactItem.artifact.created_at)) + '</div>',
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
    ? [
        '<section class="panel stack">',
        '<div class="toolbar spread">',
        '<div class="stack gap-xs">',
        '<div class="eyebrow">Артефакт</div>',
        '<h2>' + escapeHtml(artifactContent.summary.title) + '</h2>',
        '<div class="meta mono">' + escapeHtml(artifactContent.artifact.path) + '</div>',
        '</div>',
        renderPill(artifactContent.artifact.type, ''),
        '</div>',
        createKeyFacts([
          { label: 'task', value: artifactContent.artifact.taskId },
          { label: 'run', value: artifactContent.artifact.runId },
          { label: 'step', value: String(artifactContent.artifact.stepIndex + 1) },
          { label: 'tool', value: artifactContent.artifact.tool },
        ]),
        '<div class="toolbar"><a class="button secondary" href="/task/' + encodeURIComponent(artifactContent.artifact.taskId) + '">К задаче</a><a class="button secondary" href="/run/' + encodeURIComponent(artifactContent.artifact.runId) + '">К запуску</a></div>',
        '<div class="summary-text">' + escapeHtml(artifactContent.summary.summary) + '</div>',
        createKeyFacts(artifactContent.summary.facts),
        artifactContent.summary.changedFiles.length > 0
          ? '<div><div class="section-heading">Изменённые файлы</div>' + createBulletList(artifactContent.summary.changedFiles) + '</div>'
          : '',
        renderPatchPreview(artifactContent.summary.patch),
        createRawDetails(copy.rawDetails + ': artifact content', artifactContent.summary.rawJson || artifactContent.summary.rawText),
        '</section>',
      ].join('')
    : '<section class="panel stack"><div class="empty">Выберите артефакт для просмотра.</div></section>';

  return [
    '<section class="split">',
    '<section class="panel stack artifact-browser-panel"><div class="toolbar spread"><h2>Артефакты</h2>' + renderPill('task scope', '') + '</div>' + renderPager('artifacts', artifactBrowser ? artifactBrowser.page : null) + '<div class="list">' + artifactList + '</div></section>',
    '<section class="stack artifact-preview-panel">' + artifactPreview + '</section>',
    '</section>',
  ].join('');
}
`.trim();
