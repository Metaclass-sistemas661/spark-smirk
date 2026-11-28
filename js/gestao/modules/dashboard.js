/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Executive Dashboard & Custom SVG Charts
   Dados 100% dinâmicos ligados ao Store (RH + Operacional)
   ═══════════════════════════════════════════════════════════ */

import { store } from '../core/store.js';
import {
  computeCompanyCashSummary,
  computeProjectFinancials,
  computeProjectInvoiceSummary,
  escapeHtml,
  formatCurrency,
  formatDatePT,
  formatMonthLabel,
  getDaysInMonth,
  getWeekdayShortPT,
  isValuesMasked,
  todayISO,
} from '../core/formatters.js';
import { ICONS, showToast } from '../core/ui.js';

export class DashboardModule {
  constructor(options = {}) {
    this.projectFilter = 'all'; // 'all' | 'em_andamento' | 'a_iniciar' | 'concluida'
    this.donutMode = 'status'; // 'status' | 'categories'
    this.rankPeriod = 'month'; // 'month' | 'all'
    this.rankSort = 'profit'; // 'profit' | 'share' | 'margin'
    this.rankStatus = 'all'; // 'all' | 'em_andamento' | 'concluida'
    this.onNavigate = options.onNavigate || null;
    this.onQuickAction = options.onQuickAction || null;
  }

  _computeEmployeeMonth(emp, attMap, month) {
    const recMap = attMap[emp.id] || {};
    const days = getDaysInMonth(month);
    let p = 0;
    let fj = 0;
    let fi = 0;
    let fe = 0;
    let workdays = 0;
    for (let d = 1; d <= days; d += 1) {
      const wd = getWeekdayShortPT(month, d);
      if (wd !== 0 && wd !== 6) workdays += 1;
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      const r = recMap[iso];
      if (!r) continue;
      if (r.status === 'P') p += 1;
      else if (r.status === 'FJ') fj += 1;
      else if (r.status === 'FI') fi += 1;
      else if (r.status === 'FE') fe += 1;
    }
    const totalTracked = p + fj + fi;
    const rate = totalTracked > 0 ? Math.round((p / totalTracked) * 100) : 100;
    return { p, fj, fi, fe, workdays, rate };
  }

