export const dashboardStyles = `
:root {
  color-scheme: dark;
  --bg: #091018;
  --bg-soft: #0f1823;
  --panel: rgba(15, 24, 35, 0.88);
  --panel-strong: rgba(21, 33, 48, 0.94);
  --panel-highlight: rgba(28, 43, 61, 0.96);
  --border: rgba(151, 180, 210, 0.15);
  --border-strong: rgba(116, 176, 232, 0.28);
  --text: #eef5ff;
  --muted: #94a9be;
  --accent: #62c0ff;
  --accent-strong: #7dd1ff;
  --success: #5fd694;
  --warning: #f4c363;
  --danger: #ff8f8f;
  --shadow-xl: 0 28px 64px rgba(0, 0, 0, 0.34);
  --shadow-md: 0 16px 36px rgba(0, 0, 0, 0.22);
  --radius-xl: 20px;
  --radius-lg: 16px;
  --radius-md: 12px;
  --page-pad: 18px;
  --stack-gap: 14px;
  --panel-pad: 16px;
  --card-pad: 12px;
  --max-main-width: 1480px;
  --font: "Avenir Next", "SF Pro Display", "Segoe UI", sans-serif;
  --mono: "SF Mono", "JetBrains Mono", monospace;
}

body.compact {
  --page-pad: 16px;
  --stack-gap: 12px;
  --panel-pad: 14px;
  --card-pad: 10px;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  min-height: 100vh;
  font-family: var(--font);
  background:
    radial-gradient(circle at top left, rgba(98, 192, 255, 0.18), transparent 28%),
    radial-gradient(circle at top right, rgba(95, 214, 148, 0.1), transparent 24%),
    radial-gradient(circle at bottom left, rgba(244, 195, 99, 0.1), transparent 20%),
    linear-gradient(180deg, #071018 0%, var(--bg) 100%);
  color: var(--text);
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  -webkit-tap-highlight-color: transparent;
}

.layout {
  display: grid;
  grid-template-columns: clamp(304px, 22vw, 360px) minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar,
.content {
  padding: var(--page-pad);
  min-width: 0;
}

.sidebar {
  background: rgba(6, 11, 18, 0.7);
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px);
  display: grid;
  align-content: start;
  gap: var(--stack-gap);
  overflow: hidden;
}

.content {
  display: grid;
  gap: var(--stack-gap);
  min-width: 0;
  align-content: start;
  justify-items: stretch;
}

.content > * {
  width: min(100%, var(--max-main-width));
}

.layout > *,
.sidebar > *,
.content > *,
.grid > *,
.grid.two > *,
.split > *,
.filter-grid > *,
.status-strip > *,
.kpi-grid > * {
  min-width: 0;
}

.brand,
.stack {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.gap-xs {
  gap: 4px;
}

.brand h1,
.panel h2,
.panel h3 {
  margin: 0;
}

.brand p,
.muted,
.meta {
  color: var(--muted);
  overflow-wrap: anywhere;
}

.brand h1 {
  font-size: clamp(28px, 3vw, 42px);
  line-height: 0.96;
  letter-spacing: -0.04em;
  overflow-wrap: anywhere;
}

.eyebrow {
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-strong);
}

.panel {
  background: linear-gradient(180deg, rgba(21, 33, 48, 0.86), rgba(15, 24, 35, 0.96));
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: var(--panel-pad);
  box-shadow: var(--shadow-md);
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.panel-accent {
  background:
    radial-gradient(circle at top right, rgba(98, 192, 255, 0.12), transparent 32%),
    linear-gradient(180deg, rgba(27, 41, 58, 0.96), rgba(15, 24, 35, 0.96));
  border-color: var(--border-strong);
}

.hero-panel {
  background:
    radial-gradient(circle at top left, rgba(98, 192, 255, 0.18), transparent 26%),
    radial-gradient(circle at right center, rgba(95, 214, 148, 0.08), transparent 24%),
    linear-gradient(180deg, rgba(22, 35, 49, 0.96), rgba(14, 23, 34, 0.98));
  box-shadow: var(--shadow-xl);
}

.hero-copy {
  max-width: 760px;
}

.hero-copy h2 {
  font-size: 24px;
  line-height: 1.05;
}

.grid {
  display: grid;
  gap: var(--stack-gap);
}

.grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.filter-panel h3 {
  margin: 0;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.toolbar a {
  text-decoration: none;
}

.toolbar.spread {
  justify-content: space-between;
}

.field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.field label {
  font-size: 13px;
  color: var(--muted);
}

.field input,
.field textarea,
.field select {
  width: 100%;
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: rgba(8, 14, 20, 0.62);
  color: var(--text);
  padding: 12px 14px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.field input:focus,
.field textarea:focus,
.field select:focus {
  outline: none;
  border-color: rgba(125, 209, 255, 0.5);
  box-shadow: 0 0 0 4px rgba(98, 192, 255, 0.12);
  background: rgba(10, 16, 24, 0.84);
}

.field textarea {
  min-height: 132px;
  resize: vertical;
}

.button {
  border: 0;
  border-radius: 14px;
  padding: 9px 13px;
  color: #07111a;
  background: linear-gradient(180deg, var(--accent-strong), var(--accent));
  cursor: pointer;
  font-weight: 700;
  transition: transform 0.14s ease, opacity 0.14s ease, box-shadow 0.14s ease;
}

.button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(98, 192, 255, 0.18);
}

.button.secondary {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

.button.warning {
  background: var(--warning);
}

.button.danger {
  background: var(--danger);
}

.button.ghost {
  background: transparent;
  color: var(--accent-strong);
  border: 1px solid rgba(98, 192, 255, 0.3);
}

.button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
  font-size: 12px;
  white-space: nowrap;
}

.pill.success {
  background: rgba(95, 214, 148, 0.16);
  color: #dbffea;
}

.pill.warning {
  background: rgba(244, 195, 99, 0.16);
  color: #fff0c5;
}

.pill.danger {
  background: rgba(255, 143, 143, 0.16);
  color: #ffe1e1;
}

.tabs {
  gap: 12px;
}

.tab-button {
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  padding: 12px 16px;
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease;
}

.tab-button:hover {
  transform: translateY(-1px);
  color: var(--text);
}

.tab-button.active {
  background: rgba(98, 192, 255, 0.12);
  border-color: rgba(98, 192, 255, 0.28);
  color: var(--text);
}

.list {
  display: grid;
  gap: 10px;
}

.card {
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(8, 14, 20, 0.48);
  border-radius: var(--radius-lg);
  padding: var(--card-pad);
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.card-soft {
  background: rgba(255, 255, 255, 0.03);
}

.card.selected {
  border-color: rgba(98, 192, 255, 0.48);
  box-shadow: 0 0 0 1px rgba(98, 192, 255, 0.2) inset;
}

.task-card,
.artifact-card {
  text-align: left;
  transition: transform 0.14s ease, border-color 0.14s ease, background 0.14s ease;
}

.task-card strong,
.artifact-card strong,
.summary-text,
.meta,
.fact-value,
.detail-row dd {
  overflow-wrap: anywhere;
}

.task-card:hover,
.artifact-card:hover {
  transform: translateY(-1px);
  border-color: rgba(98, 192, 255, 0.32);
}

.task-card {
  display: grid;
  gap: 12px;
}

.task-card-main {
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.task-card-actions {
  display: flex;
  justify-content: flex-end;
}

.task-delete-button {
  width: 100%;
}

body.compact .task-card {
  gap: 10px;
}

.artifact-card {
  background: linear-gradient(180deg, rgba(11, 18, 27, 0.78), rgba(8, 14, 20, 0.62));
}

.card-title {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  min-width: 0;
}

.card-title strong {
  display: block;
  overflow-wrap: anywhere;
}

.task-goal-clamp,
.task-heading-clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.task-goal-clamp {
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.task-heading-clamp {
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.mono,
pre,
code {
  font-family: var(--mono);
}

pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.notification {
  border-radius: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.notification.error {
  background: rgba(255, 143, 143, 0.12);
  border-color: rgba(255, 143, 143, 0.22);
  color: #ffe6e6;
}

.status-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.status-card {
  border-radius: var(--radius-lg);
  padding: 16px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.status-value {
  margin-top: 8px;
  font-size: 14px;
  font-weight: 700;
  min-height: 28px;
  display: flex;
  align-items: center;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.kpi {
  border-radius: var(--radius-lg);
  padding: 16px;
  background: rgba(8, 14, 20, 0.46);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.kpi-value {
  margin-top: 8px;
  font-size: 22px;
  font-weight: 800;
}

.fact-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}

.fact-card {
  border-radius: 14px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.fact-label {
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.fact-value {
  margin-top: 6px;
  font-size: 15px;
  font-weight: 700;
  word-break: break-word;
}

.detail-list {
  display: grid;
  gap: 8px;
  margin: 0;
}

.detail-row {
  display: grid;
  grid-template-columns: minmax(120px, 180px) minmax(0, 1fr);
  gap: 12px;
}

.detail-row dt {
  color: var(--muted);
}

.detail-row dd {
  margin: 0;
}

.bullet-list {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
}

.summary-block {
  display: grid;
  gap: 6px;
}

.task-header-panel {
  gap: calc(var(--stack-gap) - 2px);
}

.run-summary-card {
  min-height: 100%;
  text-align: left;
  cursor: pointer;
}

.run-summary-card:hover {
  border-color: rgba(98, 192, 255, 0.32);
}

.summary-title,
.section-heading {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent-strong);
}

.summary-text {
  line-height: 1.5;
}

.section-group {
  gap: 14px;
}

.raw-details {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 10px;
}

.raw-details summary {
  cursor: pointer;
  color: var(--muted);
}

.event-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius-lg);
  border-left: 3px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.event-card.info {
  border-left-color: var(--accent);
}

.event-card.warning {
  border-left-color: var(--warning);
}

.event-card.error {
  border-left-color: var(--danger);
}

.empty {
  color: var(--muted);
  padding: 24px 0;
}

.artifact-group,
.artifact-step-group {
  display: grid;
  gap: 10px;
}

.artifact-browser-panel,
.artifact-preview-panel,
.run-view-panel {
  min-height: 100%;
}

.artifact-filter-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.patch-file-card {
  gap: 12px;
}

.patch-tree {
  display: grid;
  gap: 12px;
}

.patch-tree-card {
  gap: 8px;
}

.patch-tree-link {
  color: var(--accent-strong);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.patch-tree-link:hover {
  text-decoration: underline;
}

.patch-tree-hunks {
  display: grid;
  gap: 6px;
  padding-left: 10px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.patch-hunk {
  display: grid;
  gap: 0;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  overflow: hidden;
  background: rgba(7, 12, 19, 0.62);
}

.patch-hunk-header {
  padding: 10px 12px;
  background: rgba(98, 192, 255, 0.08);
  color: var(--accent-strong);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.patch-lines {
  display: grid;
}

.patch-line {
  display: grid;
  grid-template-columns: 56px 56px 20px minmax(0, 1fr);
  gap: 10px;
  padding: 6px 12px;
  align-items: start;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.patch-line:first-child {
  border-top: 0;
}

.patch-line.context {
  background: rgba(255, 255, 255, 0.02);
}

.patch-line.add {
  background: rgba(95, 214, 148, 0.12);
}

.patch-line.delete {
  background: rgba(255, 143, 143, 0.12);
}

.patch-line-number,
.patch-line-prefix {
  font-family: var(--mono);
  color: var(--muted);
  font-size: 12px;
}

.patch-line-content {
  font-family: var(--mono);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
}

.delta {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 8px;
  font-family: var(--mono);
  font-size: 12px;
}

.delta.add {
  background: rgba(95, 214, 148, 0.16);
  color: #dbffea;
}

.delta.delete {
  background: rgba(255, 143, 143, 0.16);
  color: #ffe1e1;
}

.group-heading {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}

.pager {
  justify-content: flex-start;
  margin-bottom: 8px;
}

.split {
  display: grid;
  gap: var(--stack-gap);
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  align-items: start;
}

@media (max-width: 1280px) {
  .layout {
    grid-template-columns: clamp(280px, 28vw, 320px) minmax(0, 1fr);
  }

  .status-strip,
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filter-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1320px) {
  .layout,
  .grid.two,
  .split {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
}

@media (max-width: 720px) {
  .sidebar,
  .content {
    padding: 18px;
  }

  .hero-copy h2 {
    font-size: 28px;
  }

  .status-strip,
  .kpi-grid {
    grid-template-columns: 1fr;
  }

  .detail-row {
    grid-template-columns: 1fr;
  }

  .patch-line {
    grid-template-columns: 48px 48px 18px minmax(0, 1fr);
    gap: 8px;
    padding: 6px 10px;
  }
}
`.trim();
