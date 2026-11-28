/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Relatórios Avançados & Caixa da Empresa
   Filtros robustos, abate automático no Caixa e PDF Spark & Smirk
   ═══════════════════════════════════════════════════════════ */

import { store } from '../core/store.js';
import {
  computeCompanyCashSummary,
  computeEmployeeMonthlyPayroll,
  downloadCSV,
  escapeHtml,
  formatCurrency,
  formatDatePT,
  formatMonthLabel,
  generateId,
  getInitials,
  getTwelfthsOptionMeta,
  parseCurrencyInput,
  todayISO,
} from '../core/formatters.js';
import { generateSparkReportPdf } from '../core/pdf-report.js';
import { ICONS, openModal, closeModal, confirmAction, showToast } from '../core/ui.js';

const REM_LABELS = {
  mensal: 'Fixo Mensal',
  diaria: 'Por Dia',
  hora: 'Por Hora',
};

const TAX_MODE_LABELS = {
  recibo_ss: 'Recibo (c/ SS)',
  por_fora: 'Por Fora SS',
  misto: 'Misto (SS + Por Fora)',
  adiantamento: 'Adiantamento / Vale',
  fatura: 'Fatura / Materiais',
  receita: 'Recebimento Obra',
  geral: 'Geral',
};

export class RelatoriosAvancadosModule {
  constructor() {
    this.viewMode = 'overview'; // 'overview' | 'cash' | 'saturdays'
    this.periodMode = 'month'; // 'month' | 'range' | 'year' | 'all'
    this.dateFrom = '';
    this.dateTo = '';
    this.yearFilter = String(new Date().getFullYear());
    this.flowFilter = 'all'; // 'all' | 'entrada' | 'saida' | 'rh' | 'obras' | 'sabados'
    this.taxFilter = 'all'; // 'all' | 'recibo_ss' | 'por_fora' | 'misto'
    this.employeeFilter = 'all';
    this.deptFilter = 'all';
    this.projectFilter = 'all';
    this.pdfSections = {
      rh: true,
      cash: true,
      projects: true,
      advances: true,
    };
  }

  _matchesPeriodDate(dateStr, monthStr, activeMonth) {
    const m = String(monthStr || dateStr || '').slice(0, 7);
    const d = String(dateStr || '');
    if (this.periodMode === 'all') return true;
    if (this.periodMode === 'month') return m === activeMonth;
    if (this.periodMode === 'year') return m.startsWith(this.yearFilter);
    if (this.periodMode === 'range') {
      if (this.dateFrom && d && d < this.dateFrom) return false;
      if (this.dateTo && d && d > this.dateTo) return false;
      return true;
    }
    return true;
  }

  _getPeriodLabel(month) {
    if (this.periodMode === 'month') return formatMonthLabel(month);
    if (this.periodMode === 'year') return `Ano Civil ${this.yearFilter}`;
    if (this.periodMode === 'range') {
      const a = this.dateFrom ? formatDatePT(this.dateFrom) : 'Início';
      const b = this.dateTo ? formatDatePT(this.dateTo) : 'Hoje';
      return `${a} até ${b}`;
    }
    return 'Histórico Completo';
  }

  _getFilterSummaryText(employees, projects, month) {
    const parts = [`Período: ${this._getPeriodLabel(month)}`];
    if (this.employeeFilter !== 'all') {
      const emp = employees.find((e) => e.id === this.employeeFilter);
      parts.push(`Colaborador: ${emp?.name || this.employeeFilter}`);
    }
    if (this.deptFilter !== 'all') parts.push(`Departamento: ${this.deptFilter}`);
    if (this.projectFilter !== 'all') {
      const proj = projects.find((p) => p.id === this.projectFilter || p.code === this.projectFilter);
      parts.push(`Obra: ${proj?.code || this.projectFilter}`);
    }
    if (this.flowFilter !== 'all') parts.push(`Fluxo: ${this.flowFilter.toUpperCase()}`);
    if (this.taxFilter !== 'all') parts.push(`Regime: ${TAX_MODE_LABELS[this.taxFilter] || this.taxFilter}`);
    return parts.join(' | ');
  }

