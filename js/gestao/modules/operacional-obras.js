/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Operacional: Obras, Orçamentos & Pagamentos
   ═══════════════════════════════════════════════════════════ */

import {
  store,
  saveInvoiceFile,
  getProjectInvoiceFile,
  saveContractFile,
  getProjectContractFile,
} from '../core/store.js';
import {
  computeBudgetTotals,
  computeProjectFinancials,
  computeProjectInvoiceSummary,
  escapeHtml,
  formatCurrency,
  formatDatePT,
  generateId,
  isValidNIF,
  parseCurrencyInput,
  todayISO,
} from '../core/formatters.js';
import {
  ICONS,
  openModal,
  closeModal,
  confirmAction,
  showToast,
  showBalanceNotification,
  attachEuroMasks,
} from '../core/ui.js';

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
    const canSeeValues = this._can('op_obras', 'valores');
    const canInvoices = canSeeValues && this._can('op_obras', 'faturas');
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
    let totalContractsCount = 0;

    filtered.forEach((proj) => {
      const invSum = computeProjectInvoiceSummary(proj, state.projectInvoices);
      const projRefs = new Set([proj.id, proj.code].filter(Boolean));
      totalContractsCount += (state.projectContracts || []).filter((c) => projRefs.has(c.projectId)).length;
      if (canSeeValues) {
        totalBudgetPool += invSum.budgetTotal;
        totalInvoiced += invSum.spentOnInvoices;
        if (invSum.isOverBudget) overBudgetCount += 1;
      }
      totalInvoicesCount += invSum.invoiceCount;
    });

    const avgProgress = filtered.length
      ? Math.round(filtered.reduce((s, p) => s + (Number(p.progress) || 0), 0) / filtered.length)
      : 0;
    const totalBudgetRemaining = totalBudgetPool - totalInvoiced;
    const empMap = new Map(state.employees.map((e) => [e.id, e]));
    const techMap = new Map((state.technicalManagers || []).map((t) => [t.id, t]));
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

        ${
          canSeeValues
            ? `<div class="erp-kpi-card">
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
               </div>`
            : `<div class="erp-kpi-card">
                 <div class="erp-kpi-card__head">
                   <span class="erp-kpi-card__label">Progresso Médio</span>
                   <span class="erp-kpi-card__icon">${ICONS.chart}</span>
                 </div>
                 <div class="erp-kpi-card__value">${avgProgress}%</div>
                 <div class="erp-kpi-card__meta">Execução física das empreitadas</div>
               </div>

               <div class="erp-kpi-card">
                 <div class="erp-kpi-card__head">
                   <span class="erp-kpi-card__label">Documentos &amp; Contratos</span>
                   <span class="erp-kpi-card__icon">${ICONS.paperclip}</span>
                 </div>
                 <div class="erp-kpi-card__value">${totalContractsCount}</div>
                 <div class="erp-kpi-card__meta">Contratos PDF arquivados</div>
               </div>

               <div class="erp-kpi-card">
                 <div class="erp-kpi-card__head">
                   <span class="erp-kpi-card__label">Saldos &amp; Valores (€)</span>
                   <span class="erp-kpi-card__icon">${ICONS.alert}</span>
                 </div>
                 <div class="erp-kpi-card__value" style="font-size:18px;">Restrito</div>
                 <div class="erp-kpi-card__meta">Valores ocultos para este perfil</div>
               </div>`
        }
      </div>

      <div class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h2 class="erp-panel__title">Gestão Operacional — Obras ${escapeHtml(statusInfo.label)}</h2>
            <p class="erp-panel__desc">${canSeeValues ? 'Orçamentos, faturas de compra de materiais (PDF), saldo restante em tempo real e recebimentos.' : 'Acompanhamento técnico, equipas, contratos PDF e prazos das obras.'}</p>
          </div>
          <div class="erp-panel__actions">
            <select class="erp-select-sm" id="filterProjectType">
              <option value="all">Todas as Tipologias</option>
              ${PROJECT_TYPES.map((t) => `<option value="${escapeHtml(t)}" ${this.typeFilter === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
            </select>
            ${
              canInvoices && state.projects.length > 0
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
                    <span>${canSeeValues ? 'Nova Obra &amp; Orçamento' : 'Nova Obra'}</span>
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
                  ${canSeeValues ? '<th>Orçamento Geral</th><th>Faturas / Materiais</th><th>Saldo Disponível (Real Time)</th>' : '<th>Documentos</th>'}
                  <th style="text-align:right">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${filtered
                  .map((proj) => {
                    const fin = computeProjectFinancials(proj);
                    const invSum = computeProjectInvoiceSummary(proj, state.projectInvoices);
                    const projRefs = new Set([proj.id, proj.code].filter(Boolean));
                    const contractsCount = (state.projectContracts || []).filter((c) => projRefs.has(c.projectId)).length;
                    const isLaborOnly = proj.costRegime === 'somente_funcionarios';
                    const dailyRate = Number(proj.dailyRatePerWorker) || 0;
                    const mgr = techMap.get(proj.managerId) || empMap.get(proj.managerId);
                    const barWidth = Math.min(100, Math.max(0, invSum.spentPct));
                    const barClass = invSum.isOverBudget
                      ? 'erp-budget-meter__fill--danger'
                      : invSum.isWarningBudget
                        ? 'erp-budget-meter__fill--warning'
                        : '';
                    return `
                    <tr class="erp-proj-row" data-proj-row="${escapeHtml(proj.id)}" title="Clique para consultar os registos desta obra">
                      <td>
                        <div class="erp-cell-title">${escapeHtml(proj.name)}</div>
                        <div class="erp-cell-sub">${escapeHtml(proj.code)} · ${escapeHtml(proj.type)} · ${escapeHtml(proj.district)}</div>
                        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px;">
                          <span class="erp-badge ${isLaborOnly ? 'erp-badge--info' : 'erp-badge--neutral'}">
                            ${isLaborOnly ? 'Somente Funcionários' : 'Materiais &amp; Funcionários'}${canSeeValues && dailyRate > 0 ? ` · ${escapeHtml(formatCurrency(dailyRate))}/dia` : ''}
                          </span>
                          ${contractsCount > 0 ? `<span class="erp-badge erp-badge--neutral">${contractsCount} contrato(s) PDF</span>` : ''}
                        </div>
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
                      ${
                        canSeeValues
                          ? `<td>
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
                             </td>`
                          : `<td>
                               <div class="erp-cell-title">${contractsCount} contrato(s) PDF</div>
                               <div class="erp-cell-sub">Valores financeiros ocultos (€)</div>
                             </td>`
                      }
                      <td>
                        <div class="erp-row-actions">
                          ${canInvoices ? `<button type="button" class="erp-icon-btn" title="Lançar Fatura de Compra (PDF)" data-proj-invoice="${escapeHtml(proj.id)}">${ICONS.receipt}</button>` : ''}
                          <button type="button" class="erp-icon-btn" title="${canSeeValues ? 'Ver Faturas, Orçamento &amp; Saldo' : 'Ver Ficha Técnica e Contratos'}" data-proj-view="${escapeHtml(proj.id)}">${ICONS.eye}</button>
                          ${!this._can || this._can('op_obras', 'editar') ? `<button type="button" class="erp-icon-btn" title="Editar Obra" data-proj-edit="${escapeHtml(proj.id)}">${ICONS.edit}</button>` : ''}
                          ${!this._can || this._can('op_obras', 'excluir') ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" title="Excluir Obra" data-proj-del="${escapeHtml(proj.id)}">${ICONS.trash}</button>` : ''}
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

    container.querySelectorAll('[data-proj-row]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.erp-row-actions, button, a')) return;
        this._openProjectHubPopup(row.dataset.projRow);
      });
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

  _openProjectHubPopup(projectId) {
    const canSeeValues = !this._can || this._can('op_obras', 'valores');
    const state = store.getState();
    const proj = state.projects.find((p) => p.id === projectId);
    if (!proj) return;

    const invSum = computeProjectInvoiceSummary(proj, state.projectInvoices);
    const projRefs = new Set([proj.id, proj.code].filter(Boolean));
    const projContracts = (state.projectContracts || []).filter((c) => projRefs.has(c.projectId));
    const isLaborOnly = proj.costRegime === 'somente_funcionarios';
    const dailyRate = Number(proj.dailyRatePerWorker) || 0;

    openModal({
      title: `${proj.code} — ${proj.name}`,
      subtitle: `${isLaborOnly ? 'Somente Funcionários' : 'Materiais & Funcionários'}${canSeeValues && dailyRate > 0 ? ` · Diária/Func.: ${formatCurrency(dailyRate)}` : ''} · Cliente: ${proj.clientName}`,
      bodyHtml: `
        ${
          canSeeValues
            ? `<div class="erp-summary-box" style="margin-bottom:10px;">
                 <div>
                   <div class="erp-summary-item__label">Orçamento Geral</div>
                   <div class="erp-summary-item__val">${escapeHtml(formatCurrency(invSum.budgetTotal))}</div>
                 </div>
                 <div>
                   <div class="erp-summary-item__label">Total em Faturas</div>
                   <div class="erp-summary-item__val erp-summary-item__val--warning">${escapeHtml(formatCurrency(invSum.spentOnInvoices))}</div>
                 </div>
                 <div>
                   <div class="erp-summary-item__label">Saldo Disponível</div>
                   <div class="erp-summary-item__val ${invSum.isOverBudget ? 'erp-summary-item__val--danger' : 'erp-summary-item__val--success'}">${escapeHtml(formatCurrency(invSum.remainingBudget))}</div>
                 </div>
                 <div>
                   <div class="erp-summary-item__label">Diária por Func.</div>
                   <div class="erp-summary-item__val">${dailyRate > 0 ? escapeHtml(formatCurrency(dailyRate)) : '—'}</div>
                 </div>
               </div>`
            : `<div class="erp-inline-invoice-box" style="margin-bottom:10px;">
                 <strong>Valores financeiros e saldos ocultos para este perfil</strong>
                 <div class="erp-cell-sub">Progresso físico: ${Number(proj.progress) || 0}% · Contratos PDF: ${projContracts.length}</div>
               </div>`
        }

        <p style="font-size:13px;color:var(--erp-text-secondary);margin-bottom:4px;">Selecione o que pretende consultar ou gerir nesta obra:</p>

        <div class="erp-hub-choices">
          ${
            canSeeValues
              ? `<button type="button" class="erp-hub-card" data-hub-choice="invoices">
                   <span class="erp-hub-card__icon">${ICONS.receipt}</span>
                   <span class="erp-hub-card__title">Faturas (${invSum.invoiceCount})</span>
                   <span class="erp-hub-card__meta">Ver todas as faturas lançadas na obra, visualizar PDFs, lançar novas faturas e acompanhar o saldo em tempo real.</span>
                 </button>`
              : `<button type="button" class="erp-hub-card" data-hub-choice="overview">
                   <span class="erp-hub-card__icon">${ICONS.building}</span>
                   <span class="erp-hub-card__title">Dados Técnicos &amp; Equipa</span>
                   <span class="erp-hub-card__meta">Consultar prazos, localização, responsável técnico e colaboradores alocados à obra.</span>
                 </button>`
          }

          <button type="button" class="erp-hub-card" data-hub-choice="contracts">
            <span class="erp-hub-card__icon">${ICONS.paperclip}</span>
            <span class="erp-hub-card__title">Contratos (${projContracts.length})</span>
            <span class="erp-hub-card__meta">Ver os contratos em PDF anexados a esta obra, descarregar ou adicionar novos documentos contratuais.</span>
          </button>
        </div>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" id="btnHubOverview">${ICONS.eye}<span>${canSeeValues ? 'Dados Técnicos &amp; Orçamento' : 'Dados Técnicos'}</span></button>
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
      `,
      onMount: (modal) => {
        modal.querySelector('[data-hub-choice="invoices"]')?.addEventListener('click', () => {
          this._openProjectDetailModal(proj.id, 'invoices');
        });
        modal.querySelector('[data-hub-choice="contracts"]')?.addEventListener('click', () => {
          this._openProjectDetailModal(proj.id, 'contracts');
        });
        modal.querySelector('[data-hub-choice="overview"]')?.addEventListener('click', () => {
          this._openProjectDetailModal(proj.id, 'overview');
        });
        modal.querySelector('#btnHubOverview')?.addEventListener('click', () => {
          this._openProjectDetailModal(proj.id, 'overview');
        });
      },
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
    const techMap = new Map((state.technicalManagers || []).map((t) => [t.id, t]));
    const fin = computeProjectFinancials(proj);
    const invSum = computeProjectInvoiceSummary(proj, state.projectInvoices);
    const projRefs = new Set([proj.id, proj.code].filter(Boolean));
    const projContracts = (state.projectContracts || []).filter((c) => projRefs.has(c.projectId));
    const statusInfo = STATUS_META[proj.status] || STATUS_META.em_andamento;
    const today = todayISO();

    const canSeeValues = !this._can || this._can('op_obras', 'valores');
    const canBudget = canSeeValues && (!this._can || this._can('op_obras', 'orcamentos'));
    const canPayments = canSeeValues && (!this._can || this._can('op_obras', 'pagamentos'));
    const canInvoices = canSeeValues && (!this._can || this._can('op_obras', 'faturas'));
    const canEditProj = !this._can || this._can('op_obras', 'editar') || (!this._can || this._can('op_obras', 'criar'));
    const canDeleteInvoice = canSeeValues && (!this._can || this._can('op_obras', 'excluir') || canInvoices);
    const canDeleteContract = !this._can || this._can('op_obras', 'excluir') || canEditProj;

    const activeTab =
      initialTab === 'invoices' && !canSeeValues
        ? 'overview'
        : initialTab === 'budget' && !canBudget
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
    const isLaborOnly = proj.costRegime === 'somente_funcionarios';
    const dailyRate = Number(proj.dailyRatePerWorker) || 0;

    const bodyHtml = `
      ${
        canSeeValues
          ? `<div class="erp-summary-box" style="margin-bottom:18px;">
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
                 <div class="erp-summary-item__label">${dailyRate > 0 ? 'Diária por Funcionário' : 'Recebido Cliente'}</div>
                 <div class="erp-summary-item__val erp-summary-item__val--accent">${dailyRate > 0 ? `${escapeHtml(formatCurrency(dailyRate))}/dia` : `${escapeHtml(formatCurrency(fin.paidAmount))} (${fin.paidPct}%)`}</div>
               </div>
             </div>`
          : `<div class="erp-inline-invoice-box" style="margin-bottom:18px;">
               <strong>Valores financeiros, orçamentos e saldos ocultos para este perfil</strong>
               <div class="erp-cell-sub">Modalidade: ${isLaborOnly ? 'Somente Funcionários' : 'Materiais e Funcionários'} · Progresso: ${Number(proj.progress) || 0}%</div>
             </div>`
      }

      <div class="erp-detail-tabs">
        <button type="button" class="erp-detail-tab ${activeTab === 'overview' ? 'is-active' : ''}" data-det-tab="overview">Dados Técnicos &amp; Equipa</button>
        ${canSeeValues ? `<button type="button" class="erp-detail-tab ${activeTab === 'invoices' ? 'is-active' : ''}" data-det-tab="invoices">Faturas &amp; Materiais (${invSum.invoiceCount})</button>` : ''}
        <button type="button" class="erp-detail-tab ${activeTab === 'contracts' ? 'is-active' : ''}" data-det-tab="contracts">Contratos PDF (${projContracts.length})</button>
        ${canBudget ? `<button type="button" class="erp-detail-tab ${activeTab === 'budget' ? 'is-active' : ''}" data-det-tab="budget">Orçamento Detalhado (${proj.budget?.items?.length || 0})</button>` : ''}
        ${canPayments ? `<button type="button" class="erp-detail-tab ${activeTab === 'payments' ? 'is-active' : ''}" data-det-tab="payments">Recebimentos Cliente (${proj.payments?.length || 0})</button>` : ''}
      </div>

      <div id="detPaneOverview" style="display:${activeTab === 'overview' ? 'block' : 'none'};">
        <div style="margin-bottom:12px;">
          <span class="erp-badge ${isLaborOnly ? 'erp-badge--info' : 'erp-badge--neutral'}">
            Modalidade: ${isLaborOnly ? 'Somente Funcionários (Mão de Obra à Diária)' : 'Materiais e Funcionários'}
          </span>
          ${canSeeValues && dailyRate > 0 ? `<span class="erp-badge erp-badge--success" style="margin-left:6px;">Valor Diário/Func.: ${escapeHtml(formatCurrency(dailyRate))} (${(proj.teamIds || []).length} alocado(s) = ${escapeHtml(formatCurrency(dailyRate * (proj.teamIds || []).length))}/dia)</span>` : ''}
        </div>
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
            <div class="erp-cell-title">${escapeHtml((techMap.get(proj.managerId) || empMap.get(proj.managerId))?.name || 'Não atribuído')}</div>
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

      <div id="detPaneContracts" style="display:${activeTab === 'contracts' ? 'block' : 'none'};">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <span class="erp-cell-sub">Contratos adjudicados e documentos em PDF associados à obra ${escapeHtml(proj.code)}.</span>
          ${
            canEditProj
              ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" id="btnDetAddContract">
                  ${ICONS.plus}<span>Anexar Contrato (PDF)</span>
                </button>`
              : ''
          }
        </div>
        ${
          projContracts.length === 0
            ? `<div class="erp-empty" style="padding:28px 16px;">${ICONS.paperclip}<div class="erp-empty__title">Nenhum contrato PDF anexado</div><p>Anexe o contrato da obra ao criar/editar ou clicando em "Anexar Contrato (PDF)".</p></div>`
            : `
          <div class="erp-table-wrap">
            <table class="erp-table">
              <thead>
                <tr>
                  <th>Data / Referência</th>
                  <th>Título do Contrato</th>
                  <th>Ficheiro PDF</th>
                  <th style="text-align:right">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${projContracts
                  .map(
                    (ctr) => `
                  <tr>
                    <td>
                      <div class="erp-cell-title">${escapeHtml(ctr.contractNumber || ctr.id)}</div>
                      <div class="erp-cell-sub">${escapeHtml(formatDatePT(ctr.contractDate))}</div>
                    </td>
                    <td>
                      <div class="erp-cell-title">${escapeHtml(ctr.title)}</div>
                      <div class="erp-cell-sub">${escapeHtml(ctr.notes || 'Contrato da empreitada')}</div>
                    </td>
                    <td>
                      ${
                        ctr.hasFile
                          ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                              <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-ctr-view="${escapeHtml(ctr.id)}">${ICONS.eye}<span>Ver PDF</span></button>
                              <button type="button" class="erp-icon-btn" data-ctr-dl="${escapeHtml(ctr.id)}" title="Descarregar Contrato">${ICONS.download}</button>
                            </div>`
                          : '<span class="erp-badge erp-badge--neutral">Sem PDF</span>'
                      }
                    </td>
                    <td style="text-align:right">
                      <div class="erp-row-actions">
                        ${canDeleteContract ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" title="Remover Contrato" data-ctr-del="${escapeHtml(ctr.id)}">${ICONS.trash}</button>` : '—'}
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
    `;

    openModal({
      title: `${proj.code} — ${proj.name}`,
      subtitle: `${statusInfo.label} · ${proj.type}`,
      size: 'wide',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
        ${!this._can || this._can('op_obras', 'editar') ? `<button type="button" class="erp-btn erp-btn--primary" id="btnDetEdit">${ICONS.edit}<span>${canSeeValues ? 'Editar Obra &amp; Orçamento' : 'Editar Obra'}</span></button>` : ''}
      `,
      onMount: (modal) => {
        const panes = {
          overview: modal.querySelector('#detPaneOverview'),
          invoices: modal.querySelector('#detPaneInvoices'),
          contracts: modal.querySelector('#detPaneContracts'),
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

        modal.querySelector('#btnDetAddContract')?.addEventListener('click', () => {
          this.openLaunchContractModal(proj.id, proj.id);
        });

        modal.querySelectorAll('[data-ctr-view]').forEach((btn) => {
          btn.addEventListener('click', () => this._previewContractFileById(btn.dataset.ctrView));
        });

        modal.querySelectorAll('[data-ctr-dl]').forEach((btn) => {
          btn.addEventListener('click', () => this._downloadContractFileById(btn.dataset.ctrDl));
        });

        modal.querySelectorAll('[data-ctr-del]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const ctr = projContracts.find((c) => c.id === btn.dataset.ctrDel);
            if (!ctr) return;
            confirmAction({
              title: 'Remover Contrato da Obra',
              message: `Tem a certeza de que pretende eliminar o contrato "${ctr.title}"?`,
              onConfirm: () => {
                store.deleteProjectContract(ctr.id);
                showToast('Contrato removido.');
                this._openProjectDetailModal(proj.id, 'contracts');
              },
            });
          });
        });
      },
    });
  }

  openLaunchContractModal(defaultProjectId = null, returnToDetailId = null) {
    const state = store.getState();
    const proj = state.projects.find((p) => p.id === defaultProjectId || p.code === defaultProjectId) || state.projects[0];
    if (!proj) {
      showToast('Cadastre primeiro uma obra antes de anexar contratos.', 'warning');
      return;
    }

    let selectedFile = null;

    openModal({
      title: 'Anexar Contrato da Obra (PDF)',
      subtitle: `${proj.code} — ${proj.name}`,
      bodyHtml: `
        <form id="projectContractForm">
          <div class="erp-form-grid">
            <div class="erp-field erp-field--full">
              <label for="ctrTitle">Título do Contrato *</label>
              <input type="text" id="ctrTitle" required placeholder="Ex.: Contrato de Empreitada Geral / Subempreitada Mão de Obra">
            </div>
            <div class="erp-field">
              <label for="ctrNumber">N.º / Referência</label>
              <input type="text" id="ctrNumber" placeholder="Ex.: CTR-2026/001">
            </div>
            <div class="erp-field">
              <label for="ctrDate">Data do Contrato</label>
              <input type="date" id="ctrDate" value="${todayISO()}">
            </div>
            <div class="erp-field erp-field--full">
              <label for="ctrNotes">Observações</label>
              <input type="text" id="ctrNotes" placeholder="Ex.: Condições de diária, prazo ou cláusulas principais">
            </div>
            <div class="erp-field erp-field--full">
              <label>Ficheiro do Contrato (PDF ou Imagem até 10 MB) *</label>
              <div class="erp-dropzone" id="ctrDropzone">
                <input type="file" id="ctrFileInput" accept=".pdf,image/*" style="display:none;">
                <div class="erp-dropzone__title" id="ctrDropTitle">Clique para selecionar ou arraste o PDF do contrato</div>
                <div class="erp-dropzone__hint">Formatos aceites: PDF, PNG, JPG, WEBP</div>
              </div>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" id="btnCancelContract">Cancelar</button>
        <button type="submit" form="projectContractForm" class="erp-btn erp-btn--primary" id="btnSubmitContract">${ICONS.plus}<span>Guardar Contrato PDF</span></button>
      `,
      onMount: (modal) => {
        const dropzone = modal.querySelector('#ctrDropzone');
        const fileInput = modal.querySelector('#ctrFileInput');
        const dropTitle = modal.querySelector('#ctrDropTitle');

        const handleFile = (f) => {
          if (!f) return;
          if (f.size > 10 * 1024 * 1024) {
            showToast('O ficheiro do contrato excede o limite de 10 MB.', 'danger');
            return;
          }
          selectedFile = f;
          dropTitle.textContent = `Selecionado: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`;
        };

        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => handleFile(e.target.files?.[0]));
        dropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropzone.classList.add('is-dragover');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
        dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('is-dragover');
          handleFile(e.dataTransfer?.files?.[0]);
        });

        modal.querySelector('#btnCancelContract').addEventListener('click', () => {
          if (returnToDetailId) {
            this._openProjectDetailModal(returnToDetailId, 'contracts');
          } else {
            closeModal();
          }
        });

        modal.querySelector('#projectContractForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!selectedFile) {
            showToast('Anexe o ficheiro PDF do contrato antes de guardar.', 'danger');
            return;
          }
          const btn = modal.querySelector('#btnSubmitContract');
          btn.disabled = true;
          btn.textContent = 'A guardar...';

          const contractId = generateId('CTR');
          let meta;
          try {
            meta = await saveContractFile(contractId, selectedFile);
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Guardar Contrato PDF';
            showToast(err?.message || 'Erro ao preparar o ficheiro do contrato.', 'danger');
            return;
          }

          await store.addProjectContract({
            id: contractId,
            projectId: proj.code || proj.id,
            title: modal.querySelector('#ctrTitle').value.trim(),
            contractNumber: modal.querySelector('#ctrNumber').value.trim(),
            contractDate: modal.querySelector('#ctrDate').value || todayISO(),
            notes: modal.querySelector('#ctrNotes').value.trim(),
            fileName: meta.name,
            fileType: meta.type,
            fileSize: meta.size,
            hasFile: true,
            createdAt: todayISO(),
          });

          showToast(`Contrato "${modal.querySelector('#ctrTitle').value.trim()}" anexado à obra ${proj.code}.`);
          if (returnToDetailId) {
            this._openProjectDetailModal(returnToDetailId, 'contracts');
          } else {
            closeModal();
          }
        });
      },
    });
  }

  async _previewContractFileById(contractId) {
    const record = await getProjectContractFile(contractId);
    if (!record) return;

    const blob = new window.Blob([record.data], { type: record.type });
    const url = window.URL.createObjectURL(blob);
    const isPdf = (record.type || '').includes('pdf') || record.name.toLowerCase().endsWith('.pdf');

    openModal({
      title: `Contrato da Obra — ${record.name}`,
      subtitle: `${Math.max(1, Math.round(record.size / 1024))} KB`,
      size: 'wide',
      bodyHtml: isPdf
        ? `<iframe class="erp-attachment-preview" src="${url}" title="Pré-visualização do contrato"></iframe>`
        : `<img class="erp-attachment-img" src="${url}" alt="Contrato da obra">`,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
        <a href="${url}" download="${escapeHtml(record.name)}" class="erp-btn erp-btn--primary">${ICONS.download}<span>Descarregar Contrato</span></a>
      `,
    });
  }

  async _downloadContractFileById(contractId) {
    const record = await getProjectContractFile(contractId);
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

  openLaunchInvoiceModal(defaultProjectId = null, returnToDetailId = null) {
    if (this._can && (!this._can('op_obras', 'valores') || !this._can('op_obras', 'faturas'))) {
      showToast('Sem permissão para lançar ou visualizar valores de faturas.', 'warning');
      return;
    }
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
              <input type="text" inputmode="numeric" data-currency-euro id="invAmount" required placeholder="€ 0,00">
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
          const newAmt = Math.max(0, parseCurrencyInput(amountInput.value));
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

          const amountVal = parseCurrencyInput(amountInput.value);
          if (Number.isNaN(amountVal) || amountVal <= 0) {
            showToast('Indique um valor válido superior a € 0,00 para a fatura.', 'danger');
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
          showBalanceNotification({
            projectLabel: `${proj.code} — ${proj.name}`,
            invoiceNumber: record.invoiceNumber,
            invoiceAmount: record.amount,
            remainingBudget: updatedSum.remainingBudget,
            budgetTotal: updatedSum.budgetTotal,
          });

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
    const canSeeValues = !this._can || this._can('op_obras', 'valores');
    const canManageBudget = canSeeValues && (!this._can || this._can('op_obras', 'orcamentos'));
    const canManagePayments = canSeeValues && (!this._can || this._can('op_obras', 'pagamentos'));
    const canManageInvoices = canSeeValues && (!this._can || this._can('op_obras', 'faturas'));
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
          managerId: (state.technicalManagers || []).find((t) => t.status === 'ativo')?.id || '',
          teamIds: state.employees[0] ? [state.employees[0].id] : [],
          startDate: todayISO(),
          expectedEndDate: '',
          actualEndDate: '',
          progress: defaultStatus === 'concluida' ? 100 : 0,
          manualBudgetCap: 0,
          costRegime: 'materiais_funcionarios',
          dailyRatePerWorker: 0,
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
            <input type="text" inputmode="numeric" data-currency-euro data-b-field="unitPrice" value="${escapeHtml(it.unitPrice)}" placeholder="€ 0,00">
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
            <input type="text" inputmode="numeric" data-currency-euro data-p-field="amount" value="${escapeHtml(p.amount)}" placeholder="€ 0,00">
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
              <label for="projManager">Responsável Técnico da Obra</label>
              <select id="projManager" name="managerId">
                <option value="">Selecionar responsável técnico...</option>
                ${(state.technicalManagers || [])
                  .filter((t) => t.status === 'ativo' || t.id === proj.managerId)
                  .map(
                    (t) =>
                      `<option value="${escapeHtml(t.id)}" ${proj.managerId === t.id ? 'selected' : ''}>${escapeHtml(t.name)} — ${escapeHtml(t.professionalTitle)}${t.licenseNumber ? ` (${escapeHtml(t.licenseNumber)})` : ''}</option>`
                  )
                  .join('')}
                ${
                  proj.managerId &&
                  !(state.technicalManagers || []).some((t) => t.id === proj.managerId) &&
                  state.employees.some((e) => e.id === proj.managerId)
                    ? `<option value="${escapeHtml(proj.managerId)}" selected>${escapeHtml(state.employees.find((e) => e.id === proj.managerId).name)} (Registo anterior)</option>`
                    : ''
                }
              </select>
              ${
                (state.technicalManagers || []).length === 0
                  ? '<span class="erp-field__hint">Ainda não existem técnicos registados. Cadastre na aba "Responsáveis Técnicos".</span>'
                  : ''
              }
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

            <div class="erp-field erp-field--full" style="margin-top:6px;">
              <label>Esta obra terá gastos com: *</label>
              <div class="erp-regime-group" id="projRegimeGroup">
                <label class="erp-regime-option ${(proj.costRegime || 'materiais_funcionarios') === 'materiais_funcionarios' ? 'is-selected' : ''}">
                  <input type="radio" name="costRegime" value="materiais_funcionarios" ${(proj.costRegime || 'materiais_funcionarios') === 'materiais_funcionarios' ? 'checked' : ''}>
                  <div>
                    <div class="erp-cell-title">Materiais e Funcionários</div>
                    <div class="erp-cell-sub">A Spark &amp; Smirk fornece os materiais e a equipa de mão de obra.</div>
                  </div>
                </label>
                <label class="erp-regime-option ${proj.costRegime === 'somente_funcionarios' ? 'is-selected' : ''}">
                  <input type="radio" name="costRegime" value="somente_funcionarios" ${proj.costRegime === 'somente_funcionarios' ? 'checked' : ''}>
                  <div>
                    <div class="erp-cell-title">Somente Funcionários</div>
                    <div class="erp-cell-sub">Obra de outra construtora: apenas fornecimento de mão de obra à diária.</div>
                  </div>
                </label>
              </div>

              ${
                canSeeValues
                  ? `<div class="erp-worker-daily-card" id="projDailyRateBox">
                       <div class="erp-form-grid">
                         <div class="erp-field">
                           <label for="projDailyRate">Valor por Funcionário na Obra — Diária (€/dia) *</label>
                           <input type="text" inputmode="numeric" data-currency-euro id="projDailyRate" name="dailyRatePerWorker" value="${escapeHtml(proj.dailyRatePerWorker || '')}" placeholder="€ 0,00">
                           <span class="erp-field__hint">Indique quanto custa ou é cobrado por cada funcionário por dia nesta obra.</span>
                         </div>
                         <div class="erp-field">
                           <label>Previsão Diária da Equipa</label>
                           <div class="erp-cred-box__code" id="projDailyEstimate" style="margin-top:2px;">0 func. × € 0,00 = € 0,00/dia</div>
                           <span class="erp-field__hint" id="projRegimeHint">Atualizado automaticamente conforme os funcionários selecionados.</span>
                         </div>
                       </div>
                     </div>`
                  : ''
              }
            </div>
          </div>
        </div>

        ${
          canSeeValues
            ? `
        ${
          canManageBudget
            ? `<div class="erp-form-section">
                 <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
                   <div class="erp-form-section__title" style="margin-bottom:0;">3. Orçamento Detalhado da Obra</div>
                   <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnAddBudgetLine">${ICONS.plus}<span>Adicionar Artigo</span></button>
                 </div>
                 <div class="erp-form-grid erp-form-grid--3" style="margin-bottom:12px;">
                   <div class="erp-field">
                     <label for="projManualCap">Orçamento Geral / Plafond (€)</label>
                     <input type="text" inputmode="numeric" data-currency-euro id="projManualCap" name="manualBudgetCap" value="${escapeHtml(proj.manualBudgetCap || '')}" placeholder="€ 0,00 (ex.: € 100.000,00)">
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
               </div>`
            : ''
        }

        ${
          canManagePayments
            ? `<div class="erp-form-section">
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
               </div>`
            : ''
        }

        ${
          canManageInvoices
            ? `<div class="erp-form-section">
                 <div class="erp-form-section__title">5. Faturas de Materiais &amp; Compras da Obra (PDF) — Abate em Tempo Real</div>
                 <div class="erp-inline-invoice-box">
                   <div class="erp-form-grid erp-form-grid--3">
                     <div class="erp-field">
                       <label for="formInvAmount">Qual o valor da fatura? (€) *</label>
                       <input type="text" inputmode="numeric" data-currency-euro id="formInvAmount" placeholder="€ 0,00">
                     </div>
                     <div class="erp-field">
                       <label for="formInvNumber">N.º Fatura / Documento *</label>
                       <input type="text" id="formInvNumber" placeholder="Ex.: FT 2026/0012">
                     </div>
                     <div class="erp-field">
                       <label for="formInvSupplier">Fornecedor / Armazém *</label>
                       <input type="text" id="formInvSupplier" placeholder="Ex.: Leroy Merlin, Maxmat">
                     </div>
                     <div class="erp-field">
                       <label for="formInvCategory">Categoria de Custo</label>
                       <select id="formInvCategory">
                         ${INVOICE_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                       </select>
                     </div>
                     <div class="erp-field">
                       <label for="formInvDate">Data da Fatura</label>
                       <input type="date" id="formInvDate" value="${todayISO()}">
                     </div>
                     <div class="erp-field">
                       <label for="formInvFile">Anexar PDF / Foto da Fatura</label>
                       <input type="file" id="formInvFile" accept=".pdf,image/*">
                     </div>
                   </div>
                   <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;flex-wrap:wrap;">
                     <span class="erp-cell-sub" id="formInvFileLabel">Anexe o PDF da fatura e indique o valor para descontar do orçamento geral.</span>
                     <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" id="btnAddFormInvoice">
                       ${ICONS.plus}<span>Anexar Fatura PDF &amp; Abater Saldo</span>
                     </button>
                   </div>
                 </div>
                 <div class="erp-summary-box" style="margin-bottom:12px;">
                   <div><div class="erp-summary-item__label">Orçamento Geral</div><div class="erp-summary-item__val" id="formInvBudget">€0,00</div></div>
                   <div><div class="erp-summary-item__label">Total em Faturas (<span id="formInvCount">0</span>)</div><div class="erp-summary-item__val erp-summary-item__val--warning" id="formInvSpent">€0,00</div></div>
                   <div><div class="erp-summary-item__label">Consumido</div><div class="erp-summary-item__val" id="formInvPct">0%</div></div>
                   <div><div class="erp-summary-item__label">Saldo Disponível (Real Time)</div><div class="erp-summary-item__val erp-summary-item__val--success" id="formInvRemaining">€0,00</div></div>
                 </div>
                 <div id="projRegimeNotice" class="erp-cell-sub" style="margin-bottom:8px;"></div>
                 <div id="formInvoicesList"></div>
               </div>`
            : ''
        }
        `
            : `<div class="erp-form-section">
                 <div class="erp-inline-invoice-box">
                   <strong>Orçamentos, pagamentos e faturas financeiros ocultos</strong>
                   <div class="erp-cell-sub">O seu perfil não tem permissão para consultar ou alterar valores financeiros desta obra. Os orçamentos e saldos atuais serão preservados automaticamente.</div>
                 </div>
               </div>`
        }

        <div class="erp-form-section">
          <div class="erp-form-section__title">6. Contratos da Obra (PDF)</div>
          <div class="erp-inline-invoice-box">
            <div class="erp-form-grid erp-form-grid--3">
              <div class="erp-field">
                <label for="formCtrTitle">Título do Contrato *</label>
                <input type="text" id="formCtrTitle" placeholder="Ex.: Contrato Empreitada / Subempreitada">
              </div>
              <div class="erp-field">
                <label for="formCtrNumber">N.º / Referência</label>
                <input type="text" id="formCtrNumber" placeholder="Ex.: CTR-2026/01">
              </div>
              <div class="erp-field">
                <label for="formCtrDate">Data do Contrato</label>
                <input type="date" id="formCtrDate" value="${todayISO()}">
              </div>
              <div class="erp-field" style="grid-column:span 2;">
                <label for="formCtrFile">Anexar Contrato em PDF / Imagem (até 10 MB)</label>
                <input type="file" id="formCtrFile" accept=".pdf,image/*">
              </div>
              <div class="erp-field" style="justify-content:flex-end;">
                <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnAddFormContract">
                  ${ICONS.plus}<span>Anexar Contrato PDF</span>
                </button>
              </div>
            </div>
            <div class="erp-cell-sub" id="formCtrFileLabel" style="margin-top:6px;">Anexe o contrato assinado em PDF para ficar disponível na lista de contratos da obra.</div>
          </div>
          <div id="formContractsList"></div>
        </div>
      </form>
    `;

    const existingProjRefs = new Set([proj.id, proj.code].filter(Boolean));
    const formInvoices = isEdit
      ? (state.projectInvoices || [])
          .filter((inv) => existingProjRefs.has(inv.projectId))
          .map((inv) => ({ ...inv, isNew: false }))
      : [];
    const formContracts = isEdit
      ? (state.projectContracts || [])
          .filter((ctr) => existingProjRefs.has(ctr.projectId))
          .map((ctr) => ({ ...ctr, isNew: false }))
      : [];
    const deletedExistingIds = [];
    const deletedContractIds = [];

    openModal({
      title: isEdit ? `Editar Obra — ${proj.code}` : 'Cadastrar Nova Obra & Orçamento',
      subtitle: 'Formulário operacional completo Spark & Smirk, Lda.',
      size: 'wide',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="projectForm" class="erp-btn erp-btn--primary" id="btnSubmitProject">${isEdit ? 'Guardar Alterações' : 'Registar Obra'}</button>
      `,
      onMount: (modal) => {
        const budWrap = modal.querySelector('#budgetLinesContainer');
        const payWrap = modal.querySelector('#paymentLinesContainer');
        const vatSelect = modal.querySelector('#projVat');
        const contInput = modal.querySelector('#projCont');
        const capInput = modal.querySelector('#projManualCap');
        const invListEl = modal.querySelector('#formInvoicesList');
        const invFileInput = modal.querySelector('#formInvFile');
        const invFileLabel = modal.querySelector('#formInvFileLabel');
        const ctrListEl = modal.querySelector('#formContractsList');
        const ctrFileInput = modal.querySelector('#formCtrFile');
        const ctrFileLabel = modal.querySelector('#formCtrFileLabel');
        const dailyRateInput = modal.querySelector('#projDailyRate');
        const dailyEstimateEl = modal.querySelector('#projDailyEstimate');
        const regimeNoticeEl = modal.querySelector('#projRegimeNotice');

        const updateRegimeUI = () => {
          const selectedRegime = modal.querySelector('input[name="costRegime"]:checked')?.value || 'materiais_funcionarios';
          modal.querySelectorAll('#projRegimeGroup .erp-regime-option').forEach((lbl) => {
            const radio = lbl.querySelector('input[name="costRegime"]');
            lbl.classList.toggle('is-selected', Boolean(radio?.checked));
          });
          const teamCount = modal.querySelectorAll('input[name="teamIds"]:checked').length;
          const dailyVal = parseCurrencyInput(dailyRateInput?.value);
          const totalDaily = teamCount * dailyVal;
          if (dailyEstimateEl) {
            dailyEstimateEl.textContent = `${teamCount} func. × ${formatCurrency(dailyVal)} = ${formatCurrency(totalDaily)}/dia`;
          }
          if (regimeNoticeEl) {
            regimeNoticeEl.textContent =
              selectedRegime === 'somente_funcionarios'
                ? 'Nota: Esta obra está definida como "Somente Funcionários" (mão de obra à diária, sem fornecimento de materiais pela Spark & Smirk).'
                : '';
          }
        };

        modal.querySelectorAll('input[name="costRegime"]').forEach((r) => {
          r.addEventListener('change', updateRegimeUI);
        });
        modal.querySelectorAll('input[name="teamIds"]').forEach((chk) => {
          chk.addEventListener('change', updateRegimeUI);
        });
        dailyRateInput?.addEventListener('input', updateRegimeUI);
        updateRegimeUI();

        const renderFormContracts = () => {
          if (!ctrListEl) return;
          if (formContracts.length === 0) {
            ctrListEl.innerHTML = '<div class="erp-cell-sub" style="padding:8px 4px;">Ainda não existem contratos PDF anexados a esta obra.</div>';
            return;
          }
          ctrListEl.innerHTML = `
            <div class="erp-table-wrap">
              <table class="erp-table">
                <thead>
                  <tr>
                    <th>Data / Ref.</th>
                    <th>Título do Contrato</th>
                    <th>Ficheiro PDF</th>
                    <th style="text-align:right">Remover</th>
                  </tr>
                </thead>
                <tbody>
                  ${formContracts
                    .map(
                      (ctr, idx) => `
                    <tr>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(ctr.contractNumber || ctr.id)}</div>
                        <div class="erp-cell-sub">${escapeHtml(formatDatePT(ctr.contractDate))}</div>
                      </td>
                      <td><div class="erp-cell-title">${escapeHtml(ctr.title)}</div></td>
                      <td><span class="erp-badge erp-badge--info">${escapeHtml(ctr.fileName || 'PDF Anexado')}</span></td>
                      <td style="text-align:right">
                        <button type="button" class="erp-icon-btn erp-icon-btn--danger" data-form-ctr-del="${idx}" title="Remover contrato">${ICONS.trash}</button>
                      </td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          `;
          ctrListEl.querySelectorAll('[data-form-ctr-del]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const idx = Number(btn.dataset.formCtrDel);
              const removed = formContracts.splice(idx, 1)[0];
              if (removed && !removed.isNew && removed.id) {
                deletedContractIds.push(removed.id);
              }
              renderFormContracts();
            });
          });
        };

        if (ctrFileInput && ctrFileLabel) {
          ctrFileInput.addEventListener('change', () => {
            const f = ctrFileInput.files?.[0];
            ctrFileLabel.textContent = f
              ? `Contrato selecionado: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`
              : 'Anexe o contrato assinado em PDF para ficar disponível na lista de contratos da obra.';
          });
        }

        modal.querySelector('#btnAddFormContract')?.addEventListener('click', async () => {
          const titleEl = modal.querySelector('#formCtrTitle');
          const numEl = modal.querySelector('#formCtrNumber');
          const dateEl = modal.querySelector('#formCtrDate');
          const file = ctrFileInput?.files?.[0] || null;
          const title = titleEl.value.trim();

          if (!title) {
            showToast('Indique o título do contrato antes de anexar.', 'danger');
            titleEl.focus();
            return;
          }
          if (!file) {
            showToast('Selecione o ficheiro PDF do contrato.', 'danger');
            return;
          }

          const ctrId = generateId('CTR');
          let meta;
          try {
            meta = await saveContractFile(ctrId, file);
          } catch (err) {
            showToast(err?.message || 'Erro ao preparar o ficheiro do contrato.', 'danger');
            return;
          }

          formContracts.unshift({
            id: ctrId,
            title,
            contractNumber: numEl.value.trim(),
            contractDate: dateEl.value || todayISO(),
            notes: '',
            fileName: meta.name,
            fileType: meta.type,
            fileSize: meta.size,
            hasFile: true,
            createdAt: todayISO(),
            isNew: true,
          });

          titleEl.value = '';
          numEl.value = '';
          if (ctrFileInput) ctrFileInput.value = '';
          if (ctrFileLabel) {
            ctrFileLabel.textContent = 'Anexe o contrato assinado em PDF para ficar disponível na lista de contratos da obra.';
          }

          renderFormContracts();
          showToast(`Contrato "${title}" anexado à lista da obra.`);
        });

        renderFormContracts();

        const renderFormInvoices = () => {
          if (!invListEl) return;
          if (formInvoices.length === 0) {
            invListEl.innerHTML = '<div class="erp-cell-sub" style="padding:8px 4px;">Ainda não existem faturas PDF anexadas a esta obra.</div>';
            return;
          }
          invListEl.innerHTML = `
            <div class="erp-table-wrap">
              <table class="erp-table">
                <thead>
                  <tr>
                    <th>Data / N.º Fatura</th>
                    <th>Fornecedor &amp; Categoria</th>
                    <th>Ficheiro PDF</th>
                    <th style="text-align:right">Valor (€)</th>
                    <th style="text-align:right">Remover</th>
                  </tr>
                </thead>
                <tbody>
                  ${formInvoices
                    .map(
                      (inv, idx) => `
                    <tr>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(inv.invoiceNumber)}</div>
                        <div class="erp-cell-sub">${escapeHtml(formatDatePT(inv.invoiceDate))}</div>
                      </td>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(inv.supplier)}</div>
                        <div class="erp-cell-sub">${escapeHtml(inv.category)}</div>
                      </td>
                      <td>
                        ${
                          inv.fileName || inv.hasFile
                            ? `<span class="erp-badge erp-badge--info">${escapeHtml(inv.fileName || 'PDF Anexado')}</span>`
                            : '<span class="erp-badge erp-badge--neutral">Sem PDF</span>'
                        }
                      </td>
                      <td style="text-align:right;font-weight:700;">${escapeHtml(formatCurrency(inv.amount))}</td>
                      <td style="text-align:right">
                        <button type="button" class="erp-icon-btn erp-icon-btn--danger" data-form-inv-del="${idx}" title="Remover fatura">${ICONS.trash}</button>
                      </td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          `;

          invListEl.querySelectorAll('[data-form-inv-del]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const idx = Number(btn.dataset.formInvDel);
              const removed = formInvoices.splice(idx, 1)[0];
              if (removed && !removed.isNew && removed.id) {
                deletedExistingIds.push(removed.id);
              }
              renderFormInvoices();
              updateSummaries();
            });
          });
        };

        const syncBudgetFromDOM = () => {
          if (!budWrap || !vatSelect || !contInput) return;
          const rows = [...budWrap.querySelectorAll('[data-b-idx]')];
          proj.budget.items = rows.map((row) => ({
            description: row.querySelector('[data-b-field="description"]').value,
            category: row.querySelector('[data-b-field="category"]').value,
            unit: row.querySelector('[data-b-field="unit"]').value,
            qty: Number(row.querySelector('[data-b-field="qty"]').value) || 0,
            unitPrice: parseCurrencyInput(row.querySelector('[data-b-field="unitPrice"]').value),
          }));
          proj.budget.vatRate = Number(vatSelect.value);
          proj.budget.contingencyPct = Number(contInput.value) || 0;
        };

        const syncPaymentsFromDOM = () => {
          if (!payWrap) return;
          const rows = [...payWrap.querySelectorAll('[data-p-idx]')];
          proj.payments = rows.map((row, i) => ({
            id: proj.payments[i]?.id || generateId('PAG'),
            description: row.querySelector('[data-p-field="description"]').value,
            dueDate: row.querySelector('[data-p-field="dueDate"]').value,
            paidDate: row.querySelector('[data-p-field="paidDate"]').value,
            amount: parseCurrencyInput(row.querySelector('[data-p-field="amount"]').value),
            status: row.querySelector('[data-p-field="status"]').value,
            method: row.querySelector('[data-p-field="method"]').value,
            invoiceRef: proj.payments[i]?.invoiceRef || '',
          }));
        };

        const computeEffectiveFormBudget = () => {
          const t = computeBudgetTotals(proj.budget);
          const manualCap = canManageBudget
            ? Math.max(0, parseCurrencyInput(capInput?.value))
            : Number(proj.manualBudgetCap || 0);
          return { t, manualCap, budgetTotal: manualCap > 0 ? manualCap : t.grossTotal };
        };

        const updateSummaries = () => {
          if (!canSeeValues) return;
          syncBudgetFromDOM();
          syncPaymentsFromDOM();
          const { t, manualCap, budgetTotal } = computeEffectiveFormBudget();
          const paid = proj.payments.filter((p) => p.status === 'pago').reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const contract = budgetTotal > 0 ? budgetTotal : proj.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const open = Math.max(0, contract - paid);

          const setTxt = (sel, txt) => {
            const el = modal.querySelector(sel);
            if (el) el.textContent = txt;
          };

          setTxt('#formBudSub', formatCurrency(t.subtotal));
          setTxt('#formBudCont', formatCurrency(t.contingencyVal));
          setTxt('#formBudVat', formatCurrency(t.vatVal));
          setTxt('#formBudGross', formatCurrency(manualCap > 0 ? manualCap : t.grossTotal));

          setTxt('#formPayContract', formatCurrency(contract));
          setTxt('#formPayPaid', formatCurrency(paid));
          setTxt('#formPayOpen', formatCurrency(open));
          setTxt('#formPayCount', String(proj.payments.length));

          const totalInvSpent = formInvoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
          const remaining = budgetTotal - totalInvSpent;
          const pct = budgetTotal > 0 ? Math.round((totalInvSpent / budgetTotal) * 100) : 0;

          setTxt('#formInvBudget', formatCurrency(budgetTotal));
          setTxt('#formInvCount', String(formInvoices.length));
          setTxt('#formInvSpent', formatCurrency(totalInvSpent));
          setTxt('#formInvPct', `${pct}%`);
          const remEl = modal.querySelector('#formInvRemaining');
          if (remEl) {
            remEl.textContent = formatCurrency(remaining);
            remEl.className = `erp-summary-item__val ${remaining < 0 ? 'erp-summary-item__val--danger' : 'erp-summary-item__val--success'}`;
          }
        };

        capInput?.addEventListener('input', updateSummaries);

        if (invFileInput && invFileLabel) {
          invFileInput.addEventListener('change', () => {
            const f = invFileInput.files?.[0];
            invFileLabel.textContent = f
              ? `Ficheiro selecionado: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`
              : 'Anexe o PDF da fatura e indique o valor para descontar do orçamento geral.';
          });
        }

        modal.querySelector('#btnAddFormInvoice')?.addEventListener('click', async () => {
          const amtEl = modal.querySelector('#formInvAmount');
          const numEl = modal.querySelector('#formInvNumber');
          const supEl = modal.querySelector('#formInvSupplier');
          const catEl = modal.querySelector('#formInvCategory');
          const dateEl = modal.querySelector('#formInvDate');

          const amountVal = parseCurrencyInput(amtEl.value);
          if (amountVal <= 0) {
            showToast('Indique primeiro qual é o valor da fatura (superior a € 0,00).', 'danger');
            amtEl.focus();
            return;
          }

          const invoiceNumber = numEl.value.trim() || `FT-${formInvoices.length + 1}`;
          const supplier = supEl.value.trim() || 'Fornecedor de Obra';
          const selectedFile = invFileInput?.files?.[0] || null;
          const invId = generateId('FAT');

          let fileMeta = { name: '', type: '', size: 0 };
          if (selectedFile) {
            try {
              fileMeta = await saveInvoiceFile(invId, selectedFile);
            } catch (err) {
              showToast(err?.message || 'Erro ao ler o ficheiro PDF da fatura.', 'danger');
              return;
            }
          }

          formInvoices.unshift({
            id: invId,
            invoiceNumber,
            supplier,
            supplierNif: '',
            category: catEl.value,
            invoiceDate: dateEl.value || todayISO(),
            amount: Number(amountVal.toFixed(2)),
            notes: '',
            fileName: fileMeta.name,
            fileType: fileMeta.type,
            fileSize: fileMeta.size,
            hasFile: Boolean(selectedFile),
            createdAt: todayISO(),
            isNew: true,
          });

          amtEl.value = '';
          numEl.value = '';
          supEl.value = '';
          if (invFileInput) invFileInput.value = '';
          if (invFileLabel) {
            invFileLabel.textContent = 'Anexe o PDF da fatura e indique o valor para descontar do orçamento geral.';
          }

          renderFormInvoices();
          updateSummaries();

          const { budgetTotal } = computeEffectiveFormBudget();
          const totalSpent = formInvoices.reduce((s, inv) => s + (Number(inv.amount) || 0), 0);
          const remainingNow = budgetTotal - totalSpent;
          const projLabel = `${modal.querySelector('#projCode').value.trim() || proj.code} — ${modal.querySelector('#projName').value.trim() || 'Obra'}`;

          showBalanceNotification({
            projectLabel: projLabel,
            invoiceNumber,
            invoiceAmount: amountVal,
            remainingBudget: remainingNow,
            budgetTotal,
          });
        });

        const bindBudgetEvents = () => {
          if (!budWrap) return;
          attachEuroMasks(budWrap);
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
          if (!payWrap) return;
          attachEuroMasks(payWrap);
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

        modal.querySelector('#btnAddBudgetLine')?.addEventListener('click', () => {
          if (!budWrap) return;
          syncBudgetFromDOM();
          proj.budget.items.push({ description: '', category: 'Materiais', unit: 'vg', qty: 1, unitPrice: 0 });
          budWrap.innerHTML = renderBudgetRows(proj.budget.items);
          bindBudgetEvents();
          updateSummaries();
        });

        modal.querySelector('#btnAddPayLine')?.addEventListener('click', () => {
          if (!payWrap) return;
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

        vatSelect?.addEventListener('change', updateSummaries);
        contInput?.addEventListener('input', updateSummaries);
        renderFormInvoices();
        bindBudgetEvents();
        bindPaymentEvents();
        updateSummaries();

        const form = modal.querySelector('#projectForm');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          syncBudgetFromDOM();
          syncPaymentsFromDOM();

          const nifVal = modal.querySelector('#projClientNif').value.replace(/\D/g, '');
          if (nifVal && !isValidNIF(nifVal)) {
            showToast('NIF do cliente inválido. Verifique os 9 dígitos.', 'danger');
            return;
          }

          const submitBtn = modal.querySelector('#btnSubmitProject');
          submitBtn.disabled = true;
          submitBtn.textContent = 'A guardar obra...';

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
            manualBudgetCap: canManageBudget
              ? Math.max(0, parseCurrencyInput(modal.querySelector('#projManualCap')?.value))
              : Number(proj.manualBudgetCap || 0),
            costRegime: modal.querySelector('input[name="costRegime"]:checked')?.value || 'materiais_funcionarios',
            dailyRatePerWorker: canSeeValues
              ? Math.max(0, parseCurrencyInput(dailyRateInput?.value))
              : Number(proj.dailyRatePerWorker || 0),
            budget: proj.budget,
            payments: proj.payments,
          };

          let savedProjectRef = proj.id;
          if (isEdit) {
            await store.updateProject(proj.id, payload);
          } else {
            savedProjectRef = generateId('OB');
            await store.addProject({ id: savedProjectRef, ...payload });
          }

          for (const delId of deletedExistingIds) {
            store.deleteProjectInvoice(delId);
          }

          for (const delCtrId of deletedContractIds) {
            store.deleteProjectContract(delCtrId);
          }

          const newInvoices = formInvoices.filter((inv) => inv.isNew);
          for (const inv of newInvoices) {
            await store.addProjectInvoice({
              ...inv,
              projectId: payload.code || savedProjectRef,
            });
          }

          const newContracts = formContracts.filter((ctr) => ctr.isNew);
          for (const ctr of newContracts) {
            await store.addProjectContract({
              ...ctr,
              projectId: payload.code || savedProjectRef,
            });
          }

          const savedProjObj = store.getState().projects.find(
            (p) => p.id === savedProjectRef || p.code === payload.code
          ) || payload;
          const finalSum = computeProjectInvoiceSummary(savedProjObj, store.getState().projectInvoices);

          showToast(
            canSeeValues
              ? `${isEdit ? `Obra ${payload.code} atualizada.` : `Obra ${payload.code} registada.`} Saldo disponível: ${formatCurrency(finalSum.remainingBudget)}`
              : `${isEdit ? `Obra ${payload.code} atualizada.` : `Obra ${payload.code} registada.`}`,
            'success',
            5000
          );
          closeModal();
        });
      },
    });
  }
}
