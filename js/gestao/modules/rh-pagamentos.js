/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — RH: Ordenados, Duodécimos, Por Fora SS & Pagamentos
   ═══════════════════════════════════════════════════════════ */

import { store } from '../core/store.js';
import {
  TWELFTHS_OPTIONS,
  computeEmployeeMonthlyPayroll,
  computeTwelfthsBreakdown,
  downloadCSV,
  escapeHtml,
  formatCurrency,
  formatDatePT,
  formatMonthLabel,
  generateId,
  getInitials,
  getTwelfthsOptionMeta,
  normalizeTwelfthsMode,
  parseCurrencyInput,
  todayISO,
} from '../core/formatters.js';
import { ICONS, openModal, closeModal, confirmAction, showToast, attachEuroMasks } from '../core/ui.js';

const REMUNERATION_LABELS = {
  mensal: 'Fixo Mensal',
  diaria: 'Por Dia (Diária)',
  hora: 'Por Hora',
};

const DEPARTMENTS = [
  'Engenharia',
  'Construção Civil',
  'Reabilitação',
  'Instalações Elétricas',
  'Espaços Verdes',
  'Administrativo',
];

export class RhPagamentosModule {
  constructor(options = {}) {
    this.viewMode = 'payroll'; // 'payroll' | 'config' | 'advances'
    this.deptFilter = 'all';
    this.remFilter = 'all';
    this.advScope = 'month'; // 'month' | 'all'
    this.onOpenPayslips = options.onOpenPayslips || null;
  }

