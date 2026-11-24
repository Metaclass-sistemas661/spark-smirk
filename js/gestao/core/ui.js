/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — UI Helpers (Icons, Modal, Toast)
   ═══════════════════════════════════════════════════════════ */

import { escapeHtml, formatCurrency, formatEuroInputValue } from './formatters.js';

export const ICONS = {
  users:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  receipt:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/></svg>',
  building:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20"/><path d="M5 20V8.5L12 4l7 4.5V20"/><path d="M9 20v-5h6v5"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  checkCircle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  edit:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  eye:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  paperclip:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  euro:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/></svg>',
  chart:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  alert:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};

export function showToast(message, variant = 'success', durationMs = 3400) {
  const stack = document.getElementById('erpToastStack');
  if (!stack) return;

  const toast = document.createElement('div');
  toast.className = `erp-toast erp-toast--${variant}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  stack.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 220);
  }, durationMs);
}

export function showBalanceNotification({ projectLabel, invoiceNumber, invoiceAmount, remainingBudget, budgetTotal }) {
  const stack = document.getElementById('erpToastStack');
  if (!stack) return;

  const isOver = budgetTotal > 0 && remainingBudget < -0.009;
  const spentPct = budgetTotal > 0 ? Math.round(((budgetTotal - remainingBudget) / budgetTotal) * 100) : 0;
  const isWarn = !isOver && budgetTotal > 0 && spentPct >= 80;
  const variant = isOver ? 'danger' : isWarn ? 'warning' : 'success';

  const toast = document.createElement('div');
  toast.className = `erp-toast erp-toast--${variant} erp-toast--balance`;
  toast.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:3px;">
      <strong style="font-size:13px;">Fatura ${escapeHtml(invoiceNumber || '')} lançada · ${escapeHtml(projectLabel || 'Obra')}</strong>
      <span style="font-size:12.5px;">Abatido: <strong>${escapeHtml(formatCurrency(invoiceAmount))}</strong> · O saldo desta obra é <strong style="text-decoration:underline;">${escapeHtml(formatCurrency(remainingBudget))}</strong></span>
    </div>
  `;
  stack.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 240);
  }, 6500);
}

export function applyEuroMaskToInput(input) {
  if (!input || input.dataset.euroMaskBound === '1') return;
  input.dataset.euroMaskBound = '1';

  const formatFromDigits = () => {
    const digits = String(input.value || '').replace(/\D/g, '').slice(0, 13);
    if (!digits) {
      input.value = '';
      return;
    }
    const numeric = Number(digits) / 100;
    input.value = formatEuroInputValue(numeric);
  };

  // Formata valor inicial caso tenha vindo numérico ou não formatado
  if (input.value !== '' && !String(input.value).includes(',')) {
    const num = Number(input.value);
    if (!Number.isNaN(num) && num > 0) {
      input.value = formatEuroInputValue(num);
    } else if (num === 0 && input.dataset.allowZero === '1') {
      input.value = formatEuroInputValue(0);
    } else {
      input.value = '';
    }
  }

  input.addEventListener('input', formatFromDigits);
  input.addEventListener('focus', () => {
    if (typeof input.setSelectionRange === 'function') {
      const len = input.value.length;
      window.setTimeout(() => input.setSelectionRange(len, len), 0);
    }
  });
}

export function attachEuroMasks(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll('[data-currency-euro]').forEach((inp) => {
    applyEuroMaskToInput(inp);
  });
}

export function openModal({ title, subtitle = '', bodyHtml, footerHtml = '', size = 'default', onMount }) {
  const overlay = document.getElementById('erpModalOverlay');
  const modal = document.getElementById('erpModal');
  if (!overlay || !modal) return;

  modal.className = 'erp-modal';
  if (size === 'wide') modal.classList.add('erp-modal--wide');
  if (size === 'narrow') modal.classList.add('erp-modal--narrow');

  modal.innerHTML = `
    <div class="erp-modal__header">
      <div>
        <h2 class="erp-modal__title">${escapeHtml(title)}</h2>
        ${subtitle ? `<p class="erp-modal__subtitle">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      <button type="button" class="erp-icon-btn" data-modal-close aria-label="Fechar janela">
        ${ICONS.close}
      </button>
    </div>
    <div class="erp-modal__body">${bodyHtml}</div>
    ${footerHtml ? `<div class="erp-modal__footer">${footerHtml}</div>` : ''}
  `;

  overlay.classList.add('is-open');
  document.body.style.overflow = 'hidden';

  modal.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', closeModal);
  });

  attachEuroMasks(modal);

  if (typeof onMount === 'function') {
    onMount(modal);
    attachEuroMasks(modal);
  }
}

export function closeModal() {
  const overlay = document.getElementById('erpModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('is-open');
  document.body.style.overflow = '';
}

export function confirmAction({ title, message, confirmLabel = 'Eliminar', onConfirm }) {
  openModal({
    title,
    size: 'narrow',
    bodyHtml: `<p style="font-size:13.5px;color:var(--erp-text-secondary);line-height:1.6;">${escapeHtml(message)}</p>`,
    footerHtml: `
      <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
      <button type="button" class="erp-btn erp-btn--danger" id="erpConfirmBtn">${escapeHtml(confirmLabel)}</button>
    `,
    onMount: (modal) => {
      modal.querySelector('#erpConfirmBtn').addEventListener('click', () => {
        closeModal();
        onConfirm();
      });
    },
  });
}
