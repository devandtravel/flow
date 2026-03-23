export const dashboardLogsScript = `
function renderLogSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    return '';
  }

  return [
    '<section class="panel stack">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">' + escapeHtml(copy.runtimeLogLabel) + '</div>',
    '<h2>' + escapeHtml(copy.runtimeLogTitle) + '</h2>',
    '<div class="meta">' + escapeHtml(copy.runtimeLogSubtitle) + '</div>',
    '</div>',
    '</div>',
    createKeyFacts([
      { label: copy.logTotalEntries, value: typeof summary.totalEntries === 'number' ? String(summary.totalEntries) : '0' },
      { label: copy.logInfoEntries, value: typeof summary.infoEntries === 'number' ? String(summary.infoEntries) : '0' },
      { label: copy.logWarningEntries, value: typeof summary.warningEntries === 'number' ? String(summary.warningEntries) : '0' },
      { label: copy.logErrorEntries, value: typeof summary.errorEntries === 'number' ? String(summary.errorEntries) : '0' },
      { label: copy.logLastEntryAt, value: typeof summary.lastEntryAt === 'string' && summary.lastEntryAt.length > 0 ? formatRelativeTime(summary.lastEntryAt) : 'n/a' },
    ]),
    summary.categories && typeof summary.categories === 'object'
      ? createDetailList(Object.entries(summary.categories).map((entry) => ({
          label: entry[0],
          value: String(entry[1]),
        })))
      : '',
    '</section>',
  ].join('');
}

function renderLogEntries(logs) {
  if (!logs || !Array.isArray(logs.entries) || logs.entries.length === 0) {
    return '<div class="empty">' + escapeHtml(copy.noLogs) + '</div>';
  }

  return '<div class="stack">' + logs.entries.map((entry) => [
    '<article class="event-card ' + escapeHtml(entry.level) + '">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<strong>' + escapeHtml(entry.title) + '</strong>',
    entry.summary ? '<div class="meta">' + escapeHtml(entry.summary) + '</div>' : '',
    '</div>',
    entry.time ? '<span class="meta mono">' + escapeHtml(formatDateTime(entry.time)) + '</span>' : '',
    '</div>',
    createKeyFacts(Array.isArray(entry.facts) ? entry.facts : []),
    entry.details ? createRawDetails(copy.rawDetails + ': log entry', entry.details) : '',
    '</article>',
  ].join('')).join('') + '</div>';
}

function renderLogs(logs) {
  if (!logs) {
    return '<section class="panel stack"><div class="empty">' + escapeHtml(copy.noLogs) + '</div></section>';
  }

  return [
    renderLogSummary(logs.summary),
    '<section class="panel stack">',
    '<div class="toolbar spread">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">' + escapeHtml(copy.runtimeLogFeedLabel) + '</div>',
    '<h2>' + escapeHtml(copy.runtimeLogFeedTitle) + '</h2>',
    '<div class="meta mono">' + escapeHtml(logs.path) + '</div>',
    '</div>',
    '<div class="meta">' + escapeHtml(copy.runtimeLogFeedLimit.replace('{count}', String(logs.limit))) + '</div>',
    '</div>',
    renderLogEntries(logs),
    '</section>',
  ].join('');
}
`.trim();
