/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Operacional: Obras, Orçamentos & Pagamentos
   ═══════════════════════════════════════════════════════════ */

import { store, saveInvoiceFile, getProjectInvoiceFile } from '../core/store.js';
import {
  computeBudgetTotals,
  computeProjectFinancials,
  computeProjectInvoiceSummary,
  escapeHtml,
  formatCurrency,
  formatDatePT,
  generateId,
  isValidNIF,
  todayISO,
} from '../core/formatters.js';
import { ICONS, openModal, closeModal, confirmAction, showToast } from '../core/ui.js';

const INVOICE_CATEGORIES = [
  'Materiais de Construção',
  'Elétrico & Iluminação',
  'Canalização & AVAC',
  'Pladur & Tectos',
  'Aluguer de Equipamentos',
  'Subempreitada',
  'Outros Custos',
];

const PROJECT_TYPES = [
  'Construção Civil',
  'Capoto & Requalificação Exterior',
  'Remodelação Interior/Exterior',
  'Obras em Pladur',
  'Instalações Elétricas & Pladur',
  'Instalações Elétricas',
  'Jardinagem & Espaços Verdes',
  'Consultoria & Fiscalização',
];

const DISTRICTS = [
  'Porto',
  'Lisboa',
  'Braga',
  'Aveiro',
  'Coimbra',
  'Setúbal',
  'Faro',
  'Valongo',
  'Maia',
  'Vila Nova de Gaia',
  'Leiria',
  'Viseu',
  'Santarém',
];

const BUDGET_CATEGORIES = ['Mão de Obra', 'Materiais', 'Equipamentos', 'Subempreitada'];
const PAYMENT_METHODS = ['Transferência Bancária', 'MB Way', 'Cheque', 'Numerário'];

const STATUS_META = {
  em_andamento: { label: 'Em Andamento', badge: 'erp-badge--info' },
  a_iniciar: { label: 'A Iniciar', badge: 'erp-badge--warning' },
  concluida: { label: 'Concluída', badge: 'erp-badge--success' },
};

export class OperacionalObrasModule {
  constructor() {
    this.typeFilter = 'all';
    this.invoiceCatFilter = 'all';
  }

