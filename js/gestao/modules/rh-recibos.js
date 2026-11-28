/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — RH: Recibos de Vencimento & Lista Anual
   ═══════════════════════════════════════════════════════════ */

import {
  store,
  saveAttachmentFile,
  getAttachmentFile,
} from '../core/store.js';
import {
  TWELFTHS_OPTIONS,
  computeEmployeeMonthlyPayroll,
  computeTwelfthsBreakdown,
  downloadCSV,
  escapeHtml,
  formatCurrency,
  formatEuroInputValue,
  formatDatePT,
  formatMonthLabel,
  generateId,
  getInitials,
  normalizeTwelfthsMode,
  parseCurrencyInput,
  todayISO,
} from '../core/formatters.js';
import { ICONS, openModal, closeModal, confirmAction, showToast } from '../core/ui.js';

const MONTHS_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export class RhRecibosModule {
  constructor() {
    this.viewMode = 'list'; // 'list' | 'annual'
    this.periodMode = 'year'; // 'year' | 'month' | 'all'
    this.yearFilter = String(new Date().getFullYear());
    this.employeeFilter = 'all';
    this.statusFilter = 'all';
  }

  openNewPayslip(defaultMonth, defaultEmpId = null) {
    this._openPayslipModal(null, defaultMonth, defaultEmpId);
  }

  focusEmployeeYear(empId, year) {
    this.employeeFilter = empId;
    this.periodMode = 'year';
    if (year) this.yearFilter = String(year);
    this.viewMode = 'annual';
  }

  _availableYears(payslips, attachedReceipts, currentMonth) {
    const years = new Set([
      String(new Date().getFullYear()),
      String(currentMonth || '').slice(0, 4),
    ]);
    [...payslips, ...(attachedReceipts || [])].forEach((p) => {
      if (p.month && p.month.length >= 4) {
        years.add(p.month.slice(0, 4));
      }
    });
    return [...years].filter(Boolean).sort((a, b) => b.localeCompare(a));
  }

  render(container, ctx) {
    const state = store.getState();
    const { month, search } = ctx;
    const query = (search || '').trim().toLowerCase();
    const attachedReceipts = state.attachedReceipts || [];
    const years = this._availableYears(state.payslips, attachedReceipts, month);
    if (!years.includes(this.yearFilter)) {
      this.yearFilter = years[0] || String(new Date().getFullYear());
    }

    const empMap = new Map(state.employees.map((e) => [e.id, e]));

    const filtered = state.payslips
      .filter((p) => {
        if (this.periodMode === 'month' && p.month !== month) return false;
        if (this.periodMode === 'year' && !String(p.month || '').startsWith(this.yearFilter)) return false;
        if (this.employeeFilter !== 'all' && p.employeeId !== this.employeeFilter) return false;
        if (this.statusFilter !== 'all' && p.status !== this.statusFilter) return false;
        if (query) {
          const emp = empMap.get(p.employeeId);
          const hay = `${p.id} ${p.month} ${emp?.name || ''} ${emp?.nif || ''}`.toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => String(b.month).localeCompare(String(a.month)));

    const filteredAttachments = attachedReceipts.filter((r) => {
      if (this.periodMode === 'month' && r.month !== month) return false;
      if (this.periodMode === 'year' && !String(r.month || '').startsWith(this.yearFilter)) return false;
      if (this.employeeFilter !== 'all' && r.employeeId !== this.employeeFilter) return false;
      return true;
    });

    const totalGross = filtered.reduce(
      (s, p) =>
        s +
        (Number(p.baseSalary) || 0) +
        (Number(p.mealAllowanceTotal) || 0) +
        (Number(p.twelfthVacation) || 0) +
        (Number(p.twelfthChristmas) || 0) +
        (Number(p.overtimeBonus) || 0),
      0
    );
    const totalDeductions = filtered.reduce(
      (s, p) => s + (Number(p.socialSecurity) || 0) + (Number(p.irsRetention) || 0) + (Number(p.otherDeductions) || 0),
      0
    );
    const totalOffPayroll = filtered.reduce((s, p) => s + (Number(p.offPayroll) || 0), 0);
    const totalNet = filtered.reduce((s, p) => s + (Number(p.netSalary) || 0), 0);

    const periodLabel =
      this.periodMode === 'month'
        ? formatMonthLabel(month)
        : this.periodMode === 'year'
          ? `Ano Inteiro (${this.yearFilter})`
          : 'Todo o Histórico';

    container.innerHTML = `
      <div class="erp-kpi-grid">
        <div class="erp-kpi-card erp-kpi-card--primary">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Total Ilíquido (Recibo)</span>
            <span class="erp-kpi-card__icon">${ICONS.receipt}</span>
          </div>
          <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalGross))}</div>
          <div class="erp-kpi-card__meta">${filtered.length} vencimento(s) · ${escapeHtml(periodLabel)}</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--warning">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Retenções (SS + IRS + Vales)</span>
            <span class="erp-kpi-card__icon">${ICONS.chart}</span>
          </div>
          <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalDeductions))}</div>
          <div class="erp-kpi-card__meta">Descontos aplicados ao valor em recibo</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--success">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Total Final Pago (Líquido)</span>
            <span class="erp-kpi-card__icon">${ICONS.euro}</span>
          </div>
          <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalNet))}</div>
          <div class="erp-kpi-card__meta">${totalOffPayroll > 0 ? `Inclui ${escapeHtml(formatCurrency(totalOffPayroll))} por fora SS` : 'Valor final liquidado (Recibo + Por Fora SS)'}</div>
        </div>

        <div class="erp-kpi-card">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Recibos na Lista do Ano</span>
            <span class="erp-kpi-card__icon">${ICONS.paperclip}</span>
          </div>
          <div class="erp-kpi-card__value">${filteredAttachments.length}</div>
          <div class="erp-kpi-card__meta">Ficheiros arquivados por mês</div>
        </div>
      </div>

      <div class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-subtabs" role="tablist">
            <button type="button" class="erp-subtab ${this.viewMode === 'list' ? 'is-active' : ''}" data-pay-view="list">
              ${ICONS.receipt}
              <span>Processamento de Vencimentos</span>
              <span class="erp-subtab__badge">${filtered.length}</span>
            </button>
            <button type="button" class="erp-subtab ${this.viewMode === 'annual' ? 'is-active' : ''}" data-pay-view="annual">
              ${ICONS.calendar}
              <span>Lista do Ano (Recibos Anexados)</span>
              <span class="erp-subtab__badge">${filteredAttachments.length}</span>
            </button>
          </div>

          <div class="erp-panel__actions">
            <button type="button" class="erp-btn erp-btn--outline" id="btnExportPayslipsCsv">
              ${ICONS.download}
              <span>Exportar CSV</span>
            </button>
            ${
              (ctx.can ? ctx.can('rh_recibos', 'emitir') : true)
                ? `<button type="button" class="erp-btn erp-btn--primary" id="btnNewPayslip">
                    ${ICONS.plus}
                    <span>Emitir Vencimento</span>
                  </button>`
                : ''
            }
          </div>
        </div>

        <div id="payViewBody"></div>
      </div>
    `;

    this._can = ctx.can || (() => true);

    container.querySelectorAll('[data-pay-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.viewMode = btn.dataset.payView;
        this.render(container, ctx);
      });
    });

    container.querySelector('#btnNewPayslip')?.addEventListener('click', () => {
      const targetEmp = this.employeeFilter !== 'all' ? this.employeeFilter : null;
      this._openPayslipModal(null, month, targetEmp);
    });

    container.querySelector('#btnExportPayslipsCsv').addEventListener('click', () => {
      this._exportPayslipsCSV(filtered, empMap, periodLabel);
    });

    const body = container.querySelector('#payViewBody');
    if (this.viewMode === 'annual') {
      this._renderAnnualGrid(body, state, empMap, years, attachedReceipts);
    } else {
      this._renderPayslipList(body, state, filtered, empMap, years, month);
    }
  }

  _renderPayslipList(target, state, filtered, empMap, years, currentMonth) {
    target.innerHTML = `
      <div class="erp-attendance-controls">
        <div class="erp-filter-bar">
          <select class="erp-select-sm" id="filterPayPeriod" title="Período">
            <option value="year" ${this.periodMode === 'year' ? 'selected' : ''}>Ano Inteiro</option>
            <option value="month" ${this.periodMode === 'month' ? 'selected' : ''}>Mês Selecionado (${escapeHtml(currentMonth)})</option>
            <option value="all" ${this.periodMode === 'all' ? 'selected' : ''}>Todos os Anos</option>
          </select>

          ${
            this.periodMode === 'year'
              ? `<select class="erp-select-sm" id="filterPayYear" title="Ano">
                   ${years.map((y) => `<option value="${escapeHtml(y)}" ${this.yearFilter === y ? 'selected' : ''}>Ano ${escapeHtml(y)}</option>`).join('')}
                 </select>`
              : ''
          }

          <select class="erp-select-sm" id="filterPayslipEmp" title="Funcionário">
            <option value="all">Todos os Funcionários</option>
            ${state.employees
              .map((e) => `<option value="${escapeHtml(e.id)}" ${this.employeeFilter === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`)
              .join('')}
          </select>

          <select class="erp-select-sm" id="filterPayslipStatus" title="Estado do Pagamento">
            <option value="all" ${this.statusFilter === 'all' ? 'selected' : ''}>Pagamento: Todos</option>
            <option value="pago" ${this.statusFilter === 'pago' ? 'selected' : ''}>Pago</option>
            <option value="pendente" ${this.statusFilter === 'pendente' ? 'selected' : ''}>Pendente</option>
          </select>
        </div>

        ${
          this.employeeFilter !== 'all' || this.statusFilter !== 'all'
            ? `<button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnClearPayFilters">Limpar Filtros</button>`
            : ''
        }
      </div>

      ${
        filtered.length === 0
          ? `<div class="erp-empty">${ICONS.receipt}<div class="erp-empty__title">Nenhum vencimento encontrado</div><p>Altere os filtros ou clique em "Emitir Vencimento".</p></div>`
          : `
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Mês / Referência</th>
                <th>Funcionário</th>
                <th>Base + Sub. Alim.</th>
                <th>Descontos (SS / IRS)</th>
                <th>Líquido</th>
                <th>Anexar Recibo</th>
                <th>Estado / Data</th>
                <th style="text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map((p) => {
                  const emp = empMap.get(p.employeeId);
                  const twelfthsVal = (Number(p.twelfthVacation) || 0) + (Number(p.twelfthChristmas) || 0);
                  const totalDesc = (Number(p.socialSecurity) || 0) + (Number(p.irsRetention) || 0) + (Number(p.otherDeductions) || 0);
                  return `
                  <tr>
                    <td>
                      <div class="erp-cell-title">${escapeHtml(formatMonthLabel(p.month))}</div>
                      <div class="erp-cell-sub">${escapeHtml(p.id)}</div>
                    </td>
                    <td>
                      <div class="erp-person-cell">
                        <span class="erp-avatar">${escapeHtml(getInitials(emp?.name || '?'))}</span>
                        <div>
                          <div class="erp-cell-title">${escapeHtml(emp?.name || 'Funcionário removido')}</div>
                          <div class="erp-cell-sub">NIF ${escapeHtml(emp?.nif || '—')}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="erp-cell-title">${escapeHtml(formatCurrency(p.baseSalary))}</div>
                      <div class="erp-cell-sub">Sub. Alim. ${escapeHtml(formatCurrency(p.mealAllowanceTotal))}${Number(p.overtimeBonus) > 0 ? ` · Extra ${escapeHtml(formatCurrency(p.overtimeBonus))}` : ''}</div>
                      ${Number(p.saturdayCount) > 0 ? `<div class="erp-cell-sub" style="color:var(--erp-accent-dark);font-weight:600;">+ Sábados (${Number(p.saturdayCount)}): Recibo ${escapeHtml(formatCurrency(p.saturdayReceiptTotal || 0))} · Fora ${escapeHtml(formatCurrency(p.saturdayOffTotal || 0))}</div>` : ''}
                      ${twelfthsVal > 0 ? `<div class="erp-cell-sub" style="color:var(--erp-info);font-weight:600;">+ Duodécimos (Fér./Nat.): ${escapeHtml(formatCurrency(twelfthsVal))}</div>` : ''}
                      ${Number(p.offPayroll) > 0 ? `<div class="erp-cell-sub" style="color:var(--erp-accent-dark);font-weight:600;">+ Por fora SS: ${escapeHtml(formatCurrency(p.offPayroll))}</div>` : ''}
                    </td>
                    <td>
                      <div class="erp-cell-title">-${escapeHtml(formatCurrency(totalDesc))}</div>
                      <div class="erp-cell-sub">SS ${escapeHtml(formatCurrency(p.socialSecurity))} · IRS ${escapeHtml(formatCurrency(p.irsRetention))}</div>
                    </td>
                    <td>
                      <div class="erp-cell-title" style="color:var(--erp-success);font-size:14px;">${escapeHtml(formatCurrency(p.netSalary))}</div>
                    </td>
                    <td>
                      <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-quick-attach="${escapeHtml(p.id)}">
                        ${ICONS.paperclip}<span>Anexar Recibo</span>
                      </button>
                    </td>
                    <td>
                      <span class="erp-badge ${p.status === 'pago' ? 'erp-badge--success' : 'erp-badge--warning'}">
                        ${p.status === 'pago' ? 'Pago' : 'Pendente'}
                      </span>
                      <div class="erp-cell-sub" style="margin-top:4px;">${p.paymentDate ? formatDatePT(p.paymentDate) : 'Por liquidar'}</div>
                    </td>
                    <td>
                      <div class="erp-row-actions">
                        <button type="button" class="erp-icon-btn" title="Ver Lista do Ano deste Funcionário" data-go-annual="${escapeHtml(p.employeeId)}" data-go-year="${escapeHtml(String(p.month).slice(0, 4))}">${ICONS.calendar}</button>
                        ${!this._can || this._can('rh_recibos', 'emitir') ? `<button type="button" class="erp-icon-btn" title="Editar Vencimento" data-edit-pay="${escapeHtml(p.id)}">${ICONS.edit}</button>` : ''}
                        ${!this._can || this._can('rh_recibos', 'excluir') ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" title="Excluir Vencimento" data-del-pay="${escapeHtml(p.id)}">${ICONS.trash}</button>` : ''}
                      </div>
                    </td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`
      }
    `;

    target.querySelector('#filterPayPeriod').addEventListener('change', (e) => {
      this.periodMode = e.target.value;
      store._commit();
    });
    const yearEl = target.querySelector('#filterPayYear');
    if (yearEl) {
      yearEl.addEventListener('change', (e) => {
        this.yearFilter = e.target.value;
        store._commit();
      });
    }
    target.querySelector('#filterPayslipEmp').addEventListener('change', (e) => {
      this.employeeFilter = e.target.value;
      store._commit();
    });
    target.querySelector('#filterPayslipStatus').addEventListener('change', (e) => {
      this.statusFilter = e.target.value;
      store._commit();
    });

    const clearBtn = target.querySelector('#btnClearPayFilters');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.employeeFilter = 'all';
        this.statusFilter = 'all';
        this.periodMode = 'year';
        store._commit();
      });
    }

    this._bindPayslipRowEvents(target);
  }

  _renderAnnualGrid(target, state, empMap, years, attachedReceipts) {
    if (state.employees.length === 0) {
      target.innerHTML = `<div class="erp-empty">${ICONS.users}<div class="erp-empty__title">Sem funcionários registados</div></div>`;
      return;
    }

    const activeEmpId =
      this.employeeFilter !== 'all' && empMap.has(this.employeeFilter)
        ? this.employeeFilter
        : state.employees[0].id;
    const emp = empMap.get(activeEmpId);

    const empAttachments = attachedReceipts.filter(
      (r) => r.employeeId === activeEmpId && String(r.month || '').startsWith(this.yearFilter)
    );
    const attByMonth = new Map();
    empAttachments.forEach((r) => {
      if (!attByMonth.has(r.month)) attByMonth.set(r.month, []);
      attByMonth.get(r.month).push(r);
    });

    const empPayslipsByMonth = new Map();
    state.payslips
      .filter((p) => p.employeeId === activeEmpId && String(p.month || '').startsWith(this.yearFilter))
      .forEach((p) => {
        empPayslipsByMonth.set(p.month, p);
      });

    let annualNet = 0;
    let monthsWithFiles = 0;

    const rowsHtml = MONTHS_PT.map((mName, idx) => {
      const ym = `${this.yearFilter}-${String(idx + 1).padStart(2, '0')}`;
      const p = empPayslipsByMonth.get(ym);
      const files = attByMonth.get(ym) || [];
      if (p) annualNet += Number(p.netSalary) || 0;
      if (files.length > 0) monthsWithFiles += 1;

      const filesHtml =
        files.length > 0
          ? `<div style="display:flex;flex-direction:column;gap:6px;">
               ${files
                 .map(
                   (f) => `
                 <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                   <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-view-file="${escapeHtml(f.id)}" title="${escapeHtml(f.fileName)}">
                     ${ICONS.eye}<span>${escapeHtml(f.fileName)}</span>
                   </button>
                   <button type="button" class="erp-icon-btn" title="Descarregar" data-dl-file="${escapeHtml(f.id)}">${ICONS.download}</button>
                   <button type="button" class="erp-icon-btn erp-icon-btn--danger" title="Remover Anexo" data-del-file="${escapeHtml(f.id)}">${ICONS.trash}</button>
                 </div>`
                 )
                 .join('')}
             </div>`
          : `<span class="erp-cell-sub">Nenhum recibo anexado neste mês</span>`;

      return `
        <tr>
          <td>
            <div class="erp-cell-title">${escapeHtml(mName)} ${escapeHtml(this.yearFilter)}</div>
            <div class="erp-cell-sub">${ym}</div>
          </td>
          <td>
            ${
              p
                ? `<span class="erp-badge ${p.status === 'pago' ? 'erp-badge--success' : 'erp-badge--warning'}">
                     ${p.status === 'pago' ? 'Pago' : 'Pendente'}
                   </span>`
                : '<span class="erp-badge erp-badge--neutral">Sem vencimento</span>'
            }
          </td>
          <td>${p ? escapeHtml(formatCurrency(p.netSalary)) : '—'}</td>
          <td>${filesHtml}</td>
          <td style="text-align:right">
            ${
              !this._can || this._can('rh_recibos', 'anexar')
                ? `<button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-attach-month="${escapeHtml(ym)}">
                    ${ICONS.paperclip}<span>Anexar Recibo</span>
                  </button>`
                : '<span style="font-size:11.5px;color:var(--erp-text-muted);">Só leitura</span>'
            }
          </td>
        </tr>`;
    }).join('');

    target.innerHTML = `
      <div class="erp-attendance-controls">
        <div class="erp-filter-bar">
          <label style="font-size:12.5px;font-weight:700;color:var(--erp-heading);">Funcionário:</label>
          <select class="erp-select-sm" id="annualEmpSelect">
            ${state.employees
              .map((e) => `<option value="${escapeHtml(e.id)}" ${activeEmpId === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`)
              .join('')}
          </select>
          <select class="erp-select-sm" id="annualYearSelect">
            ${years.map((y) => `<option value="${escapeHtml(y)}" ${this.yearFilter === y ? 'selected' : ''}>Ano ${escapeHtml(y)}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
          <span class="erp-cell-sub">Meses com anexo em ${escapeHtml(this.yearFilter)}: <strong>${monthsWithFiles} / 12</strong> (${empAttachments.length} ficheiro(s))</span>
          <span class="erp-cell-title" style="color:var(--erp-success);">Líquido Anual: ${escapeHtml(formatCurrency(annualNet))}</span>
        </div>
      </div>

      <div class="erp-table-wrap">
        <table class="erp-table">
          <thead>
            <tr>
              <th>Mês</th>
              <th>Vencimento</th>
              <th>Líquido</th>
              <th>Recibos Anexados — ${escapeHtml(emp.name)}</th>
              <th style="text-align:right">Anexar</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;

    target.querySelector('#annualEmpSelect').addEventListener('change', (e) => {
      this.employeeFilter = e.target.value;
      store._commit();
    });
    target.querySelector('#annualYearSelect').addEventListener('change', (e) => {
      this.yearFilter = e.target.value;
      store._commit();
    });
    target.querySelectorAll('[data-attach-month]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._openQuickAttachModal(activeEmpId, btn.dataset.attachMonth);
      });
    });

    this._bindFileEvents(target);
  }

  _bindPayslipRowEvents(target) {
    target.querySelectorAll('[data-edit-pay]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pay = store.getState().payslips.find((x) => x.id === btn.dataset.editPay);
        if (pay) this._openPayslipModal(pay, pay.month, pay.employeeId);
      });
    });

    target.querySelectorAll('[data-del-pay]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pay = store.getState().payslips.find((x) => x.id === btn.dataset.delPay);
        if (!pay) return;
        confirmAction({
          title: 'Excluir Vencimento',
          message: `Tem a certeza de que pretende eliminar o registo ${pay.id}?`,
          onConfirm: async () => {
            const res = await store.deletePayslip(pay.id);
            if (res !== null) {
              showToast('Registo eliminado.');
            }
          },
        });
      });
    });

    target.querySelectorAll('[data-quick-attach]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pay = store.getState().payslips.find((x) => x.id === btn.dataset.quickAttach);
        if (pay) this._openQuickAttachModal(pay.employeeId, pay.month, pay.id);
      });
    });

    target.querySelectorAll('[data-go-annual]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.focusEmployeeYear(btn.dataset.goAnnual, btn.dataset.goYear);
        store._commit();
      });
    });
  }

  _bindFileEvents(target) {
    target.querySelectorAll('[data-view-file]').forEach((btn) => {
      btn.addEventListener('click', () => this._previewAttachmentById(btn.dataset.viewFile));
    });

    target.querySelectorAll('[data-dl-file]').forEach((btn) => {
      btn.addEventListener('click', () => this._downloadAttachmentById(btn.dataset.dlFile));
    });

    target.querySelectorAll('[data-del-file]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rec = (store.getState().attachedReceipts || []).find((r) => r.id === btn.dataset.delFile);
        if (!rec) return;
        confirmAction({
          title: 'Remover Recibo Anexado',
          message: `Pretende remover o ficheiro "${rec.fileName}" de ${formatMonthLabel(rec.month)}?`,
          onConfirm: async () => {
            const res = await store.deleteAttachedReceipt(rec.id);
            if (res !== null) {
              showToast('Anexo removido.');
            }
          },
        });
      });
    });
  }

  _openQuickAttachModal(defaultEmpId, defaultMonth, payslipId = null) {
    const state = store.getState();
    let chosenFile = null;

    const bodyHtml = `
      <form id="quickAttachForm">
        <div class="erp-form-grid">
          <div class="erp-field">
            <label for="qaEmp">Funcionário *</label>
            <select id="qaEmp" name="employeeId" required>
              ${state.employees
                .map((e) => `<option value="${escapeHtml(e.id)}" ${defaultEmpId === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="erp-field">
            <label for="qaMonth">Mês / Ano do Recibo *</label>
            <input type="month" id="qaMonth" name="month" required value="${escapeHtml(defaultMonth)}">
          </div>
          <div class="erp-field erp-field--full">
            <label>Ficheiro do Recibo de Vencimento (PDF, PNG, JPG) *</label>
            <div class="erp-dropzone" id="qaDropzone">
              <input type="file" id="qaFileInput" accept=".pdf,image/*" style="display:none;">
              <div class="erp-dropzone__title" id="qaDropTitle">Clique para selecionar o recibo PDF ou imagem</div>
              <div class="erp-dropzone__hint">O recibo será arquivado diretamente na Lista do Ano no respetivo mês</div>
            </div>
          </div>
        </div>
      </form>
    `;

    openModal({
      title: 'Anexar Recibo de Vencimento',
      subtitle: 'O ficheiro será enviado para a Lista do Ano no respetivo mês',
      size: 'narrow',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="quickAttachForm" id="btnQuickAttachSubmit" class="erp-btn erp-btn--primary">Anexar Recibo</button>
      `,
      onMount: (modal) => {
        const dropzone = modal.querySelector('#qaDropzone');
        const fileInput = modal.querySelector('#qaFileInput');
        const submitBtn = modal.querySelector('#btnQuickAttachSubmit');
        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
          if (fileInput.files && fileInput.files[0]) {
            chosenFile = fileInput.files[0];
            modal.querySelector('#qaDropTitle').textContent = `Selecionado: ${chosenFile.name} (${Math.round(chosenFile.size / 1024)} KB)`;
          }
        });

        modal.querySelector('#quickAttachForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!chosenFile) {
            showToast('Selecione um ficheiro PDF ou imagem antes de anexar.', 'danger');
            return;
          }
          const empId = modal.querySelector('#qaEmp').value;
          const refMonth = modal.querySelector('#qaMonth').value;
          const fileId = generateId('ATT');

          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'A enviar...';
          }

          try {
            await saveAttachmentFile(fileId, chosenFile);
            const res = await store.addAttachedReceipt({
              id: fileId,
              employeeId: empId,
              month: refMonth,
              payslipId: payslipId || null,
              fileName: chosenFile.name,
              fileType: chosenFile.type || 'application/pdf',
              fileSize: chosenFile.size,
              uploadedAt: todayISO(),
            });

            if (res !== null) {
              closeModal();
              showToast('Recibo anexado com sucesso.');
            }
          } catch (err) {
            showToast(err?.message || 'Não foi possível anexar o ficheiro selecionado.', 'error');
          } finally {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Anexar Recibo';
            }
          }
        });
      },
    });
  }

  _exportPayslipsCSV(payslips, empMap, periodLabel) {
    const headers = [
      'Recibo',
      'Mês',
      'Funcionário',
      'NIF',
      'Base (€)',
      'Duodécimo Férias (€)',
      'Duodécimo Natal (€)',
      'Sub. Alimentação (€)',
      'Extra/Prémios (€)',
      'Seg. Social (€)',
      'IRS (€)',
      'Outros Descontos (€)',
      'Por Fora SS (€)',
      'Total Líquido Final (€)',
      'Estado',
      'Data Pagamento',
    ];
    const rows = payslips.map((p) => {
      const emp = empMap.get(p.employeeId);
      return [
        p.id,
        p.month,
        emp?.name || '',
        emp?.nif || '',
        Number(p.baseSalary || 0).toFixed(2),
        Number(p.twelfthVacation || 0).toFixed(2),
        Number(p.twelfthChristmas || 0).toFixed(2),
        Number(p.mealAllowanceTotal || 0).toFixed(2),
        Number(p.overtimeBonus || 0).toFixed(2),
        Number(p.socialSecurity || 0).toFixed(2),
        Number(p.irsRetention || 0).toFixed(2),
        Number(p.otherDeductions || 0).toFixed(2),
        Number(p.offPayroll || 0).toFixed(2),
        Number(p.netSalary || 0).toFixed(2),
        p.status,
        p.paymentDate || '',
      ];
    });
    downloadCSV(`vencimentos-${periodLabel.replace(/\s+/g, '-').toLowerCase()}.csv`, headers, rows);
    showToast('Lista de vencimentos exportada em CSV.');
  }

  async _previewAttachmentById(fileId) {
    const record = await getAttachmentFile(fileId);
    if (!record) {
      showToast('Ficheiro anexo não encontrado neste navegador.', 'danger');
      return;
    }
    const blob = new window.Blob([record.data], { type: record.type });
    const url = window.URL.createObjectURL(blob);
    const isPdf = (record.type || '').includes('pdf') || record.name.toLowerCase().endsWith('.pdf');

    openModal({
      title: `Recibo Anexado — ${record.name}`,
      subtitle: `${Math.round(record.size / 1024)} KB`,
      size: 'wide',
      bodyHtml: isPdf
        ? `<iframe class="erp-attachment-preview" src="${url}" title="Pré-visualização do recibo"></iframe>`
        : `<img class="erp-attachment-img" src="${url}" alt="Comprovativo de recibo">`,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
        <a href="${url}" download="${escapeHtml(record.name)}" class="erp-btn erp-btn--primary">${ICONS.download}<span>Descarregar</span></a>
      `,
    });
  }

  async _downloadAttachmentById(fileId) {
    const record = await getAttachmentFile(fileId);
    if (!record) {
      showToast('Ficheiro anexo indisponível.', 'danger');
      return;
    }
    const blob = new window.Blob([record.data], { type: record.type });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = record.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  _countWorkedDays(empId, yearMonth) {
    const empAtt = store.getState().attendance[empId] || {};
    return Object.entries(empAtt).filter(
      ([d, rec]) => d.startsWith(yearMonth) && rec.status === 'P'
    ).length;
  }

  _openPayslipModal(existing, defaultMonth, defaultEmpId = null) {
    const state = store.getState();
    if (state.employees.length === 0) {
      showToast('Registe primeiro pelo menos um funcionário em RH.', 'danger');
      return;
    }

    const isEdit = Boolean(existing);
    const targetEmp =
      (defaultEmpId && state.employees.find((e) => e.id === defaultEmpId)) ||
      (existing && state.employees.find((e) => e.id === existing.employeeId)) ||
      state.employees[0];
    const defaultPayroll = computeEmployeeMonthlyPayroll(
      targetEmp,
      state.attendance,
      state.employeeAdvances,
      defaultMonth
    );
    const worked = defaultPayroll.present;
    const pay = existing || {
      employeeId: targetEmp.id,
      month: defaultMonth,
      baseSalary: defaultPayroll.earnedBase,
      twelfthVacation: defaultPayroll.twelfthsVacation,
      twelfthChristmas: defaultPayroll.twelfthsChristmas,
      mealAllowanceTotal: defaultPayroll.mealEarned,
      overtimeBonus: 0,
      socialSecurity: defaultPayroll.ssDeduction,
      irsRetention: 0,
      otherDeductions: defaultPayroll.advancesTotal,
      offPayroll: defaultPayroll.offPayrollEarned,
      netSalary: defaultPayroll.netToPay,
      paymentDate: todayISO(),
      status: 'pago',
      notes: '',
    };
    const initialTwelfthsMode = existing
      ? Number(existing.twelfthVacation || 0) > 0 || Number(existing.twelfthChristmas || 0) > 0
        ? 'personalizado'
        : 'Não'
      : normalizeTwelfthsMode(targetEmp?.twelfths);

    let selectedFile = null;

    const bodyHtml = `
      <form id="payslipForm">
        <div class="erp-form-section">
          <div class="erp-form-section__title">1. Colaborador &amp; Período</div>
          <div class="erp-form-grid">
            <div class="erp-field">
              <label for="payEmp">Funcionário *</label>
              <select id="payEmp" name="employeeId" ${isEdit ? 'disabled' : ''}>
                ${state.employees
                  .map((e) => `<option value="${escapeHtml(e.id)}" ${pay.employeeId === e.id ? 'selected' : ''}>${escapeHtml(e.name)} (NIF ${escapeHtml(e.nif)})</option>`)
                  .join('')}
              </select>
            </div>
            <div class="erp-field">
              <label for="payMonth">Mês de Referência *</label>
              <input type="month" id="payMonth" name="month" required value="${escapeHtml(pay.month)}">
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">2. Abonos em Recibo, Duodécimos, Descontos &amp; Por Fora da SS (Portugal)</div>
          <div class="erp-form-grid erp-form-grid--3">
            <div class="erp-field">
              <label for="payBase">Vencimento Base em Recibo (€)</label>
              <input type="text" inputmode="numeric" data-currency-euro id="payBase" name="baseSalary" value="${escapeHtml(pay.baseSalary)}" placeholder="€ 0,00">
            </div>
            <div class="erp-field">
              <label for="payMeal">Subsídio Alimentação (€)</label>
              <input type="text" inputmode="numeric" data-currency-euro id="payMeal" name="mealAllowanceTotal" value="${escapeHtml(pay.mealAllowanceTotal)}" placeholder="€ 0,00">
              <span class="erp-field__hint" id="payWorkedHint">${worked} dias trabalhados registados no mês</span>
            </div>
            <div class="erp-field">
              <label for="payBonus">Horas Extra / Prémios (€)</label>
              <input type="text" inputmode="numeric" data-currency-euro id="payBonus" name="overtimeBonus" value="${escapeHtml(pay.overtimeBonus)}" placeholder="€ 0,00">
            </div>
            <div class="erp-field">
              <label for="paySS">Segurança Social (${targetEmp?.ssPercentage ?? 11}% s/ recibo) (€)</label>
              <input type="text" inputmode="numeric" data-currency-euro id="paySS" name="socialSecurity" value="${escapeHtml(pay.socialSecurity)}" placeholder="€ 0,00">
            </div>
            <div class="erp-field">
              <label for="payIrs">Retenção na Fonte IRS (€)</label>
              <input type="text" inputmode="numeric" data-currency-euro id="payIrs" name="irsRetention" value="${escapeHtml(pay.irsRetention)}" placeholder="€ 0,00">
            </div>
            <div class="erp-field">
              <label for="payOther">Outros Descontos / Vales (€)</label>
              <input type="text" inputmode="numeric" data-currency-euro id="payOther" name="otherDeductions" value="${escapeHtml(pay.otherDeductions)}" placeholder="€ 0,00">
            </div>
          </div>

          <div class="erp-inline-invoice-box" style="margin-top:14px;">
            <div class="erp-form-section__title" style="margin-bottom:8px;">Duodécimos (Subsídio de Férias &amp; Natal — Sujeitos a Seg. Social)</div>
            <div class="erp-form-grid erp-form-grid--3">
              <div class="erp-field">
                <label for="payTwelfthsPreset">Qual opção aplicar neste recibo?</label>
                <select id="payTwelfthsPreset">
                  ${TWELFTHS_OPTIONS.map((opt) => `<option value="${escapeHtml(opt.value)}" ${initialTwelfthsMode === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
                </select>
              </div>
              <div class="erp-field">
                <label for="payTwelfthVacation">Duodécimo Férias (€)</label>
                <input type="text" inputmode="numeric" data-currency-euro id="payTwelfthVacation" name="twelfthVacation" value="${escapeHtml(pay.twelfthVacation ?? 0)}" placeholder="€ 0,00">
              </div>
              <div class="erp-field">
                <label for="payTwelfthChristmas">Duodécimo Natal (€)</label>
                <input type="text" inputmode="numeric" data-currency-euro id="payTwelfthChristmas" name="twelfthChristmas" value="${escapeHtml(pay.twelfthChristmas ?? 0)}" placeholder="€ 0,00">
              </div>
            </div>
          </div>

          <div class="erp-inline-invoice-box" style="margin-top:12px;">
            <div class="erp-form-grid">
              <div class="erp-field erp-field--full">
                <label for="payOffPayroll">Pagamento Por Fora da Segurança Social (€)</label>
                <input type="text" inputmode="numeric" data-currency-euro id="payOffPayroll" name="offPayroll" value="${escapeHtml(pay.offPayroll ?? 0)}" placeholder="€ 0,00">
                <span class="erp-field__hint">Este valor não sofre desconto de Segurança Social nem TSU e é somado ao líquido final.</span>
              </div>
            </div>
          </div>

          <div class="erp-summary-box" style="margin-top:14px;">
            <div>
              <div class="erp-summary-item__label">Ilíquido Recibo</div>
              <div class="erp-summary-item__val" id="sumGross">€0,00</div>
            </div>
            <div>
              <div class="erp-summary-item__label">Descontos Recibo</div>
              <div class="erp-summary-item__val erp-summary-item__val--danger" id="sumDed">€0,00</div>
            </div>
            <div>
              <div class="erp-summary-item__label">+ Por Fora SS</div>
              <div class="erp-summary-item__val" id="sumOffPayroll" style="color:var(--erp-accent-dark);">€0,00</div>
            </div>
            <div>
              <div class="erp-summary-item__label">TSU Entidade (23,75%)</div>
              <div class="erp-summary-item__val" id="sumTsu">€0,00</div>
            </div>
            <div>
              <div class="erp-summary-item__label">Total Final a Receber</div>
              <div class="erp-summary-item__val erp-summary-item__val--success" id="sumNet">€0,00</div>
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">3. Liquidação &amp; Anexo Opcional (vai para a Lista do Ano)</div>
          <div class="erp-form-grid">
            <div class="erp-field">
              <label for="payStatus">Estado do Pagamento</label>
              <select id="payStatus" name="status">
                <option value="pago" ${pay.status === 'pago' ? 'selected' : ''}>Pago</option>
                <option value="pendente" ${pay.status === 'pendente' ? 'selected' : ''}>Pendente</option>
              </select>
            </div>
            <div class="erp-field">
              <label for="payDate">Data de Pagamento</label>
              <input type="date" id="payDate" name="paymentDate" value="${escapeHtml(pay.paymentDate)}">
            </div>
            <div class="erp-field erp-field--full">
              <label>Anexar Recibo de Vencimento (PDF, PNG, JPG)</label>
              <div class="erp-dropzone" id="payDropzone">
                <input type="file" id="payFileInput" accept=".pdf,image/*" style="display:none;">
                <div class="erp-dropzone__title" id="payDropTitle">Clique para anexar recibo (será enviado para a Lista do Ano)</div>
                <div class="erp-dropzone__hint">O ficheiro fica arquivado no respetivo mês da Lista do Ano</div>
              </div>
            </div>
            <div class="erp-field erp-field--full">
              <label for="payNotes">Observações</label>
              <textarea id="payNotes" name="notes" rows="2">${escapeHtml(pay.notes)}</textarea>
            </div>
          </div>
        </div>
      </form>
    `;

    openModal({
      title: isEdit ? `Editar Vencimento — ${pay.id}` : 'Emitir Vencimento',
      subtitle: 'Processamento salarial com envio automático de anexos para a Lista do Ano',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="payslipForm" id="btnPayslipSubmit" class="erp-btn erp-btn--primary">${isEdit ? 'Guardar' : 'Emitir Vencimento'}</button>
      `,
      onMount: (modal) => {
        const form = modal.querySelector('#payslipForm');
        const empSelect = modal.querySelector('#payEmp');
        const monthInput = modal.querySelector('#payMonth');
        const baseInput = modal.querySelector('#payBase');
        const mealInput = modal.querySelector('#payMeal');
        const bonusInput = modal.querySelector('#payBonus');
        const twelfthsPresetSelect = modal.querySelector('#payTwelfthsPreset');
        const twelfthVacInput = modal.querySelector('#payTwelfthVacation');
        const twelfthXmasInput = modal.querySelector('#payTwelfthChristmas');
        const ssInput = modal.querySelector('#paySS');
        const irsInput = modal.querySelector('#payIrs');
        const otherInput = modal.querySelector('#payOther');
        const offPayrollInput = modal.querySelector('#payOffPayroll');

        const recalc = () => {
          const base = parseCurrencyInput(baseInput.value);
          const meal = parseCurrencyInput(mealInput.value);
          const twVac = parseCurrencyInput(twelfthVacInput.value);
          const twXmas = parseCurrencyInput(twelfthXmasInput.value);
          const bonus = parseCurrencyInput(bonusInput.value);
          const ss = parseCurrencyInput(ssInput.value);
          const irs = parseCurrencyInput(irsInput.value);
          const other = parseCurrencyInput(otherInput.value);
          const offPayroll = parseCurrencyInput(offPayrollInput.value);

          const gross = base + meal + twVac + twXmas + bonus;
          const ded = ss + irs + other;
          const net = Math.max(0, gross - ded + offPayroll);
          const tsu = (base + twVac + twXmas + bonus) * 0.2375;

          modal.querySelector('#sumGross').textContent = formatCurrency(gross);
          modal.querySelector('#sumDed').textContent = formatCurrency(ded);
          modal.querySelector('#sumOffPayroll').textContent = formatCurrency(offPayroll);
          modal.querySelector('#sumTsu').textContent = formatCurrency(tsu);
          modal.querySelector('#sumNet').textContent = formatCurrency(net);
          return net;
        };

        const applyTwelfthsPreset = () => {
          const emp = state.employees.find((e) => e.id === empSelect.value);
          const ssPct =
            emp?.ssPercentage !== undefined && emp?.ssPercentage !== null && emp?.ssPercentage !== ''
              ? Math.min(100, Math.max(0, Number(emp.ssPercentage) || 0))
              : 11;
          const mode = twelfthsPresetSelect?.value || 'Não';
          if (mode !== 'personalizado') {
            const base = parseCurrencyInput(baseInput.value);
            const tw = computeTwelfthsBreakdown(base, mode, 0, 0);
            twelfthVacInput.value = formatEuroInputValue(tw.twelfthsVacation);
            twelfthXmasInput.value = formatEuroInputValue(tw.twelfthsChristmas);
          }
          const baseNow = parseCurrencyInput(baseInput.value);
          const vacNow = parseCurrencyInput(twelfthVacInput.value);
          const xmasNow = parseCurrencyInput(twelfthXmasInput.value);
          const bonusNow = parseCurrencyInput(bonusInput.value);
          ssInput.value = formatEuroInputValue((baseNow + vacNow + xmasNow + bonusNow) * (ssPct / 100));
          recalc();
        };

        const syncEmployeeDefaults = () => {
          const emp = state.employees.find((e) => e.id === empSelect.value);
          if (!emp) return;
          const payroll = computeEmployeeMonthlyPayroll(
            emp,
            store.getState().attendance,
            store.getState().employeeAdvances,
            monthInput.value
          );
          modal.querySelector('#payWorkedHint').textContent = `${payroll.present} dias trabalhados registados no mês`;
          if (!isEdit) {
            baseInput.value = formatEuroInputValue(payroll.earnedBase);
            mealInput.value = formatEuroInputValue(payroll.mealEarned);
            if (twelfthsPresetSelect) {
              twelfthsPresetSelect.value = payroll.twelfthsMode;
            }
            twelfthVacInput.value = formatEuroInputValue(payroll.twelfthsVacation);
            twelfthXmasInput.value = formatEuroInputValue(payroll.twelfthsChristmas);
            ssInput.value = formatEuroInputValue(
              (payroll.earnedBase +
                payroll.twelfthsTotal +
                parseCurrencyInput(bonusInput.value)) *
                (payroll.ssPercentage / 100)
            );
            otherInput.value = formatEuroInputValue(payroll.advancesTotal);
            offPayrollInput.value = formatEuroInputValue(payroll.offPayrollEarned);
          }
          recalc();
        };

        empSelect.addEventListener('change', syncEmployeeDefaults);
        monthInput.addEventListener('change', syncEmployeeDefaults);
        twelfthsPresetSelect?.addEventListener('change', applyTwelfthsPreset);
        [
          baseInput,
          mealInput,
          twelfthVacInput,
          twelfthXmasInput,
          bonusInput,
          ssInput,
          irsInput,
          otherInput,
          offPayrollInput,
        ].forEach((inp) => {
          inp.addEventListener('input', recalc);
        });
        [twelfthVacInput, twelfthXmasInput].forEach((inp) => {
          inp.addEventListener('input', () => {
            if (twelfthsPresetSelect) twelfthsPresetSelect.value = 'personalizado';
          });
        });
        recalc();

        const dropzone = modal.querySelector('#payDropzone');
        const fileInput = modal.querySelector('#payFileInput');
        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
          if (fileInput.files && fileInput.files[0]) {
            selectedFile = fileInput.files[0];
            modal.querySelector('#payDropTitle').textContent = `Selecionado: ${selectedFile.name} (${Math.round(selectedFile.size / 1024)} KB)`;
          }
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const submitBtn = modal.querySelector('#btnPayslipSubmit');
          const originalLabel = isEdit ? 'Guardar' : 'Emitir Vencimento';
          const net = recalc();
          const payslipId = isEdit ? pay.id : generateId('REC');
          const empId = isEdit ? pay.employeeId : empSelect.value;
          const refMonth = monthInput.value;

          const payload = {
            employeeId: empId,
            month: refMonth,
            baseSalary: parseCurrencyInput(baseInput.value),
            mealAllowanceTotal: parseCurrencyInput(mealInput.value),
            twelfthVacation: parseCurrencyInput(twelfthVacInput.value),
            twelfthChristmas: parseCurrencyInput(twelfthXmasInput.value),
            overtimeBonus: parseCurrencyInput(bonusInput.value),
            socialSecurity: parseCurrencyInput(ssInput.value),
            irsRetention: parseCurrencyInput(irsInput.value),
            otherDeductions: parseCurrencyInput(otherInput.value),
            offPayroll: parseCurrencyInput(offPayrollInput.value),
            netSalary: Number(net.toFixed(2)),
            paymentDate: modal.querySelector('#payDate').value,
            status: modal.querySelector('#payStatus').value,
            notes: modal.querySelector('#payNotes').value,
          };

          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'A guardar...';
          }

          try {
            const payRes = await (isEdit
              ? store.updatePayslip(pay.id, payload)
              : store.addPayslip({ id: payslipId, ...payload }));

            if (payRes === null) {
              return;
            }

            if (selectedFile) {
              const fileId = generateId('ATT');
              await saveAttachmentFile(fileId, selectedFile);
              const attRes = await store.addAttachedReceipt({
                id: fileId,
                employeeId: empId,
                month: refMonth,
                payslipId,
                fileName: selectedFile.name,
                fileType: selectedFile.type || 'application/pdf',
                fileSize: selectedFile.size,
                uploadedAt: todayISO(),
              });
              if (attRes === null) {
                return;
              }
              closeModal();
              showToast('Vencimento guardado e recibo anexado com sucesso.');
              return;
            }

            closeModal();
            showToast(isEdit ? `Vencimento ${pay.id} atualizado.` : `Vencimento ${payslipId} emitido com sucesso.`);
          } catch (err) {
            showToast(err?.message || 'Não foi possível guardar o vencimento ou anexo.', 'error');
          } finally {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = originalLabel;
            }
          }
        });
      },
    });
  }
}
