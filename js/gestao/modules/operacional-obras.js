/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Operacional: Obras, Orçamentos & Pagamentos
   ═══════════════════════════════════════════════════════════ */

import { store } from '../core/store.js';
import {
  computeBudgetTotals,
  computeProjectFinancials,
  escapeHtml,
  formatCurrency,
  formatDatePT,
  generateId,
  isValidNIF,
  todayISO,
} from '../core/formatters.js';
import { ICONS, openModal, closeModal, confirmAction, showToast } from '../core/ui.js';

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
  }

  render(container, ctx) {
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

    // Global & filtered financial KPIs
    let totalContracted = 0;
    let totalPaid = 0;
    let totalOpen = 0;
    let overdueProjects = 0;

    filtered.forEach((proj) => {
      const fin = computeProjectFinancials(proj);
      totalContracted += fin.contractTotal;
      totalPaid += fin.paidAmount;
      totalOpen += fin.balanceOpen;
      if (fin.overdueCount > 0) overdueProjects += 1;
    });

    const empMap = new Map(state.employees.map((e) => [e.id, e]));
    const statusInfo = STATUS_META[statusFilter] || STATUS_META.em_andamento;
    const today = todayISO();

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
            <span class="erp-kpi-card__label">Total Orçamentado c/ IVA</span>
            <span class="erp-kpi-card__icon">${ICONS.euro}</span>
          </div>
          <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalContracted))}</div>
          <div class="erp-kpi-card__meta">Valor contratual desta vista</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--success">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Total Recebido / Pago</span>
            <span class="erp-kpi-card__icon">${ICONS.checkCircle}</span>
          </div>
          <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalPaid))}</div>
          <div class="erp-kpi-card__meta">Parcelas liquidadas pelos clientes</div>
        </div>

        <div class="erp-kpi-card ${overdueProjects > 0 ? 'erp-kpi-card--danger' : 'erp-kpi-card--warning'}">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Valor Total em Aberto</span>
            <span class="erp-kpi-card__icon">${ICONS.clock}</span>
          </div>
          <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalOpen))}</div>
          <div class="erp-kpi-card__meta">${overdueProjects > 0 ? `${overdueProjects} obra(s) com pagamento vencido` : 'Sem pagamentos em atraso'}</div>
        </div>
      </div>

      <div class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h2 class="erp-panel__title">Gestão Operacional — Obras ${escapeHtml(statusInfo.label)}</h2>
            <p class="erp-panel__desc">Acompanhamento técnico, orçamentação detalhada, datas de pagamento e saldos em aberto.</p>
          </div>
          <div class="erp-panel__actions">
            <select class="erp-select-sm" id="filterProjectType">
              <option value="all">Todas as Tipologias</option>
              ${PROJECT_TYPES.map((t) => `<option value="${escapeHtml(t)}" ${this.typeFilter === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
            </select>
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
                  <th>Orçamento c/ IVA</th>
                  <th>Liquidado / Em Aberto</th>
                  <th>Próx. Data Pagamento</th>
                  <th style="text-align:right">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${filtered
                  .map((proj) => {
                    const fin = computeProjectFinancials(proj);
                    const mgr = empMap.get(proj.managerId);
                    const isOverdue = fin.nextDueDate && fin.nextDueDate < today;
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
                        <div class="erp-cell-title">${escapeHtml(formatCurrency(fin.contractTotal))}</div>
                        <div class="erp-cell-sub">IVA ${fin.vatRate}% · ${proj.budget?.items?.length || 0} artigos</div>
                      </td>
                      <td>
                        <div class="erp-cell-title" style="color:var(--erp-success);">${escapeHtml(formatCurrency(fin.paidAmount))} pago</div>
                        <div class="erp-cell-sub" style="color:${fin.balanceOpen > 0 ? 'var(--erp-danger)' : 'var(--erp-text-muted)'};font-weight:600;">
                          Em aberto: ${escapeHtml(formatCurrency(fin.balanceOpen))}
                        </div>
                      </td>
                      <td>
                        ${
                          fin.balanceOpen <= 0.01
                            ? '<span class="erp-badge erp-badge--success">100% Liquidada</span>'
                            : fin.nextDueDate
                              ? `<span class="erp-badge ${isOverdue ? 'erp-badge--danger' : 'erp-badge--warning'}">
                                   ${isOverdue ? 'Em Atraso · ' : ''}${escapeHtml(formatDatePT(fin.nextDueDate))}
                                 </span>`
                              : '<span class="erp-badge erp-badge--neutral">Sem data definida</span>'
                        }
                      </td>
                      <td>
                        <div class="erp-row-actions">
                          <button type="button" class="erp-icon-btn" title="Ver Orçamento &amp; Pagamentos" data-proj-view="${escapeHtml(proj.id)}">${ICONS.eye}</button>
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

    container.querySelector('#btnNewProject')?.addEventListener('click', () => {
      this._openProjectFormModal(null, statusFilter);
    });

    container.querySelectorAll('[data-proj-view]').forEach((btn) => {
      btn.addEventListener('click', () => this._openProjectDetailModal(btn.dataset.projView));
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
          message: `Tem a certeza de que pretende eliminar a obra "${proj.name}" (${proj.code}) e todo o respetivo orçamento e histórico de pagamentos?`,
          onConfirm: () => {
            store.deleteProject(proj.id);
            showToast(`Obra ${proj.code} eliminada.`);
          },
        });
      });
    });
  }

  openProjectDetail(projectId) {
    this._openProjectDetailModal(projectId);
  }

  _openProjectDetailModal(projectId) {
    const state = store.getState();
    const proj = state.projects.find((p) => p.id === projectId);
    if (!proj) return;

    const empMap = new Map(state.employees.map((e) => [e.id, e]));
    const fin = computeProjectFinancials(proj);
    const statusInfo = STATUS_META[proj.status] || STATUS_META.em_andamento;
    const today = todayISO();

    const bodyHtml = `
      <div class="erp-summary-box" style="margin-bottom:18px;">
        <div>
          <div class="erp-summary-item__label">Orçamentado c/ IVA</div>
          <div class="erp-summary-item__val">${escapeHtml(formatCurrency(fin.contractTotal))}</div>
        </div>
        <div>
          <div class="erp-summary-item__label">Total Pago</div>
          <div class="erp-summary-item__val erp-summary-item__val--success">${escapeHtml(formatCurrency(fin.paidAmount))} (${fin.paidPct}%)</div>
        </div>
        <div>
          <div class="erp-summary-item__label">Valor em Aberto</div>
          <div class="erp-summary-item__val ${fin.balanceOpen > 0 ? 'erp-summary-item__val--danger' : ''}">${escapeHtml(formatCurrency(fin.balanceOpen))}</div>
        </div>
        <div>
          <div class="erp-summary-item__label">Próximo Pagamento</div>
          <div class="erp-summary-item__val erp-summary-item__val--accent">${fin.nextDueDate ? escapeHtml(formatDatePT(fin.nextDueDate)) : 'Liquidado'}</div>
        </div>
      </div>

      <div class="erp-detail-tabs">
        <button type="button" class="erp-detail-tab is-active" data-det-tab="overview">Dados Técnicos &amp; Equipa</button>
        <button type="button" class="erp-detail-tab" data-det-tab="budget">Orçamento Detalhado (${proj.budget?.items?.length || 0})</button>
        <button type="button" class="erp-detail-tab" data-det-tab="payments">Plano &amp; Datas de Pagamento (${proj.payments?.length || 0})</button>
      </div>

      <div id="detPaneOverview">
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

      <div id="detPaneBudget" style="display:none;">
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
                      <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-toggle-pay="${escapeHtml(p.id)}">
                        ${p.status === 'pago' ? 'Reabrir' : 'Marcar Pago'}
                      </button>
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
        <button type="button" class="erp-btn erp-btn--primary" id="btnDetEdit">${ICONS.edit}<span>Editar Obra &amp; Orçamento</span></button>
      `,
      onMount: (modal) => {
        const panes = {
          overview: modal.querySelector('#detPaneOverview'),
          budget: modal.querySelector('#detPaneBudget'),
          payments: modal.querySelector('#detPanePayments'),
        };
        modal.querySelectorAll('[data-det-tab]').forEach((tab) => {
          tab.addEventListener('click', () => {
            modal.querySelectorAll('[data-det-tab]').forEach((t) => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            Object.entries(panes).forEach(([k, el]) => {
              el.style.display = k === tab.dataset.detTab ? 'block' : 'none';
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
            this._openProjectDetailModal(proj.id);
          });
        });

        modal.querySelector('#btnDetEdit').addEventListener('click', () => {
          closeModal();
          this._openProjectFormModal(proj, proj.status);
        });
      },
    });
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
          <div class="erp-form-grid" style="margin-bottom:12px;">
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
          const paid = proj.payments.filter((p) => p.status === 'pago').reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const contract = t.grossTotal > 0 ? t.grossTotal : proj.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const open = Math.max(0, contract - paid);

          modal.querySelector('#formBudSub').textContent = formatCurrency(t.subtotal);
          modal.querySelector('#formBudCont').textContent = formatCurrency(t.contingencyVal);
          modal.querySelector('#formBudVat').textContent = formatCurrency(t.vatVal);
          modal.querySelector('#formBudGross').textContent = formatCurrency(t.grossTotal);

          modal.querySelector('#formPayContract').textContent = formatCurrency(contract);
          modal.querySelector('#formPayPaid').textContent = formatCurrency(paid);
          modal.querySelector('#formPayOpen').textContent = formatCurrency(open);
          modal.querySelector('#formPayCount').textContent = String(proj.payments.length);
        };

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
