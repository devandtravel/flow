export const dashboardDialogsScript = `
const dialogState = {
  open: false,
  title: '',
  message: '',
  confirmLabel: '',
  cancelLabel: '',
  tone: 'default',
  resolve: null,
};

function getDialogRoot() {
  const root = document.getElementById('dialogRoot');
  if (!(root instanceof HTMLElement)) {
    throw new Error('Missing UI element: dialogRoot');
  }
  return root;
}

function closeDialog(result) {
  if (typeof dialogState.resolve === 'function') {
    dialogState.resolve(result);
  }
  dialogState.open = false;
  dialogState.title = '';
  dialogState.message = '';
  dialogState.confirmLabel = '';
  dialogState.cancelLabel = '';
  dialogState.tone = 'default';
  dialogState.resolve = null;
  syncDialog();
}

function syncDialog() {
  const root = getDialogRoot();
  if (!dialogState.open) {
    root.innerHTML = '';
    return;
  }

  const toneClass = dialogState.tone === 'danger'
    ? ' danger'
    : dialogState.tone === 'warning'
      ? ' warning'
      : '';

  root.innerHTML = [
    '<div class="dialog-backdrop" data-dialog-dismiss="true">',
    '<section class="dialog-panel' + toneClass + '" role="dialog" aria-modal="true" aria-labelledby="dialogTitle" aria-describedby="dialogMessage">',
    '<div class="stack gap-xs">',
    '<div class="eyebrow">' + escapeHtml(copy.confirmationLabel) + '</div>',
    '<h2 id="dialogTitle">' + escapeHtml(dialogState.title) + '</h2>',
    '<div id="dialogMessage" class="summary-text">' + escapeHtml(dialogState.message) + '</div>',
    '</div>',
    '<div class="toolbar dialog-actions">',
    '<button type="button" class="button secondary" data-dialog-cancel="true">' + escapeHtml(dialogState.cancelLabel) + '</button>',
    '<button type="button" class="button' + toneClass + '" data-dialog-confirm="true">' + escapeHtml(dialogState.confirmLabel) + '</button>',
    '</div>',
    '</section>',
    '</div>',
  ].join('');

  const confirmButton = root.querySelector('[data-dialog-confirm="true"]');
  if (confirmButton instanceof HTMLButtonElement) {
    confirmButton.focus();
  }
}

function openConfirmDialog(options) {
  return new Promise((resolve) => {
    dialogState.open = true;
    dialogState.title = typeof options.title === 'string' ? options.title : copy.confirmationLabel;
    dialogState.message = typeof options.message === 'string' ? options.message : '';
    dialogState.confirmLabel = typeof options.confirmLabel === 'string' ? options.confirmLabel : copy.confirmAction;
    dialogState.cancelLabel = typeof options.cancelLabel === 'string' ? options.cancelLabel : copy.cancelAction;
    dialogState.tone = options.tone === 'danger' || options.tone === 'warning' ? options.tone : 'default';
    dialogState.resolve = resolve;
    syncDialog();
  });
}
`.trim();