  render(container, ctx) {
    this._can = ctx.can || (() => true);
    const canSeeSalary = this._can('rh_funcionarios', 'ordenados');
    const canSeePayable = this._can('rh_funcionarios', 'pagamentos');
    const state = store.getState();
    const { month, search } = ctx;
    const query = (search || '').trim().toLowerCase();

    const activeEmployees = state.employees.filter((e) => e.status === 'ativo');
    const filteredActive = activeEmployees.filter((e) => {
      if (this.deptFilter !== 'all' && e.department !== this.deptFilter) return false;
      if (this.remFilter !== 'all' && (e.remunerationType || 'mensal') !== this.remFilter) return false;
      if (query) {
        const hay = `${e.name} ${e.role} ${e.department} ${e.nif} ${e.iban || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const filteredAll = state.employees.filter((e) => {
      if (this.deptFilter !== 'all' && e.department !== this.deptFilter) return false;
      if (this.remFilter !== 'all' && (e.remunerationType || 'mensal') !== this.remFilter) return false;
      if (query) {
        const hay = `${e.name} ${e.role} ${e.department} ${e.nif} ${e.iban || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    let totalReceiptGross = 0;
    let totalSS = 0;
    let totalOffPayroll = 0;
    let totalNetToPay = 0;
    let offPayrollActiveCount = 0;

    activeEmployees.forEach((emp) => {
      const s = computeEmployeeMonthlyPayroll(emp, state.attendance, state.employeeAdvances, month);
      totalReceiptGross += s.grossPay;
      totalSS += s.ssDeduction;
      totalOffPayroll += s.offPayrollEarned;
      totalNetToPay += s.netToPay;
      if (s.offPayrollAmount > 0) offPayrollActiveCount += 1;
    });

    const monthAdvances = (state.employeeAdvances || []).filter(
      (a) => String(a.month || a.date || '').slice(0, 7) === month
    );
    const totalMonthAdvances = monthAdvances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

    container.innerHTML = `
      <div class="erp-kpi-grid">
        <div class="erp-kpi-card erp-kpi-card--primary">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Ilíquido em Recibo (${escapeHtml(month)})</span>
            <span class="erp-kpi-card__icon">${ICONS.receipt}</span>
          </div>
          <div class="erp-kpi-card__value">${canSeeSalary ? escapeHtml(formatCurrency(totalReceiptGross)) : 'Restrito'}</div>
          <div class="erp-kpi-card__meta">Base apurada + duodécimos + sub. alimentação</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--warning">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Segurança Social (${escapeHtml(month)})</span>
            <span class="erp-kpi-card__icon">${ICONS.chart}</span>
          </div>
          <div class="erp-kpi-card__value">${canSeeSalary ? escapeHtml(formatCurrency(totalSS)) : 'Restrito'}</div>
          <div class="erp-kpi-card__meta">Retida sobre base em recibo e duodécimos</div>
        </div>

        <div class="erp-kpi-card">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Por Fora da SS (${escapeHtml(month)})</span>
            <span class="erp-kpi-card__icon">${ICONS.briefcase}</span>
          </div>
          <div class="erp-kpi-card__value">${canSeeSalary ? escapeHtml(formatCurrency(totalOffPayroll)) : 'Restrito'}</div>
          <div class="erp-kpi-card__meta">${offPayrollActiveCount} colaborador(es) com complemento sem SS</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--success">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Total Líquido a Pagar</span>
            <span class="erp-kpi-card__icon">${ICONS.euro}</span>
          </div>
          <div class="erp-kpi-card__value">${canSeePayable ? escapeHtml(formatCurrency(totalNetToPay)) : 'Restrito'}</div>
          <div class="erp-kpi-card__meta">${monthAdvances.length} vale(s) abatido(s): ${escapeHtml(formatCurrency(totalMonthAdvances))}</div>
        </div>
      </div>

      <div class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-subtabs" role="tablist">
            <button type="button" class="erp-subtab ${this.viewMode === 'payroll' ? 'is-active' : ''}" data-paytab-view="payroll">
              ${ICONS.euro}
              <span>Folha Mensal &amp; Fecho</span>
              <span class="erp-subtab__badge">${filteredActive.length}</span>
            </button>
            <button type="button" class="erp-subtab ${this.viewMode === 'config' ? 'is-active' : ''}" data-paytab-view="config" ${canSeeSalary ? '' : 'style="display:none"'}>
              ${ICONS.edit}
              <span>Configuração Salarial &amp; IBAN</span>
              <span class="erp-subtab__badge">${filteredAll.length}</span>
            </button>
            <button type="button" class="erp-subtab ${this.viewMode === 'advances' ? 'is-active' : ''}" data-paytab-view="advances" ${canSeePayable ? '' : 'style="display:none"'}>
              ${ICONS.receipt}
              <span>Adiantamentos &amp; Vales</span>
              <span class="erp-subtab__badge">${monthAdvances.length}</span>
            </button>
          </div>

          <div class="erp-panel__actions">
            ${
              canSeeSalary || canSeePayable
                ? `<button type="button" class="erp-btn erp-btn--outline" id="btnExportPayrollCsv">${ICONS.download}<span>Exportar Folha CSV</span></button>`
                : ''
            }
            ${
              canSeePayable
                ? `<button type="button" class="erp-btn erp-btn--primary" id="btnNewAdvanceGlobal">
                    ${ICONS.plus}
                    <span>Registar Adiantamento / Vale</span>
                  </button>`
                : ''
            }
          </div>
        </div>

        <div id="payrollTabBody"></div>
      </div>
    `;

    if (this.viewMode === 'config' && !canSeeSalary) this.viewMode = 'payroll';
    if (this.viewMode === 'advances' && !canSeePayable) this.viewMode = 'payroll';

    container.querySelectorAll('[data-paytab-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.viewMode = btn.dataset.paytabView;
        this.render(container, ctx);
      });
    });

    container.querySelector('#btnExportPayrollCsv')?.addEventListener('click', () => {
      this._exportPayrollCSV(activeEmployees, state, month, canSeeSalary, canSeePayable);
    });

    container.querySelector('#btnNewAdvanceGlobal')?.addEventListener('click', () => {
      this._openGlobalAdvanceModal(month);
    });

    const body = container.querySelector('#payrollTabBody');
    if (this.viewMode === 'config') {
      this._renderConfigDirectory(body, filteredAll, month);
    } else if (this.viewMode === 'advances') {
      this._renderAdvancesLedger(body, state, month);
    } else {
      this._renderPayrollSheet(body, filteredActive, state, month, canSeeSalary, canSeePayable);
    }
  }

  _renderFilterControls(labelText) {
    return `
      <div class="erp-attendance-controls">
        <div class="erp-filter-bar">
          <select class="erp-select-sm" id="filterPayDept">
            <option value="all">Todos os Departamentos</option>
            ${DEPARTMENTS.map(
              (d) => `<option value="${escapeHtml(d)}" ${this.deptFilter === d ? 'selected' : ''}>${escapeHtml(d)}</option>`
            ).join('')}
          </select>
          <select class="erp-select-sm" id="filterPayRemType">
            <option value="all" ${this.remFilter === 'all' ? 'selected' : ''}>Todas as Modalidades</option>
            <option value="mensal" ${this.remFilter === 'mensal' ? 'selected' : ''}>Fixo Mensal</option>
            <option value="diaria" ${this.remFilter === 'diaria' ? 'selected' : ''}>Por Dia (Diária)</option>
            <option value="hora" ${this.remFilter === 'hora' ? 'selected' : ''}>Por Hora</option>
          </select>
        </div>
        <span class="erp-cell-sub">${labelText}</span>
      </div>
    `;
  }

  _bindFilterEvents(target) {
    target.querySelector('#filterPayDept')?.addEventListener('change', (e) => {
      this.deptFilter = e.target.value;
      store._commit();
    });
    target.querySelector('#filterPayRemType')?.addEventListener('change', (e) => {
      this.remFilter = e.target.value;
      store._commit();
    });
  }

  _renderPayrollSheet(target, employees, state, month, canSeeSalary, canSeePayable) {
    const payslipsByEmp = new Map();
    (state.payslips || [])
      .filter((p) => p.month === month)
      .forEach((p) => {
        payslipsByEmp.set(p.employeeId, p);
      });

    target.innerHTML = `
      ${this._renderFilterControls(`Processamento salarial de ${escapeHtml(formatMonthLabel(month))} · Configure ordenados, duodécimos, por fora SS e fecho de mês sem sair desta aba`)}

      ${
        employees.length === 0
          ? `<div class="erp-empty">${ICONS.euro}<div class="erp-empty__title">Nenhum colaborador ativo encontrado</div><p>Ajuste os filtros ou registe colaboradores na aba Funcionários.</p></div>`
          : `
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Colaborador &amp; Assiduidade</th>
                ${canSeeSalary ? '<th>Regime, Duodécimos &amp; SS%</th><th>Em Recibo (c/ SS)</th><th>Por Fora SS</th>' : ''}
                ${canSeePayable ? '<th>Adiantamentos</th><th>Líquido Final a Pagar</th>' : ''}
                <th style="text-align:right">Ações de Pagamento</th>
              </tr>
            </thead>
            <tbody>
              ${employees
                .map((emp) => {
                  const s = computeEmployeeMonthlyPayroll(emp, state.attendance, state.employeeAdvances, month);
                  const payslip = payslipsByEmp.get(emp.id);
                  const twMeta = getTwelfthsOptionMeta(s.twelfthsMode);
                  const rateLabel =
                    s.remunerationType === 'diaria'
                      ? `${formatCurrency(s.dailyRate)}/dia`
                      : s.remunerationType === 'hora'
                        ? `${formatCurrency(s.hourlyRate)}/h`
                        : `${formatCurrency(s.baseSalaryFixed)}/mês`;

                  return `
                  <tr>
                    <td>
                      <div class="erp-person-cell">
                        <span class="erp-avatar">${escapeHtml(getInitials(emp.name))}</span>
                        <div>
                          <div class="erp-cell-title">${escapeHtml(emp.name)}</div>
                          <div class="erp-cell-sub">
                            ${escapeHtml(emp.role)} ·
                            <span class="erp-att-pill erp-att-pill--P" style="font-size:11px;padding:1px 6px;">${s.present}P</span>
                            ${s.remunerationType === 'mensal' ? '<span style="font-size:11px;color:var(--erp-text-muted);">Fixo</span>' : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    ${
                      canSeeSalary
                        ? `<td>
                             <div class="erp-cell-title">${escapeHtml(rateLabel)} · ${escapeHtml(REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal')}</div>
                             <div class="erp-cell-sub">SS ${s.ssPercentage}%${s.twelfthsMode !== 'Não' ? ` · <strong>${escapeHtml(twMeta.shortLabel)}</strong> (+${escapeHtml(formatCurrency(s.twelfthsTotal))})` : ' · Sem duodécimos'}</div>
                           </td>
                           <td>
                             <div class="erp-cell-title">${escapeHtml(formatCurrency(s.receiptNetPay))}</div>
                             <div class="erp-cell-sub">Bruto ${escapeHtml(formatCurrency(s.grossPay))} · SS -${escapeHtml(formatCurrency(s.ssDeduction))}</div>
                           </td>
                           <td>
                             <div class="erp-cell-title" style="color:${s.offPayrollEarned > 0 ? 'var(--erp-accent-dark)' : 'var(--erp-text-muted)'};">
                               ${s.offPayrollEarned > 0 ? `+ ${escapeHtml(formatCurrency(s.offPayrollEarned))}` : '€ 0,00'}
                             </div>
                             <div class="erp-cell-sub">${s.offPayrollAmount > 0 ? (s.offPayrollType === 'diaria' ? `${formatCurrency(s.offPayrollAmount)}/dia` : 'Fixo mensal') : 'Sem complemento'}</div>
                           </td>`
                        : ''
                    }
                    ${
                      canSeePayable
                        ? `<td>
                             <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-pay-adv="${escapeHtml(emp.id)}" title="Gerir Adiantamentos / Vales">
                               ${s.advancesTotal > 0 ? `<span style="color:var(--erp-danger);font-weight:700;">-${escapeHtml(formatCurrency(s.advancesTotal))} (${s.monthAdvances.length})</span>` : '€ 0,00 · + Vale'}
                             </button>
                           </td>
                           <td>
                             <div class="erp-cell-title" style="color:var(--erp-success);font-size:14.5px;">${escapeHtml(formatCurrency(s.netToPay))}</div>
                             ${
                               payslip
                                 ? `<span class="erp-badge ${payslip.status === 'pago' ? 'erp-badge--success' : 'erp-badge--warning'}" style="margin-top:4px;">
                                      Recibo ${payslip.status === 'pago' ? 'Pago' : 'Emitido'} (${escapeHtml(formatCurrency(payslip.netSalary))})
                                    </span>`
                                 : '<div class="erp-cell-sub">Por fechar neste mês</div>'
                             }
                           </td>`
                        : ''
                    }
                    <td>
                      <div class="erp-row-actions">
                        ${
                          canSeeSalary
                            ? `<button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-pay-config="${escapeHtml(emp.id)}" title="Definir Ordenado, Duodécimos, Por Fora SS e IBAN">Configurar Salário</button>`
                            : ''
                        }
                        ${
                          canSeePayable
                            ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-pay-close="${escapeHtml(emp.id)}" title="Fechar Mês e Emitir Recibo">Fechar Mês</button>`
                            : ''
                        }
                        ${
                          this._can('rh_recibos', 'ver')
                            ? `<button type="button" class="erp-icon-btn" title="Ver Recibos do Ano" data-pay-receipts="${escapeHtml(emp.id)}">${ICONS.receipt}</button>`
                            : ''
                        }
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

    this._bindFilterEvents(target);

    target.querySelectorAll('[data-pay-config]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emp = store.getState().employees.find((x) => x.id === btn.dataset.payConfig);
        if (emp) this._openSalaryConfigModal(emp);
      });
    });

    target.querySelectorAll('[data-pay-adv]').forEach((btn) => {
      btn.addEventListener('click', () => this._openAdvancePopup(btn.dataset.payAdv, month));
    });

    target.querySelectorAll('[data-pay-close]').forEach((btn) => {
      btn.addEventListener('click', () => this._openCloseMonthModal(btn.dataset.payClose, month));
    });

    target.querySelectorAll('[data-pay-receipts]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (typeof this.onOpenPayslips === 'function') {
          this.onOpenPayslips(btn.dataset.payReceipts);
        }
      });
    });
  }

  _renderConfigDirectory(target, employees, month) {
    target.innerHTML = `
      ${this._renderFilterControls('Tabela de condições salariais — clique em "Editar Regras Salariais" para configurar ordenado, duodécimos, pagamento por fora e IBAN')}

      ${
        employees.length === 0
          ? `<div class="erp-empty">${ICONS.users}<div class="erp-empty__title">Nenhum colaborador encontrado</div></div>`
          : `
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Modalidade &amp; Valor Base</th>
                <th>SS (%) &amp; Sub. Alim.</th>
                <th>Duodécimos (Férias / Natal)</th>
                <th>Por Fora da SS</th>
                <th>IBAN</th>
                <th style="text-align:right">Configurar</th>
              </tr>
            </thead>
            <tbody>
              ${employees
                .map((emp) => {
                  const s = computeEmployeeMonthlyPayroll(emp, store.getState().attendance, store.getState().employeeAdvances, month);
                  const twMeta = getTwelfthsOptionMeta(s.twelfthsMode);
                  const rateStr =
                    s.remunerationType === 'diaria'
                      ? `${formatCurrency(s.dailyRate)}/dia`
                      : s.remunerationType === 'hora'
                        ? `${formatCurrency(s.hourlyRate)}/h`
                        : `${formatCurrency(s.baseSalaryFixed)}/mês`;
                  return `
                  <tr>
                    <td>
                      <div class="erp-person-cell">
                        <span class="erp-avatar">${escapeHtml(getInitials(emp.name))}</span>
                        <div>
                          <div class="erp-cell-title">${escapeHtml(emp.name)}</div>
                          <div class="erp-cell-sub">${escapeHtml(emp.role)} · <span class="erp-badge ${emp.status === 'ativo' ? 'erp-badge--success' : 'erp-badge--neutral'}" style="padding:1px 6px;font-size:10.5px;">${emp.status === 'ativo' ? 'Ativo' : 'Inativo'}</span></div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="erp-cell-title">${escapeHtml(rateStr)}</div>
                      <div class="erp-cell-sub">${escapeHtml(REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal')}</div>
                    </td>
                    <td>
                      <div class="erp-cell-title">SS ${s.ssPercentage}%</div>
                      <div class="erp-cell-sub">${s.remunerationType === 'mensal' ? 'Sub. Alim. N/A' : `Sub. Alim. ${formatCurrency(emp.mealAllowance)}/dia`}</div>
                    </td>
                    <td>
                      <div class="erp-cell-title">${escapeHtml(twMeta.shortLabel)}</div>
                      <div class="erp-cell-sub">${s.twelfthsTotal > 0 ? `+${escapeHtml(formatCurrency(s.twelfthsTotal))} (no mês)` : 'Pago em junho/novembro'}</div>
                    </td>
                    <td>
                      <div class="erp-cell-title" style="color:${s.offPayrollAmount > 0 ? 'var(--erp-accent-dark)' : 'var(--erp-text-muted)'};">
                        ${s.offPayrollAmount > 0 ? `${escapeHtml(formatCurrency(s.offPayrollAmount))}/${s.offPayrollType === 'diaria' ? 'dia' : 'mês'}` : '€ 0,00'}
                      </div>
                      <div class="erp-cell-sub">Sem desconto SS</div>
                    </td>
                    <td>
                      <div class="erp-cell-sub" style="font-family:monospace;">${escapeHtml(emp.iban || 'Não definido')}</div>
                    </td>
                    <td style="text-align:right">
                      <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-cfg-emp="${escapeHtml(emp.id)}">${ICONS.edit}<span>Editar Regras Salariais</span></button>
                    </td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`
      }
    `;

    this._bindFilterEvents(target);
    target.querySelectorAll('[data-cfg-emp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emp = store.getState().employees.find((x) => x.id === btn.dataset.cfgEmp);
        if (emp) this._openSalaryConfigModal(emp);
      });
    });
  }

  _renderAdvancesLedger(target, state, month) {
    const empMap = new Map((state.employees || []).map((e) => [e.id, e]));
    const allAdvances = state.employeeAdvances || [];
    const list =
      this.advScope === 'month'
        ? allAdvances.filter((a) => String(a.month || a.date || '').slice(0, 7) === month)
        : allAdvances;
    const totalVal = list.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

    target.innerHTML = `
      <div class="erp-attendance-controls">
        <div class="erp-filter-bar">
          <select class="erp-select-sm" id="advScopeSelect">
            <option value="month" ${this.advScope === 'month' ? 'selected' : ''}>Mês Selecionado (${escapeHtml(month)})</option>
            <option value="all" ${this.advScope === 'all' ? 'selected' : ''}>Todo o Histórico</option>
          </select>
        </div>
        <span class="erp-cell-title" style="color:var(--erp-danger);">Total em Vales / Adiantamentos: -${escapeHtml(formatCurrency(totalVal))}</span>
      </div>

      ${
        list.length === 0
          ? `<div class="erp-empty">${ICONS.receipt}<div class="erp-empty__title">Nenhum adiantamento registado</div><p>Clique em "Registar Adiantamento / Vale" acima para lançar um levantamento antecipado.</p></div>`
          : `
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Colaborador</th>
                <th>Mês de Abate</th>
                <th>Observação / Motivo</th>
                <th>Valor Retirado</th>
                <th style="text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${list
                .map((adv) => {
                  const emp = empMap.get(adv.employeeId);
                  return `
                  <tr>
                    <td><div class="erp-cell-title">${escapeHtml(formatDatePT(adv.date || adv.month))}</div></td>
                    <td>
                      <div class="erp-person-cell">
                        <span class="erp-avatar">${escapeHtml(getInitials(emp?.name || '?'))}</span>
                        <div>
                          <div class="erp-cell-title">${escapeHtml(emp?.name || 'Colaborador removido')}</div>
                          <div class="erp-cell-sub">${escapeHtml(emp?.role || '')}</div>
                        </div>
                      </div>
                    </td>
                    <td><span class="erp-badge erp-badge--neutral">${escapeHtml(adv.month || String(adv.date || '').slice(0, 7))}</span></td>
                    <td><div class="erp-cell-sub">${escapeHtml(adv.notes || 'Adiantamento de ordenado')}</div></td>
                    <td><strong style="color:var(--erp-danger);">-${escapeHtml(formatCurrency(adv.amount))}</strong></td>
                    <td style="text-align:right">
                      <button type="button" class="erp-icon-btn erp-icon-btn--danger" data-del-adv-row="${escapeHtml(adv.id)}" title="Remover Adiantamento">${ICONS.trash}</button>
                    </td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`
      }
    `;

    target.querySelector('#advScopeSelect')?.addEventListener('change', (e) => {
      this.advScope = e.target.value;
      store._commit();
    });

    target.querySelectorAll('[data-del-adv-row]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const adv = allAdvances.find((a) => a.id === btn.dataset.delAdvRow);
        if (!adv) return;
        const emp = empMap.get(adv.employeeId);
        confirmAction({
          title: 'Remover Adiantamento',
          message: `Pretende eliminar o vale de ${formatCurrency(adv.amount)} (${emp?.name || 'colaborador'})?`,
          onConfirm: () => {
            store.deleteEmployeeAdvance(adv.id);
            showToast('Adiantamento removido da base de dados.');
          },
        });
      });
    });
  }

  _exportPayrollCSV(employees, state, month, canSeeSalary, canSeePayable) {
    const headers = [
      'ID',
      'Nome',
      'NIF',
      'IBAN',
      'Modalidade',
      'Dias Trabalhados (P)',
      ...(canSeeSalary
        ? [
            'Base Recibo (€)',
            'Regime Duodécimos',
            'Duodécimo Férias (€)',
            'Duodécimo Natal (€)',
            'Sub. Alimentação (€)',
            'SS (%)',
            'Desconto SS (€)',
            'Por Fora SS (€)',
          ]
        : []),
      ...(canSeePayable ? ['Adiantamentos (€)', 'Total Final a Pagar (€)'] : []),
    ];
    const rows = employees.map((emp) => {
      const s = computeEmployeeMonthlyPayroll(emp, state.attendance, state.employeeAdvances, month);
      return [
        emp.id,
        emp.name,
        emp.nif,
        canSeeSalary ? emp.iban || '' : '',
        REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal',
        s.present,
        ...(canSeeSalary
          ? [
              s.earnedBase.toFixed(2),
              getTwelfthsOptionMeta(s.twelfthsMode).shortLabel,
              s.twelfthsVacation.toFixed(2),
              s.twelfthsChristmas.toFixed(2),
              s.mealEarned.toFixed(2),
              s.ssPercentage,
              s.ssDeduction.toFixed(2),
              s.offPayrollEarned.toFixed(2),
            ]
          : []),
        ...(canSeePayable ? [s.advancesTotal.toFixed(2), s.netToPay.toFixed(2)] : []),
      ];
    });
    downloadCSV(`folha-ordenados-pagamentos-${month}.csv`, headers, rows);
    showToast('Folha de ordenados e pagamentos exportada em CSV.');
  }

  _openSalaryConfigModal(emp) {
    if (this._can && !this._can('rh_funcionarios', 'ordenados')) {
      showToast('Sem permissão para visualizar ou alterar regras salariais.', 'warning');
      return;
    }

    const remType = ['diaria', 'hora', 'mensal'].includes(emp.remunerationType) ? emp.remunerationType : 'mensal';
    const offType = remType === 'mensal' ? 'mensal' : emp.offPayrollType === 'diaria' ? 'diaria' : 'mensal';
    const twelfthsMode = normalizeTwelfthsMode(emp.twelfths);

    const bodyHtml = `
      <form id="salaryConfigForm">
        <div class="erp-form-section">
          <div class="erp-form-section__title">1. Modalidade &amp; Ordenado em Recibo (Sujeito a Segurança Social)</div>
          <div class="erp-field erp-field--full" style="margin-bottom:12px;">
            <label>Como este colaborador recebe no recibo oficial? *</label>
            <div class="erp-regime-group" style="grid-template-columns:repeat(3,minmax(0,1fr));" id="cfgRemGroup">
              <label class="erp-regime-option ${remType === 'mensal' ? 'is-selected' : ''}">
                <input type="radio" name="remunerationType" value="mensal" ${remType === 'mensal' ? 'checked' : ''}>
                <div>
                  <div class="erp-cell-title">Valor Fixo por Mês</div>
                  <div class="erp-cell-sub">Salário mensal fixo (presenças não alteram o valor).</div>
                </div>
              </label>
              <label class="erp-regime-option ${remType === 'diaria' ? 'is-selected' : ''}">
                <input type="radio" name="remunerationType" value="diaria" ${remType === 'diaria' ? 'checked' : ''}>
                <div>
                  <div class="erp-cell-title">Por Dia (Diária)</div>
                  <div class="erp-cell-sub">Cada presença (P) soma a diária. Faltas não somam.</div>
                </div>
              </label>
              <label class="erp-regime-option ${remType === 'hora' ? 'is-selected' : ''}">
                <input type="radio" name="remunerationType" value="hora" ${remType === 'hora' ? 'checked' : ''}>
                <div>
                  <div class="erp-cell-title">Por Hora Trabalhada</div>
                  <div class="erp-cell-sub">Calculado pelas horas de presença registadas.</div>
                </div>
              </label>
            </div>
          </div>

          <div class="erp-form-grid erp-form-grid--3">
            <div class="erp-field" id="cfgWrapBase" style="display:${remType === 'mensal' ? 'flex' : 'none'};">
              <label for="cfgBaseSalary">Vencimento Fixo em Recibo (€/mês) *</label>
              <input type="text" inputmode="numeric" data-currency-euro id="cfgBaseSalary" name="baseSalary" value="${escapeHtml(emp.baseSalary ?? 0)}" placeholder="€ 0,00">
            </div>
            <div class="erp-field" id="cfgWrapDaily" style="display:${remType === 'diaria' ? 'flex' : 'none'};">
              <label for="cfgDailyRate">Valor da Diária em Recibo (€/dia) *</label>
              <input type="text" inputmode="numeric" data-currency-euro id="cfgDailyRate" name="dailyRate" value="${escapeHtml(emp.dailyRate ?? 0)}" placeholder="€ 0,00">
            </div>
            <div class="erp-field" id="cfgWrapHourly" style="display:${remType === 'hora' ? 'flex' : 'none'};">
              <label for="cfgHourlyRate">Valor por Hora em Recibo (€/hora) *</label>
              <input type="text" inputmode="numeric" data-currency-euro id="cfgHourlyRate" name="hourlyRate" value="${escapeHtml(emp.hourlyRate ?? 0)}" placeholder="€ 0,00">
            </div>

            <div class="erp-field">
              <label for="cfgSsPct">Desconto Segurança Social (%) *</label>
              <input type="number" step="0.1" min="0" max="100" id="cfgSsPct" name="ssPercentage" required value="${escapeHtml(emp.ssPercentage ?? 11)}">
              <span class="erp-field__hint">Incide sobre vencimento + duodécimos em recibo</span>
            </div>

            <div class="erp-field" id="cfgWrapMeal" style="display:${remType !== 'mensal' ? 'flex' : 'none'};">
              <label for="cfgMeal">Sub. Alimentação em Recibo (€/dia)</label>
              <input type="text" inputmode="numeric" data-currency-euro id="cfgMeal" name="mealAllowance" value="${escapeHtml(emp.mealAllowance ?? 0)}" placeholder="€ 0,00">
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">2. Duodécimos de Férias &amp; Natal</div>
          <div class="erp-inline-invoice-box">
            <div class="erp-form-grid">
              <div class="erp-field erp-field--full">
                <label for="cfgTwelfths">Qual a opção de duodécimos pretendida para este colaborador?</label>
                <select id="cfgTwelfths" name="twelfths">
                  ${TWELFTHS_OPTIONS.map((opt) => `<option value="${escapeHtml(opt.value)}" ${twelfthsMode === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
                </select>
                <span class="erp-field__hint">Os duodécimos somam ao recibo e entram na base de cálculo da Segurança Social.</span>
              </div>
              <div class="erp-field" id="cfgWrapTwVac" style="display:${twelfthsMode === 'personalizado' ? 'flex' : 'none'};">
                <label for="cfgTwVacManual">Duodécimo Férias Mensal (€)</label>
                <input type="text" inputmode="numeric" data-currency-euro id="cfgTwVacManual" name="twelfthsVacationManual" value="${escapeHtml(emp.twelfthsVacationManual ?? 0)}" placeholder="€ 0,00">
              </div>
              <div class="erp-field" id="cfgWrapTwXmas" style="display:${twelfthsMode === 'personalizado' ? 'flex' : 'none'};">
                <label for="cfgTwXmasManual">Duodécimo Natal Mensal (€)</label>
                <input type="text" inputmode="numeric" data-currency-euro id="cfgTwXmasManual" name="twelfthsChristmasManual" value="${escapeHtml(emp.twelfthsChristmasManual ?? 0)}" placeholder="€ 0,00">
              </div>
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">3. Pagamento Por Fora da Segurança Social (Sem Desconto SS) &amp; IBAN</div>
          <div class="erp-inline-invoice-box" style="margin-bottom:12px;">
            <div class="erp-form-grid">
              <div class="erp-field">
                <label for="cfgOffType">Periodicidade Por Fora da SS</label>
                <select id="cfgOffType" name="offPayrollType" ${remType === 'mensal' ? 'disabled' : ''}>
                  <option value="mensal" ${offType === 'mensal' ? 'selected' : ''}>Valor Fixo Mensal (€/mês)</option>
                  <option value="diaria" ${offType === 'diaria' ? 'selected' : ''}>Por Dia Trabalhado P (€/dia)</option>
                </select>
                <span class="erp-field__hint" id="cfgOffHint">${remType === 'mensal' ? 'Em ordenado fixo, o complemento por fora é fixo por mês (presenças não alteram).' : 'Escolha se o complemento por fora soma por dia trabalhado ou se é fixo no mês.'}</span>
              </div>
              <div class="erp-field">
                <label for="cfgOffAmount" id="cfgOffLbl">Valor Por Fora da SS (${offType === 'diaria' ? '€/dia' : '€/mês'})</label>
                <input type="text" inputmode="numeric" data-currency-euro id="cfgOffAmount" name="offPayrollAmount" value="${escapeHtml(emp.offPayrollAmount ?? 0)}" placeholder="€ 0,00">
                <span class="erp-field__hint">Isento de Segurança Social — somado integralmente ao líquido final.</span>
              </div>
            </div>
            <div class="erp-summary-box" id="cfgSalaryPreview" style="margin-top:12px;margin-bottom:0;"></div>
          </div>

          <div class="erp-form-grid">
            <div class="erp-field erp-field--full">
              <label for="cfgIban">IBAN para Transferência Bancária</label>
              <input type="text" id="cfgIban" name="iban" value="${escapeHtml(emp.iban || '')}" placeholder="PT50 0000 0000 0000 0000 0000 0">
            </div>
          </div>
        </div>
      </form>
    `;

    openModal({
      title: `Configuração Salarial — ${emp.name}`,
      subtitle: `${emp.role} · NIF ${emp.nif || '—'}`,
      size: 'wide',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="salaryConfigForm" id="btnSaveSalaryCfg" class="erp-btn erp-btn--primary">Guardar Condições Salariais</button>
      `,
      onMount: (modal) => {
        const form = modal.querySelector('#salaryConfigForm');
        const offSelect = modal.querySelector('#cfgOffType');
        const offAmountInput = modal.querySelector('#cfgOffAmount');
        const offHint = modal.querySelector('#cfgOffHint');
        const offLbl = modal.querySelector('#cfgOffLbl');
        const twSelect = modal.querySelector('#cfgTwelfths');
        const twVacInput = modal.querySelector('#cfgTwVacManual');
        const twXmasInput = modal.querySelector('#cfgTwXmasManual');
        const wrapTwVac = modal.querySelector('#cfgWrapTwVac');
        const wrapTwXmas = modal.querySelector('#cfgWrapTwXmas');
        const previewEl = modal.querySelector('#cfgSalaryPreview');

        const renderPreview = () => {
          if (!previewEl) return;
          const active = modal.querySelector('input[name="remunerationType"]:checked')?.value || 'mensal';
          const ssPct = Math.min(100, Math.max(0, Number(modal.querySelector('#cfgSsPct')?.value ?? 11) || 0));
          const offMode = active === 'mensal' ? 'mensal' : offSelect?.value === 'diaria' ? 'diaria' : 'mensal';
          const offVal = Math.max(0, parseCurrencyInput(offAmountInput?.value));
          const mealVal = active !== 'mensal' ? Math.max(0, parseCurrencyInput(modal.querySelector('#cfgMeal')?.value)) : 0;

          if (offLbl) {
            offLbl.textContent = `Valor Por Fora da SS (${offMode === 'diaria' ? '€/dia' : '€/mês'})`;
          }

          let earnedBaseEst = 0;
          let mealEst = 0;
          let periodTag = 'Mensal Fixo';
          let offPeriodVal = offVal;

          if (active === 'mensal') {
            earnedBaseEst = Math.max(0, parseCurrencyInput(modal.querySelector('#cfgBaseSalary')?.value));
          } else if (active === 'diaria') {
            const dRate = Math.max(0, parseCurrencyInput(modal.querySelector('#cfgDailyRate')?.value));
            earnedBaseEst = dRate * 22;
            mealEst = mealVal * 22;
            offPeriodVal = offMode === 'diaria' ? offVal * 22 : offVal;
            periodTag = 'Est. 22 dias (P)';
          } else {
            const hRate = Math.max(0, parseCurrencyInput(modal.querySelector('#cfgHourlyRate')?.value));
            earnedBaseEst = hRate * 176;
            mealEst = mealVal * 22;
            offPeriodVal = offMode === 'diaria' ? offVal * 22 : offVal;
            periodTag = 'Est. 176h/22d';
          }

          const tw = computeTwelfthsBreakdown(
            earnedBaseEst,
            twSelect?.value || 'Não',
            parseCurrencyInput(twVacInput?.value),
            parseCurrencyInput(twXmasInput?.value)
          );
          const ssBasis = Number((earnedBaseEst + tw.twelfthsTotal).toFixed(2));
          const receiptGross = Number((earnedBaseEst + mealEst + tw.twelfthsTotal).toFixed(2));
          const ssCut = Number((ssBasis * (ssPct / 100)).toFixed(2));
          const receiptNet = Math.max(0, Number((receiptGross - ssCut).toFixed(2)));
          const totalFinal = Number((receiptNet + offPeriodVal).toFixed(2));

          previewEl.innerHTML = `
            <div>
              <div class="erp-summary-item__label">Base + Alimentação (${escapeHtml(periodTag)})</div>
              <div class="erp-summary-item__val">${escapeHtml(formatCurrency(earnedBaseEst + mealEst))}</div>
            </div>
            <div>
              <div class="erp-summary-item__label">+ Duodécimos (Fér./Nat.)</div>
              <div class="erp-summary-item__val" style="color:var(--erp-navy);">+${escapeHtml(formatCurrency(tw.twelfthsTotal))}</div>
            </div>
            <div>
              <div class="erp-summary-item__label">Líquido Recibo (-${ssPct}% SS)</div>
              <div class="erp-summary-item__val">${escapeHtml(formatCurrency(receiptNet))}</div>
            </div>
            <div>
              <div class="erp-summary-item__label">+ Por Fora SS (sem SS)</div>
              <div class="erp-summary-item__val" style="color:var(--erp-accent-dark);">+${escapeHtml(formatCurrency(offPeriodVal))}</div>
            </div>
            <div>
              <div class="erp-summary-item__label">= Total Final Estimado</div>
              <div class="erp-summary-item__val erp-summary-item__val--success">${escapeHtml(formatCurrency(totalFinal))}</div>
            </div>
          `;
        };

        const syncUI = () => {
          const active = modal.querySelector('input[name="remunerationType"]:checked')?.value || 'mensal';
          modal.querySelectorAll('#cfgRemGroup .erp-regime-option').forEach((lbl) => {
            lbl.classList.toggle('is-selected', Boolean(lbl.querySelector('input')?.checked));
          });
          modal.querySelector('#cfgWrapBase').style.display = active === 'mensal' ? 'flex' : 'none';
          modal.querySelector('#cfgWrapDaily').style.display = active === 'diaria' ? 'flex' : 'none';
          modal.querySelector('#cfgWrapHourly').style.display = active === 'hora' ? 'flex' : 'none';
          modal.querySelector('#cfgWrapMeal').style.display = active !== 'mensal' ? 'flex' : 'none';

          const isCustomTw = twSelect?.value === 'personalizado';
          if (wrapTwVac) wrapTwVac.style.display = isCustomTw ? 'flex' : 'none';
          if (wrapTwXmas) wrapTwXmas.style.display = isCustomTw ? 'flex' : 'none';

          if (offSelect) {
            if (active === 'mensal') {
              offSelect.value = 'mensal';
              offSelect.disabled = true;
              if (offHint) offHint.textContent = 'Em ordenado fixo, o complemento por fora é fixo por mês (presenças não alteram).';
            } else {
              offSelect.disabled = false;
              if (offHint) offHint.textContent = 'Escolha se o complemento por fora soma por dia trabalhado ou se é fixo no mês.';
            }
          }
          renderPreview();
        };

        modal.querySelectorAll('input[name="remunerationType"]').forEach((r) => r.addEventListener('change', syncUI));
        twSelect?.addEventListener('change', syncUI);
        offSelect?.addEventListener('change', renderPreview);
        ['#cfgBaseSalary', '#cfgDailyRate', '#cfgHourlyRate', '#cfgSsPct', '#cfgMeal', '#cfgOffAmount', '#cfgTwVacManual', '#cfgTwXmasManual'].forEach((sel) => {
          modal.querySelector(sel)?.addEventListener('input', renderPreview);
        });
        syncUI();

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const chosenType = modal.querySelector('input[name="remunerationType"]:checked')?.value || 'mensal';
          const baseSalary = parseCurrencyInput(modal.querySelector('#cfgBaseSalary')?.value);
          const dailyRate = parseCurrencyInput(modal.querySelector('#cfgDailyRate')?.value);
          const hourlyRate = parseCurrencyInput(modal.querySelector('#cfgHourlyRate')?.value);

          if (chosenType === 'mensal' && baseSalary < 0) {
            showToast('Indique um vencimento mensal válido.', 'danger');
            return;
          }
          if (chosenType === 'diaria' && dailyRate <= 0) {
            showToast('Indique o valor da diária do colaborador.', 'danger');
            return;
          }
          if (chosenType === 'hora' && hourlyRate <= 0) {
            showToast('Indique o valor por hora do colaborador.', 'danger');
            return;
          }

          const chosenTwelfths = normalizeTwelfthsMode(twSelect?.value);
          const saveBtn = modal.querySelector('#btnSaveSalaryCfg');
          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'A guardar...';
          }

          const res = await store.updateEmployee(emp.id, {
            remunerationType: chosenType,
            baseSalary,
            dailyRate,
            hourlyRate,
            ssPercentage: Math.min(100, Math.max(0, Number(modal.querySelector('#cfgSsPct')?.value ?? 11) || 0)),
            mealAllowance: chosenType === 'mensal' ? 0 : parseCurrencyInput(modal.querySelector('#cfgMeal')?.value),
            offPayrollType: chosenType === 'mensal' ? 'mensal' : offSelect?.value === 'diaria' ? 'diaria' : 'mensal',
            offPayrollAmount: Math.max(0, parseCurrencyInput(offAmountInput?.value)),
            twelfths: chosenTwelfths,
            twelfthsVacationManual: chosenTwelfths === 'personalizado' ? Math.max(0, parseCurrencyInput(twVacInput?.value)) : 0,
            twelfthsChristmasManual: chosenTwelfths === 'personalizado' ? Math.max(0, parseCurrencyInput(twXmasInput?.value)) : 0,
            iban: String(modal.querySelector('#cfgIban')?.value || '').trim(),
          });

          if (res !== null) {
            showToast(`Condições salariais de ${emp.name} guardadas na base de dados.`);
            closeModal();
          } else if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Guardar Condições Salariais';
          }
        });
      },
    });
  }

  _openGlobalAdvanceModal(month) {
    const activeEmployees = (store.getState().employees || []).filter((e) => e.status === 'ativo');
    if (activeEmployees.length === 0) {
      showToast('Registe primeiro pelo menos um funcionário ativo.', 'warning');
      return;
    }
    this._openAdvancePopup(activeEmployees[0].id, month, true);
  }

  _openAdvancePopup(empId, month, allowPickEmployee = false) {
    if (this._can && !this._can('rh_funcionarios', 'pagamentos')) {
      showToast('Sem permissão para consultar valores a pagar ou registar adiantamentos.', 'warning');
      return;
    }
    const state = store.getState();
    const activeEmployees = (state.employees || []).filter((e) => e.status === 'ativo');
    const emp = state.employees.find((e) => e.id === empId) || activeEmployees[0];
    if (!emp) return;

    const s = computeEmployeeMonthlyPayroll(emp, state.attendance, state.employeeAdvances, month);

    openModal({
      title: allowPickEmployee ? 'Registar Adiantamento / Vale Salarial' : `Ordenado & Adiantamentos — ${emp.name}`,
      subtitle: `${REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal'} · ${formatMonthLabel(month)}`,
      bodyHtml: `
        ${
          allowPickEmployee
            ? `<div class="erp-field erp-field--full" style="margin-bottom:14px;">
                 <label for="advEmpSelect">Colaborador *</label>
                 <select id="advEmpSelect">
                   ${activeEmployees.map((e) => `<option value="${escapeHtml(e.id)}" ${e.id === emp.id ? 'selected' : ''}>${escapeHtml(e.name)} (${escapeHtml(e.role)})</option>`).join('')}
                 </select>
               </div>`
            : ''
        }

        <div class="erp-summary-box" style="margin-bottom:16px;" id="advSummaryBox">
          <div>
            <div class="erp-summary-item__label">Líquido Recibo (c/ SS ${s.ssPercentage}%)</div>
            <div class="erp-summary-item__val">${escapeHtml(formatCurrency(s.receiptNetPay))}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">+ Por Fora SS</div>
            <div class="erp-summary-item__val" style="color:var(--erp-accent-dark);">+${escapeHtml(formatCurrency(s.offPayrollEarned))}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Vales Retirados (${s.monthAdvances.length})</div>
            <div class="erp-summary-item__val erp-summary-item__val--danger">-${escapeHtml(formatCurrency(s.advancesTotal))}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Total Final a Receber</div>
            <div class="erp-summary-item__val erp-summary-item__val--success">${escapeHtml(formatCurrency(s.netToPay))}</div>
          </div>
        </div>

        <form id="empAdvanceForm" class="erp-inline-invoice-box">
          <div class="erp-form-section__title" style="margin-bottom:10px;">Registar Adiantamento Antecipado</div>
          <div class="erp-form-grid erp-form-grid--3">
            <div class="erp-field">
              <label for="advAmount">Valor Retirado (€) *</label>
              <input type="text" inputmode="numeric" data-currency-euro id="advAmount" required placeholder="€ 0,00">
            </div>
            <div class="erp-field">
              <label for="advDate">Data do Levantamento</label>
              <input type="date" id="advDate" value="${todayISO()}">
            </div>
            <div class="erp-field">
              <label for="advNotes">Observação / Motivo</label>
              <input type="text" id="advNotes" placeholder="Ex.: Adiantamento quinzenal">
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
            <button type="submit" class="erp-btn erp-btn--primary erp-btn--sm" id="btnSaveAdvance">
              ${ICONS.plus}<span>Registar Adiantamento</span>
            </button>
          </div>
        </form>

        <div id="advMonthHistory" style="margin-top:14px;">
          ${
            s.monthAdvances.length > 0
              ? `<div class="erp-form-section__title" style="margin-bottom:8px;">Vales já registados em ${escapeHtml(formatMonthLabel(month))}</div>
                 <div class="erp-table-wrap">
                   <table class="erp-table">
                     <tbody>
                       ${s.monthAdvances
                         .map(
                           (adv) => `
                         <tr>
                           <td>${escapeHtml(formatDatePT(adv.date))}</td>
                           <td>${escapeHtml(adv.notes || 'Adiantamento de ordenado')}</td>
                           <td style="text-align:right;font-weight:700;color:var(--erp-danger);">-${escapeHtml(formatCurrency(adv.amount))}</td>
                           <td style="text-align:right"><button type="button" class="erp-icon-btn erp-icon-btn--danger" data-del-adv="${escapeHtml(adv.id)}" title="Remover Vale">${ICONS.trash}</button></td>
                         </tr>`
                         )
                         .join('')}
                     </tbody>
                   </table>
                 </div>`
              : ''
          }
        </div>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" id="btnAdvGoCloseMonth">Ir para Fecho do Mês</button>
        <button type="button" class="erp-btn erp-btn--primary" data-modal-close>Concluir</button>
      `,
      onMount: (modal) => {
        let selectedEmpId = emp.id;
        const empPicker = modal.querySelector('#advEmpSelect');
        empPicker?.addEventListener('change', () => {
          selectedEmpId = empPicker.value;
          const targetEmp = store.getState().employees.find((x) => x.id === selectedEmpId);
          if (!targetEmp) return;
          const nextStats = computeEmployeeMonthlyPayroll(targetEmp, store.getState().attendance, store.getState().employeeAdvances, month);
          const box = modal.querySelector('#advSummaryBox');
          if (box) {
            box.innerHTML = `
              <div>
                <div class="erp-summary-item__label">Líquido Recibo (c/ SS ${nextStats.ssPercentage}%)</div>
                <div class="erp-summary-item__val">${escapeHtml(formatCurrency(nextStats.receiptNetPay))}</div>
              </div>
              <div>
                <div class="erp-summary-item__label">+ Por Fora SS</div>
                <div class="erp-summary-item__val" style="color:var(--erp-accent-dark);">+${escapeHtml(formatCurrency(nextStats.offPayrollEarned))}</div>
              </div>
              <div>
                <div class="erp-summary-item__label">Vales Retirados (${nextStats.monthAdvances.length})</div>
                <div class="erp-summary-item__val erp-summary-item__val--danger">-${escapeHtml(formatCurrency(nextStats.advancesTotal))}</div>
              </div>
              <div>
                <div class="erp-summary-item__label">Total Final a Receber</div>
                <div class="erp-summary-item__val erp-summary-item__val--success">${escapeHtml(formatCurrency(nextStats.netToPay))}</div>
              </div>
            `;
          }
        });

        modal.querySelector('#empAdvanceForm')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const amount = parseCurrencyInput(modal.querySelector('#advAmount')?.value);
          if (amount <= 0) {
            showToast('Indique o valor retirado antecipadamente (maior que € 0,00).', 'danger');
            return;
          }
          const targetEmp = store.getState().employees.find((x) => x.id === selectedEmpId) || emp;
          const saveBtn = modal.querySelector('#btnSaveAdvance');
          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'A guardar...';
          }
          await store.addEmployeeAdvance({
            id: generateId('ADV'),
            employeeId: targetEmp.id,
            month,
            date: modal.querySelector('#advDate')?.value || todayISO(),
            amount,
            notes: modal.querySelector('#advNotes')?.value || '',
          });
          showToast(`Adiantamento de ${formatCurrency(amount)} registado para ${targetEmp.name}.`);
          this._openAdvancePopup(targetEmp.id, month, allowPickEmployee);
        });

        modal.querySelectorAll('[data-del-adv]').forEach((btn) => {
          btn.addEventListener('click', () => {
            store.deleteEmployeeAdvance(btn.dataset.delAdv);
            showToast('Adiantamento removido.');
            this._openAdvancePopup(selectedEmpId, month, allowPickEmployee);
          });
        });

        modal.querySelector('#btnAdvGoCloseMonth')?.addEventListener('click', () => {
          this._openCloseMonthModal(selectedEmpId, month);
        });
      },
    });
  }

  _openCloseMonthModal(empId, month) {
    if (this._can && !this._can('rh_funcionarios', 'pagamentos')) {
      showToast('Sem permissão para consultar o fecho do mês ou valores a pagar.', 'warning');
      return;
    }
    const state = store.getState();
    const emp = state.employees.find((e) => e.id === empId);
    if (!emp) return;

    const baseStats = computeEmployeeMonthlyPayroll(emp, state.attendance, state.employeeAdvances, month);
    const canEmitPayslip = !this._can || this._can('rh_recibos', 'emitir');
    const remDesc =
      baseStats.remunerationType === 'diaria'
        ? `${baseStats.present} dia(s) com presença × ${formatCurrency(baseStats.dailyRate)}/dia`
        : baseStats.remunerationType === 'hora'
          ? `${baseStats.totalHours}h em ${baseStats.present} dia(s) × ${formatCurrency(baseStats.hourlyRate)}/h`
          : `Vencimento Fixo Mensal (presenças não alteram este valor)`;

    let activeTwelfthsMode = normalizeTwelfthsMode(emp.twelfths);
    let customVacVal = Number(emp.twelfthsVacationManual) || 0;
    let customXmasVal = Number(emp.twelfthsChristmasManual) || 0;

    const calcCloseSummary = () => {
      const tw = computeTwelfthsBreakdown(
        baseStats.earnedBase,
        activeTwelfthsMode,
        customVacVal,
        customXmasVal
      );
      const ssBasis = Number((baseStats.earnedBase + tw.twelfthsTotal).toFixed(2));
      const ssDeduction = Number((ssBasis * (baseStats.ssPercentage / 100)).toFixed(2));
      const grossPay = Number((baseStats.earnedBase + baseStats.mealEarned + tw.twelfthsTotal).toFixed(2));
      const receiptNetPay = Math.max(0, Number((grossPay - ssDeduction).toFixed(2)));
      const netToPay = Math.max(
        0,
        Number((receiptNetPay + baseStats.offPayrollEarned - baseStats.advancesTotal).toFixed(2))
      );
      return {
        ...baseStats,
        twelfthsMode: tw.twelfthsMode,
        twelfthsVacation: tw.twelfthsVacation,
        twelfthsChristmas: tw.twelfthsChristmas,
        twelfthsTotal: tw.twelfthsTotal,
        ssDeduction,
        grossPay,
        receiptNetPay,
        netToPay,
      };
    };

    const renderCloseBody = () => {
      const s = calcCloseSummary();
      return `
        <div class="erp-cred-box" style="margin-bottom:14px;text-align:center;">
          <div class="erp-summary-item__label">Total Final a Pagar ao Funcionário em ${escapeHtml(formatMonthLabel(month))}</div>
          <div style="font-family:var(--erp-font-heading);font-size:28px;font-weight:900;color:var(--erp-success);margin:4px 0;">
            ${escapeHtml(formatCurrency(s.netToPay))}
          </div>
          <span class="erp-cell-sub">${escapeHtml(remDesc)}${s.twelfthsTotal > 0 ? ` · + ${escapeHtml(formatCurrency(s.twelfthsTotal))} duodécimos` : ''}${s.offPayrollEarned > 0 ? ` · + ${escapeHtml(formatCurrency(s.offPayrollEarned))} por fora SS` : ''}</span>
        </div>

        <div class="erp-inline-invoice-box" style="margin-bottom:14px;">
          <div class="erp-form-section__title" style="margin-bottom:8px;">Qual a opção de Duodécimos (Férias &amp; Natal) pretende aplicar neste mês?</div>
          <div class="erp-form-grid">
            <div class="erp-field erp-field--full">
              <label for="closeMonthTwelfthsMode">Modalidade de Duodécimos (Gestor)</label>
              <select id="closeMonthTwelfthsMode">
                ${TWELFTHS_OPTIONS.map((opt) => `<option value="${escapeHtml(opt.value)}" ${activeTwelfthsMode === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field" id="wrapCloseCustomVac" style="display:${activeTwelfthsMode === 'personalizado' ? 'flex' : 'none'};">
              <label for="closeCustomVac">Duodécimo Subsídio de Férias (€)</label>
              <input type="text" inputmode="numeric" data-currency-euro id="closeCustomVac" value="${escapeHtml(customVacVal)}" placeholder="€ 0,00">
            </div>
            <div class="erp-field" id="wrapCloseCustomXmas" style="display:${activeTwelfthsMode === 'personalizado' ? 'flex' : 'none'};">
              <label for="closeCustomXmas">Duodécimo Subsídio de Natal (€)</label>
              <input type="text" inputmode="numeric" data-currency-euro id="closeCustomXmas" value="${escapeHtml(customXmasVal)}" placeholder="€ 0,00">
            </div>
            <div class="erp-field erp-field--full" style="margin-top:2px;">
              <label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;">
                <input type="checkbox" id="closeMonthSaveTwelfths">
                <span>Guardar esta preferência de duodécimos como padrão na ficha salarial de ${escapeHtml(emp.name)}</span>
              </label>
            </div>
          </div>
        </div>

        <div class="erp-table-wrap">
          <table class="erp-table">
            <tbody>
              <tr>
                <td><strong>Base em Recibo (${escapeHtml(REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal')})</strong></td>
                <td style="text-align:right;font-weight:700;">+ ${escapeHtml(formatCurrency(s.earnedBase))}</td>
              </tr>
              <tr>
                <td><strong>Duodécimo Subsídio de Férias (${escapeHtml(getTwelfthsOptionMeta(s.twelfthsMode).shortLabel)})</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-navy);">+ ${escapeHtml(formatCurrency(s.twelfthsVacation))}</td>
              </tr>
              <tr>
                <td><strong>Duodécimo Subsídio de Natal</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-navy);">+ ${escapeHtml(formatCurrency(s.twelfthsChristmas))}</td>
              </tr>
              ${
                s.remunerationType !== 'mensal' || s.mealEarned > 0
                  ? `<tr>
                       <td><strong>Subsídio de Alimentação (${s.present} dia(s) × ${escapeHtml(formatCurrency(emp.mealAllowance))})</strong></td>
                       <td style="text-align:right;font-weight:700;">+ ${escapeHtml(formatCurrency(s.mealEarned))}</td>
                     </tr>`
                  : ''
              }
              <tr>
                <td><strong>Desconto Segurança Social (${s.ssPercentage}% sobre base + duodécimos)</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(s.ssDeduction))}</td>
              </tr>
              <tr>
                <td><strong>Pagamento Por Fora da Segurança Social (${s.offPayrollType === 'diaria' ? `${s.present} dia(s) × ${escapeHtml(formatCurrency(s.offPayrollAmount))}` : 'Fixo Mensal — sem desconto SS'})</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-accent-dark);">+ ${escapeHtml(formatCurrency(s.offPayrollEarned))}</td>
              </tr>
              <tr>
                <td><strong>Adiantamentos / Vales Retirados no Mês (${s.monthAdvances.length})</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(s.advancesTotal))}</td>
              </tr>
              <tr style="background:var(--erp-surface-alt);">
                <td><strong style="font-size:14px;">TOTAL FINAL A PAGAR</strong></td>
                <td style="text-align:right;font-size:16px;font-weight:900;color:var(--erp-success);">${escapeHtml(formatCurrency(s.netToPay))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    };

    openModal({
      title: `Fecho de Mês — ${emp.name}`,
      subtitle: `${formatMonthLabel(month)} · ${REMUNERATION_LABELS[baseStats.remunerationType] || 'Fixo Mensal'}`,
      bodyHtml: `<div id="closeMonthWrap">${renderCloseBody()}</div>`,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" id="btnCloseMonthAdvance">Registar / Ver Adiantamentos</button>
        ${
          canEmitPayslip
            ? `<button type="button" class="erp-btn erp-btn--primary" id="btnConfirmCloseMonth">${ICONS.checkCircle}<span>Confirmar Fecho &amp; Gerar Recibo</span></button>`
            : ''
        }
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
      `,
      onMount: (modal) => {
        const wrap = modal.querySelector('#closeMonthWrap');
        const bindCloseControls = (keepFocusSelector = null) => {
          attachEuroMasks(wrap);
          const modeSelect = modal.querySelector('#closeMonthTwelfthsMode');
          const vacInput = modal.querySelector('#closeCustomVac');
          const xmasInput = modal.querySelector('#closeCustomXmas');

          modeSelect?.addEventListener('change', (e) => {
            activeTwelfthsMode = e.target.value;
            const saveDefaultChecked = Boolean(modal.querySelector('#closeMonthSaveTwelfths')?.checked);
            wrap.innerHTML = renderCloseBody();
            bindCloseControls();
            const cb = modal.querySelector('#closeMonthSaveTwelfths');
            if (cb) cb.checked = saveDefaultChecked;
          });

          const onCustomChange = (fieldSel) => {
            customVacVal = parseCurrencyInput(vacInput?.value);
            customXmasVal = parseCurrencyInput(xmasInput?.value);
            const saveDefaultChecked = Boolean(modal.querySelector('#closeMonthSaveTwelfths')?.checked);
            wrap.innerHTML = renderCloseBody();
            bindCloseControls(fieldSel);
            const cb = modal.querySelector('#closeMonthSaveTwelfths');
            if (cb) cb.checked = saveDefaultChecked;
          };

          vacInput?.addEventListener('change', () => onCustomChange('#closeCustomVac'));
          xmasInput?.addEventListener('change', () => onCustomChange('#closeCustomXmas'));

          if (keepFocusSelector) {
            modal.querySelector(keepFocusSelector)?.focus();
          }
        };
        bindCloseControls();

        modal.querySelector('#btnCloseMonthAdvance')?.addEventListener('click', () => {
          this._openAdvancePopup(emp.id, month);
        });
        modal.querySelector('#btnConfirmCloseMonth')?.addEventListener('click', async () => {
          const finalSummary = calcCloseSummary();
          const shouldSaveDefault = Boolean(modal.querySelector('#closeMonthSaveTwelfths')?.checked);

          if (shouldSaveDefault) {
            await store.updateEmployee(emp.id, {
              twelfths: finalSummary.twelfthsMode,
              twelfthsVacationManual: finalSummary.twelfthsMode === 'personalizado' ? customVacVal : 0,
              twelfthsChristmasManual: finalSummary.twelfthsMode === 'personalizado' ? customXmasVal : 0,
            });
          }

          const payslipId = generateId('REC');
          store.addPayslip({
            id: payslipId,
            employeeId: emp.id,
            month,
            baseSalary: finalSummary.earnedBase,
            mealAllowanceTotal: finalSummary.mealEarned,
            twelfthVacation: finalSummary.twelfthsVacation,
            twelfthChristmas: finalSummary.twelfthsChristmas,
            overtimeBonus: 0,
            socialSecurity: finalSummary.ssDeduction,
            irsRetention: 0,
            otherDeductions: finalSummary.advancesTotal,
            offPayroll: finalSummary.offPayrollEarned,
            netSalary: finalSummary.netToPay,
            paymentDate: todayISO(),
            status: 'pago',
            notes: `Fecho mensal (${REMUNERATION_LABELS[finalSummary.remunerationType]} · ${getTwelfthsOptionMeta(finalSummary.twelfthsMode).shortLabel}${finalSummary.twelfthsTotal > 0 ? `: ${formatCurrency(finalSummary.twelfthsTotal)}` : ''} · SS ${finalSummary.ssPercentage}%${finalSummary.offPayrollEarned > 0 ? ` · Por fora SS: ${formatCurrency(finalSummary.offPayrollEarned)}` : ''}${finalSummary.advancesTotal > 0 ? ` · Adiantamentos: ${formatCurrency(finalSummary.advancesTotal)}` : ''})`,
          });
          showToast(
            `Mês fechado para ${emp.name}! Valor pago registado: ${formatCurrency(finalSummary.netToPay)} (${payslipId}).`,
            'success',
            5500
          );
          closeModal();
        });
      },
    });
  }
}
