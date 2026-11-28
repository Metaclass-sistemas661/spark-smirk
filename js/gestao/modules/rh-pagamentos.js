/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — RH: Ordenados, Duodécimos, Por Fora SS & Pagamentos
   ═══════════════════════════════════════════════════════════ */

import { store } from '../core/store.js';
import {
  TWELFTHS_OPTIONS,
  computeCompanyCashSummary,
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
import { generateSparkReportPdf } from '../core/pdf-report.js';
import { ICONS, openModal, closeModal, confirmAction, showToast } from '../core/ui.js';

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

function hasSalaryConfigured(emp) {
  return (
    (Number(emp?.baseSalary) || 0) > 0 ||
    (Number(emp?.dailyRate) || 0) > 0 ||
    (Number(emp?.hourlyRate) || 0) > 0 ||
    (Number(emp?.offPayrollAmount) || 0) > 0
  );
}

export class RhPagamentosModule {
  constructor(options = {}) {
    this.viewMode = 'payroll'; // 'payroll' | 'config' | 'advances'
    this.employeeFilter = 'all'; // 'all' | employeeId
    this.deptFilter = 'all';
    this.remFilter = 'all';
    this.payStateFilter = 'all'; // 'all' | 'unclosed' | 'closed' | 'unconfigured' | 'off_payroll' | 'with_advances'
    this.advScope = 'month'; // 'month' | 'all'
    this.expandedAdvEmployees = new Set();
    this.onOpenPayslips = options.onOpenPayslips || null;
    this.onOpenAdvancedReports = options.onOpenAdvancedReports || null;
  }

  _hasActiveFilters() {
    return (
      this.employeeFilter !== 'all' ||
      this.deptFilter !== 'all' ||
      this.remFilter !== 'all' ||
      this.payStateFilter !== 'all'
    );
  }

  _resetFilters() {
    this.employeeFilter = 'all';
    this.deptFilter = 'all';
    this.remFilter = 'all';
    this.payStateFilter = 'all';
  }

  _matchesEmployeeFilters(emp, state, month, payslipsByEmp, query) {
    if (this.employeeFilter !== 'all' && emp.id !== this.employeeFilter) return false;
    if (this.deptFilter !== 'all' && emp.department !== this.deptFilter) return false;
    if (this.remFilter !== 'all' && (emp.remunerationType || 'mensal') !== this.remFilter) return false;

    if (query) {
      const hay = `${emp.name} ${emp.role} ${emp.department} ${emp.nif} ${emp.iban || ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }

    if (this.payStateFilter !== 'all') {
      const configured = hasSalaryConfigured(emp);
      const payslip = payslipsByEmp.get(emp.id);
      const hasAdv = (state.employeeAdvances || []).some(
        (a) => a.employeeId === emp.id && String(a.month || a.date || '').slice(0, 7) === month
      );
      if (this.payStateFilter === 'unclosed' && (payslip || !configured)) return false;
      if (this.payStateFilter === 'closed' && !payslip) return false;
      if (this.payStateFilter === 'unconfigured' && configured) return false;
      if (this.payStateFilter === 'off_payroll' && (Number(emp.offPayrollAmount) || 0) <= 0) return false;
      if (this.payStateFilter === 'with_advances' && !hasAdv) return false;
    }

    return true;
  }

  render(container, ctx) {
    this._can = ctx.can || (() => true);
    const canSeeSalary = this._can('rh_funcionarios', 'ordenados');
    const canSeePayable = this._can('rh_funcionarios', 'pagamentos');
    const state = store.getState();
    const { month, search } = ctx;
    const query = (search || '').trim().toLowerCase();

    const payslipsByEmp = new Map();
    (state.payslips || [])
      .filter((p) => p.month === month)
      .forEach((p) => {
        payslipsByEmp.set(p.employeeId, p);
      });

    if (
      this.employeeFilter !== 'all' &&
      !(state.employees || []).some((e) => e.id === this.employeeFilter)
    ) {
      this.employeeFilter = 'all';
    }

    const activeEmployees = (state.employees || []).filter((e) => e.status === 'ativo');
    const filteredActive = activeEmployees.filter((e) =>
      this._matchesEmployeeFilters(e, state, month, payslipsByEmp, query)
    );
    const filteredAll = (state.employees || []).filter((e) =>
      this._matchesEmployeeFilters(e, state, month, payslipsByEmp, query)
    );

    const kpiSource = filteredActive;
    let totalReceiptGross = 0;
    let totalSS = 0;
    let totalOffPayroll = 0;
    let totalNetToPay = 0;
    let offPayrollCount = 0;

    kpiSource.forEach((emp) => {
      const s = computeEmployeeMonthlyPayroll(emp, state.attendance, state.employeeAdvances, month);
      totalReceiptGross += s.grossPay;
      totalSS += s.ssDeduction;
      totalOffPayroll += s.offPayrollEarned;
      totalNetToPay += s.netToPay;
      if (s.offPayrollAmount > 0) offPayrollCount += 1;
    });

    const filteredEmpIds = new Set(kpiSource.map((e) => e.id));
    const scopedMonthAdvances = (state.employeeAdvances || []).filter(
      (a) =>
        String(a.month || a.date || '').slice(0, 7) === month &&
        (this.employeeFilter === 'all'
          ? !this._hasActiveFilters() || filteredEmpIds.has(a.employeeId)
          : a.employeeId === this.employeeFilter)
    );
    const totalMonthAdvances = scopedMonthAdvances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

    const unclosedEligible = activeEmployees.filter(
      (emp) => hasSalaryConfigured(emp) && !payslipsByEmp.has(emp.id)
    );
    const unconfiguredCount = activeEmployees.filter((emp) => !hasSalaryConfigured(emp)).length;
    const selectedEmp =
      this.employeeFilter !== 'all'
        ? (state.employees || []).find((e) => e.id === this.employeeFilter) || null
        : null;
    const kpiScopeLabel = selectedEmp
      ? `Filtro: ${selectedEmp.name}`
      : this._hasActiveFilters()
        ? `${kpiSource.length} colaborador(es) filtrado(s)`
        : 'Base apurada + duodécimos + sub. alimentação';

    const groupedAdvancePeopleCount = new Set(scopedMonthAdvances.map((a) => a.employeeId)).size;

    container.innerHTML = `
      <div class="erp-kpi-grid">
        <div class="erp-kpi-card erp-kpi-card--primary">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Ilíquido em Recibo (${escapeHtml(month)})</span>
            <span class="erp-kpi-card__icon">${ICONS.receipt}</span>
          </div>
          <div class="erp-kpi-card__value">${canSeeSalary ? escapeHtml(formatCurrency(totalReceiptGross)) : 'Restrito'}</div>
          <div class="erp-kpi-card__meta">${escapeHtml(kpiScopeLabel)}</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--warning">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Segurança Social (${escapeHtml(month)})</span>
            <span class="erp-kpi-card__icon">${ICONS.chart}</span>
          </div>
          <div class="erp-kpi-card__value">${canSeeSalary ? escapeHtml(formatCurrency(totalSS)) : 'Restrito'}</div>
          <div class="erp-kpi-card__meta">Retida sobre vencimento e duodécimos em recibo</div>
        </div>

        <div class="erp-kpi-card">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Por Fora da SS (${escapeHtml(month)})</span>
            <span class="erp-kpi-card__icon">${ICONS.briefcase}</span>
          </div>
          <div class="erp-kpi-card__value">${canSeeSalary ? escapeHtml(formatCurrency(totalOffPayroll)) : 'Restrito'}</div>
          <div class="erp-kpi-card__meta">${offPayrollCount} colaborador(es) com complemento sem SS</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--success">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Total Líquido a Pagar</span>
            <span class="erp-kpi-card__icon">${ICONS.euro}</span>
          </div>
          <div class="erp-kpi-card__value">${canSeePayable ? escapeHtml(formatCurrency(totalNetToPay)) : 'Restrito'}</div>
          <div class="erp-kpi-card__meta">${scopedMonthAdvances.length} vale(s) em ${groupedAdvancePeopleCount} pessoa(s): -${escapeHtml(formatCurrency(totalMonthAdvances))}</div>
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
              <span>Regras Salariais (Config. Única)</span>
              <span class="erp-subtab__badge">${filteredAll.length}</span>
            </button>
            <button type="button" class="erp-subtab ${this.viewMode === 'advances' ? 'is-active' : ''}" data-paytab-view="advances" ${canSeePayable ? '' : 'style="display:none"'}>
              ${ICONS.receipt}
              <span>Adiantamentos &amp; Vales</span>
              <span class="erp-subtab__badge">${groupedAdvancePeopleCount}</span>
            </button>
          </div>

          <div class="erp-panel__actions">
            ${
              canSeeSalary || canSeePayable
                ? `<button type="button" class="erp-btn erp-btn--outline" id="btnExportPayrollCsv">${ICONS.download}<span>Exportar Folha CSV</span></button>`
                : ''
            }
            ${
              canSeePayable && unclosedEligible.length > 0 && this._can('rh_recibos', 'emitir')
                ? `<button type="button" class="erp-btn erp-btn--secondary" id="btnBatchCloseMonth" title="Gerar recibos mensais em lote usando as regras salariais guardadas">
                    ${ICONS.checkCircle}
                    <span>Fechar Mês em Lote (${unclosedEligible.length})</span>
                  </button>`
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
      this._exportPayrollCSV(filteredActive, state, month, canSeeSalary, canSeePayable);
    });

    container.querySelector('#btnBatchCloseMonth')?.addEventListener('click', () => {
      this._openBatchCloseMonthModal(unclosedEligible, month);
    });

    container.querySelector('#btnNewAdvanceGlobal')?.addEventListener('click', () => {
      this._openGlobalAdvanceModal(month);
    });

    const body = container.querySelector('#payrollTabBody');
    if (this.viewMode === 'config') {
      this._renderConfigDirectory(body, filteredAll, state.employees || [], month);
    } else if (this.viewMode === 'advances') {
      this._renderAdvancesLedger(body, state, month, query);
    } else {
      this._renderPayrollSheet(
        body,
        filteredActive,
        state,
        month,
        payslipsByEmp,
        unconfiguredCount,
        canSeeSalary,
        canSeePayable
      );
    }
  }

  _renderFilterControls(allEmployees, labelText, options = {}) {
    const { showPayState = true, extraControlsHtml = '' } = options;
    const sortedEmployees = [...allEmployees].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'pt')
    );

    return `
      <div class="erp-attendance-controls">
        <div class="erp-filter-bar">
          <select class="erp-select-sm" id="filterPayEmployee" title="Filtrar por funcionário específico ou todos">
            <option value="all" ${this.employeeFilter === 'all' ? 'selected' : ''}>Todos os Funcionários (${sortedEmployees.length})</option>
            ${sortedEmployees
              .map(
                (e) => `<option value="${escapeHtml(e.id)}" ${this.employeeFilter === e.id ? 'selected' : ''}>${escapeHtml(e.name)} · ${escapeHtml(e.role)}</option>`
              )
              .join('')}
          </select>

          <select class="erp-select-sm" id="filterPayDept" title="Departamento">
            <option value="all">Todos os Departamentos</option>
            ${DEPARTMENTS.map(
              (d) => `<option value="${escapeHtml(d)}" ${this.deptFilter === d ? 'selected' : ''}>${escapeHtml(d)}</option>`
            ).join('')}
          </select>

          <select class="erp-select-sm" id="filterPayRemType" title="Modalidade Salarial">
            <option value="all" ${this.remFilter === 'all' ? 'selected' : ''}>Todas as Modalidades</option>
            <option value="mensal" ${this.remFilter === 'mensal' ? 'selected' : ''}>Fixo Mensal</option>
            <option value="diaria" ${this.remFilter === 'diaria' ? 'selected' : ''}>Por Dia (Diária)</option>
            <option value="hora" ${this.remFilter === 'hora' ? 'selected' : ''}>Por Hora</option>
          </select>

          ${
            showPayState
              ? `<select class="erp-select-sm" id="filterPayState" title="Estado de Pagamento / Configuração">
                   <option value="all" ${this.payStateFilter === 'all' ? 'selected' : ''}>Todos os Estados</option>
                   <option value="unclosed" ${this.payStateFilter === 'unclosed' ? 'selected' : ''}>Por Fechar neste Mês</option>
                   <option value="closed" ${this.payStateFilter === 'closed' ? 'selected' : ''}>Recibo já Emitido</option>
                   <option value="unconfigured" ${this.payStateFilter === 'unconfigured' ? 'selected' : ''}>Sem Salário Definido (1.ª Vez)</option>
                   <option value="off_payroll" ${this.payStateFilter === 'off_payroll' ? 'selected' : ''}>Com Por Fora da SS</option>
                   <option value="with_advances" ${this.payStateFilter === 'with_advances' ? 'selected' : ''}>Com Adiantamentos / Vales</option>
                 </select>`
              : ''
          }

          ${extraControlsHtml}

          ${
            this._hasActiveFilters()
              ? `<button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnClearPayFilters">Limpar Filtros</button>`
              : ''
          }
        </div>
        <span class="erp-cell-sub">${labelText}</span>
      </div>
    `;
  }

  _bindFilterEvents(target) {
    target.querySelector('#filterPayEmployee')?.addEventListener('change', (e) => {
      this.employeeFilter = e.target.value;
      store._commit();
    });
    target.querySelector('#filterPayDept')?.addEventListener('change', (e) => {
      this.deptFilter = e.target.value;
      store._commit();
    });
    target.querySelector('#filterPayRemType')?.addEventListener('change', (e) => {
      this.remFilter = e.target.value;
      store._commit();
    });
    target.querySelector('#filterPayState')?.addEventListener('change', (e) => {
      this.payStateFilter = e.target.value;
      store._commit();
    });
    target.querySelector('#btnClearPayFilters')?.addEventListener('click', () => {
      this._resetFilters();
      store._commit();
    });
  }

  _renderPayrollSheet(
    target,
    employees,
    state,
    month,
    payslipsByEmp,
    unconfiguredCount,
    canSeeSalary,
    canSeePayable
  ) {
    const allEmployees = state.employees || [];
    const smartBanner =
      unconfiguredCount > 0 && canSeeSalary && this.payStateFilter !== 'unconfigured'
        ? `<div class="erp-smart-banner">
             <span><strong>Configuração pendente:</strong> ${unconfiguredCount} colaborador(es) ativo(s) ainda não têm o ordenado base configurado. A configuração é feita apenas uma vez e replica automaticamente para os meses seguintes.</span>
             <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnFilterUnconfigured">Ver Pendentes (${unconfiguredCount})</button>
           </div>`
        : '';

    target.innerHTML = `
      ${this._renderFilterControls(
        allEmployees,
        `Folha de ${escapeHtml(formatMonthLabel(month))} · Regras configuradas aplicam-se automaticamente todos os meses`,
        { showPayState: true }
      )}
      ${smartBanner}

      ${
        employees.length === 0
          ? `<div class="erp-empty">${ICONS.euro}<div class="erp-empty__title">Nenhum colaborador encontrado neste filtro</div><p>Altere os filtros acima ou limpe a pesquisa para ver todos os colaboradores.</p></div>`
          : `
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Colaborador &amp; Assiduidade</th>
                ${canSeeSalary ? '<th>Regra Permanente, Duodécimos &amp; SS%</th><th>Em Recibo (c/ SS)</th><th>Por Fora SS</th>' : ''}
                ${canSeePayable ? '<th>Adiantamentos</th><th>Líquido Final a Pagar</th>' : ''}
                <th style="text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${employees
                .map((emp) => {
                  const s = computeEmployeeMonthlyPayroll(emp, state.attendance, state.employeeAdvances, month);
                  const payslip = payslipsByEmp.get(emp.id);
                  const configured = hasSalaryConfigured(emp);
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
                            <span class="erp-att-pill erp-att-pill--P" style="font-size:11px;padding:1px 6px;">${s.weekdayPresent}d</span>
                            ${s.saturdayCount > 0 ? `<span class="erp-badge erp-badge--warning" style="padding:1px 6px;font-size:10.5px;">${s.saturdayCount} Sáb. (+${escapeHtml(formatCurrency(s.saturdayTotal))})</span>` : ''}
                            ${s.remunerationType === 'mensal' ? '<span style="font-size:11px;color:var(--erp-text-muted);">Fixo</span>' : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    ${
                      canSeeSalary
                        ? `<td>
                             ${
                               configured
                                 ? `<div class="erp-cell-title">${escapeHtml(rateLabel)} · ${escapeHtml(REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal')}</div>
                                    <div class="erp-cell-sub">SS ${s.ssPercentage}%${s.twelfthsMode !== 'Não' ? ` · <strong>${escapeHtml(twMeta.shortLabel)}</strong> (+${escapeHtml(formatCurrency(s.twelfthsTotal))})` : ' · Sem duodécimos'}</div>`
                                 : `<span class="erp-badge erp-badge--warning">Salário por definir (1.ª vez)</span>`
                             }
                           </td>
                           <td>
                             <div class="erp-cell-title">${escapeHtml(formatCurrency(s.receiptNetPay))}</div>
                             <div class="erp-cell-sub">Bruto ${escapeHtml(formatCurrency(s.grossPay))} · SS -${escapeHtml(formatCurrency(s.ssDeduction))}${s.saturdayReceiptTotal > 0 ? ` · Sáb. +${escapeHtml(formatCurrency(s.saturdayReceiptTotal))}` : ''}</div>
                           </td>
                           <td>
                             <div class="erp-cell-title" style="color:${s.offPayrollEarned > 0 ? 'var(--erp-accent-dark)' : 'var(--erp-text-muted)'};">
                               ${s.offPayrollEarned > 0 ? `+ ${escapeHtml(formatCurrency(s.offPayrollEarned))}` : '€ 0,00'}
                             </div>
                             <div class="erp-cell-sub">${s.saturdayOffTotal > 0 ? `Inclui Sáb. ${formatCurrency(s.saturdayOffTotal)}` : s.offPayrollAmount > 0 ? (s.offPayrollType === 'diaria' ? `${formatCurrency(s.offPayrollAmount)}/dia` : 'Fixo mensal') : 'Sem complemento'}</div>
                           </td>`
                        : ''
                    }
                    ${
                      canSeePayable
                        ? `<td>
                             <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-pay-adv="${escapeHtml(emp.id)}" title="Ver ou registar vales deste colaborador">
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
                          canSeeSalary && !configured
                            ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-pay-config="${escapeHtml(emp.id)}">Definir Salário (1.ª Vez)</button>`
                            : ''
                        }
                        ${
                          canSeePayable && configured
                            ? `<button type="button" class="erp-btn ${payslip ? 'erp-btn--outline' : 'erp-btn--primary'} erp-btn--sm" data-pay-close="${escapeHtml(emp.id)}" title="Fechar Mês e Emitir Recibo">${payslip ? 'Rever Fecho' : 'Fechar Mês'}</button>`
                            : ''
                        }
                        ${
                          canSeeSalary && configured
                            ? `<button type="button" class="erp-icon-btn" data-pay-config="${escapeHtml(emp.id)}" title="Ajustar regra salarial permanente (${escapeHtml(emp.name)})">${ICONS.edit}</button>`
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

    target.querySelector('#btnFilterUnconfigured')?.addEventListener('click', () => {
      this.payStateFilter = 'unconfigured';
      store._commit();
    });

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

  _renderConfigDirectory(target, employees, allEmployees, month) {
    target.innerHTML = `
      ${this._renderFilterControls(
        allEmployees,
        'Configuração única e permanente — defina uma vez e o sistema calcula automaticamente todos os meses',
        { showPayState: true }
      )}

      <div class="erp-smart-banner">
        <span><strong>Automação mensal ativa:</strong> Alterações aqui guardam a regra contratual permanente do colaborador na base de dados para todos os meses futuros.</span>
      </div>

      ${
        employees.length === 0
          ? `<div class="erp-empty">${ICONS.users}<div class="erp-empty__title">Nenhum colaborador encontrado neste filtro</div></div>`
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
                <th style="text-align:right">Regra Permanente</th>
              </tr>
            </thead>
            <tbody>
              ${employees
                .map((emp) => {
                  const s = computeEmployeeMonthlyPayroll(emp, store.getState().attendance, store.getState().employeeAdvances, month);
                  const configured = hasSalaryConfigured(emp);
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
                      ${
                        configured
                          ? `<div class="erp-cell-title">${escapeHtml(rateStr)}</div>
                             <div class="erp-cell-sub">${escapeHtml(REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal')}</div>`
                          : `<span class="erp-badge erp-badge--warning">Por configurar</span>`
                      }
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
                      <button type="button" class="erp-btn ${configured ? 'erp-btn--outline' : 'erp-btn--primary'} erp-btn--sm" data-cfg-emp="${escapeHtml(emp.id)}">${ICONS.edit}<span>${configured ? 'Alterar Regra' : 'Configurar (1.ª Vez)'}</span></button>
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

  _renderAdvancesLedger(target, state, month, query) {
    const allEmployees = state.employees || [];
    const empMap = new Map(allEmployees.map((e) => [e.id, e]));
    const allAdvances = state.employeeAdvances || [];

    const filteredAdvances = allAdvances.filter((adv) => {
      if (this.advScope === 'month' && String(adv.month || adv.date || '').slice(0, 7) !== month) {
        return false;
      }
      if (this.employeeFilter !== 'all' && adv.employeeId !== this.employeeFilter) {
        return false;
      }
      const emp = empMap.get(adv.employeeId);
      if (this.deptFilter !== 'all' && emp?.department !== this.deptFilter) {
        return false;
      }
      if (this.remFilter !== 'all' && (emp?.remunerationType || 'mensal') !== this.remFilter) {
        return false;
      }
      if (query) {
        const hay = `${emp?.name || ''} ${emp?.role || ''} ${adv.notes || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    // Agrupa por colaborador para nunca repetir o mesmo nome várias vezes na tabela principal
    const groupedMap = new Map();
    filteredAdvances.forEach((adv) => {
      const empId = adv.employeeId || 'unknown';
      if (!groupedMap.has(empId)) {
        groupedMap.set(empId, {
          employeeId: empId,
          emp: empMap.get(empId) || null,
          items: [],
          totalAmount: 0,
          latestDate: '',
        });
      }
      const grp = groupedMap.get(empId);
      grp.items.push(adv);
      grp.totalAmount += Number(adv.amount) || 0;
      const d = String(adv.date || adv.month || '');
      if (!grp.latestDate || d > grp.latestDate) {
        grp.latestDate = d;
      }
    });

    const groups = [...groupedMap.values()].sort((a, b) =>
      String(b.latestDate).localeCompare(String(a.latestDate))
    );
    groups.forEach((g) => {
      g.items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    });

    const totalVal = groups.reduce((sum, g) => sum + g.totalAmount, 0);
    const scopeControl = `
      <select class="erp-select-sm" id="advScopeSelect" title="Período dos Vales">
        <option value="month" ${this.advScope === 'month' ? 'selected' : ''}>Mês (${escapeHtml(month)})</option>
        <option value="all" ${this.advScope === 'all' ? 'selected' : ''}>Todo o Histórico</option>
      </select>
    `;

    target.innerHTML = `
      ${this._renderFilterControls(
        allEmployees,
        `Agrupado por colaborador (${groups.length} pessoa(s) · ${filteredAdvances.length} vale(s) · Total -${escapeHtml(formatCurrency(totalVal))})`,
        { showPayState: false, extraControlsHtml: scopeControl }
      )}

      ${
        groups.length === 0
          ? `<div class="erp-empty">${ICONS.receipt}<div class="erp-empty__title">Nenhum adiantamento encontrado</div><p>Altere os filtros ou clique em "Registar Adiantamento / Vale".</p></div>`
          : `
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Qtd. Vales / Último</th>
                <th>Resumo dos Levantamentos</th>
                <th>Total Abatido</th>
                <th style="text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${groups
                .map((g) => {
                  const isSingleEmpFiltered = this.employeeFilter !== 'all' && this.employeeFilter === g.employeeId;
                  const isExpanded = isSingleEmpFiltered || this.expandedAdvEmployees.has(g.employeeId);
                  const previewItems = g.items.slice(0, 3);
                  const extraCount = g.items.length - previewItems.length;

                  const summaryRow = `
                  <tr>
                    <td>
                      <div class="erp-person-cell">
                        <span class="erp-avatar">${escapeHtml(getInitials(g.emp?.name || '?'))}</span>
                        <div>
                          <div class="erp-cell-title">${escapeHtml(g.emp?.name || 'Colaborador removido')}</div>
                          <div class="erp-cell-sub">${escapeHtml(g.emp?.role || '—')}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="erp-badge erp-badge--warning">${g.items.length} ${g.items.length === 1 ? 'vale' : 'vales'}</span>
                      <div class="erp-cell-sub" style="margin-top:4px;">Último: ${escapeHtml(formatDatePT(g.latestDate))}</div>
                    </td>
                    <td>
                      <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        ${previewItems
                          .map(
                            (it) => `<span class="erp-badge erp-badge--neutral">${escapeHtml(formatDatePT(it.date || it.month).slice(0, 5))}: -${escapeHtml(formatCurrency(it.amount))}</span>`
                          )
                          .join('')}
                        ${extraCount > 0 ? `<span class="erp-badge erp-badge--info">+${extraCount}</span>` : ''}
                      </div>
                    </td>
                    <td><strong style="color:var(--erp-danger);font-size:14px;">-${escapeHtml(formatCurrency(g.totalAmount))}</strong></td>
                    <td style="text-align:right">
                      <div class="erp-row-actions">
                        <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-toggle-adv-emp="${escapeHtml(g.employeeId)}">
                          ${isExpanded ? 'Ocultar Detalhes' : `Ver Detalhes (${g.items.length})`}
                        </button>
                        ${
                          g.emp
                            ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-add-adv-emp="${escapeHtml(g.employeeId)}" title="Lançar novo vale para ${escapeHtml(g.emp.name)}">${ICONS.plus}<span>Novo Vale</span></button>`
                            : ''
                        }
                      </div>
                    </td>
                  </tr>`;

                  const detailRow = isExpanded
                    ? `
                  <tr class="erp-adv-detail-row">
                    <td colspan="5">
                      <div class="erp-adv-subcard">
                        <div class="erp-adv-subcard__head">
                          <span>Levantamentos individuais de ${escapeHtml(g.emp?.name || 'Colaborador')} (${g.items.length})</span>
                          <span style="color:var(--erp-danger);">Soma abatida: -${escapeHtml(formatCurrency(g.totalAmount))}</span>
                        </div>
                        <table class="erp-table">
                          <thead>
                            <tr>
                              <th>Data</th>
                              <th>Mês de Abate</th>
                              <th>Motivo / Observação</th>
                              <th style="text-align:right">Valor</th>
                              <th style="text-align:right">Remover</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${g.items
                              .map(
                                (adv) => `
                              <tr>
                                <td>${escapeHtml(formatDatePT(adv.date || adv.month))}</td>
                                <td><span class="erp-badge erp-badge--neutral">${escapeHtml(adv.month || String(adv.date || '').slice(0, 7))}</span></td>
                                <td><span class="erp-cell-sub">${escapeHtml(adv.notes || 'Adiantamento de ordenado')}</span></td>
                                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">-${escapeHtml(formatCurrency(adv.amount))}</td>
                                <td style="text-align:right">
                                  <button type="button" class="erp-icon-btn erp-icon-btn--danger" data-del-adv-row="${escapeHtml(adv.id)}" title="Remover este adiantamento">${ICONS.trash}</button>
                                </td>
                              </tr>`
                              )
                              .join('')}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>`
                    : '';

                  return `${summaryRow}${detailRow}`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`
      }
    `;

    this._bindFilterEvents(target);

    target.querySelector('#advScopeSelect')?.addEventListener('change', (e) => {
      this.advScope = e.target.value;
      store._commit();
    });

    target.querySelectorAll('[data-toggle-adv-emp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const empId = btn.dataset.toggleAdvEmp;
        if (this.expandedAdvEmployees.has(empId)) {
          this.expandedAdvEmployees.delete(empId);
        } else {
          this.expandedAdvEmployees.add(empId);
        }
        store._commit();
      });
    });

    target.querySelectorAll('[data-add-adv-emp]').forEach((btn) => {
      btn.addEventListener('click', () => this._openAdvancePopup(btn.dataset.addAdvEmp, month));
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

  _openBatchCloseMonthModal(eligibleEmployees, month) {
    if (!eligibleEmployees || eligibleEmployees.length === 0) {
      showToast('Todos os colaboradores com salário configurado já têm recibo emitido neste mês.', 'info');
      return;
    }
    const state = store.getState();
    const rows = eligibleEmployees.map((emp) => ({
      emp,
      stats: computeEmployeeMonthlyPayroll(emp, state.attendance, state.employeeAdvances, month),
    }));

    openModal({
      title: `Fechar Mês em Lote — ${formatMonthLabel(month)}`,
      subtitle: 'Emissão automática usando as regras salariais permanentes guardadas na base de dados',
      size: 'wide',
      bodyHtml: `
        <div class="erp-smart-banner">
          <span><strong>Zero reconfiguração manual:</strong> Cada colaborador abaixo será processado com a sua modalidade, Segurança Social, duodécimos e pagamento por fora da SS já guardados (abatendo vales do mês).</span>
        </div>

        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th style="width:36px;"><input type="checkbox" id="batchCheckAll" checked title="Selecionar todos"></th>
                <th>Colaborador</th>
                <th>Base / Sábados</th>
                <th>Duodécimos</th>
                <th>Por Fora SS</th>
                <th>Vales</th>
                <th style="text-align:right">Total Líquido</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  ({ emp, stats }) => `
                <tr>
                  <td><input type="checkbox" class="batch-emp-check" value="${escapeHtml(emp.id)}" checked></td>
                  <td>
                    <div class="erp-cell-title">${escapeHtml(emp.name)}</div>
                    <div class="erp-cell-sub">${escapeHtml(REMUNERATION_LABELS[stats.remunerationType] || 'Fixo Mensal')} · SS ${stats.ssPercentage}%</div>
                  </td>
                  <td>
                    <div class="erp-cell-title">${escapeHtml(formatCurrency(stats.earnedBase))}</div>
                    <div class="erp-cell-sub">${stats.weekdayPresent}d úteis${stats.saturdayCount > 0 ? ` · ${stats.saturdayCount} sáb. (+${escapeHtml(formatCurrency(stats.saturdayTotal))})` : ''} · SS -${escapeHtml(formatCurrency(stats.ssDeduction))}</div>
                  </td>
                  <td style="color:${stats.twelfthsTotal > 0 ? 'var(--erp-info)' : 'var(--erp-text-muted)'};font-weight:600;">${stats.twelfthsTotal > 0 ? `+${escapeHtml(formatCurrency(stats.twelfthsTotal))}` : '—'}</td>
                  <td style="color:${stats.offPayrollEarned > 0 ? 'var(--erp-accent-dark)' : 'var(--erp-text-muted)'};font-weight:600;">${stats.offPayrollEarned > 0 ? `+${escapeHtml(formatCurrency(stats.offPayrollEarned))}` : '—'}</td>
                  <td style="color:${stats.advancesTotal > 0 ? 'var(--erp-danger)' : 'var(--erp-text-muted)'};">${stats.advancesTotal > 0 ? `-${escapeHtml(formatCurrency(stats.advancesTotal))}` : '€ 0,00'}</td>
                  <td style="text-align:right;font-weight:800;color:var(--erp-success);">${escapeHtml(formatCurrency(stats.netToPay))}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="button" class="erp-btn erp-btn--primary" id="btnRunBatchClose">
          ${ICONS.checkCircle}<span id="lblBatchBtn">Emitir ${rows.length} Recibo(s) &amp; Fechar Mês</span>
        </button>
      `,
      onMount: (modal) => {
        const checkAll = modal.querySelector('#batchCheckAll');
        const checks = [...modal.querySelectorAll('.batch-emp-check')];
        const btnRun = modal.querySelector('#btnRunBatchClose');
        const lblRun = modal.querySelector('#lblBatchBtn');

        const syncCount = () => {
          const checkedCount = checks.filter((c) => c.checked).length;
          if (lblRun) lblRun.textContent = `Emitir ${checkedCount} Recibo(s) & Fechar Mês`;
          if (btnRun) btnRun.disabled = checkedCount === 0;
        };

        checkAll?.addEventListener('change', () => {
          checks.forEach((c) => {
            c.checked = checkAll.checked;
          });
          syncCount();
        });

        checks.forEach((c) => {
          c.addEventListener('change', () => {
            if (checkAll) checkAll.checked = checks.every((x) => x.checked);
            syncCount();
          });
        });

        btnRun?.addEventListener('click', async () => {
          const selectedIds = new Set(checks.filter((c) => c.checked).map((c) => c.value));
          const chosenRows = rows.filter((r) => selectedIds.has(r.emp.id));
          if (chosenRows.length === 0) return;

          btnRun.disabled = true;
          if (lblRun) lblRun.textContent = 'A emitir recibos e abater do caixa...';

          let okCount = 0;
          for (const { emp, stats } of chosenRows) {
            const payslipId = generateId('REC');
            const res = await store.addPayslip({
              id: payslipId,
              employeeId: emp.id,
              month,
              baseSalary: stats.earnedBase,
              mealAllowanceTotal: stats.mealEarned,
              twelfthVacation: stats.twelfthsVacation,
              twelfthChristmas: stats.twelfthsChristmas,
              saturdayCount: stats.saturdayCount,
              saturdayReceiptTotal: stats.saturdayReceiptTotal,
              saturdayOffTotal: stats.saturdayOffTotal,
              overtimeBonus: 0,
              socialSecurity: stats.ssDeduction,
              irsRetention: 0,
              otherDeductions: stats.advancesTotal,
              offPayroll: stats.offPayrollEarned,
              netSalary: stats.netToPay,
              paymentDate: todayISO(),
              status: 'pago',
              notes: `Fecho automático (${REMUNERATION_LABELS[stats.remunerationType]} · ${getTwelfthsOptionMeta(stats.twelfthsMode).shortLabel}${stats.saturdayCount > 0 ? ` · ${stats.saturdayCount} Sáb.: ${formatCurrency(stats.saturdayTotal)}` : ''} · SS ${stats.ssPercentage}%)`,
            });
            if (res !== null) okCount += 1;
          }

          showToast(`${okCount} recibo(s) emitidos e abatidos automaticamente no Caixa da Empresa.`, 'success', 5500);
          this._openBatchSummaryModal(okCount, chosenRows, month);
        });
      },
    });
  }

  _openBatchSummaryModal(okCount, chosenRows, month) {
    const latestState = store.getState();
    const cashSummary = computeCompanyCashSummary(latestState);
    const monthMovements = cashSummary.movements.filter((m) => String(m.month || m.date || '').slice(0, 7) === month);
    const monthInflows = monthMovements.filter((m) => m.type === 'entrada').reduce((s, m) => s + (Number(m.amount) || 0), 0);
    const monthOutflows = monthMovements.filter((m) => m.type === 'saida').reduce((s, m) => s + (Number(m.amount) || 0), 0);
    const monthInvoices = monthMovements.filter((m) => m.originType === 'fatura_obra').reduce((s, m) => s + (Number(m.amount) || 0), 0);

    const batchNetTotal = chosenRows.reduce((s, r) => s + r.stats.netToPay, 0);
    const batchSatCount = chosenRows.reduce((s, r) => s + r.stats.saturdayCount, 0);
    const batchSatTotal = chosenRows.reduce((s, r) => s + r.stats.saturdayTotal, 0);
    const batchOffTotal = chosenRows.reduce((s, r) => s + r.stats.offPayrollEarned, 0);
    const batchAdvancesTotal = chosenRows.reduce((s, r) => s + r.stats.advancesTotal, 0);

    openModal({
      title: `Relatório de Fecho do Mês — ${formatMonthLabel(month)}`,
      subtitle: `${okCount} recibo(s) processado(s) · Caixa da Empresa atualizado na base de dados`,
      size: 'wide',
      bodyHtml: `
        <div class="erp-smart-banner">
          <span><strong>Fecho concluído com sucesso:</strong> Os pagamentos a funcionários foram abatidos automaticamente do Caixa da Empresa.</span>
        </div>

        <div class="erp-summary-box" style="margin-bottom:16px;">
          <div>
            <div class="erp-summary-item__label">Pago neste Fecho (${okCount} rec.)</div>
            <div class="erp-summary-item__val erp-summary-item__val--danger">- ${escapeHtml(formatCurrency(batchNetTotal))}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Sábados (${batchSatCount} sáb.)</div>
            <div class="erp-summary-item__val" style="color:var(--erp-accent-dark);">+ ${escapeHtml(formatCurrency(batchSatTotal))}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Entradas no Mês</div>
            <div class="erp-summary-item__val erp-summary-item__val--success">+ ${escapeHtml(formatCurrency(monthInflows))}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Saldo Atual em Caixa</div>
            <div class="erp-summary-item__val" style="color:${cashSummary.currentBalance >= 0 ? 'var(--erp-success)' : 'var(--erp-danger)'};">${escapeHtml(formatCurrency(cashSummary.currentBalance))}</div>
          </div>
        </div>

        <div class="erp-table-wrap">
          <table class="erp-table">
            <tbody>
              <tr>
                <td><strong>Pagamentos a Funcionários neste Fecho (Recibo + Por Fora SS)</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(batchNetTotal))}</td>
              </tr>
              <tr>
                <td><strong>Parcela Por Fora da SS incluída (c/ Sábados Por Fora)</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-accent-dark);">${escapeHtml(formatCurrency(batchOffTotal))}</td>
              </tr>
              <tr>
                <td><strong>Adiantamentos / Vales abatidos aos funcionários</strong></td>
                <td style="text-align:right;font-weight:700;">${escapeHtml(formatCurrency(batchAdvancesTotal))}</td>
              </tr>
              <tr>
                <td><strong>Saídas de Faturas de Obras no Mês</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(monthInvoices))}</td>
              </tr>
              <tr>
                <td><strong>Entradas / Recebimentos de Obras no Mês</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-success);">+ ${escapeHtml(formatCurrency(monthInflows))}</td>
              </tr>
              <tr style="background:var(--erp-surface-alt);">
                <td><strong style="font-size:14px;">Total de Saídas no Mês / Saldo Atual do Caixa</strong></td>
                <td style="text-align:right;font-size:15px;font-weight:900;color:${cashSummary.currentBalance >= 0 ? 'var(--erp-success)' : 'var(--erp-danger)'};">${escapeHtml(formatCurrency(monthOutflows))} saídas · Caixa ${escapeHtml(formatCurrency(cashSummary.currentBalance))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
        ${
          typeof this.onOpenAdvancedReports === 'function'
            ? `<button type="button" class="erp-btn erp-btn--outline" id="btnGoAdvReportsAfterClose">Abrir Relatórios Avançados &amp; Caixa</button>`
            : ''
        }
        <button type="button" class="erp-btn erp-btn--primary" id="btnBatchDownloadPdf">
          ${ICONS.download}<span>Baixar Relatório PDF Spark &amp; Smirk</span>
        </button>
      `,
      onMount: (modal) => {
        modal.querySelector('#btnGoAdvReportsAfterClose')?.addEventListener('click', () => {
          closeModal();
          this.onOpenAdvancedReports?.();
        });

        modal.querySelector('#btnBatchDownloadPdf')?.addEventListener('click', async () => {
          const allEmps = latestState.employees || [];
          const rhRows = allEmps.map((emp) => {
            const c = computeEmployeeMonthlyPayroll(emp, latestState.attendance, latestState.employeeAdvances, month);
            return {
              ...c,
              name: emp.name,
              department: emp.department,
              remunerationLabel: REMUNERATION_LABELS[c.remunerationType] || 'Fixo Mensal',
            };
          });
          const projMap = new Map();
          (latestState.projects || []).forEach((p) => {
            projMap.set(p.id, p);
            if (p.code) projMap.set(p.code, p);
          });
          const invoiceRows = (latestState.projectInvoices || [])
            .filter((i) => String(i.invoiceDate || i.createdAt || '').slice(0, 7) === month)
            .map((i) => {
              const p = projMap.get(i.projectId);
              return { ...i, projectLabel: p ? `${p.code} — ${p.name}` : i.projectId };
            });
          const inflowRows = [];
          (latestState.projects || []).forEach((p) => {
            (p.payments || []).forEach((pay) => {
              const dt = pay.paidDate || pay.dueDate || '';
              if (pay.status === 'pago' && String(dt).slice(0, 7) === month) {
                inflowRows.push({
                  date: dt,
                  projectLabel: `${p.code} — ${p.name}`,
                  clientName: p.clientName,
                  description: pay.description || 'Recebimento de Obra',
                  amount: Number(pay.amount) || 0,
                });
              }
            });
          });
          const empMap = new Map(allEmps.map((e) => [e.id, e]));
          const advanceRows = (latestState.employeeAdvances || [])
            .filter((a) => String(a.month || a.date || '').slice(0, 7) === month)
            .map((a) => ({ ...a, employeeName: empMap.get(a.employeeId)?.name || 'Colaborador' }));

          const periodSalaries = monthMovements
            .filter((m) => m.type === 'saida' && (m.originType === 'recibo_vencimento' || m.category === 'Salários & Ordenados'))
            .reduce((s, m) => s + (Number(m.amount) || 0), 0);

          await generateSparkReportPdf({
            title: `Relatório Mensal de Fecho — ${formatMonthLabel(month)}`,
            periodLabel: formatMonthLabel(month),
            filterSummary: `Fecho do mês (${okCount} recibos emitidos) · Abate automático no Caixa da Empresa`,
            kpis: {
              openingBalance: cashSummary.openingBalance,
              cashBalance: cashSummary.currentBalance,
              periodInflows: monthInflows,
              inflowsCount: monthMovements.filter((m) => m.type === 'entrada').length,
              periodOutflows: monthOutflows,
              periodSalaries,
              periodAdvances: advanceRows.reduce((s, a) => s + (Number(a.amount) || 0), 0),
              periodPayrollTotal: periodSalaries + advanceRows.reduce((s, a) => s + (Number(a.amount) || 0), 0),
              periodInvoices: monthInvoices,
              invoicesCount: invoiceRows.length,
              saturdayCount: rhRows.reduce((s, r) => s + r.saturdayCount, 0),
              saturdayReceiptTotal: rhRows.reduce((s, r) => s + r.saturdayReceiptTotal, 0),
              saturdayOffTotal: rhRows.reduce((s, r) => s + r.saturdayOffTotal, 0),
              saturdayTotal: rhRows.reduce((s, r) => s + r.saturdayTotal, 0),
              periodNetResult: monthInflows - monthOutflows,
            },
            rhRows,
            cashRows: monthMovements,
            invoiceRows,
            inflowRows,
            advanceRows,
            filename: `Spark-Smirk-Fecho-${month}.pdf`,
          });
          showToast('PDF de Fecho do Mês Spark & Smirk transferido!');
        });
      },
    });
  }

  _exportPayrollCSV(employees, state, month, canSeeSalary, canSeePayable) {
    const headers = [
      'ID',
      'Nome',
      'NIF',
      'IBAN',
      'Modalidade',
      'Dias Seg-Sex (P)',
      'Sábados Trabalhados',
      ...(canSeeSalary
        ? [
            'Base Recibo (€)',
            'Sábados em Recibo (€)',
            'Sábados Por Fora (€)',
            'Regime Duodécimos',
            'Duodécimo Férias (€)',
            'Duodécimo Natal (€)',
            'Sub. Alimentação (€)',
            'SS (%)',
            'Desconto SS (€)',
            'Por Fora SS Total (€)',
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
        s.weekdayPresent,
        s.saturdayCount,
        ...(canSeeSalary
          ? [
              s.earnedBase.toFixed(2),
              s.saturdayReceiptTotal.toFixed(2),
              s.saturdayOffTotal.toFixed(2),
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
        <div class="erp-smart-banner">
          <span><strong>Configuração Permanente (1 só vez):</strong> Guarde uma única vez — estas condições mantêm-se ativas automaticamente em todos os meses seguintes.</span>
        </div>

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
      title: `Regra Salarial Permanente — ${emp.name}`,
      subtitle: `${emp.role} · NIF ${emp.nif || '—'}`,
      size: 'wide',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="salaryConfigForm" id="btnSaveSalaryCfg" class="erp-btn erp-btn--primary">Guardar Regra Permanente</button>
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
              <div class="erp-summary-item__val" style="color:var(--erp-info);">+${escapeHtml(formatCurrency(tw.twelfthsTotal))}</div>
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
            showToast(`Regra salarial permanente de ${emp.name} guardada na base de dados.`);
            closeModal();
          } else if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Guardar Regra Permanente';
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
    const preferred =
      this.employeeFilter !== 'all'
        ? activeEmployees.find((e) => e.id === this.employeeFilter) || activeEmployees[0]
        : activeEmployees[0];
    this._openAdvancePopup(preferred.id, month, true);
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
      title: allowPickEmployee ? 'Registar Adiantamento / Vale Salarial' : `Adiantamentos de ${emp.name}`,
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
          <div class="erp-form-section__title" style="margin-bottom:10px;">Registar Novo Adiantamento</div>
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
              ? `<div class="erp-form-section__title" style="margin-bottom:8px;">Vales registados para ${escapeHtml(emp.name)} em ${escapeHtml(formatMonthLabel(month))} (${s.monthAdvances.length})</div>
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
        const selectedEmpId = emp.id;
        const empPicker = modal.querySelector('#advEmpSelect');
        empPicker?.addEventListener('change', () => {
          this._openAdvancePopup(empPicker.value, month, true);
        });

        modal.querySelector('#empAdvanceForm')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const amount = parseCurrencyInput(modal.querySelector('#advAmount')?.value);
          if (amount <= 0) {
            showToast('Indique o valor retirado antecipadamente (maior que € 0,00).', 'danger');
            return;
          }
          const targetEmp = store.getState().employees.find((x) => x.id === selectedEmpId) || emp;
          const advDate = modal.querySelector('#advDate')?.value || todayISO();
          const saveBtn = modal.querySelector('#btnSaveAdvance');
          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'A guardar...';
          }
          await store.addEmployeeAdvance({
            id: generateId('ADT'),
            employeeId: targetEmp.id,
            month: String(advDate).slice(0, 7) || month,
            date: advDate,
            amount: Number(amount.toFixed(2)),
            notes: modal.querySelector('#advNotes')?.value.trim() || 'Adiantamento de ordenado',
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
    let activeOffPayroll = Number(baseStats.offPayrollEarned) || 0;

    const calcCloseSummary = () => {
      const tw = computeTwelfthsBreakdown(
        baseStats.earnedBase,
        activeTwelfthsMode,
        customVacVal,
        customXmasVal
      );
      const ssBasis = Number((baseStats.earnedBase + baseStats.saturdayReceiptTotal + tw.twelfthsTotal).toFixed(2));
      const ssDeduction = Number((ssBasis * (baseStats.ssPercentage / 100)).toFixed(2));
      const grossPay = Number((baseStats.earnedBase + baseStats.saturdayReceiptTotal + baseStats.mealEarned + tw.twelfthsTotal).toFixed(2));
      const receiptNetPay = Math.max(0, Number((grossPay - ssDeduction).toFixed(2)));
      const offEarned = Math.max(0, Number(activeOffPayroll) || 0);
      const netToPay = Math.max(
        0,
        Number((receiptNetPay + offEarned - baseStats.advancesTotal).toFixed(2))
      );
      return {
        ...baseStats,
        twelfthsMode: tw.twelfthsMode,
        twelfthsVacation: tw.twelfthsVacation,
        twelfthsChristmas: tw.twelfthsChristmas,
        twelfthsTotal: tw.twelfthsTotal,
        offPayrollEarned: Number(offEarned.toFixed(2)),
        ssDeduction,
        grossPay,
        receiptNetPay,
        netToPay,
      };
    };

    const s0 = calcCloseSummary();
    const buildOffHintText = (summary) => {
      const isAdjusted = Math.abs(summary.offPayrollEarned - baseStats.offPayrollEarned) > 0.009;
      if (isAdjusted) {
        return `Valor ajustado manualmente para ${formatMonthLabel(month)} (sem desconto SS).`;
      }
      if (baseStats.offPayrollAmount > 0) {
        return baseStats.offPayrollType === 'diaria'
          ? `${baseStats.present} dia(s) × ${formatCurrency(baseStats.offPayrollAmount)} — pré-calculado; pode ajustar este mês.`
          : 'Valor fixo mensal da regra permanente — pode ajustar este mês.';
      }
      return 'Opcional: adicione um extra/prémio por fora da SS apenas para este mês.';
    };

    const bodyHtml = `
      <div id="closeMonthWrap">
        <div class="erp-cred-box" style="margin-bottom:14px;text-align:center;">
          <div class="erp-summary-item__label">Total Final a Pagar ao Funcionário em ${escapeHtml(formatMonthLabel(month))}</div>
          <div id="closeTopNetVal" style="font-family:var(--erp-font-heading);font-size:28px;font-weight:900;color:var(--erp-success);margin:4px 0;">
            ${escapeHtml(formatCurrency(s0.netToPay))}
          </div>
          <span class="erp-cell-sub" id="closeTopSubDesc">${escapeHtml(remDesc)}${s0.twelfthsTotal > 0 ? ` · + ${escapeHtml(formatCurrency(s0.twelfthsTotal))} duodécimos` : ''}${s0.offPayrollEarned > 0 ? ` · + ${escapeHtml(formatCurrency(s0.offPayrollEarned))} por fora SS` : ''}</span>
        </div>

        <div class="erp-inline-invoice-box" style="margin-bottom:14px;">
          <div class="erp-form-section__title" style="margin-bottom:10px;">Ajustes do Fecho deste Mês (Duodécimos &amp; Por Fora SS)</div>
          <div class="erp-form-grid">
            <div class="erp-field">
              <label for="closeMonthTwelfthsMode">Modalidade de Duodécimos (Férias &amp; Natal)</label>
              <select id="closeMonthTwelfthsMode">
                ${TWELFTHS_OPTIONS.map((opt) => `<option value="${escapeHtml(opt.value)}" ${activeTwelfthsMode === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field">
              <label for="closeMonthOffPayroll">Pagamento Por Fora da SS deste mês (€)</label>
              <input type="text" inputmode="numeric" data-currency-euro id="closeMonthOffPayroll" value="${escapeHtml(activeOffPayroll)}" placeholder="€ 0,00">
              <span class="erp-field__hint" id="closeOffHint">${escapeHtml(buildOffHintText(s0))}</span>
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
              <div class="erp-check-stack">
                <label class="erp-check-row" for="closeMonthSaveTwelfths">
                  <input type="checkbox" id="closeMonthSaveTwelfths">
                  <span>Guardar preferência de duodécimos como padrão permanente de ${escapeHtml(emp.name)}</span>
                </label>
                <label class="erp-check-row" for="closeMonthSaveOffPayroll">
                  <input type="checkbox" id="closeMonthSaveOffPayroll">
                  <span>Guardar valor Por Fora da SS acima como valor mensal permanente (1 só vez)</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="erp-table-wrap">
          <table class="erp-table">
            <tbody>
              <tr>
                <td><strong>Base em Recibo (${escapeHtml(REMUNERATION_LABELS[s0.remunerationType] || 'Fixo Mensal')})</strong></td>
                <td style="text-align:right;font-weight:700;">+ ${escapeHtml(formatCurrency(s0.earnedBase))}</td>
              </tr>
              ${
                s0.saturdayCount > 0
                  ? `<tr>
                       <td><strong>Sábados Trabalhados (${s0.saturdayCount} sáb. — Recibo c/ SS / Total Sáb. ${escapeHtml(formatCurrency(s0.saturdayTotal))})</strong></td>
                       <td style="text-align:right;font-weight:700;color:var(--erp-info);">+ ${escapeHtml(formatCurrency(s0.saturdayReceiptTotal))} (SS) · + ${escapeHtml(formatCurrency(s0.saturdayOffTotal))} (Fora)</td>
                     </tr>`
                  : ''
              }
              <tr>
                <td><strong id="closeRowVacLbl">Duodécimo Subsídio de Férias (${escapeHtml(getTwelfthsOptionMeta(s0.twelfthsMode).shortLabel)})</strong></td>
                <td id="closeRowVacVal" style="text-align:right;font-weight:700;color:var(--erp-info);">+ ${escapeHtml(formatCurrency(s0.twelfthsVacation))}</td>
              </tr>
              <tr>
                <td><strong>Duodécimo Subsídio de Natal</strong></td>
                <td id="closeRowXmasVal" style="text-align:right;font-weight:700;color:var(--erp-info);">+ ${escapeHtml(formatCurrency(s0.twelfthsChristmas))}</td>
              </tr>
              ${
                s0.remunerationType !== 'mensal' || s0.mealEarned > 0
                  ? `<tr>
                       <td><strong>Subsídio de Alimentação (${s0.present} dia(s) × ${escapeHtml(formatCurrency(emp.mealAllowance))})</strong></td>
                       <td style="text-align:right;font-weight:700;">+ ${escapeHtml(formatCurrency(s0.mealEarned))}</td>
                     </tr>`
                  : ''
              }
              <tr>
                <td><strong>Desconto Segurança Social (${s0.ssPercentage}% sobre base + duodécimos)</strong></td>
                <td id="closeRowSsVal" style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(s0.ssDeduction))}</td>
              </tr>
              <tr>
                <td><strong id="closeRowOffLbl">Pagamento Por Fora da Segurança Social (${escapeHtml(buildOffHintText(s0))})</strong></td>
                <td id="closeRowOffVal" style="text-align:right;font-weight:700;color:var(--erp-accent-dark);">+ ${escapeHtml(formatCurrency(s0.offPayrollEarned))}</td>
              </tr>
              <tr>
                <td><strong>Adiantamentos / Vales Retirados no Mês (${s0.monthAdvances.length})</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(s0.advancesTotal))}</td>
              </tr>
              <tr style="background:var(--erp-surface-alt);">
                <td><strong style="font-size:14px;">TOTAL FINAL A PAGAR</strong></td>
                <td id="closeRowNetVal" style="text-align:right;font-size:16px;font-weight:900;color:var(--erp-success);">${escapeHtml(formatCurrency(s0.netToPay))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    openModal({
      title: `Fecho de Mês — ${emp.name}`,
      subtitle: `${formatMonthLabel(month)} · ${REMUNERATION_LABELS[baseStats.remunerationType] || 'Fixo Mensal'}`,
      bodyHtml,
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
        const modeSelect = modal.querySelector('#closeMonthTwelfthsMode');
        const vacInput = modal.querySelector('#closeCustomVac');
        const xmasInput = modal.querySelector('#closeCustomXmas');
        const offInput = modal.querySelector('#closeMonthOffPayroll');
        const wrapVac = modal.querySelector('#wrapCloseCustomVac');
        const wrapXmas = modal.querySelector('#wrapCloseCustomXmas');

        const syncLiveSummary = () => {
          activeTwelfthsMode = modeSelect?.value || 'Não';
          customVacVal = parseCurrencyInput(vacInput?.value);
          customXmasVal = parseCurrencyInput(xmasInput?.value);
          activeOffPayroll = Math.max(0, parseCurrencyInput(offInput?.value));

          const isCustom = activeTwelfthsMode === 'personalizado';
          if (wrapVac) wrapVac.style.display = isCustom ? 'flex' : 'none';
          if (wrapXmas) wrapXmas.style.display = isCustom ? 'flex' : 'none';

          const s = calcCloseSummary();
          const setTxt = (sel, val) => {
            const el = modal.querySelector(sel);
            if (el) el.textContent = val;
          };

          const offHint = buildOffHintText(s);
          setTxt('#closeTopNetVal', formatCurrency(s.netToPay));
          setTxt(
            '#closeTopSubDesc',
            `${remDesc}${s.twelfthsTotal > 0 ? ` · + ${formatCurrency(s.twelfthsTotal)} duodécimos` : ''}${s.offPayrollEarned > 0 ? ` · + ${formatCurrency(s.offPayrollEarned)} por fora SS` : ''}`
          );
          setTxt('#closeOffHint', offHint);
          setTxt('#closeRowVacLbl', `Duodécimo Subsídio de Férias (${getTwelfthsOptionMeta(s.twelfthsMode).shortLabel})`);
          setTxt('#closeRowVacVal', `+ ${formatCurrency(s.twelfthsVacation)}`);
          setTxt('#closeRowXmasVal', `+ ${formatCurrency(s.twelfthsChristmas)}`);
          setTxt('#closeRowSsVal', `- ${formatCurrency(s.ssDeduction)}`);
          setTxt('#closeRowOffLbl', `Pagamento Por Fora da Segurança Social (${offHint})`);
          setTxt('#closeRowOffVal', `+ ${formatCurrency(s.offPayrollEarned)}`);
          setTxt('#closeRowNetVal', formatCurrency(s.netToPay));
        };

        modeSelect?.addEventListener('change', syncLiveSummary);
        vacInput?.addEventListener('input', syncLiveSummary);
        xmasInput?.addEventListener('input', syncLiveSummary);
        offInput?.addEventListener('input', syncLiveSummary);

        modal.querySelector('#btnCloseMonthAdvance')?.addEventListener('click', () => {
          this._openAdvancePopup(emp.id, month);
        });
        modal.querySelector('#btnConfirmCloseMonth')?.addEventListener('click', async () => {
          syncLiveSummary();
          const finalSummary = calcCloseSummary();
          const saveTwelfths = Boolean(modal.querySelector('#closeMonthSaveTwelfths')?.checked);
          const saveOffPayroll = Boolean(modal.querySelector('#closeMonthSaveOffPayroll')?.checked);

          const permanentPatch = {};
          if (saveTwelfths) {
            permanentPatch.twelfths = finalSummary.twelfthsMode;
            permanentPatch.twelfthsVacationManual = finalSummary.twelfthsMode === 'personalizado' ? customVacVal : 0;
            permanentPatch.twelfthsChristmasManual = finalSummary.twelfthsMode === 'personalizado' ? customXmasVal : 0;
          }
          if (saveOffPayroll) {
            permanentPatch.offPayrollType = 'mensal';
            permanentPatch.offPayrollAmount = finalSummary.offPayrollEarned;
          }
          if (Object.keys(permanentPatch).length > 0) {
            await store.updateEmployee(emp.id, permanentPatch);
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
            saturdayCount: finalSummary.saturdayCount,
            saturdayReceiptTotal: finalSummary.saturdayReceiptTotal,
            saturdayOffTotal: finalSummary.saturdayOffTotal,
            overtimeBonus: 0,
            socialSecurity: finalSummary.ssDeduction,
            irsRetention: 0,
            otherDeductions: finalSummary.advancesTotal,
            offPayroll: finalSummary.offPayrollEarned,
            netSalary: finalSummary.netToPay,
            paymentDate: todayISO(),
            status: 'pago',
            notes: `Fecho mensal (${REMUNERATION_LABELS[finalSummary.remunerationType]} · ${getTwelfthsOptionMeta(finalSummary.twelfthsMode).shortLabel}${finalSummary.saturdayCount > 0 ? ` · ${finalSummary.saturdayCount} Sáb.: ${formatCurrency(finalSummary.saturdayTotal)}` : ''}${finalSummary.twelfthsTotal > 0 ? `: ${formatCurrency(finalSummary.twelfthsTotal)}` : ''} · SS ${finalSummary.ssPercentage}%${finalSummary.offPayrollEarned > 0 ? ` · Por fora SS: ${formatCurrency(finalSummary.offPayrollEarned)}` : ''}${finalSummary.advancesTotal > 0 ? ` · Adiantamentos: ${formatCurrency(finalSummary.advancesTotal)}` : ''})`,
          });
          showToast(
            `Mês fechado para ${emp.name}! Valor pago (${formatCurrency(finalSummary.netToPay)}) abatido do Caixa da Empresa.`,
            'success',
            5500
          );
          closeModal();
        });
      },
    });
  }
}