  render(container, ctx) {
    const state = store.getState();
    const { month } = ctx;
    const can = ctx.can || (() => true);
    const canSeeDashValues = can('dashboard', 'valores');
    const canCreateProj = can('op_obras', 'criar');
    const canCreateEmp = can('rh_funcionarios', 'criar');
    const canViewRh = can('rh_funcionarios', 'ver');
    const canViewObras = can('op_obras', 'ver');
    const today = todayISO();

    // Global Financials across all projects
    let totalContracted = 0;
    let totalPaid = 0;
    let totalOpen = 0;
    let totalInvoicedCosts = 0;
    let totalBudgetPool = 0;
    const openInstallments = [];

    const projectStats = state.projects.map((proj) => {
      const fin = computeProjectFinancials(proj);
      const invSum = computeProjectInvoiceSummary(proj, state.projectInvoices);
      if (canSeeDashValues) {
        totalContracted += fin.contractTotal;
        totalPaid += fin.paidAmount;
        totalOpen += fin.balanceOpen;
        totalInvoicedCosts += invSum.spentOnInvoices;
        totalBudgetPool += invSum.budgetTotal;

        (proj.payments || []).forEach((pay) => {
          if (pay.status !== 'pago') {
            openInstallments.push({
              projectId: proj.id,
              projectCode: proj.code,
              projectName: proj.name,
              clientName: proj.clientName,
              paymentId: pay.id,
              description: pay.description,
              dueDate: pay.dueDate,
              amount: Number(pay.amount) || 0,
              overdue: Boolean(pay.dueDate && pay.dueDate < today),
            });
          }
        });
      }

      return { proj, fin, invSum };
    });

    const totalBudgetRemaining = totalBudgetPool - totalInvoicedCosts;
    const totalInvoicesCount = (state.projectInvoices || []).length;
    const ongoingCount = state.projects.filter((p) => p.status === 'em_andamento').length;
    const plannedCount = state.projects.filter((p) => p.status === 'a_iniciar').length;
    const completedCount = state.projects.filter((p) => p.status === 'concluida').length;
    const avgProgress = state.projects.length
      ? Math.round(state.projects.reduce((s, p) => s + (Number(p.progress) || 0), 0) / state.projects.length)
      : 0;

    openInstallments.sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
    const overdueInstallments = openInstallments.filter((i) => i.overdue);
    const overallPaidPct = totalContracted > 0 ? Math.round((totalPaid / totalContracted) * 100) : 0;

    // Global HR metrics for selected month
    const activeEmployees = state.employees.filter((e) => e.status === 'ativo');
    let totalP = 0;
    let totalAbs = 0;
    const empAttendance = activeEmployees.map((emp) => {
      const stats = this._computeEmployeeMonth(emp, state.attendance, month);
      totalP += stats.p;
      totalAbs += stats.fj + stats.fi;
      return { emp, stats };
    });
    const attRateGlobal = totalP + totalAbs > 0 ? Math.round((totalP / (totalP + totalAbs)) * 100) : 100;

    const cashSummary = canSeeDashValues ? computeCompanyCashSummary(state) : null;

    // Filtered projects for Bar Chart
    const chartProjects = projectStats.filter(
      ({ proj }) => this.projectFilter === 'all' || proj.status === this.projectFilter
    );

    if (!canSeeDashValues && this.donutMode === 'categories') {
      this.donutMode = 'status';
    }

    container.innerHTML = `
      <div class="erp-dash-banner">
        <div>
          <div class="erp-dash-banner__title">Centro de Comando Executivo — Spark &amp; Smirk, Lda.</div>
          <div class="erp-dash-banner__sub">
            ${
              canSeeDashValues
                ? `Controlo consolidado de Engenharia, Obras, Orçamentos, Tesouraria e Recursos Humanos (${escapeHtml(formatMonthLabel(month))}).`
                : `Controlo operacional de Obras, Equipa e Assiduidade (${escapeHtml(formatMonthLabel(month))}).`
            }
          </div>
        </div>
        <div class="erp-dash-banner__actions">
          ${
            canCreateProj
              ? `<button type="button" class="erp-btn erp-btn--primary" data-dash-quick="new-project">
                  ${ICONS.plus}<span>Nova Obra</span>
                </button>`
              : ''
          }
          ${
            canCreateEmp
              ? `<button type="button" class="erp-btn erp-btn--outline" style="background:rgba(255,255,255,0.1);color:#fff;border-color:rgba(255,255,255,0.22);" data-dash-quick="new-employee">
                  ${ICONS.users}<span>Novo Funcionário</span>
                </button>`
              : ''
          }
        </div>
      </div>

      <!-- KPIs -->
      <div class="erp-kpi-grid">
        ${
          canSeeDashValues
            ? `
            <div class="erp-kpi-card erp-kpi-card--primary">
              <div class="erp-kpi-card__head">
                <span class="erp-kpi-card__label">Carteira Contratada c/ IVA</span>
                <span class="erp-kpi-card__icon">${ICONS.building}</span>
              </div>
              <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalContracted))}</div>
              <div class="erp-kpi-card__meta">Já entrou em Caixa: ${escapeHtml(formatCurrency(cashSummary.portfolioReceived))} (${overallPaidPct}% liquidado)</div>
            </div>

            <div class="erp-kpi-card ${overdueInstallments.length > 0 ? 'erp-kpi-card--danger' : 'erp-kpi-card--warning'}">
              <div class="erp-kpi-card__head">
                <span class="erp-kpi-card__label">A Receber das Carteiras</span>
                <span class="erp-kpi-card__icon">${ICONS.clock}</span>
              </div>
              <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalOpen))}</div>
              <div class="erp-kpi-card__meta">
                ${
                  overdueInstallments.length > 0
                    ? `${overdueInstallments.length} parcela(s) em atraso · ${openInstallments.length} em aberto`
                    : `${openInstallments.length} parcela(s) por receber`
                }
              </div>
            </div>

            <div class="erp-kpi-card" style="cursor:pointer;" data-dash-nav="relatorios-avancados" title="Abrir Relatórios Avançados &amp; Caixa da Empresa">
              <div class="erp-kpi-card__head">
                <span class="erp-kpi-card__label">Caixa Real da Empresa</span>
                <span class="erp-kpi-card__icon">${ICONS.euro}</span>
              </div>
              <div class="erp-kpi-card__value" style="color:${cashSummary.currentBalance < 0 ? 'var(--erp-danger)' : 'var(--erp-success)'};">${escapeHtml(formatCurrency(cashSummary.currentBalance))}</div>
              <div class="erp-kpi-card__meta">${totalInvoicesCount} fatura(s) -${escapeHtml(formatCurrency(cashSummary.invoicesOutflow))} · RH -${escapeHtml(formatCurrency(cashSummary.salariesOutflow + cashSummary.advancesOutflow))}</div>
            </div>

            <div class="erp-kpi-card erp-kpi-card--success">
              <div class="erp-kpi-card__head">
                <span class="erp-kpi-card__label">Assiduidade (${escapeHtml(month)})</span>
                <span class="erp-kpi-card__icon">${ICONS.checkCircle}</span>
              </div>
              <div class="erp-kpi-card__value">${attRateGlobal}%</div>
              <div class="erp-kpi-card__meta">${totalP} presenças · ${totalAbs} faltas · Saldo Obras ${escapeHtml(formatCurrency(totalBudgetRemaining))}</div>
            </div>
          `
            : `
            <div class="erp-kpi-card erp-kpi-card--primary">
              <div class="erp-kpi-card__head">
                <span class="erp-kpi-card__label">Obras no Sistema</span>
                <span class="erp-kpi-card__icon">${ICONS.building}</span>
              </div>
              <div class="erp-kpi-card__value">${state.projects.length}</div>
              <div class="erp-kpi-card__meta">${ongoingCount} em andamento · ${plannedCount} a iniciar</div>
            </div>

            <div class="erp-kpi-card">
              <div class="erp-kpi-card__head">
                <span class="erp-kpi-card__label">Equipa Ativa</span>
                <span class="erp-kpi-card__icon">${ICONS.users}</span>
              </div>
              <div class="erp-kpi-card__value">${activeEmployees.length} <span style="font-size:13px;font-weight:600;color:var(--erp-text-muted)">/ ${state.employees.length}</span></div>
              <div class="erp-kpi-card__meta">Colaboradores registados em RH</div>
            </div>

            <div class="erp-kpi-card erp-kpi-card--success">
              <div class="erp-kpi-card__head">
                <span class="erp-kpi-card__label">Assiduidade (${escapeHtml(month)})</span>
                <span class="erp-kpi-card__icon">${ICONS.checkCircle}</span>
              </div>
              <div class="erp-kpi-card__value">${attRateGlobal}%</div>
              <div class="erp-kpi-card__meta">${totalP} presenças · ${totalAbs} faltas (${activeEmployees.length} ativos)</div>
            </div>

            <div class="erp-kpi-card">
              <div class="erp-kpi-card__head">
                <span class="erp-kpi-card__label">Execução Média das Obras</span>
                <span class="erp-kpi-card__icon">${ICONS.chart}</span>
              </div>
              <div class="erp-kpi-card__value">${avgProgress}%</div>
              <div class="erp-kpi-card__meta">${completedCount} concluída(s) · ${(state.technicalManagers || []).length} resp. técnico(s)</div>
            </div>
          `
        }
      </div>

      <!-- Row 2: Custom Bar Chart / Operational Progress + Donut Chart -->
      <div class="erp-dash-grid">
        <section class="erp-chart-card">
          <div class="erp-chart-card__head">
            <div>
              <h2 class="erp-chart-card__title">${canSeeDashValues ? 'Desempenho Financeiro por Obra' : 'Progresso Físico por Obra'}</h2>
              <p class="erp-chart-card__sub">${
                canSeeDashValues
                  ? 'Comparativo entre Orçamentado c/ IVA, Valor Recebido e Saldo em Aberto (clique na barra para abrir a obra)'
                  : 'Estado de execução física das empreitadas (valores financeiros ocultos para este perfil)'
              }</p>
            </div>
            <div class="erp-pill-switch">
              <button type="button" class="${this.projectFilter === 'all' ? 'is-active' : ''}" data-chart-pfilter="all">Todas</button>
              <button type="button" class="${this.projectFilter === 'em_andamento' ? 'is-active' : ''}" data-chart-pfilter="em_andamento">Andamento</button>
              <button type="button" class="${this.projectFilter === 'a_iniciar' ? 'is-active' : ''}" data-chart-pfilter="a_iniciar">A Iniciar</button>
              <button type="button" class="${this.projectFilter === 'concluida' ? 'is-active' : ''}" data-chart-pfilter="concluida">Concluídas</button>
            </div>
          </div>
          <div class="erp-chart-card__body">
            ${
              canSeeDashValues
                ? this._renderFinancialBarChartSVG(chartProjects)
                : this._renderOperationalProgressBars(chartProjects)
            }
          </div>
        </section>

        <section class="erp-chart-card">
          <div class="erp-chart-card__head">
            <div>
              <h2 class="erp-chart-card__title">Distribuição Estratégica</h2>
              <p class="erp-chart-card__sub">${canSeeDashValues ? 'Análise por estado das obras ou estrutura de custos' : 'Distribuição por estado das empreitadas'}</p>
            </div>
            <div class="erp-pill-switch">
              <button type="button" class="${this.donutMode === 'status' ? 'is-active' : ''}" data-donut-mode="status">Estados</button>
              ${
                canSeeDashValues
                  ? `<button type="button" class="${this.donutMode === 'categories' ? 'is-active' : ''}" data-donut-mode="categories">Orçamentos</button>`
                  : ''
              }
            </div>
          </div>
          <div class="erp-chart-card__body">
            ${this._renderDonutWidget(projectStats, canSeeDashValues)}
          </div>
        </section>
      </div>

      <!-- Row 2.5: Interactive Project Profit Ranking & Portfolio Share -->
      ${canSeeDashValues ? this._renderProfitRankingPanel(projectStats, state, month, totalContracted) : ''}

      <!-- Row 3: HR Attendance Bars + Payment Deadlines / Operational Schedule Feed -->
      <div class="erp-dash-grid erp-dash-grid--equal">
        <section class="erp-chart-card">
          <div class="erp-chart-card__head">
            <div>
              <h2 class="erp-chart-card__title">Assiduidade da Equipa — ${escapeHtml(formatMonthLabel(month))}</h2>
              <p class="erp-chart-card__sub">Distribuição proporcional de dias trabalhados, faltas e férias</p>
            </div>
            ${canViewRh ? '<button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-dash-nav="rh-funcionarios">Ver RH Completo</button>' : ''}
          </div>
          <div class="erp-chart-card__body">
            ${this._renderAttendanceBars(empAttendance)}
          </div>
        </section>

        <section class="erp-chart-card">
          <div class="erp-chart-card__head">
            <div>
              <h2 class="erp-chart-card__title">${canSeeDashValues ? 'Próximos Pagamentos &amp; Parcelas em Aberto' : 'Cronograma &amp; Prazos das Obras'}</h2>
              <p class="erp-chart-card__sub">${canSeeDashValues ? 'Vencimentos financeiros de obras ordenados por prioridade' : 'Datas previstas de conclusão das empreitadas ativas'}</p>
            </div>
            ${canViewObras ? '<button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-dash-nav="op-andamento">Ir para Operacional</button>' : ''}
          </div>
          <div class="erp-chart-card__body">
            ${
              canSeeDashValues
                ? this._renderPaymentsFeed(openInstallments)
                : this._renderOperationalDeadlinesFeed(state.projects)
            }
          </div>
        </section>
      </div>

      <div class="erp-chart-tooltip" id="erpChartTooltip"></div>
    `;

    this._bindEvents(container, state);
  }

  _renderProfitRankingPanel(projectStats, state, month, totalContracted) {
    const manualCashMovs = (state.cashMovements || []).filter((m) => m.originType === 'manual');
    const rankingRows = projectStats
      .filter(({ proj }) => this.rankStatus === 'all' || proj.status === this.rankStatus)
      .map(({ proj, fin }) => {
        const projRefs = new Set([proj.id, proj.code].filter(Boolean));
        let inflows = 0;
        let inflowCount = 0;

        (proj.payments || []).forEach((pay) => {
          if (pay.status !== 'pago') return;
          const dt = String(pay.paidDate || pay.dueDate || '');
          if (this.rankPeriod === 'month' && dt.slice(0, 7) !== month) return;
          inflows += Number(pay.amount) || 0;
          inflowCount += 1;
        });

        let outflows = 0;
        let invoiceCount = 0;
        (state.projectInvoices || []).forEach((inv) => {
          if (!projRefs.has(inv.projectId)) return;
          const dt = String(inv.invoiceDate || inv.createdAt || '');
          if (this.rankPeriod === 'month' && dt.slice(0, 7) !== month) return;
          outflows += Math.max(0, Number(inv.amount) || 0);
          invoiceCount += 1;
        });

        manualCashMovs.forEach((m) => {
          if (!projRefs.has(m.projectId)) return;
          const dt = String(m.date || '');
          if (this.rankPeriod === 'month' && (m.month || dt.slice(0, 7)) !== month) return;
          const amt = Math.max(0, Number(m.amount) || 0);
          if (m.type === 'entrada') {
            inflows += amt;
            inflowCount += 1;
          } else {
            outflows += amt;
          }
        });

        const netProfit = Number((inflows - outflows).toFixed(2));
        const marginPct = inflows > 0 ? (netProfit / inflows) * 100 : outflows > 0 ? -100 : 0;
        const portfolioSharePct = totalContracted > 0 ? (fin.contractTotal / totalContracted) * 100 : 0;

        return {
          proj,
          fin,
          inflows: Number(inflows.toFixed(2)),
          inflowCount,
          outflows: Number(outflows.toFixed(2)),
          invoiceCount,
          netProfit,
          marginPct,
          portfolioSharePct,
        };
      });

    rankingRows.sort((a, b) => {
      if (this.rankSort === 'share') return b.portfolioSharePct - a.portfolioSharePct || b.netProfit - a.netProfit;
      if (this.rankSort === 'margin') return b.marginPct - a.marginPct || b.netProfit - a.netProfit;
      return b.netProfit - a.netProfit || b.portfolioSharePct - a.portfolioSharePct;
    });

    const totalPeriodInflows = rankingRows.reduce((s, r) => s + r.inflows, 0);
    const totalPeriodOutflows = rankingRows.reduce((s, r) => s + r.outflows, 0);
    const totalPeriodProfit = totalPeriodInflows - totalPeriodOutflows;
    const leader = rankingRows[0] || null;
    const periodTag = this.rankPeriod === 'month' ? formatMonthLabel(month) : 'Acumulado Total';

    return `
      <section class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h2 class="erp-panel__title">Ranking de Lucro por Obra &amp; Peso na Carteira</h2>
            <p class="erp-panel__desc">Apuramento interativo (${escapeHtml(periodTag)}): Entradas recebidas da obra menos saídas de faturas/despesas, e representatividade na Carteira Contratada.</p>
          </div>
          <div class="erp-rank-controls">
            <div class="erp-pill-switch">
              <button type="button" class="${this.rankPeriod === 'month' ? 'is-active' : ''}" data-rank-period="month">Mensal (${escapeHtml(month)})</button>
              <button type="button" class="${this.rankPeriod === 'all' ? 'is-active' : ''}" data-rank-period="all">Acumulado</button>
            </div>
            <div class="erp-pill-switch">
              <button type="button" class="${this.rankSort === 'profit' ? 'is-active' : ''}" data-rank-sort="profit">Maior Lucro</button>
              <button type="button" class="${this.rankSort === 'share' ? 'is-active' : ''}" data-rank-sort="share">% Carteira</button>
              <button type="button" class="${this.rankSort === 'margin' ? 'is-active' : ''}" data-rank-sort="margin">Margem %</button>
            </div>
            <select class="erp-select-sm" id="dashRankStatusFilter" aria-label="Filtrar obras por estado">
              <option value="all" ${this.rankStatus === 'all' ? 'selected' : ''}>Todas as Obras</option>
              <option value="em_andamento" ${this.rankStatus === 'em_andamento' ? 'selected' : ''}>Em Andamento</option>
              <option value="concluida" ${this.rankStatus === 'concluida' ? 'selected' : ''}>Concluídas</option>
            </select>
          </div>
        </div>

        <div class="erp-rank-strip">
          <div class="erp-rank-strip__item">
            <span class="erp-cell-sub">Lucro Líquido (${escapeHtml(periodTag)}):</span>
            <strong style="color:${totalPeriodProfit >= 0 ? 'var(--erp-success)' : 'var(--erp-danger)'};font-size:14px;">
              ${totalPeriodProfit >= 0 ? '+' : ''}${escapeHtml(formatCurrency(totalPeriodProfit))}
            </strong>
          </div>
          <div class="erp-rank-strip__item">
            <span class="erp-cell-sub">Entradas:</span>
            <strong style="color:var(--erp-success);">+${escapeHtml(formatCurrency(totalPeriodInflows))}</strong>
            <span class="erp-cell-sub">· Saídas:</span>
            <strong style="color:var(--erp-danger);">-${escapeHtml(formatCurrency(totalPeriodOutflows))}</strong>
          </div>
          ${
            leader
              ? `<div class="erp-rank-strip__item">
                   <span class="erp-badge erp-badge--warning">1.º Lugar: ${escapeHtml(leader.proj.code)}</span>
                   <strong>${escapeHtml(formatCurrency(leader.netProfit))}</strong>
                   <span class="erp-cell-sub">(${leader.portfolioSharePct.toFixed(1).replace('.', ',')}% da carteira)</span>
                 </div>`
              : ''
          }
        </div>

        ${
          rankingRows.length === 0
            ? `<div class="erp-empty">${ICONS.building}<div class="erp-empty__title">Sem obras neste filtro</div></div>`
            : `
          <div class="erp-table-wrap">
            <table class="erp-table">
              <thead>
                <tr>
                  <th style="width:60px;">Pos.</th>
                  <th>Obra &amp; Cliente</th>
                  <th>Peso na Carteira da Empresa</th>
                  <th style="text-align:right">Entradas (${escapeHtml(this.rankPeriod === 'month' ? month : 'Total')})</th>
                  <th style="text-align:right">Saídas (Faturas/Desp.)</th>
                  <th style="text-align:right">Lucro Gerado</th>
                  <th style="text-align:right">Abrir</th>
                </tr>
              </thead>
              <tbody>
                ${rankingRows
                  .map((r, idx) => {
                    const pos = idx + 1;
                    const rankCls = pos <= 3 ? `erp-rank-badge--${pos}` : '';
                    const shareStr = `${r.portfolioSharePct.toFixed(1).replace('.', ',')}%`;
                    const barW = Math.min(100, Math.max(0, r.portfolioSharePct));
                    const marginStr = `${r.marginPct >= 0 ? '+' : ''}${Math.round(r.marginPct)}%`;
                    const statusLabel =
                      r.proj.status === 'concluida'
                        ? 'Concluída'
                        : r.proj.status === 'a_iniciar'
                          ? 'A Iniciar'
                          : 'Em Andamento';
                    return `
                    <tr class="erp-rank-row" data-dash-open-proj="${escapeHtml(r.proj.id)}" data-dash-proj-status="${escapeHtml(r.proj.status)}" title="Clique para abrir detalhes financeiros da obra ${escapeHtml(r.proj.code)}">
                      <td><span class="erp-rank-badge ${rankCls}">${pos}.º</span></td>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(r.proj.code)} — ${escapeHtml(r.proj.name)}</div>
                        <div class="erp-cell-sub">${escapeHtml(r.proj.clientName || 'Cliente')} · ${escapeHtml(statusLabel)}</div>
                      </td>
                      <td>
                        <div class="erp-share-meter">
                          <div class="erp-share-meter__track">
                            <div class="erp-share-meter__fill" style="width:${barW}%"></div>
                          </div>
                          <strong style="color:var(--erp-primary);white-space:nowrap;">${shareStr}</strong>
                        </div>
                        <div class="erp-cell-sub">${escapeHtml(formatCurrency(r.fin.contractTotal))} contratado</div>
                      </td>
                      <td style="text-align:right;font-weight:700;white-space:nowrap;color:${r.inflows > 0 ? 'var(--erp-success)' : 'var(--erp-text-muted)'};">
                        ${r.inflows > 0 ? `+ ${escapeHtml(formatCurrency(r.inflows))}` : '€ 0,00'}
                        <div class="erp-cell-sub">${r.inflowCount} receb.</div>
                      </td>
                      <td style="text-align:right;font-weight:700;white-space:nowrap;color:${r.outflows > 0 ? 'var(--erp-danger)' : 'var(--erp-text-muted)'};">
                        ${r.outflows > 0 ? `- ${escapeHtml(formatCurrency(r.outflows))}` : '€ 0,00'}
                        <div class="erp-cell-sub">${r.invoiceCount} fat.</div>
                      </td>
                      <td style="text-align:right;white-space:nowrap;">
                        <div class="erp-cell-title" style="font-size:14.5px;color:${r.netProfit > 0 ? 'var(--erp-success)' : r.netProfit < 0 ? 'var(--erp-danger)' : 'var(--erp-text-muted)'};">
                          ${r.netProfit > 0 ? '+' : ''}${escapeHtml(formatCurrency(r.netProfit))}
                        </div>
                        <span class="erp-badge ${r.netProfit > 0 ? 'erp-badge--success' : r.netProfit < 0 ? 'erp-badge--danger' : 'erp-badge--neutral'}" style="margin-top:3px;padding:2px 7px;font-size:10.5px;">
                          Margem ${marginStr}
                        </span>
                      </td>
                      <td style="text-align:right;">
                        <button type="button" class="erp-btn erp-btn--outline erp-btn--sm">Ver Obra</button>
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
  }

  _renderOperationalProgressBars(items) {
    if (items.length === 0) {
      return `<div class="erp-empty">${ICONS.building}<div class="erp-empty__title">Sem obras neste filtro</div></div>`;
    }
    return `
      <div class="erp-att-bar-list">
        ${items
          .map(({ proj }) => {
            const pct = Math.min(100, Math.max(0, Number(proj.progress) || 0));
            return `
            <div class="erp-att-bar-item" data-dash-open-proj="${escapeHtml(proj.id)}" data-dash-proj-status="${escapeHtml(proj.status)}">
              <div class="erp-att-bar-item__top">
                <span class="erp-att-bar-item__name">${escapeHtml(proj.code)} — ${escapeHtml(proj.name)} <span style="font-weight:400;color:var(--erp-text-muted)">· ${escapeHtml(proj.district || '')}</span></span>
                <span class="erp-att-bar-item__meta"><strong style="color:var(--erp-heading)">${pct}%</strong> concluído</span>
              </div>
              <div class="erp-progress">
                <div class="erp-progress__track" style="height:10px;"><div class="erp-progress__fill" style="width:${pct}%"></div></div>
              </div>
            </div>`;
          })
          .join('')}
      </div>
    `;
  }

  _renderOperationalDeadlinesFeed(projects) {
    const active = projects
      .filter((p) => p.status !== 'concluida')
      .slice()
      .sort((a, b) => String(a.expectedEndDate || '9999').localeCompare(String(b.expectedEndDate || '9999')));
    if (active.length === 0) {
      return `<div class="erp-empty">${ICONS.checkCircle}<div class="erp-empty__title">Sem prazos pendentes</div><p>Todas as empreitadas registadas estão concluídas.</p></div>`;
    }
    return `
      <div class="erp-pay-feed">
        ${active
          .slice(0, 5)
          .map(
            (p) => `
          <div class="erp-pay-feed__item">
            <div class="erp-pay-feed__left">
              <div class="erp-pay-feed__title">${escapeHtml(p.code)} · ${escapeHtml(p.name)}</div>
              <div class="erp-pay-feed__sub">${escapeHtml(p.clientName)} · Conclusão prevista: ${escapeHtml(formatDatePT(p.expectedEndDate))}</div>
            </div>
            <div class="erp-pay-feed__right">
              <span class="erp-badge ${p.status === 'em_andamento' ? 'erp-badge--info' : 'erp-badge--warning'}">${Number(p.progress) || 0}%</span>
            </div>
          </div>`
          )
          .join('')}
      </div>
    `;
  }

  _renderFinancialBarChartSVG(items) {
    if (items.length === 0) {
      return `<div class="erp-empty">${ICONS.building}<div class="erp-empty__title">Sem obras neste filtro</div></div>`;
    }

    const svgW = Math.max(540, items.length * 124);
    const svgH = 250;
    const padL = 62;
    const padR = 16;
    const padT = 18;
    const padB = 46;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;

    const maxVal = Math.max(
      1000,
      ...items.map(({ fin }) => Math.max(fin.contractTotal, fin.paidAmount + fin.balanceOpen))
    );
    const niceMax = Math.ceil(maxVal / 10000) * 10000 || 10000;

    let gridHtml = '';
    for (let i = 0; i <= 4; i += 1) {
      const ratio = i / 4;
      const y = padT + plotH - ratio * plotH;
      const labelVal = Math.round((niceMax * ratio) / 1000);
      const axisText = isValuesMasked() ? '•• €' : `${labelVal}k €`;
      gridHtml += `
        <line x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}" stroke="var(--erp-border)" stroke-dasharray="${i === 0 ? 'none' : '4 4'}" />
        <text x="${padL - 10}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="var(--erp-text-muted)" font-weight="600">${axisText}</text>
      `;
    }

    const groupW = plotW / items.length;
    const barW = Math.min(26, Math.max(14, groupW * 0.24));

    let barsHtml = '';
    items.forEach(({ proj, fin, invSum }, idx) => {
      const cx = padL + idx * groupW + groupW / 2;
      const hTotal = Math.max(4, (fin.contractTotal / niceMax) * plotH);
      const hPaid = fin.paidAmount > 0 ? Math.max(3, (fin.paidAmount / niceMax) * plotH) : 0;
      const hOpen = fin.balanceOpen > 0 ? Math.max(3, (fin.balanceOpen / niceMax) * plotH) : 0;

      const x1 = cx - barW * 1.15;
      const x2 = cx + barW * 0.15;
      const yTotal = padT + plotH - hTotal;
      const yPaid = padT + plotH - hPaid;
      const yOpen = padT + plotH - hPaid - hOpen;

      const tipTitle = escapeHtml(`${proj.code} — ${proj.name}`);
      const tipContract = escapeHtml(formatCurrency(invSum?.budgetTotal ?? fin.contractTotal));
      const tipPaid = escapeHtml(formatCurrency(fin.paidAmount));
      const tipOpen = escapeHtml(formatCurrency(fin.balanceOpen));
      const tipSpentInv = escapeHtml(formatCurrency(invSum?.spentOnInvoices ?? 0));
      const tipRemInv = escapeHtml(formatCurrency(invSum?.remainingBudget ?? fin.contractTotal));
      const tipNext = escapeHtml(fin.nextDueDate ? formatDatePT(fin.nextDueDate) : 'Liquidada');

      barsHtml += `
        <g class="erp-bar-group"
           data-bar-proj="${escapeHtml(proj.id)}"
           data-bar-status="${escapeHtml(proj.status)}"
           data-tip-title="${tipTitle}"
           data-tip-contract="${tipContract}"
           data-tip-paid="${tipPaid}"
           data-tip-open="${tipOpen}"
           data-tip-spent="${tipSpentInv}"
           data-tip-rem="${tipRemInv}"
           data-tip-next="${tipNext}">
          <rect class="erp-bar-rect" x="${x1}" y="${yTotal}" width="${barW}" height="${hTotal}" rx="4" fill="url(#gradNavy)" />
          ${hPaid > 0 ? `<rect class="erp-bar-rect" x="${x2}" y="${yPaid}" width="${barW}" height="${hPaid}" rx="4" fill="url(#gradGreen)" />` : ''}
          ${hOpen > 0 ? `<rect class="erp-bar-rect" x="${x2}" y="${yOpen}" width="${barW}" height="${hOpen}" rx="4" fill="url(#gradOrange)" />` : ''}
          <text x="${cx}" y="${svgH - 22}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--erp-heading)">${escapeHtml(proj.code)}</text>
          <text x="${cx}" y="${svgH - 8}" text-anchor="middle" font-size="10" fill="var(--erp-text-muted)">${escapeHtml(proj.district)}</text>
        </g>
      `;
    });

    return `
      <div class="erp-svg-wrap">
        <svg class="erp-svg-chart" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="Gráfico financeiro por obra">
          <defs>
            <linearGradient id="gradNavy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style="stop-color:var(--erp-bar-primary-top)" />
              <stop offset="100%" style="stop-color:var(--erp-bar-primary-bot)" />
            </linearGradient>
            <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#10b981" />
              <stop offset="100%" stop-color="#059669" />
            </linearGradient>
            <linearGradient id="gradOrange" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#ff8534" />
              <stop offset="100%" stop-color="#e8650a" />
            </linearGradient>
          </defs>
          ${gridHtml}
          ${barsHtml}
        </svg>
      </div>
      <div class="erp-chart-legend">
        <span class="erp-chart-legend__item"><span class="erp-chart-legend__dot" style="background:var(--erp-bar-primary-bot);"></span>Orçamentado c/ IVA</span>
        <span class="erp-chart-legend__item"><span class="erp-chart-legend__dot" style="background:#059669;"></span>Valor Recebido</span>
        <span class="erp-chart-legend__item"><span class="erp-chart-legend__dot" style="background:#e8650a;"></span>Saldo em Aberto</span>
      </div>
    `;
  }

  _renderDonutWidget(projectStats, canSeeDashValues = true) {
    let slices = [];
    let centerVal = '';
    let centerLbl = '';

    if (this.donutMode === 'status') {
      const groups = [
        { key: 'em_andamento', label: 'Em Andamento', color: '#2563eb', route: 'op-andamento', count: 0, amount: 0 },
        { key: 'a_iniciar', label: 'A Iniciar', color: '#e8650a', route: 'op-iniciar', count: 0, amount: 0 },
        { key: 'concluida', label: 'Concluídas', color: '#059669', route: 'op-concluidas', count: 0, amount: 0 },
      ];
      projectStats.forEach(({ proj, fin }) => {
        const g = groups.find((x) => x.key === proj.status);
        if (g) {
          g.count += 1;
          g.amount += canSeeDashValues ? fin.contractTotal : 0;
        }
      });
      slices = groups.map((g) => ({
        label: g.label,
        color: g.color,
        value: canSeeDashValues ? g.amount : g.count,
        display: canSeeDashValues ? `${g.count} · ${formatCurrency(g.amount)}` : `${g.count} obra(s)`,
        route: g.route,
      }));
      centerVal = String(projectStats.length);
      centerLbl = 'Obras Totais';
    } else {
      const catTotals = {
        'Materiais': { color: '#0c1829', val: 0 },
        'Mão de Obra': { color: '#e8650a', val: 0 },
        'Equipamentos': { color: '#d4a03c', val: 0 },
        'Subempreitada': { color: '#2563eb', val: 0 },
      };
      projectStats.forEach(({ proj }) => {
        (proj.budget?.items || []).forEach((it) => {
          const lineVal = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
          if (!catTotals[it.category]) {
            catTotals[it.category] = { color: '#6b7280', val: 0 };
          }
          catTotals[it.category].val += lineVal;
        });
      });
      const grand = Object.values(catTotals).reduce((s, c) => s + c.val, 0);
      slices = Object.entries(catTotals).map(([name, info]) => ({
        label: name,
        color: info.color,
        value: info.val,
        display: formatCurrency(info.val),
        route: 'op-andamento',
      }));
      centerVal = formatCurrency(grand);
      centerLbl = 'Base s/ IVA';
    }

    const total = slices.reduce((s, x) => s + x.value, 0) || 1;
    const r = 68;
    const circ = 2 * Math.PI * r;
    let offset = 0;

    const circlesHtml = slices
      .map((s) => {
        const dash = (s.value / total) * circ;
        const pct = Math.round((s.value / total) * 100);
        const seg = `
          <circle class="erp-donut-slice"
            cx="90" cy="90" r="${r}"
            fill="none"
            stroke="${s.color}"
            stroke-width="24"
            stroke-dasharray="${dash} ${circ - dash}"
            stroke-dashoffset="${-offset}"
            data-donut-label="${escapeHtml(s.label)}"
            data-donut-val="${escapeHtml(s.display)}"
            data-donut-pct="${pct}%"
            data-donut-route="${escapeHtml(s.route)}" />
        `;
        offset += dash;
        return seg;
      })
      .join('');

    return `
      <div class="erp-donut-layout">
        <div class="erp-donut-box">
          <svg class="erp-donut-svg" viewBox="0 0 180 180">
            <circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--erp-bg)" stroke-width="24" />
            ${circlesHtml}
          </svg>
          <div class="erp-donut-center">
            <div class="erp-donut-center__val" id="donutCenterVal">${escapeHtml(centerVal)}</div>
            <div class="erp-donut-center__lbl" id="donutCenterLbl">${escapeHtml(centerLbl)}</div>
          </div>
        </div>
        <div class="erp-donut-list">
          ${slices
            .map((s) => {
              const pct = Math.round((s.value / total) * 100);
              return `
              <button type="button" class="erp-donut-row" data-donut-route="${escapeHtml(s.route)}">
                <span class="erp-donut-row__left">
                  <span class="erp-chart-legend__dot" style="background:${s.color};"></span>
                  <span class="erp-donut-row__name">${escapeHtml(s.label)} (${pct}%)</span>
                </span>
                <span class="erp-donut-row__val">${escapeHtml(s.display)}</span>
              </button>`;
            })
            .join('')}
        </div>
      </div>
    `;
  }

  _renderAttendanceBars(empAttendance) {
    if (empAttendance.length === 0) {
      return `<div class="erp-empty">${ICONS.users}<div class="erp-empty__title">Sem colaboradores ativos</div></div>`;
    }

    return `
      <div class="erp-att-bar-list">
        ${empAttendance
          .map(({ emp, stats }) => {
            const denom = Math.max(1, stats.workdays);
            const wP = Math.min(100, (stats.p / denom) * 100);
            const wFJ = Math.min(100 - wP, (stats.fj / denom) * 100);
            const wFI = Math.min(100 - wP - wFJ, (stats.fi / denom) * 100);
            const wFE = Math.min(100 - wP - wFJ - wFI, (stats.fe / denom) * 100);
            return `
            <div class="erp-att-bar-item" data-dash-nav="rh-funcionarios">
              <div class="erp-att-bar-item__top">
                <span class="erp-att-bar-item__name">${escapeHtml(emp.name)} <span style="font-weight:400;color:var(--erp-text-muted)">· ${escapeHtml(emp.department)}</span></span>
                <span class="erp-att-bar-item__meta">${stats.p}P · ${stats.fj}FJ · ${stats.fi}FI · <strong style="color:var(--erp-heading)">${stats.rate}%</strong></span>
              </div>
              <div class="erp-stacked-track">
                ${wP > 0 ? `<div class="erp-stacked-seg--P" style="width:${wP}%"></div>` : ''}
                ${wFJ > 0 ? `<div class="erp-stacked-seg--FJ" style="width:${wFJ}%"></div>` : ''}
                ${wFI > 0 ? `<div class="erp-stacked-seg--FI" style="width:${wFI}%"></div>` : ''}
                ${wFE > 0 ? `<div class="erp-stacked-seg--FE" style="width:${wFE}%"></div>` : ''}
              </div>
            </div>`;
          })
          .join('')}
      </div>
      <div class="erp-chart-legend">
        <span class="erp-chart-legend__item"><span class="erp-chart-legend__dot" style="background:var(--erp-success);"></span>Presente (P)</span>
        <span class="erp-chart-legend__item"><span class="erp-chart-legend__dot" style="background:var(--erp-warning);"></span>Falta Justificada (FJ)</span>
        <span class="erp-chart-legend__item"><span class="erp-chart-legend__dot" style="background:var(--erp-danger);"></span>Falta Injustificada (FI)</span>
        <span class="erp-chart-legend__item"><span class="erp-chart-legend__dot" style="background:var(--erp-info);"></span>Férias (FE)</span>
      </div>
    `;
  }

  _renderPaymentsFeed(openInstallments) {
    if (openInstallments.length === 0) {
      return `<div class="erp-empty">${ICONS.checkCircle}<div class="erp-empty__title">Todas as parcelas liquidadas</div><p>Não existem pagamentos em aberto nas obras registadas.</p></div>`;
    }

    const visible = openInstallments.slice(0, 5);
    return `
      <div class="erp-pay-feed">
        ${visible
          .map(
            (item) => `
          <div class="erp-pay-feed__item ${item.overdue ? 'erp-pay-feed__item--overdue' : ''}">
            <div class="erp-pay-feed__left">
              <div class="erp-pay-feed__title">${escapeHtml(item.projectCode)} · ${escapeHtml(item.description)}</div>
              <div class="erp-pay-feed__sub">
                ${escapeHtml(item.clientName)} · Vencimento ${escapeHtml(formatDatePT(item.dueDate))}
                ${item.overdue ? ' · <strong style="color:var(--erp-danger)">Em Atraso</strong>' : ''}
              </div>
            </div>
            <div class="erp-pay-feed__right">
              <span class="erp-pay-feed__amount">${escapeHtml(formatCurrency(item.amount))}</span>
              <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-dash-pay="${escapeHtml(item.paymentId)}" data-dash-proj="${escapeHtml(item.projectId)}">
                Marcar Pago
              </button>
            </div>
          </div>`
          )
          .join('')}
      </div>
    `;
  }

  _bindEvents(container, state) {
    container.querySelectorAll('[data-chart-pfilter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.projectFilter = btn.dataset.chartPfilter;
        store._commit();
      });
    });

    container.querySelectorAll('[data-donut-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.donutMode = btn.dataset.donutMode;
        store._commit();
      });
    });

    container.querySelectorAll('[data-rank-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.rankPeriod = btn.dataset.rankPeriod;
        store._commit();
      });
    });

    container.querySelectorAll('[data-rank-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.rankSort = btn.dataset.rankSort;
        store._commit();
      });
    });

    container.querySelector('#dashRankStatusFilter')?.addEventListener('change', (e) => {
      this.rankStatus = e.target.value;
      store._commit();
    });

    container.querySelectorAll('[data-dash-nav]').forEach((el) => {
      el.addEventListener('click', () => {
        if (typeof this.onNavigate === 'function') {
          this.onNavigate(el.dataset.dashNav);
        }
      });
    });

    container.querySelectorAll('[data-dash-quick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (typeof this.onQuickAction === 'function') {
          this.onQuickAction(btn.dataset.dashQuick);
        }
      });
    });

    container.querySelectorAll('[data-dash-open-proj]').forEach((item) => {
      item.addEventListener('click', () => {
        const st = item.dataset.dashProjStatus;
        const route = st === 'concluida' ? 'op-concluidas' : st === 'a_iniciar' ? 'op-iniciar' : 'op-andamento';
        if (typeof this.onNavigate === 'function') {
          this.onNavigate(route, item.dataset.dashOpenProj);
        }
      });
    });

    // Bar chart hover tooltip & click navigation
    const tooltip = container.querySelector('#erpChartTooltip');
    container.querySelectorAll('.erp-bar-group').forEach((grp) => {
      grp.addEventListener('mousemove', (e) => {
        if (!tooltip) return;
        tooltip.innerHTML = `
          <div style="font-weight:700;margin-bottom:4px;color:#ff8534;">${grp.dataset.tipTitle}</div>
          <div>Orçamento Geral: <strong>${grp.dataset.tipContract}</strong></div>
          <div>Faturas Materiais: <strong style="color:#fda4af;">${grp.dataset.tipSpent}</strong></div>
          <div>Saldo Obra: <strong style="color:#4ade80;">${grp.dataset.tipRem}</strong></div>
          <div style="margin-top:3px;opacity:0.8;">Cliente Pago: ${grp.dataset.tipPaid} · Aberto: ${grp.dataset.tipOpen}</div>
          <div style="opacity:0.8;">Próx. Recebimento: ${grp.dataset.tipNext}</div>
        `;
        tooltip.style.left = `${Math.min(window.innerWidth - 230, e.clientX + 14)}px`;
        tooltip.style.top = `${Math.max(12, e.clientY - 24)}px`;
        tooltip.classList.add('is-visible');
      });
      grp.addEventListener('mouseleave', () => {
        tooltip?.classList.remove('is-visible');
      });
      grp.addEventListener('click', () => {
        const st = grp.dataset.barStatus;
        const route = st === 'concluida' ? 'op-concluidas' : st === 'a_iniciar' ? 'op-iniciar' : 'op-andamento';
        if (typeof this.onNavigate === 'function') {
          this.onNavigate(route, grp.dataset.barProj);
        }
      });
    });

    // Donut interactive hover & click
    const centerValEl = container.querySelector('#donutCenterVal');
    const centerLblEl = container.querySelector('#donutCenterLbl');
    const origVal = centerValEl ? centerValEl.textContent : '';
    const origLbl = centerLblEl ? centerLblEl.textContent : '';

    container.querySelectorAll('.erp-donut-slice').forEach((slice) => {
      slice.addEventListener('mouseenter', () => {
        if (centerValEl) centerValEl.textContent = slice.dataset.donutPct;
        if (centerLblEl) centerLblEl.textContent = slice.dataset.donutLabel;
      });
      slice.addEventListener('mouseleave', () => {
        if (centerValEl) centerValEl.textContent = origVal;
        if (centerLblEl) centerLblEl.textContent = origLbl;
      });
      slice.addEventListener('click', () => {
        if (typeof this.onNavigate === 'function') {
          this.onNavigate(slice.dataset.donutRoute);
        }
      });
    });

    container.querySelectorAll('.erp-donut-row').forEach((row) => {
      row.addEventListener('click', () => {
        if (typeof this.onNavigate === 'function') {
          this.onNavigate(row.dataset.donutRoute);
        }
      });
    });

    // Direct Mark Paid from Dashboard
    container.querySelectorAll('[data-dash-pay]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const projId = btn.dataset.dashProj;
        const payId = btn.dataset.dashPay;
        const proj = state.projects.find((p) => p.id === projId);
        if (!proj) return;
        const updatedPayments = (proj.payments || []).map((p) =>
          p.id === payId ? { ...p, status: 'pago', paidDate: todayISO() } : p
        );
        store.updateProject(proj.id, { payments: updatedPayments });
        showToast(`Parcela de ${proj.code} marcada como paga.`);
      });
    });
  }
}