  _buildReportDataset(state, month, query) {
    const allEmployees = state.employees || [];
    const allProjects = state.projects || [];
    const empMap = new Map(allEmployees.map((e) => [e.id, e]));
    const projMap = new Map();
    allProjects.forEach((p) => {
      projMap.set(p.id, p);
      if (p.code) projMap.set(p.code, p);
    });

    const cashSummary = computeCompanyCashSummary(state);

    // 1. Movimentos de Caixa filtrados no período + filtros robustos
    const cashRows = cashSummary.movements.filter((m) => {
      if (!this._matchesPeriodDate(m.date, m.month, month)) return false;
      if (this.employeeFilter !== 'all' && m.employeeId !== this.employeeFilter) return false;
      if (this.projectFilter !== 'all' && m.projectId !== this.projectFilter) return false;
      if (this.deptFilter !== 'all') {
        const emp = empMap.get(m.employeeId);
        if (!emp || emp.department !== this.deptFilter) return false;
      }
      if (this.flowFilter === 'entrada' && m.type !== 'entrada') return false;
      if (this.flowFilter === 'saida' && m.type !== 'saida') return false;
      if (
        this.flowFilter === 'rh' &&
        !['recibo_vencimento', 'adiantamento'].includes(m.originType) &&
        !['Salários & Ordenados', 'Adiantamento / Vale'].includes(m.category)
      ) {
        return false;
      }
      if (
        this.flowFilter === 'obras' &&
        !['fatura_obra', 'recebimento_obra'].includes(m.originType) &&
        !['Fatura de Obra / Materiais', 'Recebimento de Obra'].includes(m.category)
      ) {
        return false;
      }
      if (this.taxFilter !== 'all' && m.taxMode !== this.taxFilter) return false;
      if (query) {
        const hay = `${m.description || ''} ${m.category || ''} ${m.notes || ''} ${m.projectId || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    }).map((m) => ({
      ...m,
      taxModeLabel: TAX_MODE_LABELS[m.taxMode] || m.taxMode || 'Geral',
    }));

    // 2. RH & Sábados filtrados
    const targetMonthForRh = this.periodMode === 'month' ? month : month;
    const rhEmployees = allEmployees.filter((emp) => {
      if (this.employeeFilter !== 'all' && emp.id !== this.employeeFilter) return false;
      if (this.deptFilter !== 'all' && emp.department !== this.deptFilter) return false;
      if (query) {
        const hay = `${emp.name || ''} ${emp.role || ''} ${emp.department || ''} ${emp.nif || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const payslipsByEmp = new Map();
    (state.payslips || []).forEach((p) => {
      if (this._matchesPeriodDate(p.paymentDate || `${p.month}-28`, p.month, month)) {
        if (!payslipsByEmp.has(p.employeeId)) payslipsByEmp.set(p.employeeId, []);
        payslipsByEmp.get(p.employeeId).push(p);
      }
    });

    const rhRows = rhEmployees
      .map((emp) => {
        const computed = computeEmployeeMonthlyPayroll(
          emp,
          state.attendance,
          state.employeeAdvances,
          targetMonthForRh
        );
        const empPayslips = payslipsByEmp.get(emp.id) || [];
        return {
          empId: emp.id,
          name: emp.name,
          role: emp.role,
          department: emp.department,
          remunerationType: computed.remunerationType,
          remunerationLabel: REM_LABELS[computed.remunerationType] || 'Fixo Mensal',
          weekdayPresent: computed.weekdayPresent,
          saturdayCount: computed.saturdayCount,
          saturdayReceiptTotal: computed.saturdayReceiptTotal,
          saturdayOffTotal: computed.saturdayOffTotal,
          saturdayTotal: computed.saturdayTotal,
          saturdayDetails: computed.saturdayDetails,
          earnedBase: computed.earnedBase,
          twelfthsTotal: computed.twelfthsTotal,
          twelfthsLabel: getTwelfthsOptionMeta(computed.twelfthsMode).shortLabel,
          ssDeduction: computed.ssDeduction,
          offPayrollEarned: computed.offPayrollEarned,
          advancesTotal: computed.advancesTotal,
          netToPay: computed.netToPay,
          payslipIssued: empPayslips.length > 0,
          payslipsNetTotal: empPayslips.reduce((s, p) => s + (Number(p.netSalary) || 0), 0),
        };
      })
      .filter((r) => {
        if (this.flowFilter === 'sabados' && r.saturdayCount <= 0) return false;
        if (this.taxFilter === 'por_fora' && r.offPayrollEarned <= 0 && r.saturdayOffTotal <= 0) return false;
        return true;
      });

    // 3. Faturas (Saídas) e Recebimentos (Entradas) de Obras
    const invoiceRows = (state.projectInvoices || [])
      .filter((inv) => {
        if (this.projectFilter !== 'all' && inv.projectId !== this.projectFilter) return false;
        const dt = inv.invoiceDate || inv.createdAt || '';
        if (!this._matchesPeriodDate(dt, String(dt).slice(0, 7), month)) return false;
        if (query) {
          const proj = projMap.get(inv.projectId);
          const hay = `${inv.supplier || ''} ${inv.invoiceNumber || ''} ${inv.category || ''} ${proj?.name || ''} ${proj?.code || ''}`.toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      })
      .map((inv) => {
        const proj = projMap.get(inv.projectId);
        return {
          ...inv,
          projectLabel: proj ? `${proj.code} — ${proj.name}` : inv.projectId,
        };
      });

    const inflowRows = [];
    allProjects.forEach((proj) => {
      if (this.projectFilter !== 'all' && proj.id !== this.projectFilter && proj.code !== this.projectFilter) return;
      (proj.payments || []).forEach((pay) => {
        if (pay.status !== 'pago') return;
        const dt = pay.paidDate || pay.dueDate || '';
        if (!this._matchesPeriodDate(dt, String(dt).slice(0, 7), month)) return;
        if (query) {
          const hay = `${proj.code || ''} ${proj.name || ''} ${proj.clientName || ''} ${pay.description || ''}`.toLowerCase();
          if (!hay.includes(query)) return false;
        }
        inflowRows.push({
          id: pay.id,
          date: dt,
          projectLabel: `${proj.code} — ${proj.name}`,
          clientName: proj.clientName,
          description: pay.description || 'Recebimento de Obra',
          method: pay.method || 'Transferência Bancária',
          amount: Number(pay.amount) || 0,
        });
      });
    });

    // 4. Vales / Adiantamentos
    const advanceRows = (state.employeeAdvances || [])
      .filter((adv) => {
        if (!this._matchesPeriodDate(adv.date, adv.month, month)) return false;
        if (this.employeeFilter !== 'all' && adv.employeeId !== this.employeeFilter) return false;
        const emp = empMap.get(adv.employeeId);
        if (this.deptFilter !== 'all' && emp?.department !== this.deptFilter) return false;
        if (query) {
          const hay = `${emp?.name || ''} ${adv.notes || ''}`.toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      })
      .map((adv) => ({
        ...adv,
        employeeName: empMap.get(adv.employeeId)?.name || 'Colaborador',
      }));

    // KPIs agregados do período filtrado
    const periodInflows = cashRows
      .filter((m) => m.type === 'entrada')
      .reduce((s, m) => s + (Number(m.amount) || 0), 0);
    const periodOutflows = cashRows
      .filter((m) => m.type === 'saida')
      .reduce((s, m) => s + (Number(m.amount) || 0), 0);
    const periodSalaries = cashRows
      .filter((m) => m.type === 'saida' && (m.originType === 'recibo_vencimento' || m.category === 'Salários & Ordenados'))
      .reduce((s, m) => s + (Number(m.amount) || 0), 0);
    const periodAdvances = advanceRows.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const periodInvoices = invoiceRows.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const saturdayCount = rhRows.reduce((s, r) => s + r.saturdayCount, 0);
    const saturdayReceiptTotal = rhRows.reduce((s, r) => s + r.saturdayReceiptTotal, 0);
    const saturdayOffTotal = rhRows.reduce((s, r) => s + r.saturdayOffTotal, 0);

    return {
      cashSummary,
      cashRows,
      rhRows,
      invoiceRows,
      inflowRows,
      advanceRows,
      kpis: {
        openingBalance: cashSummary.openingBalance,
        cashBalance: cashSummary.currentBalance,
        periodInflows,
        inflowsCount: cashRows.filter((m) => m.type === 'entrada').length,
        periodOutflows,
        periodSalaries,
        periodAdvances,
        periodPayrollTotal: periodSalaries + periodAdvances,
        periodInvoices,
        invoicesCount: invoiceRows.length,
        saturdayCount,
        saturdayReceiptTotal,
        saturdayOffTotal,
        saturdayTotal: saturdayReceiptTotal + saturdayOffTotal,
        periodNetResult: periodInflows - periodOutflows,
      },
    };
  }

  render(container, ctx) {
    const state = store.getState();
    const { month, search = '', currentProfile = null } = ctx;
    const can = ctx.can || (() => true);
    const canManageCash = can('op_obras', 'pagamentos') || can('rh_recibos', 'emitir');
    const query = search.trim().toLowerCase();

    const dataset = this._buildReportDataset(state, month, query);
    const { cashSummary, kpis } = dataset;

    const yearsSet = new Set([String(new Date().getFullYear()), String(month).slice(0, 4)]);
    cashSummary.movements.forEach((m) => {
      if (m.month) yearsSet.add(String(m.month).slice(0, 4));
    });
    const years = [...yearsSet].sort().reverse();
    const departments = [...new Set((state.employees || []).map((e) => e.department).filter(Boolean))].sort();

    container.innerHTML = `
      <div class="erp-dash-banner" style="margin-bottom:18px;">
        <div>
          <div class="erp-dash-banner__title">Relatórios Avançados &amp; Caixa da Empresa</div>
          <div class="erp-dash-banner__sub">
            Consolidação inteligente em tempo real de Salários, Sábados, Vales, Faturas de Obras, Entradas e Abate Automático no Caixa (${escapeHtml(this._getPeriodLabel(month))}).
          </div>
        </div>
        <div class="erp-dash-banner__actions" style="flex-wrap:wrap;">
          ${
            canManageCash
              ? `<button type="button" class="erp-btn erp-btn--outline" style="background:rgba(255,255,255,0.1);color:#fff;border-color:rgba(255,255,255,0.25);" id="btnSetOpeningBalance">
                   ${ICONS.euro}<span>Saldo Inicial Caixa</span>
                 </button>
                 <button type="button" class="erp-btn erp-btn--outline" style="background:rgba(255,255,255,0.1);color:#fff;border-color:rgba(255,255,255,0.25);" id="btnNewCashMovement">
                   ${ICONS.plus}<span>Movimento Caixa</span>
                 </button>`
              : ''
          }
          <button type="button" class="erp-btn erp-btn--outline" style="background:rgba(255,255,255,0.1);color:#fff;border-color:rgba(255,255,255,0.25);" id="btnExportReportCsv">
            ${ICONS.download}<span>Exportar CSV</span>
          </button>
          <button type="button" class="erp-btn erp-btn--primary" id="btnDownloadSparkPdf">
            ${ICONS.receipt}<span>Baixar PDF Spark &amp; Smirk</span>
          </button>
        </div>
      </div>

      <!-- KPIs Executivos -->
      <div class="erp-kpi-grid" style="margin-bottom:18px;">
        <div class="erp-kpi-card erp-kpi-card--primary">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Saldo Atual em Caixa</span>
            <span class="erp-kpi-card__icon">${ICONS.euro}</span>
          </div>
          <div class="erp-kpi-card__value" style="color:${kpis.cashBalance >= 0 ? 'var(--erp-success)' : 'var(--erp-danger)'};">${escapeHtml(formatCurrency(kpis.cashBalance))}</div>
          <div class="erp-kpi-card__meta">Inicial ${escapeHtml(formatCurrency(kpis.openingBalance))} · Abate RH e Faturas automático</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--success">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Entradas (${escapeHtml(this._getPeriodLabel(month))})</span>
            <span class="erp-kpi-card__icon">${ICONS.building}</span>
          </div>
          <div class="erp-kpi-card__value" style="color:var(--erp-success);">+ ${escapeHtml(formatCurrency(kpis.periodInflows))}</div>
          <div class="erp-kpi-card__meta">${kpis.inflowsCount} recebimento(s) / reforço(s)</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--danger">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Saídas RH + Faturas</span>
            <span class="erp-kpi-card__icon">${ICONS.receipt}</span>
          </div>
          <div class="erp-kpi-card__value" style="color:var(--erp-danger);">- ${escapeHtml(formatCurrency(kpis.periodOutflows))}</div>
          <div class="erp-kpi-card__meta">RH ${escapeHtml(formatCurrency(kpis.periodPayrollTotal))} · Faturas ${escapeHtml(formatCurrency(kpis.periodInvoices))}</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--warning">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Trabalho aos Sábados</span>
            <span class="erp-kpi-card__icon">${ICONS.calendar}</span>
          </div>
          <div class="erp-kpi-card__value" style="color:var(--erp-accent-dark);">${kpis.saturdayCount} sáb. · ${escapeHtml(formatCurrency(kpis.saturdayTotal))}</div>
          <div class="erp-kpi-card__meta">Recibo SS ${escapeHtml(formatCurrency(kpis.saturdayReceiptTotal))} · Por Fora ${escapeHtml(formatCurrency(kpis.saturdayOffTotal))}</div>
        </div>
      </div>

      <!-- Painel de Filtros Avançados -->
      <section class="erp-panel" style="margin-bottom:18px;">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h2 class="erp-panel__title">Filtros Inteligentes &amp; Sub-abas de Análise</h2>
            <p class="erp-panel__desc">Refine o período, colaborador, departamento, obra, tipo de fluxo ou regime fiscal antes de analisar ou gerar o PDF.</p>
          </div>
          <div class="erp-subtabs">
            <button type="button" class="erp-subtab ${this.viewMode === 'overview' ? 'is-active' : ''}" data-rep-tab="overview">Resumo &amp; PDF</button>
            <button type="button" class="erp-subtab ${this.viewMode === 'cash' ? 'is-active' : ''}" data-rep-tab="cash">
              Caixa da Empresa <span class="erp-subtab__badge">${dataset.cashRows.length}</span>
            </button>
            <button type="button" class="erp-subtab ${this.viewMode === 'saturdays' ? 'is-active' : ''}" data-rep-tab="saturdays">
              RH, Sábados &amp; Obras <span class="erp-subtab__badge">${dataset.rhRows.length}</span>
            </button>
          </div>
        </div>

        <div class="erp-panel__body">
          <div class="erp-form-grid erp-form-grid--3" style="margin-bottom:12px;">
            <div class="erp-field">
              <label for="repPeriodMode">Período de Análise</label>
              <select id="repPeriodMode">
                <option value="month" ${this.periodMode === 'month' ? 'selected' : ''}>Mês de Referência (${escapeHtml(formatMonthLabel(month))})</option>
                <option value="range" ${this.periodMode === 'range' ? 'selected' : ''}>Intervalo de Datas Personalizado</option>
                <option value="year" ${this.periodMode === 'year' ? 'selected' : ''}>Ano Completo</option>
                <option value="all" ${this.periodMode === 'all' ? 'selected' : ''}>Todo o Histórico</option>
              </select>
            </div>

            ${
              this.periodMode === 'range'
                ? `<div class="erp-field">
                     <label for="repDateFrom">Data Inicial</label>
                     <input type="date" id="repDateFrom" value="${escapeHtml(this.dateFrom)}">
                   </div>
                   <div class="erp-field">
                     <label for="repDateTo">Data Final</label>
                     <input type="date" id="repDateTo" value="${escapeHtml(this.dateTo)}">
                   </div>`
                : this.periodMode === 'year'
                  ? `<div class="erp-field">
                       <label for="repYearSelect">Selecionar Ano</label>
                       <select id="repYearSelect">
                         ${years.map((y) => `<option value="${escapeHtml(y)}" ${this.yearFilter === y ? 'selected' : ''}>${escapeHtml(y)}</option>`).join('')}
                       </select>
                     </div>`
                  : ''
            }

            <div class="erp-field">
              <label for="repEmpFilter">Colaborador</label>
              <select id="repEmpFilter">
                <option value="all">Todos os Colaboradores</option>
                ${(state.employees || []).map((e) => `<option value="${escapeHtml(e.id)}" ${this.employeeFilter === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}
              </select>
            </div>

            <div class="erp-field">
              <label for="repDeptFilter">Departamento</label>
              <select id="repDeptFilter">
                <option value="all">Todos os Departamentos</option>
                ${departments.map((d) => `<option value="${escapeHtml(d)}" ${this.deptFilter === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
              </select>
            </div>

            <div class="erp-field">
              <label for="repProjFilter">Obra / Projeto</label>
              <select id="repProjFilter">
                <option value="all">Todas as Obras</option>
                ${(state.projects || []).map((p) => `<option value="${escapeHtml(p.code || p.id)}" ${this.projectFilter === (p.code || p.id) ? 'selected' : ''}>${escapeHtml(p.code)} — ${escapeHtml(p.name)}</option>`).join('')}
              </select>
            </div>

            <div class="erp-field">
              <label for="repFlowFilter">Tipo de Fluxo / Origem</label>
              <select id="repFlowFilter">
                <option value="all" ${this.flowFilter === 'all' ? 'selected' : ''}>Todos os Fluxos</option>
                <option value="entrada" ${this.flowFilter === 'entrada' ? 'selected' : ''}>Apenas Entradas (+)</option>
                <option value="saida" ${this.flowFilter === 'saida' ? 'selected' : ''}>Apenas Saídas (-)</option>
                <option value="rh" ${this.flowFilter === 'rh' ? 'selected' : ''}>Apenas Pagamentos RH &amp; Vales</option>
                <option value="obras" ${this.flowFilter === 'obras' ? 'selected' : ''}>Apenas Faturas &amp; Recebimentos de Obras</option>
                <option value="sabados" ${this.flowFilter === 'sabados' ? 'selected' : ''}>Com Sábados Trabalhados</option>
              </select>
            </div>

            <div class="erp-field">
              <label for="repTaxFilter">Regime Fiscal</label>
              <select id="repTaxFilter">
                <option value="all" ${this.taxFilter === 'all' ? 'selected' : ''}>Todos os Regimes</option>
                <option value="recibo_ss" ${this.taxFilter === 'recibo_ss' ? 'selected' : ''}>Sujeito a Segurança Social</option>
                <option value="por_fora" ${this.taxFilter === 'por_fora' ? 'selected' : ''}>Por Fora da Segurança Social</option>
                <option value="misto" ${this.taxFilter === 'misto' ? 'selected' : ''}>Misto (Recibo + Por Fora)</option>
              </select>
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding-top:10px;border-top:1px dashed var(--erp-border);">
            <span class="erp-cell-sub"><strong>Âmbito ativo:</strong> ${escapeHtml(this._getFilterSummaryText(state.employees || [], state.projects || [], month))}</span>
            <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnClearReportFilters">Limpar Filtros</button>
          </div>
        </div>
      </section>

      <div id="repSubContent"></div>
    `;

    const subTarget = container.querySelector('#repSubContent');
    if (this.viewMode === 'cash') {
      this._renderCashTab(subTarget, dataset, canManageCash);
    } else if (this.viewMode === 'saturdays') {
      this._renderDetailsTab(subTarget, dataset);
    } else {
      this._renderOverviewPdfTab(subTarget, dataset, month);
    }

    container.querySelectorAll('[data-rep-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.viewMode = btn.dataset.repTab;
        store._commit();
      });
    });

    container.querySelector('#repPeriodMode')?.addEventListener('change', (e) => {
      this.periodMode = e.target.value;
      store._commit();
    });
    container.querySelector('#repDateFrom')?.addEventListener('change', (e) => {
      this.dateFrom = e.target.value;
      store._commit();
    });
    container.querySelector('#repDateTo')?.addEventListener('change', (e) => {
      this.dateTo = e.target.value;
      store._commit();
    });
    container.querySelector('#repYearSelect')?.addEventListener('change', (e) => {
      this.yearFilter = e.target.value;
      store._commit();
    });
    container.querySelector('#repEmpFilter')?.addEventListener('change', (e) => {
      this.employeeFilter = e.target.value;
      store._commit();
    });
    container.querySelector('#repDeptFilter')?.addEventListener('change', (e) => {
      this.deptFilter = e.target.value;
      store._commit();
    });
    container.querySelector('#repProjFilter')?.addEventListener('change', (e) => {
      this.projectFilter = e.target.value;
      store._commit();
    });
    container.querySelector('#repFlowFilter')?.addEventListener('change', (e) => {
      this.flowFilter = e.target.value;
      store._commit();
    });
    container.querySelector('#repTaxFilter')?.addEventListener('change', (e) => {
      this.taxFilter = e.target.value;
      store._commit();
    });
    container.querySelector('#btnClearReportFilters')?.addEventListener('click', () => {
      this.periodMode = 'month';
      this.dateFrom = '';
      this.dateTo = '';
      this.flowFilter = 'all';
      this.taxFilter = 'all';
      this.employeeFilter = 'all';
      this.deptFilter = 'all';
      this.projectFilter = 'all';
      store._commit();
    });

    container.querySelector('#btnSetOpeningBalance')?.addEventListener('click', () => {
      this._openCashOpeningModal(cashSummary);
    });
    container.querySelector('#btnNewCashMovement')?.addEventListener('click', () => {
      this._openNewCashMovementModal(state);
    });
    container.querySelector('#btnExportReportCsv')?.addEventListener('click', () => {
      this._exportReportCsv(dataset, month);
    });
    container.querySelector('#btnDownloadSparkPdf')?.addEventListener('click', async () => {
      await this._triggerPdfDownload(dataset, state, month, currentProfile);
    });
  }

  _renderOverviewPdfTab(target, dataset, month) {
    const { kpis, rhRows, cashRows, invoiceRows, inflowRows } = dataset;

    target.innerHTML = `
      <section class="erp-panel" style="margin-bottom:18px;">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h3 class="erp-panel__title">Personalizar Secções do PDF Executivo Spark &amp; Smirk</h3>
            <p class="erp-panel__desc">Escolha exatamente o que pretende incluir no documento PDF oficial para direção ou contabilidade.</p>
          </div>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" id="btnPdfFromBuilder">
            ${ICONS.download}<span>Gerar &amp; Baixar PDF Agora</span>
          </button>
        </div>
        <div class="erp-panel__body">
          <div class="erp-form-grid">
            <label class="erp-check-row">
              <input type="checkbox" data-pdf-sec="rh" ${this.pdfSections.rh ? 'checked' : ''}>
              <span><strong>1. Folha RH &amp; Sábados Trabalhados</strong> (${rhRows.length} colaborador(es) · ${kpis.saturdayCount} sáb. pagos)</span>
            </label>
            <label class="erp-check-row">
              <input type="checkbox" data-pdf-sec="cash" ${this.pdfSections.cash ? 'checked' : ''}>
              <span><strong>2. Extrato do Caixa da Empresa</strong> (${cashRows.length} movimento(s) · Saldo ${escapeHtml(formatCurrency(kpis.cashBalance))})</span>
            </label>
            <label class="erp-check-row">
              <input type="checkbox" data-pdf-sec="projects" ${this.pdfSections.projects ? 'checked' : ''}>
              <span><strong>3. Faturas de Obras &amp; Entradas</strong> (${invoiceRows.length} fatura(s) · ${inflowRows.length} recebimento(s))</span>
            </label>
            <label class="erp-check-row">
              <input type="checkbox" data-pdf-sec="advances" ${this.pdfSections.advances ? 'checked' : ''}>
              <span><strong>4. Adiantamentos &amp; Vales Salariais</strong> (${dataset.advanceRows.length} lançamento(s))</span>
            </label>
          </div>
        </div>
      </section>

      <div class="erp-account-grid">
        <section class="erp-panel">
          <div class="erp-panel__header">
            <div class="erp-panel__title-group">
              <h3 class="erp-panel__title">Fecho Financeiro — ${escapeHtml(this._getPeriodLabel(month))}</h3>
              <p class="erp-panel__desc">Resumo de entradas, saídas RH, faturas e impacto no Caixa da Empresa</p>
            </div>
          </div>
          <div class="erp-table-wrap">
            <table class="erp-table">
              <tbody>
                <tr>
                  <td><strong>Saldo Inicial de Abertura do Caixa</strong></td>
                  <td style="text-align:right;font-weight:700;">${escapeHtml(formatCurrency(kpis.openingBalance))}</td>
                </tr>
                <tr>
                  <td><strong>(+) Entradas / Recebimentos de Obras &amp; Aportes</strong></td>
                  <td style="text-align:right;font-weight:700;color:var(--erp-success);">+ ${escapeHtml(formatCurrency(kpis.periodInflows))}</td>
                </tr>
                <tr>
                  <td><strong>(-) Pagamentos de Salários &amp; Ordenados (Recibos Pagos)</strong></td>
                  <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(kpis.periodSalaries))}</td>
                </tr>
                <tr>
                  <td><strong>(-) Adiantamentos / Vales Retirados</strong></td>
                  <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(kpis.periodAdvances))}</td>
                </tr>
                <tr>
                  <td><strong>(-) Saídas de Faturas de Obras &amp; Materiais</strong></td>
                  <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(kpis.periodInvoices))}</td>
                </tr>
                <tr style="background:var(--erp-surface-alt);">
                  <td><strong>Balanço Líquido do Período</strong></td>
                  <td style="text-align:right;font-weight:800;color:${kpis.periodNetResult >= 0 ? 'var(--erp-success)' : 'var(--erp-danger)'};">${escapeHtml(formatCurrency(kpis.periodNetResult))}</td>
                </tr>
                <tr style="background:var(--erp-primary-soft);">
                  <td><strong style="font-size:14px;">SALDO FINAL ATUAL EM CAIXA</strong></td>
                  <td style="text-align:right;font-size:16px;font-weight:900;color:${kpis.cashBalance >= 0 ? 'var(--erp-success)' : 'var(--erp-danger)'};">${escapeHtml(formatCurrency(kpis.cashBalance))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="erp-panel">
          <div class="erp-panel__header">
            <div class="erp-panel__title-group">
              <h3 class="erp-panel__title">Últimos Abates &amp; Entradas no Caixa</h3>
              <p class="erp-panel__desc">Sincronização automática a partir dos recibos, vales e faturas</p>
            </div>
          </div>
          <div class="erp-table-wrap">
            <table class="erp-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Movimento</th>
                  <th style="text-align:right">Valor</th>
                </tr>
              </thead>
              <tbody>
                ${
                  cashRows.length === 0
                    ? `<tr><td colspan="3" style="text-align:center;color:var(--erp-text-muted);padding:24px;">Sem movimentos neste filtro.</td></tr>`
                    : cashRows
                        .slice(0, 8)
                        .map(
                          (m) => `
                      <tr>
                        <td>${escapeHtml(formatDatePT(m.date))}</td>
                        <td>
                          <div class="erp-cell-title">${escapeHtml(m.description)}</div>
                          <div class="erp-cell-sub">${escapeHtml(m.category)}</div>
                        </td>
                        <td style="text-align:right;font-weight:700;color:${m.type === 'entrada' ? 'var(--erp-success)' : 'var(--erp-danger)'};">
                          ${m.type === 'entrada' ? '+' : '-'} ${escapeHtml(formatCurrency(m.amount))}
                        </td>
                      </tr>`
                        )
                        .join('')
                }
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    target.querySelectorAll('[data-pdf-sec]').forEach((cb) => {
      cb.addEventListener('change', () => {
        this.pdfSections[cb.dataset.pdfSec] = cb.checked;
      });
    });

    target.querySelector('#btnPdfFromBuilder')?.addEventListener('click', () => {
      document.getElementById('btnDownloadSparkPdf')?.click();
    });
  }

  _renderCashTab(target, dataset, canManageCash) {
    const { cashRows } = dataset;

    target.innerHTML = `
      <section class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h3 class="erp-panel__title">Livro de Caixa Empresarial — Entradas &amp; Saídas</h3>
            <p class="erp-panel__desc">Pagamentos de ordenados, adiantamentos e faturas abatem automaticamente do Caixa da Empresa.</p>
          </div>
        </div>
        ${
          cashRows.length === 0
            ? `<div class="erp-empty">${ICONS.euro}<div class="erp-empty__title">Nenhum movimento de caixa encontrado</div><p class="erp-empty__desc">Emita recibos pagos, adiantamentos, faturas ou registe um movimento manual.</p></div>`
            : `<div class="erp-table-wrap">
                 <table class="erp-table">
                   <thead>
                     <tr>
                       <th>Data</th>
                       <th>Origem</th>
                       <th>Descrição</th>
                       <th>Regime</th>
                       <th style="text-align:right">Entrada / Saída</th>
                       <th style="text-align:right">Ação</th>
                     </tr>
                   </thead>
                   <tbody>
                     ${cashRows
                       .map((m) => {
                         const isManual = m.originType === 'manual';
                         const badgeCls =
                           m.type === 'entrada'
                             ? 'erp-badge--success'
                             : m.originType === 'fatura_obra'
                               ? 'erp-badge--warning'
                               : 'erp-badge--danger';
                         return `
                         <tr>
                           <td>${escapeHtml(formatDatePT(m.date))}</td>
                           <td>
                             <span class="erp-badge ${badgeCls}">${escapeHtml(m.category)}</span>
                             <div class="erp-cell-sub" style="margin-top:3px;">${isManual ? 'Lançamento Manual' : 'Abate/Crédito Automático'}</div>
                           </td>
                           <td>
                             <div class="erp-cell-title">${escapeHtml(m.description)}</div>
                             ${m.notes ? `<div class="erp-cell-sub">${escapeHtml(m.notes)}</div>` : ''}
                           </td>
                           <td><span class="erp-badge erp-badge--neutral">${escapeHtml(m.taxModeLabel)}</span></td>
                           <td style="text-align:right;font-weight:800;color:${m.type === 'entrada' ? 'var(--erp-success)' : 'var(--erp-danger)'};">
                             ${m.type === 'entrada' ? '+' : '-'} ${escapeHtml(formatCurrency(m.amount))}
                           </td>
                           <td style="text-align:right">
                             ${
                               isManual && canManageCash
                                 ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" data-del-cash="${escapeHtml(m.id)}" title="Remover Movimento Manual">${ICONS.trash}</button>`
                                 : '<span class="erp-cell-sub">Automático</span>'
                             }
                           </td>
                         </tr>`;
                       })
                       .join('')}
                   </tbody>
                 </table>
               </div>`
        }
      </section>
    `;

    target.querySelectorAll('[data-del-cash]').forEach((btn) => {
      btn.addEventListener('click', () => {
        confirmAction({
          title: 'Remover Movimento de Caixa',
          message: 'Pretende eliminar este movimento manual do livro de caixa?',
          onConfirm: () => {
            store.deleteCashMovement(btn.dataset.delCash);
            showToast('Movimento de caixa removido.');
          },
        });
      });
    });
  }

  _renderDetailsTab(target, dataset) {
    const { rhRows, invoiceRows, inflowRows } = dataset;

    target.innerHTML = `
      <section class="erp-panel" style="margin-bottom:18px;">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h3 class="erp-panel__title">Colaboradores — Dias Úteis (Seg–Sex) vs Sábados Pagos</h3>
            <p class="erp-panel__desc">Detalhe completo de quantos sábados trabalhou cada funcionário e quanto recebeu em Recibo SS vs Por Fora.</p>
          </div>
        </div>
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Seg–Sex (P)</th>
                <th>Sábados Trab.</th>
                <th>Sáb. Recibo (c/ SS)</th>
                <th>Sáb. Por Fora SS</th>
                <th>Duodécimos / SS</th>
                <th style="text-align:right">Total Final</th>
              </tr>
            </thead>
            <tbody>
              ${
                rhRows.length === 0
                  ? `<tr><td colspan="7" style="text-align:center;color:var(--erp-text-muted);padding:24px;">Sem colaboradores neste filtro.</td></tr>`
                  : rhRows
                      .map(
                        (r) => `
                    <tr>
                      <td>
                        <div class="erp-person-cell">
                          <span class="erp-avatar">${escapeHtml(getInitials(r.name))}</span>
                          <div>
                            <div class="erp-cell-title">${escapeHtml(r.name)}</div>
                            <div class="erp-cell-sub">${escapeHtml(r.department)} · ${escapeHtml(r.remunerationLabel)}</div>
                          </div>
                        </div>
                      </td>
                      <td><strong>${r.weekdayPresent} d</strong></td>
                      <td>
                        ${
                          r.saturdayCount > 0
                            ? `<span class="erp-badge erp-badge--warning">${r.saturdayCount} sáb.</span>`
                            : '<span class="erp-cell-sub">0</span>'
                        }
                      </td>
                      <td style="color:${r.saturdayReceiptTotal > 0 ? 'var(--erp-info)' : 'var(--erp-text-muted)'};font-weight:700;">
                        ${r.saturdayReceiptTotal > 0 ? `+ ${escapeHtml(formatCurrency(r.saturdayReceiptTotal))}` : '€ 0,00'}
                      </td>
                      <td style="color:${r.saturdayOffTotal > 0 ? 'var(--erp-accent-dark)' : 'var(--erp-text-muted)'};font-weight:700;">
                        ${r.saturdayOffTotal > 0 ? `+ ${escapeHtml(formatCurrency(r.saturdayOffTotal))}` : '€ 0,00'}
                      </td>
                      <td>
                        <div class="erp-cell-sub">Duod. +${escapeHtml(formatCurrency(r.twelfthsTotal))}</div>
                        <div class="erp-cell-sub" style="color:var(--erp-danger);">SS -${escapeHtml(formatCurrency(r.ssDeduction))}</div>
                      </td>
                      <td style="text-align:right;font-weight:800;color:var(--erp-success);">${escapeHtml(formatCurrency(r.netToPay))}</td>
                    </tr>`
                      )
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </section>

      <div class="erp-account-grid">
        <section class="erp-panel">
          <div class="erp-panel__header">
            <div class="erp-panel__title-group">
              <h3 class="erp-panel__title">Saídas de Faturas de Obras (${invoiceRows.length})</h3>
            </div>
          </div>
          <div class="erp-table-wrap">
            <table class="erp-table">
              <thead>
                <tr><th>Data</th><th>Fornecedor / Obra</th><th style="text-align:right">Valor</th></tr>
              </thead>
              <tbody>
                ${
                  invoiceRows.length === 0
                    ? `<tr><td colspan="3" style="text-align:center;color:var(--erp-text-muted);padding:20px;">Sem faturas neste filtro.</td></tr>`
                    : invoiceRows
                        .map(
                          (inv) => `
                        <tr>
                          <td>${escapeHtml(formatDatePT(inv.invoiceDate))}</td>
                          <td>
                            <div class="erp-cell-title">#${escapeHtml(inv.invoiceNumber)} · ${escapeHtml(inv.supplier)}</div>
                            <div class="erp-cell-sub">${escapeHtml(inv.projectLabel)}</div>
                          </td>
                          <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(inv.amount))}</td>
                        </tr>`
                        )
                        .join('')
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="erp-panel">
          <div class="erp-panel__header">
            <div class="erp-panel__title-group">
              <h3 class="erp-panel__title">Entradas / Recebimentos de Obras (${inflowRows.length})</h3>
            </div>
          </div>
          <div class="erp-table-wrap">
            <table class="erp-table">
              <thead>
                <tr><th>Data</th><th>Obra / Cliente</th><th style="text-align:right">Valor</th></tr>
              </thead>
              <tbody>
                ${
                  inflowRows.length === 0
                    ? `<tr><td colspan="3" style="text-align:center;color:var(--erp-text-muted);padding:20px;">Sem recebimentos neste filtro.</td></tr>`
                    : inflowRows
                        .map(
                          (inf) => `
                        <tr>
                          <td>${escapeHtml(formatDatePT(inf.date))}</td>
                          <td>
                            <div class="erp-cell-title">${escapeHtml(inf.description)}</div>
                            <div class="erp-cell-sub">${escapeHtml(inf.projectLabel)} · ${escapeHtml(inf.clientName || '')}</div>
                          </td>
                          <td style="text-align:right;font-weight:700;color:var(--erp-success);">+ ${escapeHtml(formatCurrency(inf.amount))}</td>
                        </tr>`
                        )
                        .join('')
                }
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  _openCashOpeningModal(cashSummary) {
    openModal({
      title: 'Definir Saldo Inicial do Caixa da Empresa',
      subtitle: 'Base de tesouraria guardada no Supabase para apuramento automático do saldo atual',
      bodyHtml: `
        <form id="cashOpeningForm">
          <div class="erp-form-grid">
            <div class="erp-field erp-field--full">
              <label for="cashOpenAmt">Saldo Inicial / Base em Caixa (€) *</label>
              <input type="text" inputmode="numeric" data-currency-euro id="cashOpenAmt" value="${escapeHtml(cashSummary.openingBalance || 0)}" required>
              <span class="erp-field__hint">Este valor soma todas as entradas e abate automaticamente salários, adiantamentos e faturas.</span>
            </div>
            <div class="erp-field erp-field--full">
              <label for="cashOpenNote">Nota / Referência Bancária</label>
              <input type="text" id="cashOpenNote" value="${escapeHtml(store.getState().cashOpeningNote || '')}" placeholder="Ex.: Saldo bancário inicial Spark & Smirk">
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="cashOpeningForm" class="erp-btn erp-btn--primary">Guardar Saldo Inicial</button>
      `,
      onMount: (modal) => {
        modal.querySelector('#cashOpeningForm')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const val = parseCurrencyInput(modal.querySelector('#cashOpenAmt')?.value);
          const note = modal.querySelector('#cashOpenNote')?.value?.trim() || '';
          const res = await store.setCashOpeningBalance(val, note);
          if (res !== null) {
            showToast(`Saldo inicial de caixa atualizado para ${formatCurrency(val)}.`);
            closeModal();
          }
        });
      },
    });
  }

  _openNewCashMovementModal(state) {
    openModal({
      title: 'Novo Movimento Manual no Caixa da Empresa',
      subtitle: 'Registe reforços de caixa, aportes ou outras despesas operacionais na base de dados',
      bodyHtml: `
        <form id="cashMovementForm">
          <div class="erp-form-grid">
            <div class="erp-field">
              <label for="cxType">Tipo de Movimento *</label>
              <select id="cxType">
                <option value="entrada">Entrada (+) — Aporte / Receita</option>
                <option value="saida">Saída (-) — Despesa / Retirada</option>
              </select>
            </div>
            <div class="erp-field">
              <label for="cxAmount">Valor (€) *</label>
              <input type="text" inputmode="numeric" data-currency-euro id="cxAmount" required placeholder="€ 0,00">
            </div>
            <div class="erp-field">
              <label for="cxCategory">Categoria *</label>
              <input type="text" id="cxCategory" required value="Reforço / Aporte de Caixa" placeholder="Ex.: Combustível, Aluguer, Aporte">
            </div>
            <div class="erp-field">
              <label for="cxDate">Data *</label>
              <input type="date" id="cxDate" value="${todayISO()}" required>
            </div>
            <div class="erp-field erp-field--full">
              <label for="cxDesc">Descrição *</label>
              <input type="text" id="cxDesc" required placeholder="Ex.: Transferência reforço de tesouraria">
            </div>
            <div class="erp-field">
              <label for="cxProj">Associar a Obra (Opcional)</label>
              <select id="cxProj">
                <option value="">Nenhuma</option>
                ${(state.projects || []).map((p) => `<option value="${escapeHtml(p.code || p.id)}">${escapeHtml(p.code)} — ${escapeHtml(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field">
              <label for="cxNotes">Observações</label>
              <input type="text" id="cxNotes" placeholder="Opcional">
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="cashMovementForm" class="erp-btn erp-btn--primary">Guardar no Caixa</button>
      `,
      onMount: (modal) => {
        const typeEl = modal.querySelector('#cxType');
        const catEl = modal.querySelector('#cxCategory');
        typeEl?.addEventListener('change', () => {
          if (catEl && (catEl.value === 'Reforço / Aporte de Caixa' || catEl.value === 'Outras Despesas Operacionais')) {
            catEl.value = typeEl.value === 'entrada' ? 'Reforço / Aporte de Caixa' : 'Outras Despesas Operacionais';
          }
        });

        modal.querySelector('#cashMovementForm')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const amt = parseCurrencyInput(modal.querySelector('#cxAmount')?.value);
          if (amt <= 0) {
            showToast('Indique um valor superior a € 0,00.', 'danger');
            return;
          }
          const dt = modal.querySelector('#cxDate')?.value || todayISO();
          const res = await store.addCashMovement({
            id: generateId('CXM'),
            type: typeEl?.value === 'entrada' ? 'entrada' : 'saida',
            category: catEl?.value?.trim() || 'Movimento Geral',
            date: dt,
            month: String(dt).slice(0, 7),
            description: modal.querySelector('#cxDesc')?.value?.trim() || 'Movimento de Caixa',
            amount: Number(amt.toFixed(2)),
            taxMode: 'geral',
            projectId: modal.querySelector('#cxProj')?.value || '',
            notes: modal.querySelector('#cxNotes')?.value?.trim() || '',
          });
          if (res !== null) {
            showToast('Movimento registado e sincronizado com o Caixa da Empresa.');
            closeModal();
          }
        });
      },
    });
  }

  _exportReportCsv(dataset, month) {
    const headers = ['Data', 'Tipo', 'Categoria', 'Descrição', 'Regime', 'Valor (€)'];
    const rows = dataset.cashRows.map((m) => [
      m.date,
      m.type === 'entrada' ? 'Entrada' : 'Saída',
      m.category,
      m.description,
      m.taxModeLabel,
      `${m.type === 'entrada' ? '' : '-'}${Number(m.amount || 0).toFixed(2)}`,
    ]);
    downloadCSV(`relatorio-caixa-spark-smirk-${month}.csv`, headers, rows);
    showToast('Relatório exportado em CSV.');
  }

  async _triggerPdfDownload(dataset, state, month, currentProfile) {
    try {
      const periodLabel = this._getPeriodLabel(month);
      const filterSummary = this._getFilterSummaryText(state.employees || [], state.projects || [], month);
      const operatorName = currentProfile?.nome_completo || currentProfile?.username || 'Direção Interna';
      await generateSparkReportPdf({
        title: `Relatório Executivo — ${periodLabel}`,
        periodLabel,
        filterSummary,
        operatorName,
        kpis: dataset.kpis,
        sections: this.pdfSections,
        rhRows: dataset.rhRows,
        cashRows: dataset.cashRows,
        invoiceRows: dataset.invoiceRows,
        inflowRows: dataset.inflowRows,
        advanceRows: dataset.advanceRows,
        filename: `Spark-Smirk-Relatorio-${month}.pdf`,
      });
      showToast('PDF personalizado Spark & Smirk transferido com sucesso!');
    } catch (err) {
      showToast(err?.message || 'Não foi possível gerar o PDF.', 'error');
    }
  }
}