  render(container, ctx) {
    this._can = ctx.can || (() => true);
    const state = store.getState();
    const { statusFilter, search } = ctx; // 'em_andamento' | 'a_iniciar' | 'concluida'
    const query = (search || '').trim().toLowerCase();

    const byStatus = state.projects.filter((p) => p.status === statusFilter);
    const filtered = byStatus.filter((p) => {
      if (this.typeFilter !== 'all' && p.type !== this.typeFilter) return false;
      if (query) {
        const hay = `${p.code} ${p.name} ${p.clientName} ${p.clientNif} ${p.district} ${p.type}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    // Global & filtered financial + material invoice KPIs
    let totalBudgetPool = 0;
    let totalInvoiced = 0;
    let totalInvoicesCount = 0;
    let overBudgetCount = 0;

    filtered.forEach((proj) => {
      const invSum = computeProjectInvoiceSummary(proj, state.projectInvoices);
      totalBudgetPool += invSum.budgetTotal;
      totalInvoiced += invSum.spentOnInvoices;
      totalInvoicesCount += invSum.invoiceCount;
      if (invSum.isOverBudget) overBudgetCount += 1;
    });

    const totalBudgetRemaining = totalBudgetPool - totalInvoiced;
    const empMap = new Map(state.employees.map((e) => [e.id, e]));
    const statusInfo = STATUS_META[statusFilter] || STATUS_META.em_andamento;

    container.innerHTML = `
      <div class="erp-kpi-grid">
        <div class="erp-kpi-card erp-kpi-card--primary">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Obras (${escapeHtml(statusInfo.label)})</span>
            <span class="erp-kpi-card__icon">${ICONS.building}</span>
          </div>
          <div class="erp-kpi-card__value">${filtered.length}</div>
          <div class="erp-kpi-card__meta">De ${state.projects.length} empreitadas no sistema</div>
        </div>

        <div class="erp-kpi-card">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Orçamento Geral das Obras</span>
            <span class="erp-kpi-card__icon">${ICONS.euro}</span>
          </div>
          <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalBudgetPool))}</div>
          <div class="erp-kpi-card__meta">Plafond global orçamentado</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--warning">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Faturas de Compra Lançadas</span>
            <span class="erp-kpi-card__icon">${ICONS.receipt}</span>
          </div>
          <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalInvoiced))}</div>
          <div class="erp-kpi-card__meta">${totalInvoicesCount} fatura(s) de materiais imputadas</div>
        </div>

        <div class="erp-kpi-card ${overBudgetCount > 0 || totalBudgetRemaining < 0 ? 'erp-kpi-card--danger' : 'erp-kpi-card--success'}">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Saldo Disponível nas Obras</span>
            <span class="erp-kpi-card__icon">${ICONS.checkCircle}</span>
          </div>
          <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalBudgetRemaining))}</div>
          <div class="erp-kpi-card__meta">${overBudgetCount > 0 ? `${overBudgetCount} obra(s) acima do orçamento` : 'Calculado em tempo real após faturas'}</div>
        </div>
      </div>

      <div class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h2 class="erp-panel__title">Gestão Operacional — Obras ${escapeHtml(statusInfo.label)}</h2>
            <p class="erp-panel__desc">Orçamentos, faturas de compra de materiais (PDF), saldo restante em tempo real e recebimentos.</p>
          </div>
          <div class="erp-panel__actions">
            <select class="erp-select-sm" id="filterProjectType">
              <option value="all">Todas as Tipologias</option>
              ${PROJECT_TYPES.map((t) => `<option value="${escapeHtml(t)}" ${this.typeFilter === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
            </select>
            ${
              (ctx.can ? ctx.can('op_obras', 'faturas') : true) && state.projects.length > 0
                ? `<button type="button" class="erp-btn erp-btn--outline" id="btnQuickLaunchInvoice">
                    ${ICONS.receipt}
                    <span>Lançar Fatura de Material</span>
                  </button>`
                : ''
            }
            ${
              (ctx.can ? ctx.can('op_obras', 'criar') : true)
                ? `<button type="button" class="erp-btn erp-btn--primary" id="btnNewProject">
                    ${ICONS.plus}
                    <span>Nova Obra &amp; Orçamento</span>
                  </button>`
                : ''
            }
          </div>
        </div>

        ${
          filtered.length === 0
            ? `<div class="erp-empty">${ICONS.building}<div class="erp-empty__title">Nenhuma obra nesta categoria</div><p>Cadastre uma nova obra ou altere o filtro de tipologia.</p></div>`
            : `
          <div class="erp-table-wrap">
            <table class="erp-table">
              <thead>
                <tr>
                  <th>Obra &amp; Localização</th>
                  <th>Cliente &amp; Responsável</th>
                  <th>Prazos &amp; Progresso</th>
                  <th>Orçamento Geral</th>
                  <th>Faturas / Materiais</th>
                  <th>Saldo Disponível (Real Time)</th>
                  <th style="text-align:right">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${filtered
                  .map((proj) => {
                    const fin = computeProjectFinancials(proj);
                    const invSum = computeProjectInvoiceSummary(proj, state.projectInvoices);
                    const mgr = empMap.get(proj.managerId);
                    const barWidth = Math.min(100, Math.max(0, invSum.spentPct));
                    const barClass = invSum.isOverBudget
                      ? 'erp-budget-meter__fill--danger'
                      : invSum.isWarningBudget
                        ? 'erp-budget-meter__fill--warning'
                        : '';
                    return `
                    <tr>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(proj.name)}</div>
                        <div class="erp-cell-sub">${escapeHtml(proj.code)} · ${escapeHtml(proj.type)} · ${escapeHtml(proj.district)}</div>
                      </td>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(proj.clientName)}</div>
                        <div class="erp-cell-sub">NIF ${escapeHtml(proj.clientNif || '—')} · Resp. ${escapeHtml(mgr?.name || 'Não definido')}</div>
                      </td>
                      <td>
                        <div class="erp-cell-sub" style="margin-bottom:5px;">
                          ${escapeHtml(formatDatePT(proj.startDate))} → ${escapeHtml(formatDatePT(proj.expectedEndDate))}
                        </div>
                        <div class="erp-progress">
                          <div class="erp-progress__track"><div class="erp-progress__fill" style="width:${Number(proj.progress) || 0}%"></div></div>
                          <span class="erp-progress__label">${Number(proj.progress) || 0}%</span>
                        </div>
                      </td>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(formatCurrency(invSum.budgetTotal))}</div>
                        <div class="erp-cell-sub">${invSum.isManualCap ? 'Plafond direto da obra' : `IVA ${fin.vatRate}% · ${proj.budget?.items?.length || 0} artigo(s)`}</div>
                      </td>
                      <td>
                        <div class="erp-cell-title" style="color:var(--erp-heading);">${escapeHtml(formatCurrency(invSum.spentOnInvoices))}</div>
                        <div class="erp-cell-sub" style="margin-bottom:4px;">${invSum.invoiceCount} fatura(s) · ${invSum.spentPct}% consumido</div>
                        <div class="erp-budget-meter__track" style="height:6px;width:130px;">
                          <div class="erp-budget-meter__fill ${barClass}" style="width:${barWidth}%"></div>
                        </div>
                      </td>
                      <td>
                        <div class="erp-cell-title" style="color:${invSum.isOverBudget ? 'var(--erp-danger)' : invSum.isWarningBudget ? 'var(--erp-warning)' : 'var(--erp-success)'};font-size:14px;">
                          ${escapeHtml(formatCurrency(invSum.remainingBudget))}
                        </div>
                        <span class="erp-badge ${invSum.isOverBudget ? 'erp-badge--danger' : invSum.isWarningBudget ? 'erp-badge--warning' : 'erp-badge--success'}">
                          ${invSum.isOverBudget ? 'Orçamento Excedido' : invSum.isWarningBudget ? 'Atenção (>80%)' : 'Saldo Disponível'}
                        </span>
                      </td>
                      <td>
                        <div class="erp-row-actions">
                          ${!ctx.can || ctx.can('op_obras', 'faturas') ? `<button type="button" class="erp-icon-btn" title="Lançar Fatura de Compra (PDF)" data-proj-invoice="${escapeHtml(proj.id)}">${ICONS.receipt}</button>` : ''}
                          <button type="button" class="erp-icon-btn" title="Ver Faturas, Orçamento &amp; Saldo" data-proj-view="${escapeHtml(proj.id)}">${ICONS.eye}</button>
                          ${!ctx.can || ctx.can('op_obras', 'editar') ? `<button type="button" class="erp-icon-btn" title="Editar Obra Completa" data-proj-edit="${escapeHtml(proj.id)}">${ICONS.edit}</button>` : ''}
                          ${!ctx.can || ctx.can('op_obras', 'excluir') ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" title="Excluir Obra" data-proj-del="${escapeHtml(proj.id)}">${ICONS.trash}</button>` : ''}
                        </div>
                      </td>
                    </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>`
        }
      </div>
    `;

    container.querySelector('#filterProjectType').addEventListener('change', (e) => {
      this.typeFilter = e.target.value;
      store._commit();
    });

    container.querySelector('#btnQuickLaunchInvoice')?.addEventListener('click', () => {
      this.openLaunchInvoiceModal(filtered[0]?.id || state.projects[0]?.id || null);
    });

    container.querySelector('#btnNewProject')?.addEventListener('click', () => {
      this._openProjectFormModal(null, statusFilter);
    });

    container.querySelectorAll('[data-proj-invoice]').forEach((btn) => {
      btn.addEventListener('click', () => this.openLaunchInvoiceModal(btn.dataset.projInvoice));
    });

    container.querySelectorAll('[data-proj-view]').forEach((btn) => {
      btn.addEventListener('click', () => this._openProjectDetailModal(btn.dataset.projView, 'invoices'));
    });

    container.querySelectorAll('[data-proj-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const proj = store.getState().projects.find((p) => p.id === btn.dataset.projEdit);
        if (proj) this._openProjectFormModal(proj, proj.status);
      });
    });

    container.querySelectorAll('[data-proj-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const proj = store.getState().projects.find((p) => p.id === btn.dataset.projDel);
        if (!proj) return;
        confirmAction({
          title: 'Excluir Obra',
          message: `Tem a certeza de que pretende eliminar a obra "${proj.name}" (${proj.code}), todas as faturas lançadas e o respetivo orçamento?`,
          onConfirm: () => {
            store.deleteProject(proj.id);
            showToast(`Obra ${proj.code} eliminada.`);
          },
        });
      });
    });
  }

  openProjectDetail(projectId, initialTab = 'invoices') {
    this._openProjectDetailModal(projectId, initialTab);
  }

  _openProjectDetailModal(projectId, initialTab = 'overview') {
    const state = store.getState();
    const proj = state.projects.find((p) => p.id === projectId);
    if (!proj) return;

    const empMap = new Map(state.employees.map((e) => [e.id, e]));
    const fin = computeProjectFinancials(proj);
    const invSum = computeProjectInvoiceSummary(proj, state.projectInvoices);
    const statusInfo = STATUS_META[proj.status] || STATUS_META.em_andamento;
    const today = todayISO();

    const canBudget = !this._can || this._can('op_obras', 'orcamentos');
    const canPayments = !this._can || this._can('op_obras', 'pagamentos');
    const canInvoices = !this._can || this._can('op_obras', 'faturas');
    const canDeleteInvoice = !this._can || this._can('op_obras', 'excluir') || canInvoices;

    const activeTab =
      initialTab === 'budget' && !canBudget
        ? 'overview'
        : initialTab === 'payments' && !canPayments
          ? 'overview'
          : initialTab;

    const meterPct = Math.min(100, Math.max(0, invSum.spentPct));
    const meterClass = invSum.isOverBudget
      ? 'erp-budget-meter__fill--danger'
      : invSum.isWarningBudget
        ? 'erp-budget-meter__fill--warning'
        : '';

    const filteredInvoices = invSum.invoices.filter(
      (inv) => this.invoiceCatFilter === 'all' || inv.category === this.invoiceCatFilter
    );

    const bodyHtml = `
      <div class="erp-summary-box" style="margin-bottom:18px;">
        <div>
          <div class="erp-summary-item__label">Orçamento Geral da Obra</div>
          <div class="erp-summary-item__val">${escapeHtml(formatCurrency(invSum.budgetTotal))}</div>
        </div>
        <div>
          <div class="erp-summary-item__label">Gasto em Faturas (${invSum.invoiceCount})</div>
          <div class="erp-summary-item__val erp-summary-item__val--warning">${escapeHtml(formatCurrency(invSum.spentOnInvoices))} (${invSum.spentPct}%)</div>
        </div>
        <div>
          <div class="erp-summary-item__label">Saldo Disponível (Real Time)</div>
          <div class="erp-summary-item__val ${invSum.isOverBudget ? 'erp-summary-item__val--danger' : 'erp-summary-item__val--success'}">
            ${escapeHtml(formatCurrency(invSum.remainingBudget))}
          </div>
        </div>
        <div>
          <div class="erp-summary-item__label">Recebido Cliente</div>
          <div class="erp-summary-item__val erp-summary-item__val--accent">${escapeHtml(formatCurrency(fin.paidAmount))} (${fin.paidPct}%)</div>
        </div>
      </div>

      <div class="erp-detail-tabs">
        <button type="button" class="erp-detail-tab ${activeTab === 'overview' ? 'is-active' : ''}" data-det-tab="overview">Dados Técnicos &amp; Equipa</button>
        <button type="button" class="erp-detail-tab ${activeTab === 'invoices' ? 'is-active' : ''}" data-det-tab="invoices">Faturas &amp; Materiais (${invSum.invoiceCount})</button>
        ${canBudget ? `<button type="button" class="erp-detail-tab ${activeTab === 'budget' ? 'is-active' : ''}" data-det-tab="budget">Orçamento Detalhado (${proj.budget?.items?.length || 0})</button>` : ''}
        ${canPayments ? `<button type="button" class="erp-detail-tab ${activeTab === 'payments' ? 'is-active' : ''}" data-det-tab="payments">Recebimentos Cliente (${proj.payments?.length || 0})</button>` : ''}
      </div>

      <div id="detPaneOverview" style="display:${activeTab === 'overview' ? 'block' : 'none'};">
        <div class="erp-form-grid" style="margin-bottom:14px;">
          <div>
            <div class="erp-cell-sub">Cliente</div>
            <div class="erp-cell-title">${escapeHtml(proj.clientName)} (NIF ${escapeHtml(proj.clientNif || '—')})</div>
            <div class="erp-cell-sub">${escapeHtml(proj.clientPhone)} · ${escapeHtml(proj.clientEmail)}</div>
          </div>
          <div>
            <div class="erp-cell-sub">Localização da Obra</div>
            <div class="erp-cell-title">${escapeHtml(proj.district)}</div>
            <div class="erp-cell-sub">${escapeHtml(proj.address)}</div>
          </div>
          <div>
            <div class="erp-cell-sub">Responsável Técnico</div>
            <div class="erp-cell-title">${escapeHtml(empMap.get(proj.managerId)?.name || 'Não atribuído')}</div>
          </div>
          <div>
            <div class="erp-cell-sub">Cronograma</div>
            <div class="erp-cell-title">Início ${escapeHtml(formatDatePT(proj.startDate))} · Prev. ${escapeHtml(formatDatePT(proj.expectedEndDate))}</div>
            ${proj.actualEndDate ? `<div class="erp-cell-sub">Concluída em ${escapeHtml(formatDatePT(proj.actualEndDate))}</div>` : ''}
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <div class="erp-cell-sub" style="margin-bottom:4px;">Descrição Técnica</div>
          <p style="font-size:13px;color:var(--erp-text-secondary);">${escapeHtml(proj.description || 'Sem descrição adicional.')}</p>
        </div>
        <div>
          <div class="erp-cell-sub" style="margin-bottom:6px;">Equipa Alocada (${(proj.teamIds || []).length})</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${(proj.teamIds || [])
              .map((id) => {
                const m = empMap.get(id);
                return m ? `<span class="erp-badge erp-badge--neutral">${escapeHtml(m.name)} (${escapeHtml(m.department)})</span>` : '';
              })
              .join('') || '<span class="erp-cell-sub">Nenhum colaborador alocado.</span>'}
          </div>
        </div>
      </div>

      <div id="detPaneInvoices" style="display:${activeTab === 'invoices' ? 'block' : 'none'};">
        <div class="erp-budget-meter">
          <div class="erp-budget-meter__top">
            <span class="erp-budget-meter__label">Controlo de Materiais &amp; Faturas de Compra (${invSum.spentPct}% utilizado)</span>
            <span class="erp-budget-meter__nums">
              Gasto: <strong style="color:var(--erp-heading);">${escapeHtml(formatCurrency(invSum.spentOnInvoices))}</strong>
              de ${escapeHtml(formatCurrency(invSum.budgetTotal))} ·
              Saldo Restante: <strong style="color:${invSum.isOverBudget ? 'var(--erp-danger)' : 'var(--erp-success)'};">${escapeHtml(formatCurrency(invSum.remainingBudget))}</strong>
            </span>
          </div>
          <div class="erp-budget-meter__track">
            <div class="erp-budget-meter__fill ${meterClass}" style="width:${meterPct}%"></div>
          </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <select class="erp-select-sm" id="detInvCatFilter" title="Filtrar por Categoria">
            <option value="all" ${this.invoiceCatFilter === 'all' ? 'selected' : ''}>Todas as Categorias (${invSum.invoiceCount})</option>
            ${INVOICE_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}" ${this.invoiceCatFilter === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
          ${
            canInvoices
              ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" id="btnDetAddInvoice">
                  ${ICONS.plus}<span>Lançar Fatura de Compra (PDF)</span>
                </button>`
              : ''
          }
        </div>

        ${
          filteredInvoices.length === 0
            ? `<div class="erp-empty" style="padding:28px 16px;">${ICONS.receipt}<div class="erp-empty__title">Sem faturas lançadas nesta vista</div><p>Lance as faturas de materiais ou fornecedores (com PDF) para abater em tempo real no orçamento de ${escapeHtml(formatCurrency(invSum.budgetTotal))}.</p></div>`
            : `
          <div class="erp-table-wrap">
            <table class="erp-table">
              <thead>
                <tr>
                  <th>Data / Fatura</th>
                  <th>Fornecedor &amp; Categoria</th>
                  <th>PDF / Documento</th>
                  <th style="text-align:right">Valor (€)</th>
                  <th style="text-align:right">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${filteredInvoices
                  .map(
                    (inv) => `
                  <tr>
                    <td>
                      <div class="erp-cell-title">${escapeHtml(inv.invoiceNumber)}</div>
                      <div class="erp-cell-sub">${escapeHtml(formatDatePT(inv.invoiceDate))} · ${escapeHtml(inv.id)}</div>
                    </td>
                    <td>
                      <div class="erp-cell-title">${escapeHtml(inv.supplier)}</div>
                      <div class="erp-cell-sub">${escapeHtml(inv.category)}${inv.supplierNif ? ` · NIF ${escapeHtml(inv.supplierNif)}` : ''}</div>
                    </td>
                    <td>
                      ${
                        inv.hasFile
                          ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                              <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-inv-view="${escapeHtml(inv.id)}" title="Pré-visualizar PDF/Imagem">${ICONS.eye}<span>Ver PDF</span></button>
                              <button type="button" class="erp-icon-btn" data-inv-dl="${escapeHtml(inv.id)}" title="Descarregar Fatura">${ICONS.download}</button>
                            </div>`
                          : '<span class="erp-badge erp-badge--neutral">Sem PDF anexo</span>'
                      }
                    </td>
                    <td style="text-align:right;font-weight:800;color:var(--erp-heading);">
                      ${escapeHtml(formatCurrency(inv.amount))}
                    </td>
                    <td style="text-align:right">
                      <div class="erp-row-actions">
                        ${canDeleteInvoice ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" title="Eliminar Fatura e Repor Saldo" data-inv-del="${escapeHtml(inv.id)}">${ICONS.trash}</button>` : '<span style="font-size:11px;color:var(--erp-text-muted);">—</span>'}
                      </div>
                    </td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
        }
      </div>

      <div id="detPaneBudget" style="display:${activeTab === 'budget' ? 'block' : 'none'};">
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Artigo / Descrição</th>
                <th>Categoria</th>
                <th>Qtd. / Un.</th>
                <th>Preço Unit.</th>
                <th style="text-align:right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${(proj.budget?.items || [])
                .map(
                  (item) => `
                <tr>
                  <td><div class="erp-cell-title">${escapeHtml(item.description)}</div></td>
                  <td>${escapeHtml(item.category)}</td>
                  <td>${escapeHtml(item.qty)} ${escapeHtml(item.unit)}</td>
                  <td>${escapeHtml(formatCurrency(item.unitPrice))}</td>
                  <td style="text-align:right;font-weight:700;">${escapeHtml(formatCurrency((Number(item.qty) || 0) * (Number(item.unitPrice) || 0)))}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="erp-summary-box" style="margin-top:14px;">
          <div><div class="erp-summary-item__label">Subtotal Artigos</div><div class="erp-summary-item__val">${escapeHtml(formatCurrency(fin.subtotal))}</div></div>
          <div><div class="erp-summary-item__label">Contingência (${fin.contingencyVal > 0 ? `${proj.budget?.contingencyPct}%` : '0%'})</div><div class="erp-summary-item__val">${escapeHtml(formatCurrency(fin.contingencyVal))}</div></div>
          <div><div class="erp-summary-item__label">IVA (${fin.vatRate}%)</div><div class="erp-summary-item__val">${escapeHtml(formatCurrency(fin.vatVal))}</div></div>
          <div><div class="erp-summary-item__label">Total c/ IVA</div><div class="erp-summary-item__val erp-summary-item__val--accent">${escapeHtml(formatCurrency(fin.grossTotal))}</div></div>
        </div>
      </div>

      <div id="detPanePayments" style="display:none;">
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Parcela / Auto</th>
                <th>Data Prevista</th>
                <th>Data Pagamento</th>
                <th>Método / Fatura</th>
                <th>Valor</th>
                <th>Estado</th>
                <th style="text-align:right">Ação Rápida</th>
              </tr>
            </thead>
            <tbody>
              ${(proj.payments || [])
                .map((p) => {
                  const overdue = p.status !== 'pago' && p.dueDate && p.dueDate < today;
                  return `
                  <tr>
                    <td><div class="erp-cell-title">${escapeHtml(p.description)}</div></td>
                    <td>${escapeHtml(formatDatePT(p.dueDate))}</td>
                    <td>${p.paidDate ? escapeHtml(formatDatePT(p.paidDate)) : '—'}</td>
                    <td>
                      <div>${escapeHtml(p.method)}</div>
                      <div class="erp-cell-sub">${escapeHtml(p.invoiceRef || 'Sem fatura')}</div>
                    </td>
                    <td style="font-weight:700;">${escapeHtml(formatCurrency(p.amount))}</td>
                    <td>
                      <span class="erp-badge ${p.status === 'pago' ? 'erp-badge--success' : overdue ? 'erp-badge--danger' : 'erp-badge--warning'}">
                        ${p.status === 'pago' ? 'Pago' : overdue ? 'Em Atraso' : 'Em Aberto'}
                      </span>
                    </td>
                    <td style="text-align:right">
                      ${
                        !this._can || this._can('op_obras', 'pagamentos')
                          ? `<button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-toggle-pay="${escapeHtml(p.id)}">
                              ${p.status === 'pago' ? 'Reabrir' : 'Marcar Pago'}
                            </button>`
                          : '<span style="font-size:11px;color:var(--erp-text-muted);">Só leitura</span>'
                      }
                    </td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    openModal({
      title: `${proj.code} — ${proj.name}`,
      subtitle: `${statusInfo.label} · ${proj.type}`,
      size: 'wide',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
        ${!this._can || this._can('op_obras', 'editar') ? `<button type="button" class="erp-btn erp-btn--primary" id="btnDetEdit">${ICONS.edit}<span>Editar Obra &amp; Orçamento</span></button>` : ''}
      `,
      onMount: (modal) => {
        const panes = {
          overview: modal.querySelector('#detPaneOverview'),
          invoices: modal.querySelector('#detPaneInvoices'),
          budget: modal.querySelector('#detPaneBudget'),
          payments: modal.querySelector('#detPanePayments'),
        };
        modal.querySelectorAll('[data-det-tab]').forEach((tab) => {
          tab.addEventListener('click', () => {
            modal.querySelectorAll('[data-det-tab]').forEach((t) => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            Object.entries(panes).forEach(([k, el]) => {
              if (el) el.style.display = k === tab.dataset.detTab ? 'block' : 'none';
            });
          });
        });

        modal.querySelector('#detInvCatFilter')?.addEventListener('change', (e) => {
          this.invoiceCatFilter = e.target.value;
          this._openProjectDetailModal(proj.id, 'invoices');
        });

        modal.querySelector('#btnDetAddInvoice')?.addEventListener('click', () => {
          this.openLaunchInvoiceModal(proj.id, proj.id);
        });

        modal.querySelectorAll('[data-inv-view]').forEach((btn) => {
          btn.addEventListener('click', () => this._previewInvoiceFileById(btn.dataset.invView));
        });

        modal.querySelectorAll('[data-inv-dl]').forEach((btn) => {
          btn.addEventListener('click', () => this._downloadInvoiceFileById(btn.dataset.invDl));
        });

        modal.querySelectorAll('[data-inv-del]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const inv = invSum.invoices.find((x) => x.id === btn.dataset.invDel);
            if (!inv) return;
            confirmAction({
              title: 'Remover Fatura da Obra',
              message: `Eliminar a fatura "${inv.invoiceNumber}" (${inv.supplier}, ${formatCurrency(inv.amount)})? O saldo disponível da obra será recalculado automaticamente.`,
              onConfirm: () => {
                store.deleteProjectInvoice(inv.id);
                showToast('Fatura removida e saldo atualizado em tempo real.');
                this._openProjectDetailModal(proj.id, 'invoices');
              },
            });
          });
        });

        modal.querySelectorAll('[data-toggle-pay]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const payId = btn.dataset.togglePay;
            const updatedPayments = (proj.payments || []).map((p) => {
              if (p.id !== payId) return p;
              const nextStatus = p.status === 'pago' ? 'em_aberto' : 'pago';
              return {
                ...p,
                status: nextStatus,
                paidDate: nextStatus === 'pago' ? todayISO() : '',
              };
            });
            store.updateProject(proj.id, { payments: updatedPayments });
            showToast('Estado da parcela atualizado.');
            this._openProjectDetailModal(proj.id, 'payments');
          });
        });

        modal.querySelector('#btnDetEdit')?.addEventListener('click', () => {
          closeModal();
          this._openProjectFormModal(proj, proj.status);
        });
      },
    });
  }

  openLaunchInvoiceModal(defaultProjectId = null, returnToDetailId = null) {
    const state = store.getState();
    if (!state.projects || state.projects.length === 0) {
      showToast('Cadastre primeiro uma obra antes de lançar faturas.', 'warning');
      return;
    }

    const selectedProjId =
      defaultProjectId && state.projects.some((p) => p.id === defaultProjectId || p.code === defaultProjectId)
        ? state.projects.find((p) => p.id === defaultProjectId || p.code === defaultProjectId).id
        : state.projects[0].id;

    let selectedFile = null;

    const bodyHtml = `
      <form id="projectInvoiceForm">
        <div class="erp-form-section">
          <div class="erp-form-section__title">1. Obra &amp; Dados da Fatura de Compra</div>
          <div class="erp-form-grid erp-form-grid--3">
            <div class="erp-field" style="grid-column:span 2;">
              <label for="invProject">Obra Associada *</label>
              <select id="invProject" required>
                ${state.projects
                  .map((p) => {
                    const s = computeProjectInvoiceSummary(p, state.projectInvoices);
                    return `<option value="${escapeHtml(p.id)}" ${p.id === selectedProjId ? 'selected' : ''}>${escapeHtml(p.code)} — ${escapeHtml(p.name)} (Saldo: ${escapeHtml(formatCurrency(s.remainingBudget))})</option>`;
                  })
                  .join('')}
              </select>
            </div>
            <div class="erp-field">
              <label for="invDate">Data da Fatura *</label>
              <input type="date" id="invDate" required value="${todayISO()}">
            </div>

            <div class="erp-field">
              <label for="invNumber">N.º Fatura / Documento *</label>
              <input type="text" id="invNumber" required placeholder="Ex.: FT 2026/00458">
            </div>
            <div class="erp-field">
              <label for="invSupplier">Fornecedor / Armazém *</label>
              <input type="text" id="invSupplier" required placeholder="Ex.: Maxmat, Leroy Merlin, Cimpor">
            </div>
            <div class="erp-field">
              <label for="invSupplierNif">NIF Fornecedor (Opcional)</label>
              <input type="text" id="invSupplierNif" maxlength="9" placeholder="9 dígitos">
            </div>

            <div class="erp-field">
              <label for="invCategory">Categoria de Custo *</label>
              <select id="invCategory" required>
                ${INVOICE_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field">
              <label for="invAmount">Valor da Fatura c/ IVA (€) *</label>
              <input type="number" step="0.01" min="0" id="invAmount" required placeholder="Ex.: 2000.00">
            </div>
            <div class="erp-field">
              <label for="invNotes">Descrição / Material Comprado</label>
              <input type="text" id="invNotes" placeholder="Ex.: Cimento, aço, cablagem...">
            </div>
          </div>

          <div class="erp-invoice-sim">
            <div>
              <div class="erp-summary-item__label">Orçamento Geral</div>
              <div class="erp-summary-item__val" id="simBudget">€0,00</div>
            </div>
            <div>
              <div class="erp-summary-item__label">Já Gasto (<span id="simCount">0</span> fat.)</div>
              <div class="erp-summary-item__val erp-summary-item__val--warning" id="simSpent">€0,00</div>
            </div>
            <div>
              <div class="erp-summary-item__label">Nova Fatura</div>
              <div class="erp-summary-item__val" id="simNew">+ €0,00</div>
            </div>
            <div>
              <div class="erp-summary-item__label">Saldo Restante Após Fatura</div>
              <div class="erp-summary-item__val erp-summary-item__val--success" id="simRemaining">€0,00</div>
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">2. Anexar PDF ou Comprovativo da Fatura</div>
          <div class="erp-dropzone" id="invDropzone">
            <input type="file" id="invFileInput" accept=".pdf,image/*" style="display:none;">
            <div class="erp-dropzone__title" id="invDropTitle">Clique para selecionar ou arraste o PDF / foto da fatura (até 10 MB)</div>
            <div class="erp-dropzone__hint">Formatos aceites: PDF, PNG, JPG, WEBP · Fica arquivado na obra para consulta a qualquer momento</div>
          </div>
        </div>
      </form>
    `;

    openModal({
      title: 'Lançar Fatura de Material / Compra em Obra',
      subtitle: 'O saldo disponível da obra é recalculado automaticamente ao lançar cada fatura.',
      size: 'wide',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" id="btnCancelInvoice">Cancelar</button>
        <button type="submit" form="projectInvoiceForm" class="erp-btn erp-btn--primary" id="btnSubmitInvoice">${ICONS.plus}<span>Registar Fatura &amp; Atualizar Saldo</span></button>
      `,
      onMount: (modal) => {
        const projSelect = modal.querySelector('#invProject');
        const amountInput = modal.querySelector('#invAmount');
        const dropzone = modal.querySelector('#invDropzone');
        const fileInput = modal.querySelector('#invFileInput');
        const dropTitle = modal.querySelector('#invDropTitle');

        const updateSimulator = () => {
          const latestState = store.getState();
          const proj = latestState.projects.find((p) => p.id === projSelect.value);
          const sum = computeProjectInvoiceSummary(proj, latestState.projectInvoices);
          const newAmt = Math.max(0, Number(amountInput.value) || 0);
          const nextRemaining = sum.remainingBudget - newAmt;

          modal.querySelector('#simBudget').textContent = formatCurrency(sum.budgetTotal);
          modal.querySelector('#simCount').textContent = String(sum.invoiceCount);
          modal.querySelector('#simSpent').textContent = formatCurrency(sum.spentOnInvoices);
          modal.querySelector('#simNew').textContent = `+ ${formatCurrency(newAmt)}`;

          const remEl = modal.querySelector('#simRemaining');
          remEl.textContent = formatCurrency(nextRemaining);
          remEl.className = `erp-summary-item__val ${nextRemaining < 0 ? 'erp-summary-item__val--danger' : 'erp-summary-item__val--success'}`;
        };

        projSelect.addEventListener('change', updateSimulator);
        amountInput.addEventListener('input', updateSimulator);
        updateSimulator();

        const handleSelectedFile = (file) => {
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) {
            showToast('O ficheiro da fatura ultrapassa o limite de 10 MB.', 'danger');
            return;
          }
          selectedFile = file;
          dropTitle.textContent = `Ficheiro selecionado: ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`;
        };

        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => handleSelectedFile(e.target.files?.[0]));
        dropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropzone.classList.add('is-dragover');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
        dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('is-dragover');
          handleSelectedFile(e.dataTransfer?.files?.[0]);
        });

        modal.querySelector('#btnCancelInvoice').addEventListener('click', () => {
          if (returnToDetailId) {
            this._openProjectDetailModal(returnToDetailId, 'invoices');
          } else {
            closeModal();
          }
        });

        modal.querySelector('#projectInvoiceForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const proj = store.getState().projects.find((p) => p.id === projSelect.value);
          if (!proj) {
            showToast('Selecione uma obra válida.', 'danger');
            return;
          }

          const nif = modal.querySelector('#invSupplierNif').value.replace(/\D/g, '');
          if (nif && !isValidNIF(nif)) {
            showToast('NIF do fornecedor inválido. Verifique os 9 dígitos.', 'danger');
            return;
          }

          const amountVal = Number(amountInput.value);
          if (Number.isNaN(amountVal) || amountVal < 0) {
            showToast('Indique um valor válido para a fatura.', 'danger');
            return;
          }

          const submitBtn = modal.querySelector('#btnSubmitInvoice');
          submitBtn.disabled = true;
          submitBtn.textContent = 'A guardar...';

          const invoiceId = generateId('FAT');
          let fileMeta = { name: '', type: '', size: 0 };
          try {
            if (selectedFile) {
              fileMeta = await saveInvoiceFile(invoiceId, selectedFile);
            }
          } catch (err) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Registar Fatura & Atualizar Saldo';
            showToast(err?.message || 'Erro ao preparar o ficheiro PDF.', 'danger');
            return;
          }

          const record = {
            id: invoiceId,
            projectId: proj.code || proj.id,
            invoiceNumber: modal.querySelector('#invNumber').value.trim(),
            supplier: modal.querySelector('#invSupplier').value.trim(),
            supplierNif: nif,
            category: modal.querySelector('#invCategory').value,
            invoiceDate: modal.querySelector('#invDate').value,
            amount: Number(amountVal.toFixed(2)),
            notes: modal.querySelector('#invNotes').value.trim(),
            fileName: fileMeta.name,
            fileType: fileMeta.type,
            fileSize: fileMeta.size,
            hasFile: Boolean(selectedFile),
            createdAt: todayISO(),
          };

          store.addProjectInvoice(record);

          const updatedSum = computeProjectInvoiceSummary(proj, store.getState().projectInvoices);
          showToast(
            `Fatura ${record.invoiceNumber} registada! Saldo disponível em ${proj.code}: ${formatCurrency(updatedSum.remainingBudget)}`
          );

          if (returnToDetailId) {
            this._openProjectDetailModal(returnToDetailId, 'invoices');
          } else {
            closeModal();
          }
        });
      },
    });
  }

  async _previewInvoiceFileById(invoiceId) {
    const record = await getProjectInvoiceFile(invoiceId);
    if (!record) return;

    const blob = new window.Blob([record.data], { type: record.type });
    const url = window.URL.createObjectURL(blob);
    const isPdf = (record.type || '').includes('pdf') || record.name.toLowerCase().endsWith('.pdf');

    openModal({
      title: `Fatura Anexada — ${record.name}`,
      subtitle: `${Math.max(1, Math.round(record.size / 1024))} KB`,
      size: 'wide',
      bodyHtml: isPdf
        ? `<iframe class="erp-attachment-preview" src="${url}" title="Pré-visualização da fatura"></iframe>`
        : `<img class="erp-attachment-img" src="${url}" alt="Fatura de obra">`,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
        <a href="${url}" download="${escapeHtml(record.name)}" class="erp-btn erp-btn--primary">${ICONS.download}<span>Descarregar</span></a>
      `,
    });
  }

  async _downloadInvoiceFileById(invoiceId) {
    const record = await getProjectInvoiceFile(invoiceId);
    if (!record) return;

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

  openNewProject(defaultStatus) {
    this._openProjectFormModal(null, defaultStatus);
  }

  _openProjectFormModal(existing, defaultStatus) {
    const state = store.getState();
    const isEdit = Boolean(existing);
    const proj = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
          code: `OB-${new Date().getFullYear()}-${String(state.projects.length + 1).padStart(3, '0')}`,
          name: '',
          type: 'Construção Civil',
          status: defaultStatus || 'em_andamento',
          priority: 'Alta',
          district: 'Porto',
          address: '',
          clientName: '',
          clientNif: '',
          clientPhone: '+351 ',
          clientEmail: '',
          managerId: state.employees[0]?.id || '',
          teamIds: state.employees[0] ? [state.employees[0].id] : [],
          startDate: todayISO(),
          expectedEndDate: '',
          actualEndDate: '',
          progress: defaultStatus === 'concluida' ? 100 : 0,
          manualBudgetCap: 0,
          description: '',
          budget: {
            vatRate: 23,
            contingencyPct: 5,
            items: [{ description: '', category: 'Mão de Obra', unit: 'vg', qty: 1, unitPrice: 0 }],
          },
          payments: [
            {
              id: generateId('PAG'),
              description: 'Adjudicação inicial',
              dueDate: todayISO(),
              paidDate: '',
              amount: 0,
              method: 'Transferência Bancária',
              status: 'em_aberto',
              invoiceRef: '',
            },
          ],
        };

    const renderBudgetRows = (items) =>
      items
        .map(
          (it, idx) => `
        <div class="erp-line-row erp-line-row--budget" data-b-idx="${idx}">
          <div class="erp-field">
            <label>Descrição do Artigo</label>
            <input type="text" data-b-field="description" value="${escapeHtml(it.description)}" placeholder="Ex.: Execução de fachada ETICS">
          </div>
          <div class="erp-field">
            <label>Categoria</label>
            <select data-b-field="category">
              ${BUDGET_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}" ${it.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
            </select>
          </div>
          <div class="erp-field">
            <label>Unidade</label>
            <input type="text" data-b-field="unit" value="${escapeHtml(it.unit)}" placeholder="m², vg...">
          </div>
          <div class="erp-field">
            <label>Qtd.</label>
            <input type="number" step="0.01" min="0" data-b-field="qty" value="${escapeHtml(it.qty)}">
          </div>
          <div class="erp-field">
            <label>Preço Unit. (€)</label>
            <input type="number" step="0.01" min="0" data-b-field="unitPrice" value="${escapeHtml(it.unitPrice)}">
          </div>
          <button type="button" class="erp-icon-btn erp-icon-btn--danger" data-b-remove="${idx}" title="Remover linha">${ICONS.trash}</button>
        </div>`
        )
        .join('');

    const renderPaymentRows = (payments) =>
      payments
        .map(
          (p, idx) => `
        <div class="erp-line-row erp-line-row--payment" data-p-idx="${idx}">
          <div class="erp-field">
            <label>Descrição / Auto</label>
            <input type="text" data-p-field="description" value="${escapeHtml(p.description)}" placeholder="Ex.: 1.º Auto de Medição">
          </div>
          <div class="erp-field">
            <label>Data Prevista</label>
            <input type="date" data-p-field="dueDate" value="${escapeHtml(p.dueDate)}">
          </div>
          <div class="erp-field">
            <label>Data Pagamento</label>
            <input type="date" data-p-field="paidDate" value="${escapeHtml(p.paidDate || '')}">
          </div>
          <div class="erp-field">
            <label>Valor (€)</label>
            <input type="number" step="0.01" min="0" data-p-field="amount" value="${escapeHtml(p.amount)}">
          </div>
          <div class="erp-field">
            <label>Estado</label>
            <select data-p-field="status">
              <option value="em_aberto" ${p.status !== 'pago' ? 'selected' : ''}>Em Aberto</option>
              <option value="pago" ${p.status === 'pago' ? 'selected' : ''}>Pago</option>
            </select>
          </div>
          <div class="erp-field">
            <label>Método / Fatura</label>
            <select data-p-field="method">
              ${PAYMENT_METHODS.map((m) => `<option value="${escapeHtml(m)}" ${p.method === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
            </select>
          </div>
          <button type="button" class="erp-icon-btn erp-icon-btn--danger" data-p-remove="${idx}" title="Remover parcela">${ICONS.trash}</button>
        </div>`
        )
        .join('');

    const bodyHtml = `
      <form id="projectForm">
        <div class="erp-form-section">
          <div class="erp-form-section__title">1. Identificação &amp; Enquadramento da Obra</div>
          <div class="erp-form-grid erp-form-grid--3">
            <div class="erp-field">
              <label for="projCode">Código da Obra *</label>
              <input type="text" id="projCode" name="code" required value="${escapeHtml(proj.code)}">
            </div>
            <div class="erp-field" style="grid-column:span 2;">
              <label for="projName">Designação da Obra *</label>
              <input type="text" id="projName" name="name" required value="${escapeHtml(proj.name)}" placeholder="Ex.: Remodelação Integral — Edifício Avenida">
            </div>
            <div class="erp-field">
              <label for="projType">Tipologia</label>
              <select id="projType" name="type">
                ${PROJECT_TYPES.map((t) => `<option value="${escapeHtml(t)}" ${proj.type === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field">
              <label for="projStatus">Estado da Obra</label>
              <select id="projStatus" name="status">
                <option value="em_andamento" ${proj.status === 'em_andamento' ? 'selected' : ''}>Em Andamento</option>
                <option value="a_iniciar" ${proj.status === 'a_iniciar' ? 'selected' : ''}>A Iniciar</option>
                <option value="concluida" ${proj.status === 'concluida' ? 'selected' : ''}>Concluída</option>
              </select>
            </div>
            <div class="erp-field">
              <label for="projProgress">Progresso Físico (%)</label>
              <input type="number" id="projProgress" name="progress" min="0" max="100" value="${escapeHtml(proj.progress)}">
            </div>
            <div class="erp-field">
              <label for="projDistrict">Distrito / Concelho</label>
              <select id="projDistrict" name="district">
                ${DISTRICTS.map((d) => `<option value="${escapeHtml(d)}" ${proj.district === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field" style="grid-column:span 2;">
              <label for="projAddress">Morada da Obra</label>
              <input type="text" id="projAddress" name="address" value="${escapeHtml(proj.address)}" placeholder="Rua, número e código postal">
            </div>
            <div class="erp-field">
              <label for="projStart">Data de Início</label>
              <input type="date" id="projStart" name="startDate" value="${escapeHtml(proj.startDate)}">
            </div>
            <div class="erp-field">
              <label for="projExpEnd">Data Prevista Conclusão</label>
              <input type="date" id="projExpEnd" name="expectedEndDate" value="${escapeHtml(proj.expectedEndDate)}">
            </div>
            <div class="erp-field">
              <label for="projActEnd">Data Real Conclusão</label>
              <input type="date" id="projActEnd" name="actualEndDate" value="${escapeHtml(proj.actualEndDate)}">
            </div>
            <div class="erp-field erp-field--full">
              <label for="projDesc">Descrição Técnica / Âmbito dos Trabalhos</label>
              <textarea id="projDesc" name="description" rows="2">${escapeHtml(proj.description)}</textarea>
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">2. Cliente &amp; Equipa Alocada</div>
          <div class="erp-form-grid erp-form-grid--3">
            <div class="erp-field">
              <label for="projClient">Nome / Entidade Cliente *</label>
              <input type="text" id="projClient" name="clientName" required value="${escapeHtml(proj.clientName)}">
            </div>
            <div class="erp-field">
              <label for="projClientNif">NIF do Cliente</label>
              <input type="text" id="projClientNif" name="clientNif" maxlength="9" value="${escapeHtml(proj.clientNif)}" placeholder="9 dígitos">
            </div>
            <div class="erp-field">
              <label for="projClientPhone">Contacto Telefónico</label>
              <input type="tel" id="projClientPhone" name="clientPhone" value="${escapeHtml(proj.clientPhone)}">
            </div>
            <div class="erp-field">
              <label for="projClientEmail">Email do Cliente</label>
              <input type="email" id="projClientEmail" name="clientEmail" value="${escapeHtml(proj.clientEmail)}">
            </div>
            <div class="erp-field">
              <label for="projManager">Responsável Técnico</label>
              <select id="projManager" name="managerId">
                <option value="">Selecionar responsável...</option>
                ${state.employees.map((e) => `<option value="${escapeHtml(e.id)}" ${proj.managerId === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field erp-field--full">
              <label>Equipa Alocada à Obra</label>
              <div class="erp-team-grid">
                ${state.employees
                  .map(
                    (e) => `
                  <label class="erp-team-chip">
                    <input type="checkbox" name="teamIds" value="${escapeHtml(e.id)}" ${(proj.teamIds || []).includes(e.id) ? 'checked' : ''}>
                    <span>${escapeHtml(e.name)}</span>
                  </label>`
                  )
                  .join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
            <div class="erp-form-section__title" style="margin-bottom:0;">3. Orçamento Detalhado da Obra</div>
            <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnAddBudgetLine">${ICONS.plus}<span>Adicionar Artigo</span></button>
          </div>
          <div class="erp-form-grid erp-form-grid--3" style="margin-bottom:12px;">
            <div class="erp-field">
              <label for="projManualCap">Orçamento Geral / Plafond (€)</label>
              <input type="number" step="0.01" min="0" id="projManualCap" name="manualBudgetCap" value="${escapeHtml(proj.manualBudgetCap || '')}" placeholder="Ex.: 100000 (opcional)">
              <span class="erp-field__hint">Se preenchido, define o teto global para abate das faturas. Caso contrário usa os artigos abaixo.</span>
            </div>
            <div class="erp-field">
              <label for="projVat">Regime de IVA (Portugal)</label>
              <select id="projVat" name="vatRate">
                <option value="23" ${Number(proj.budget?.vatRate) === 23 ? 'selected' : ''}>23% — Taxa Normal (Construção Geral)</option>
                <option value="6" ${Number(proj.budget?.vatRate) === 6 ? 'selected' : ''}>6% — Taxa Reduzida (Reabilitação Urbana / ARU)</option>
                <option value="0" ${Number(proj.budget?.vatRate) === 0 ? 'selected' : ''}>0% — Autoliquidação / Isento (Art. 2.º CIVA)</option>
              </select>
            </div>
            <div class="erp-field">
              <label for="projCont">Margem de Contingência (%)</label>
              <input type="number" step="0.5" min="0" max="50" id="projCont" name="contingencyPct" value="${escapeHtml(proj.budget?.contingencyPct ?? 0)}">
            </div>
          </div>
          <div class="erp-line-list" id="budgetLinesContainer">${renderBudgetRows(proj.budget.items)}</div>
          <div class="erp-summary-box" style="margin-top:12px;">
            <div><div class="erp-summary-item__label">Subtotal Artigos</div><div class="erp-summary-item__val" id="formBudSub">€0,00</div></div>
            <div><div class="erp-summary-item__label">Contingência</div><div class="erp-summary-item__val" id="formBudCont">€0,00</div></div>
            <div><div class="erp-summary-item__label">IVA</div><div class="erp-summary-item__val" id="formBudVat">€0,00</div></div>
            <div><div class="erp-summary-item__label">Total Orçamentado c/ IVA</div><div class="erp-summary-item__val erp-summary-item__val--accent" id="formBudGross">€0,00</div></div>
          </div>
        </div>

        <div class="erp-form-section">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
            <div class="erp-form-section__title" style="margin-bottom:0;">4. Plano &amp; Datas de Pagamento da Obra</div>
            <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnAddPayLine">${ICONS.plus}<span>Adicionar Parcela</span></button>
          </div>
          <div class="erp-line-list" id="paymentLinesContainer">${renderPaymentRows(proj.payments)}</div>
          <div class="erp-summary-box" style="margin-top:12px;">
            <div><div class="erp-summary-item__label">Total Orçamentado</div><div class="erp-summary-item__val" id="formPayContract">€0,00</div></div>
            <div><div class="erp-summary-item__label">Total Pago</div><div class="erp-summary-item__val erp-summary-item__val--success" id="formPayPaid">€0,00</div></div>
            <div><div class="erp-summary-item__label">Saldo em Aberto</div><div class="erp-summary-item__val erp-summary-item__val--danger" id="formPayOpen">€0,00</div></div>
            <div><div class="erp-summary-item__label">Parcelas Lançadas</div><div class="erp-summary-item__val" id="formPayCount">0</div></div>
          </div>
        </div>
      </form>
    `;

    openModal({
      title: isEdit ? `Editar Obra — ${proj.code}` : 'Cadastrar Nova Obra & Orçamento',
      subtitle: 'Formulário operacional completo Spark & Smirk, Lda.',
      size: 'wide',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="projectForm" class="erp-btn erp-btn--primary">${isEdit ? 'Guardar Alterações' : 'Registar Obra'}</button>
      `,
      onMount: (modal) => {
        const budWrap = modal.querySelector('#budgetLinesContainer');
        const payWrap = modal.querySelector('#paymentLinesContainer');
        const vatSelect = modal.querySelector('#projVat');
        const contInput = modal.querySelector('#projCont');
        const capInput = modal.querySelector('#projManualCap');

        const syncBudgetFromDOM = () => {
          const rows = [...budWrap.querySelectorAll('[data-b-idx]')];
          proj.budget.items = rows.map((row) => ({
            description: row.querySelector('[data-b-field="description"]').value,
            category: row.querySelector('[data-b-field="category"]').value,
            unit: row.querySelector('[data-b-field="unit"]').value,
            qty: Number(row.querySelector('[data-b-field="qty"]').value) || 0,
            unitPrice: Number(row.querySelector('[data-b-field="unitPrice"]').value) || 0,
          }));
          proj.budget.vatRate = Number(vatSelect.value);
          proj.budget.contingencyPct = Number(contInput.value) || 0;
        };

        const syncPaymentsFromDOM = () => {
          const rows = [...payWrap.querySelectorAll('[data-p-idx]')];
          proj.payments = rows.map((row, i) => ({
            id: proj.payments[i]?.id || generateId('PAG'),
            description: row.querySelector('[data-p-field="description"]').value,
            dueDate: row.querySelector('[data-p-field="dueDate"]').value,
            paidDate: row.querySelector('[data-p-field="paidDate"]').value,
            amount: Number(row.querySelector('[data-p-field="amount"]').value) || 0,
            status: row.querySelector('[data-p-field="status"]').value,
            method: row.querySelector('[data-p-field="method"]').value,
            invoiceRef: proj.payments[i]?.invoiceRef || '',
          }));
        };

        const updateSummaries = () => {
          syncBudgetFromDOM();
          syncPaymentsFromDOM();
          const t = computeBudgetTotals(proj.budget);
          const manualCap = Math.max(0, Number(capInput?.value) || 0);
          const paid = proj.payments.filter((p) => p.status === 'pago').reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const effectiveBudget = manualCap > 0 ? manualCap : t.grossTotal;
          const contract = effectiveBudget > 0 ? effectiveBudget : proj.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const open = Math.max(0, contract - paid);

          modal.querySelector('#formBudSub').textContent = formatCurrency(t.subtotal);
          modal.querySelector('#formBudCont').textContent = formatCurrency(t.contingencyVal);
          modal.querySelector('#formBudVat').textContent = formatCurrency(t.vatVal);
          modal.querySelector('#formBudGross').textContent = formatCurrency(manualCap > 0 ? manualCap : t.grossTotal);

          modal.querySelector('#formPayContract').textContent = formatCurrency(contract);
          modal.querySelector('#formPayPaid').textContent = formatCurrency(paid);
          modal.querySelector('#formPayOpen').textContent = formatCurrency(open);
          modal.querySelector('#formPayCount').textContent = String(proj.payments.length);
        };

        capInput?.addEventListener('input', updateSummaries);

        const bindBudgetEvents = () => {
          budWrap.querySelectorAll('input, select').forEach((el) => {
            el.addEventListener('input', updateSummaries);
          });
          budWrap.querySelectorAll('[data-b-remove]').forEach((btn) => {
            btn.addEventListener('click', () => {
              syncBudgetFromDOM();
              if (proj.budget.items.length <= 1) {
                showToast('O orçamento deve manter pelo menos 1 linha.', 'danger');
                return;
              }
              proj.budget.items.splice(Number(btn.dataset.bRemove), 1);
              budWrap.innerHTML = renderBudgetRows(proj.budget.items);
              bindBudgetEvents();
              updateSummaries();
            });
          });
        };

        const bindPaymentEvents = () => {
          payWrap.querySelectorAll('input, select').forEach((el) => {
            el.addEventListener('input', updateSummaries);
            el.addEventListener('change', updateSummaries);
          });
          payWrap.querySelectorAll('[data-p-remove]').forEach((btn) => {
            btn.addEventListener('click', () => {
              syncPaymentsFromDOM();
              proj.payments.splice(Number(btn.dataset.pRemove), 1);
              payWrap.innerHTML = renderPaymentRows(proj.payments);
              bindPaymentEvents();
              updateSummaries();
            });
          });
        };

        modal.querySelector('#btnAddBudgetLine').addEventListener('click', () => {
          syncBudgetFromDOM();
          proj.budget.items.push({ description: '', category: 'Materiais', unit: 'vg', qty: 1, unitPrice: 0 });
          budWrap.innerHTML = renderBudgetRows(proj.budget.items);
          bindBudgetEvents();
          updateSummaries();
        });

        modal.querySelector('#btnAddPayLine').addEventListener('click', () => {
          syncPaymentsFromDOM();
          proj.payments.push({
            id: generateId('PAG'),
            description: `${proj.payments.length + 1}.ª Prestação`,
            dueDate: todayISO(),
            paidDate: '',
            amount: 0,
            method: 'Transferência Bancária',
            status: 'em_aberto',
            invoiceRef: '',
          });
          payWrap.innerHTML = renderPaymentRows(proj.payments);
          bindPaymentEvents();
          updateSummaries();
        });

        vatSelect.addEventListener('change', updateSummaries);
        contInput.addEventListener('input', updateSummaries);
        bindBudgetEvents();
        bindPaymentEvents();
        updateSummaries();

        const form = modal.querySelector('#projectForm');
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          syncBudgetFromDOM();
          syncPaymentsFromDOM();

          const nifVal = modal.querySelector('#projClientNif').value.replace(/\D/g, '');
          if (nifVal && !isValidNIF(nifVal)) {
            showToast('NIF do cliente inválido. Verifique os 9 dígitos.', 'danger');
            return;
          }

          const checkedTeam = [...modal.querySelectorAll('input[name="teamIds"]:checked')].map((c) => c.value);
          const statusVal = modal.querySelector('#projStatus').value;
          const progressVal = statusVal === 'concluida' ? 100 : Math.min(100, Math.max(0, Number(modal.querySelector('#projProgress').value) || 0));

          const payload = {
            code: modal.querySelector('#projCode').value.trim(),
            name: modal.querySelector('#projName').value.trim(),
            type: modal.querySelector('#projType').value,
            status: statusVal,
            priority: existing?.priority || 'Alta',
            district: modal.querySelector('#projDistrict').value,
            address: modal.querySelector('#projAddress').value.trim(),
            startDate: modal.querySelector('#projStart').value,
            expectedEndDate: modal.querySelector('#projExpEnd').value,
            actualEndDate: modal.querySelector('#projActEnd').value,
            progress: progressVal,
            description: modal.querySelector('#projDesc').value.trim(),
            clientName: modal.querySelector('#projClient').value.trim(),
            clientNif: nifVal,
            clientPhone: modal.querySelector('#projClientPhone').value.trim(),
            clientEmail: modal.querySelector('#projClientEmail').value.trim(),
            managerId: modal.querySelector('#projManager').value,
            teamIds: checkedTeam,
            manualBudgetCap: Math.max(0, Number(modal.querySelector('#projManualCap').value) || 0),
            budget: proj.budget,
            payments: proj.payments,
          };

          if (isEdit) {
            store.updateProject(proj.id, payload);
            showToast(`Obra ${payload.code} atualizada.`);
          } else {
            store.addProject({ id: generateId('OB'), ...payload });
            showToast(`Obra ${payload.code} registada com sucesso.`);
          }
          closeModal();
        });
      },
    });
  }
}
