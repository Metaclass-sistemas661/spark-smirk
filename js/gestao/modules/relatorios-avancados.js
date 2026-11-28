/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Relatórios Avançados & Caixa da Empresa
   Sincronizado com Carteiras Contratadas, Faturas, RH e PDF
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
  receita: 'Carteira Contratada',
  geral: 'Geral',
};

export class RelatoriosAvancadosModule {
  constructor() {
    this.viewMode = 'overview'; // 'overview' | 'cash' | 'saturdays'
    this.periodMode = 'all'; // 'all' | 'month' | 'year' | 'range'
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
    return 'Carteira Global & Histórico Completo';
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
    const cashRows = cashSummary.movements
      .filter((m) => {
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
      })
      .map((m) => ({
        ...m,
        taxModeLabel: TAX_MODE_LABELS[m.taxMode] || m.taxMode || 'Geral',
      }));

    // 2. RH & Sábados (sempre usa o mês de referência da barra superior para assiduidade/sábados)
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
          month
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

    // 3. Faturas (Saídas) e Recebimentos das Carteiras Contratadas (Entradas)
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
          description: pay.description || 'Recebimento de Carteira Contratada',
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

    // KPIs filtrados no período selecionado
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
        portfolioContracted: cashSummary.portfolioContracted,
        portfolioReceived: cashSummary.portfolioReceived,
        portfolioOpen: cashSummary.portfolioOpen,
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
    const isGlobalMode = this.periodMode === 'all' && this.employeeFilter === 'all' && this.deptFilter === 'all' && this.projectFilter === 'all' && this.flowFilter === 'all' && this.taxFilter === 'all' && !query;

    container.innerHTML = `
      <div class="erp-dash-banner">
        <div>
          <div class="erp-dash-banner__title">Relatórios Avançados &amp; Caixa da Empresa</div>
          <div class="erp-dash-banner__sub">
            Sincronizado 100% com as <strong>Carteiras Contratadas</strong>: todo o recebimento das obras entra no Caixa e todo o salário, vale e fatura abate automaticamente.
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

      <!-- KPIs Reconciliados (Carteira Contratada -> Entradas -> Abates -> Saldo em Caixa) -->
      <div class="erp-kpi-grid">
        <div class="erp-kpi-card erp-kpi-card--primary">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Carteira Contratada Total</span>
            <span class="erp-kpi-card__icon">${ICONS.building}</span>
          </div>
          <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(cashSummary.portfolioContracted))}</div>
          <div class="erp-kpi-card__meta">A receber em aberto: ${escapeHtml(formatCurrency(cashSummary.portfolioOpen))}</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--success">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Entradas no Caixa (Carteiras)</span>
            <span class="erp-kpi-card__icon">${ICONS.checkCircle}</span>
          </div>
          <div class="erp-kpi-card__value" style="color:var(--erp-success);">+ ${escapeHtml(formatCurrency(isGlobalMode ? cashSummary.totalInflows : kpis.periodInflows))}</div>
          <div class="erp-kpi-card__meta">Carteiras: ${escapeHtml(formatCurrency(cashSummary.portfolioReceived))}${cashSummary.manualInflows > 0 ? ` · Aportes: ${escapeHtml(formatCurrency(cashSummary.manualInflows))}` : ''}</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--danger">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Saídas Abatidas (Faturas + RH)</span>
            <span class="erp-kpi-card__icon">${ICONS.receipt}</span>
          </div>
          <div class="erp-kpi-card__value" style="color:var(--erp-danger);">- ${escapeHtml(formatCurrency(isGlobalMode ? cashSummary.totalOutflows : kpis.periodOutflows))}</div>
          <div class="erp-kpi-card__meta">Faturas: ${escapeHtml(formatCurrency(isGlobalMode ? cashSummary.invoicesOutflow : kpis.periodInvoices))} · RH: ${escapeHtml(formatCurrency(isGlobalMode ? cashSummary.salariesOutflow + cashSummary.advancesOutflow : kpis.periodPayrollTotal))}</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--warning">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Saldo Real do Caixa da Empresa</span>
            <span class="erp-kpi-card__icon">${ICONS.euro}</span>
          </div>
          <div class="erp-kpi-card__value" style="color:${cashSummary.currentBalance >= 0 ? 'var(--erp-success)' : 'var(--erp-danger)'};">${escapeHtml(formatCurrency(cashSummary.currentBalance))}</div>
          <div class="erp-kpi-card__meta">Inicial ${escapeHtml(formatCurrency(cashSummary.openingBalance))} + Entradas - Saídas</div>
        </div>
      </div>

      <!-- Painel de Filtros Avançados (Ponta a Ponta) -->
      <section class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h2 class="erp-panel__title">Filtros Inteligentes &amp; Sub-abas</h2>
            <p class="erp-panel__desc">Mesmos dados do Dashboard e Carteiras Contratadas — alterne entre Carteira Completa, Mês de Referência ou Filtros Avançados.</p>
          </div>
          <div class="erp-subtabs">
            <button type="button" class="erp-subtab ${this.viewMode === 'overview' ? 'is-active' : ''}" data-rep-tab="overview">Resumo &amp; PDF</button>
            <button type="button" class="erp-subtab ${this.viewMode === 'cash' ? 'is-active' : ''}" data-rep-tab="cash">
              Caixa da Empresa <span class="erp-subtab__badge">${dataset.cashRows.length}</span>
            </button>
            <button type="button" class="erp-subtab ${this.viewMode === 'saturdays' ? 'is-active' : ''}" data-rep-tab="saturdays">
              RH, Sábados &amp; Carteiras <span class="erp-subtab__badge">${dataset.rhRows.length}</span>
            </button>
          </div>
        </div>

        <div class="erp-panel__body">
          <div class="erp-pill-switch" style="margin-bottom:14px;">
            <button type="button" class="${this.periodMode === 'all' ? 'is-active' : ''}" data-rep-period-pill="all">Toda a Carteira &amp; Histórico</button>
            <button type="button" class="${this.periodMode === 'month' ? 'is-active' : ''}" data-rep-period-pill="month">Mês: ${escapeHtml(formatMonthLabel(month))}</button>
            <button type="button" class="${this.periodMode === 'year' ? 'is-active' : ''}" data-rep-period-pill="year">Ano: ${escapeHtml(this.yearFilter)}</button>
            <button type="button" class="${this.periodMode === 'range' ? 'is-active' : ''}" data-rep-period-pill="range">Intervalo de Datas</button>
          </div>

          <div class="erp-form-grid erp-form-grid--3" style="margin-bottom:12px;">
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
                       <label for="repYearSelect">Ano</label>
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
              <label for="repProjFilter">Obra / Carteira Contratada</label>
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

      <div id="repSubContent" style="display:flex;flex-direction:column;gap:20px;"></div>
    `;

    const subTarget = container.querySelector('#repSubContent');
    if (this.viewMode === 'cash') {
      this._renderCashTab(subTarget, dataset, canManageCash);
    } else if (this.viewMode === 'saturdays') {
      this._renderDetailsTab(subTarget, dataset, month);
    } else {
      this._renderOverviewPdfTab(subTarget, dataset, month);
    }

    container.querySelectorAll('[data-rep-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.viewMode = btn.dataset.repTab;
        store._commit();
      });
    });

    container.querySelectorAll('[data-rep-period-pill]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.periodMode = btn.dataset.repPeriodPill;
        store._commit();
      });
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
      this.periodMode = 'all';
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
    const { cashSummary, kpis, rhRows, cashRows, invoiceRows, inflowRows } = dataset;

    target.innerHTML = `
      <section class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h3 class="erp-panel__title">Construtor de Relatório PDF Spark &amp; Smirk</h3>
            <p class="erp-panel__desc">Selecione as secções incluídas no PDF oficial para direção ou contabilidade.</p>
          </div>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" id="btnPdfFromBuilder">
            ${ICONS.download}<span>Gerar &amp; Baixar PDF Agora</span>
          </button>
        </div>
        <div class="erp-panel__body">
          <div class="erp-form-grid">
            <label class="erp-check-row">
              <input type="checkbox" data-pdf-sec="rh" ${this.pdfSections.rh ? 'checked' : ''}>
              <span><strong>1. Folha RH &amp; Sábados Trabalhados</strong> (${rhRows.length} colaborador(es) · ${kpis.saturdayCount} sáb. em ${escapeHtml(formatMonthLabel(month))})</span>
            </label>
            <label class="erp-check-row">
              <input type="checkbox" data-pdf-sec="cash" ${this.pdfSections.cash ? 'checked' : ''}>
              <span><strong>2. Extrato do Caixa da Empresa</strong> (${cashRows.length} movimento(s) · Saldo Real ${escapeHtml(formatCurrency(cashSummary.currentBalance))})</span>
            </label>
            <label class="erp-check-row">
              <input type="checkbox" data-pdf-sec="projects" ${this.pdfSections.projects ? 'checked' : ''}>
              <span><strong>3. Faturas de Obras &amp; Carteiras</strong> (${invoiceRows.length} fatura(s) · ${inflowRows.length} entrada(s))</span>
            </label>
            <label class="erp-check-row">
              <input type="checkbox" data-pdf-sec="advances" ${this.pdfSections.advances ? 'checked' : ''}>
              <span><strong>4. Adiantamentos &amp; Vales Salariais</strong> (${dataset.advanceRows.length} lançamento(s))</span>
            </label>
          </div>
        </div>
      </section>

      <!-- Reconciliação Ponta a Ponta -->
      <section class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h3 class="erp-panel__title">Reconciliação: Carteiras Contratadas → Caixa da Empresa</h3>
            <p class="erp-panel__desc">Alinhamento exato com os valores do Dashboard: é através dos recebimentos das Carteiras Contratadas que o dinheiro entra em Caixa.</p>
          </div>
          <span class="erp-badge erp-badge--success">100% Sincronizado com Dashboard</span>
        </div>
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Rubrica Financeira</th>
                <th>Origem no Sistema</th>
                <th style="text-align:right">Global (Carteiras &amp; Caixa)</th>
                <th style="text-align:right">No Filtro (${escapeHtml(this._getPeriodLabel(month))})</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Carteira Contratada c/ IVA (Total Obras)</strong></td>
                <td><span class="erp-cell-sub">Soma contratual de todas as obras</span></td>
                <td style="text-align:right;font-weight:700;">${escapeHtml(formatCurrency(cashSummary.portfolioContracted))}</td>
                <td style="text-align:right;color:var(--erp-text-muted);">—</td>
              </tr>
              <tr>
                <td><strong>Saldo em Aberto nas Carteiras (Por Receber)</strong></td>
                <td><span class="erp-cell-sub">Prestações ainda por liquidar pelos clientes</span></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-warning);">${escapeHtml(formatCurrency(cashSummary.portfolioOpen))}</td>
                <td style="text-align:right;color:var(--erp-text-muted);">—</td>
              </tr>
              <tr>
                <td><strong>(+) Dinheiro Recebido das Carteiras Contratadas</strong></td>
                <td><span class="erp-cell-sub">Prestações marcadas como Pagas nas Obras</span></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-success);">+ ${escapeHtml(formatCurrency(cashSummary.portfolioReceived))}</td>
                <td style="text-align:right;font-weight:700;color:var(--erp-success);">+ ${escapeHtml(formatCurrency(inflowRows.reduce((s, r) => s + r.amount, 0)))}</td>
              </tr>
              <tr>
                <td><strong>(+) Saldo Inicial + Aportes Manuais</strong></td>
                <td><span class="erp-cell-sub">Saldo inicial configurado e reforços de caixa</span></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-success);">+ ${escapeHtml(formatCurrency(cashSummary.openingBalance + cashSummary.manualInflows))}</td>
                <td style="text-align:right;color:var(--erp-text-muted);">—</td>
              </tr>
              <tr>
                <td><strong>(-) Saídas de Faturas &amp; Materiais de Obras</strong></td>
                <td><span class="erp-cell-sub">Faturas lançadas nas obras (abate automático)</span></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(cashSummary.invoicesOutflow))}</td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(kpis.periodInvoices))}</td>
              </tr>
              <tr>
                <td><strong>(-) Pagamentos de Ordenados (Recibos Pagos)</strong></td>
                <td><span class="erp-cell-sub">Fechos mensais emitidos como Pago (abate automático)</span></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(cashSummary.salariesOutflow))}</td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(kpis.periodSalaries))}</td>
              </tr>
              <tr>
                <td><strong>(-) Adiantamentos / Vales Retirados (RH)</strong></td>
                <td><span class="erp-cell-sub">Vales adiantados aos colaboradores (abate automático)</span></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(cashSummary.advancesOutflow))}</td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(kpis.periodAdvances))}</td>
              </tr>
              <tr style="background:var(--erp-primary-soft);">
                <td colspan="2"><strong style="font-size:14px;">SALDO REAL ATUAL NO CAIXA DA EMPRESA</strong></td>
                <td style="text-align:right;font-size:16px;font-weight:900;color:${cashSummary.currentBalance >= 0 ? 'var(--erp-success)' : 'var(--erp-danger)'};">${escapeHtml(formatCurrency(cashSummary.currentBalance))}</td>
                <td style="text-align:right;font-weight:800;color:${kpis.periodNetResult >= 0 ? 'var(--erp-success)' : 'var(--erp-danger)'};">${escapeHtml(formatCurrency(kpis.periodNetResult))} (fluxo)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Lista com Scroll Interno (Ponta a Ponta) -->
      <section class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h3 class="erp-panel__title">Últimas Entradas &amp; Abates no Caixa (${cashRows.length})</h3>
            <p class="erp-panel__desc">Lista com scroll interno — recebimentos das carteiras, faturas, salários e adiantamentos.</p>
          </div>
        </div>
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Categoria</th>
                <th>Descrição</th>
                <th>Regime</th>
                <th style="text-align:right">Valor (€)</th>
              </tr>
            </thead>
            <tbody>
              ${
                cashRows.length === 0
                  ? `<tr><td colspan="5" style="text-align:center;color:var(--erp-text-muted);padding:28px;">Sem movimentos para os filtros selecionados.</td></tr>`
                  : cashRows
                      .map(
                        (m) => `
                    <tr>
                      <td style="white-space:nowrap;">${escapeHtml(formatDatePT(m.date))}</td>
                      <td><span class="erp-badge ${m.type === 'entrada' ? 'erp-badge--success' : 'erp-badge--danger'}">${escapeHtml(m.category)}</span></td>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(m.description)}</div>
                        ${m.notes ? `<div class="erp-cell-sub">${escapeHtml(m.notes)}</div>` : ''}
                      </td>
                      <td><span class="erp-badge erp-badge--neutral">${escapeHtml(m.taxModeLabel)}</span></td>
                      <td style="text-align:right;font-weight:800;white-space:nowrap;color:${m.type === 'entrada' ? 'var(--erp-success)' : 'var(--erp-danger)'};">
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
            <h3 class="erp-panel__title">Livro de Caixa Empresarial — Entradas &amp; Saídas (${cashRows.length})</h3>
            <p class="erp-panel__desc">Entradas das Carteiras Contratadas e abates automáticos de salários, vales e faturas.</p>
          </div>
        </div>
        ${
          cashRows.length === 0
            ? `<div class="erp-empty">${ICONS.euro}<div class="erp-empty__title">Nenhum movimento de caixa encontrado</div><p class="erp-empty__desc">Emita recibos pagos, adiantamentos, faturas ou marque prestações pagas nas Obras.</p></div>`
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
                           <td style="white-space:nowrap;">${escapeHtml(formatDatePT(m.date))}</td>
                           <td>
                             <span class="erp-badge ${badgeCls}">${escapeHtml(m.category)}</span>
                             <div class="erp-cell-sub" style="margin-top:3px;">${isManual ? 'Lançamento Manual' : 'Sincronização Automática'}</div>
                           </td>
                           <td>
                             <div class="erp-cell-title">${escapeHtml(m.description)}</div>
                             ${m.notes ? `<div class="erp-cell-sub">${escapeHtml(m.notes)}</div>` : ''}
                           </td>
                           <td><span class="erp-badge erp-badge--neutral">${escapeHtml(m.taxModeLabel)}</span></td>
                           <td style="text-align:right;font-weight:800;white-space:nowrap;color:${m.type === 'entrada' ? 'var(--erp-success)' : 'var(--erp-danger)'};">
                             ${m.type === 'entrada' ? '+' : '-'} ${escapeHtml(formatCurrency(m.amount))}
                           </td>
                           <td style="text-align:right;white-space:nowrap;">
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

  _renderDetailsTab(target, dataset, month) {
    const { rhRows, invoiceRows, inflowRows } = dataset;

    target.innerHTML = `
      <section class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h3 class="erp-panel__title">Colaboradores — Seg–Sex vs Sábados Pagos (${escapeHtml(formatMonthLabel(month))})</h3>
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
                            : '<span class="erp-cell-sub">0 sáb.</span>'
                        }
                      </td>
                      <td style="color:${r.saturdayReceiptTotal > 0 ? 'var(--erp-info)' : 'var(--erp-text-muted)'};font-weight:700;white-space:nowrap;">
                        ${r.saturdayReceiptTotal > 0 ? `+ ${escapeHtml(formatCurrency(r.saturdayReceiptTotal))}` : '€ 0,00'}
                      </td>
                      <td style="color:${r.saturdayOffTotal > 0 ? 'var(--erp-accent-dark)' : 'var(--erp-text-muted)'};font-weight:700;white-space:nowrap;">
                        ${r.saturdayOffTotal > 0 ? `+ ${escapeHtml(formatCurrency(r.saturdayOffTotal))}` : '€ 0,00'}
                      </td>
                      <td>
                        <div class="erp-cell-sub">Duod. +${escapeHtml(formatCurrency(r.twelfthsTotal))}</div>
                        <div class="erp-cell-sub" style="color:var(--erp-danger);">SS -${escapeHtml(formatCurrency(r.ssDeduction))}</div>
                      </td>
                      <td style="text-align:right;font-weight:800;white-space:nowrap;color:var(--erp-success);">${escapeHtml(formatCurrency(r.netToPay))}</td>
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
            <h3 class="erp-panel__title">Entradas no Caixa via Carteiras Contratadas (${inflowRows.length})</h3>
            <p class="erp-panel__desc">Prestações liquidadas pelos clientes das obras que alimentam diretamente o Caixa da Empresa.</p>
          </div>
        </div>
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Obra / Carteira</th>
                <th>Cliente</th>
                <th>Prestação / Método</th>
                <th style="text-align:right">Entrada (€)</th>
              </tr>
            </thead>
            <tbody>
              ${
                inflowRows.length === 0
                  ? `<tr><td colspan="5" style="text-align:center;color:var(--erp-text-muted);padding:24px;">Sem recebimentos neste filtro.</td></tr>`
                  : inflowRows
                      .map(
                        (inf) => `
                      <tr>
                        <td style="white-space:nowrap;">${escapeHtml(formatDatePT(inf.date))}</td>
                        <td><div class="erp-cell-title">${escapeHtml(inf.projectLabel)}</div></td>
                        <td>${escapeHtml(inf.clientName || '—')}</td>
                        <td>
                          <div class="erp-cell-title">${escapeHtml(inf.description)}</div>
                          <div class="erp-cell-sub">${escapeHtml(inf.method)}</div>
                        </td>
                        <td style="text-align:right;font-weight:800;white-space:nowrap;color:var(--erp-success);">+ ${escapeHtml(formatCurrency(inf.amount))}</td>
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
            <h3 class="erp-panel__title">Saídas de Faturas &amp; Materiais de Obras (${invoiceRows.length})</h3>
            <p class="erp-panel__desc">Todas as faturas de compras e subempreitadas abatidas do Caixa e do orçamento das obras.</p>
          </div>
        </div>
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>N.º Fatura</th>
                <th>Fornecedor</th>
                <th>Obra</th>
                <th>Categoria</th>
                <th style="text-align:right">Saída (€)</th>
              </tr>
            </thead>
            <tbody>
              ${
                invoiceRows.length === 0
                  ? `<tr><td colspan="6" style="text-align:center;color:var(--erp-text-muted);padding:24px;">Sem faturas neste filtro.</td></tr>`
                  : invoiceRows
                      .map(
                        (inv) => `
                      <tr>
                        <td style="white-space:nowrap;">${escapeHtml(formatDatePT(inv.invoiceDate))}</td>
                        <td><strong>#${escapeHtml(inv.invoiceNumber)}</strong></td>
                        <td>${escapeHtml(inv.supplier)}</td>
                        <td><div class="erp-cell-title">${escapeHtml(inv.projectLabel)}</div></td>
                        <td><span class="erp-badge erp-badge--neutral">${escapeHtml(inv.category)}</span></td>
                        <td style="text-align:right;font-weight:800;white-space:nowrap;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(inv.amount))}</td>
                      </tr>`
                      )
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  _openCashOpeningModal(cashSummary) {
    openModal({
      title: 'Definir Saldo Inicial do Caixa da Empresa',
      subtitle: 'Base de tesouraria guardada no Supabase para somar com as Carteiras Contratadas',
      bodyHtml: `
        <form id="cashOpeningForm">
          <div class="erp-form-grid">
            <div class="erp-field erp-field--full">
              <label for="cashOpenAmt">Saldo Inicial / Base em Caixa (€) *</label>
              <input type="text" inputmode="numeric" data-currency-euro id="cashOpenAmt" value="${escapeHtml(cashSummary.openingBalance || 0)}" required>
              <span class="erp-field__hint">Este valor soma aos recebimentos das Carteiras Contratadas e abate salários, vales e faturas.</span>
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
                <option value="entrada">Entrada (+) — Aporte / Reforço</option>
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
