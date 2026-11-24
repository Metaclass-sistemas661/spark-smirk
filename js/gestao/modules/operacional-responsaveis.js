/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Operacional: Responsáveis Técnicos & Certificados PDF
   Construção Civil (PT), Elétrica (DGEG), Trabalho em Altura & Segurança (ACT)
   ═══════════════════════════════════════════════════════════ */

import { store, saveCertificateFile, getTechnicalCertificateFile } from '../core/store.js';
import {
  escapeHtml,
  formatDatePT,
  generateId,
  getInitials,
  isValidNIF,
  todayISO,
} from '../core/formatters.js';
import { ICONS, openModal, closeModal, confirmAction, showToast } from '../core/ui.js';

const PROFESSIONAL_TITLES = [
  'Engenheiro Civil (Diretor de Obra)',
  'Engenheiro Civil (Diretor de Fiscalização)',
  'Engenheiro Eletrotécnico',
  'Engenheiro Técnico Civil',
  'Engenheiro Técnico de Energia e Instalações Elétricas',
  'Técnico Responsável DGEG — Execução Elétrica',
  'Técnico Responsável DGEG — Exploração Elétrica',
  'Coordenador de Segurança em Obra (CSO)',
  'Técnico Superior de Segurança no Trabalho (TSST)',
  'Encarregado Geral de Construção Civil',
  'Especialista em Trabalho em Altura & Acesso por Cordas',
  'Técnico Instalador ITED / ITUR',
  'Técnico / Instalador de Gás & AVAC',
];

const ENTITY_ORDERS = [
  'Ordem dos Engenheiros (OE)',
  'Ordem dos Engenheiros Técnicos (OET)',
  'DGEG — Direção-Geral de Energia e Geologia',
  'ACT — Autoridade para as Condições do Trabalho',
  'IMPIC — Inst. Mercados Públicos, Imobiliário e Construção',
  'ANACOM (Registo ITED / ITUR)',
  'CERTIF / APA (Gases Fluorados)',
  'IRATA / Formação Certificada Altura',
  'Outra Entidade / Sem Ordem',
];

export const SPECIALTY_GROUPS = [
  {
    key: 'civil',
    label: 'Construção Civil & Estruturas',
    items: [
      'Direção de Obra (IMPIC)',
      'Direção de Fiscalização de Obra',
      'Betão Armado & Estruturas',
      'Reabilitação Urbana & Património',
      'Alvenarias, Rebocos & Acabamentos',
      'Capoto (ETICS) & Isolamentos Térmicos',
      'Sistemas em Pladur & Tetos Falsos',
      'Impermeabilizações & Coberturas',
      'Demolições, Escavações & Contenções',
    ],
  },
  {
    key: 'eletrica',
    label: 'Instalações Elétricas & Telecomunicações (DGEG / ITED)',
    items: [
      'DGEG — Técnico Responsável por Execução Elétrica',
      'DGEG — Técnico Responsável por Exploração Elétrica',
      'Baixa Tensão & Quadros Elétricos',
      'Média & Alta Tensão / Postos de Transformação',
      'ITED / ITUR (Telecomunicações em Edifícios)',
      'Energia Solar Fotovoltaica & Autoconsumo',
      'Mobilidade Elétrica (Postos de Carregamento)',
      'Domótica, SADI & Segurança Contra Incêndios',
    ],
  },
  {
    key: 'altura_seguranca',
    label: 'Trabalho em Altura, Andaimes & Segurança em Obra',
    items: [
      'Trabalho em Altura & Acesso por Cordas (IRATA / ACT)',
      'Montagem, Alteração & Inspeção de Andaimes (EN 12811)',
      'Coordenação de Segurança em Obra (CSO — DL 273/2003)',
      'Técnico Superior de Segurança no Trabalho (TSST CAP)',
      'Manobrador de Plataformas Elevatórias (PEMT)',
      'Manobrador de Gruas, Empilhadores & Máquinas',
      'Espaços Confinados & Resgate em Altura',
      'Primeiros Socorros & Combate a Incêndios em Obra',
    ],
  },
  {
    key: 'aguas_avac',
    label: 'Águas, Gás, AVAC & Ambiente',
    items: [
      'Instalações Hidráulicas, Águas & Saneamento',
      'Técnico / Instalador de Gás (DGEG)',
      'AVAC, Climatização & Gases Fluorados (CERTIF)',
      'Gestão de Resíduos de Construção e Demolição (RCD)',
    ],
  },
];

const CERTIFICATE_CATALOG = [
  { label: 'Cédula Profissional — Ordem dos Engenheiros (OE)', category: 'Construção Civil' },
  { label: 'Cédula Profissional — Ordem dos Engenheiros Técnicos (OET)', category: 'Construção Civil' },
  { label: 'Declaração / Termo de Responsabilidade Técnica (IMPIC / Câmara)', category: 'Construção Civil' },
  { label: 'Carteira / Registo DGEG — Técnico Responsável Elétrico (Execução)', category: 'Instalações Elétricas' },
  { label: 'Carteira / Registo DGEG — Técnico Responsável Elétrico (Exploração)', category: 'Instalações Elétricas' },
  { label: 'Certificado Habilitação em Média / Alta Tensão (TET)', category: 'Instalações Elétricas' },
  { label: 'Certificado Instalador ITED / ITUR (ANACOM)', category: 'Telecomunicações' },
  { label: 'Certificado de Formação — Trabalho em Altura (ACT / IRATA / EN 365)', category: 'Trabalho em Altura' },
  { label: 'Certificado Montagem, Desmontagem & Inspeção de Andaimes (EN 12811)', category: 'Trabalho em Altura' },
  { label: 'Certificado Manobrador de Plataformas Elevatórias (PEMT)', category: 'Trabalho em Altura' },
  { label: 'Certificado Manobrador de Gruas, Empilhadores & Máquinas', category: 'Equipamentos & Máquinas' },
  { label: 'CAP — Técnico Superior de Segurança no Trabalho (ACT)', category: 'Segurança em Obra' },
  { label: 'Certificado Coordenador de Segurança em Obra (CSO)', category: 'Segurança em Obra' },
  { label: 'Certificado Espaços Confinados & Resgate Técnico', category: 'Segurança em Obra' },
  { label: 'Certificado de Primeiros Socorros & Combate a Incêndios', category: 'Segurança em Obra' },
  { label: 'Carteira Profissional DGEG — Técnico / Instalador de Gás', category: 'Águas, Gás & AVAC' },
  { label: 'Certificado Gases Fluorados / AVAC (CERTIF / APA)', category: 'Águas, Gás & AVAC' },
  { label: 'Apólice Seguro de Responsabilidade Civil Profissional', category: 'Seguros & Legal' },
  { label: 'Ficha de Aptidão Médica (Medicina do Trabalho — Trabalho em Altura)', category: 'Segurança & Legal' },
  { label: 'Outro Certificado / Habilitação Técnica (PDF)', category: 'Outros' },
];

function getCertificateValidityBadge(expiryDate) {
  if (!expiryDate) {
    return '<span class="erp-badge erp-badge--neutral">Sem Validade</span>';
  }
  const today = todayISO();
  if (expiryDate < today) {
    return '<span class="erp-badge erp-badge--danger">Expirado</span>';
  }
  const expMs = new Date(`${expiryDate}T00:00:00`).getTime();
  const nowMs = new Date(`${today}T00:00:00`).getTime();
  const diffDays = Math.round((expMs - nowMs) / (1000 * 60 * 60 * 24));
  if (diffDays <= 45) {
    return `<span class="erp-badge erp-badge--warning">Expira em ${diffDays}d</span>`;
  }
  return '<span class="erp-badge erp-badge--success">Válido</span>';
}

export class OperacionalResponsaveisModule {
  constructor(options = {}) {
    this.statusFilter = 'all';
    this.domainFilter = 'all';
    this.onNavigateProject = options.onNavigateProject || null;
  }

  _canManage(ctx) {
    if (!ctx?.can) return true;
    return ctx.can('op_obras', 'responsaveis') || ctx.can('op_obras', 'editar') || ctx.can('op_obras', 'criar');
  }

  render(container, ctx) {
    this._can = ctx.can || (() => true);
    const state = store.getState();
    const managers = Array.isArray(state.technicalManagers) ? state.technicalManagers : [];
    const certs = Array.isArray(state.technicalCertificates) ? state.technicalCertificates : [];
    const query = (ctx.search || '').trim().toLowerCase();
    const today = todayISO();

    const filtered = managers.filter((m) => {
      if (this.statusFilter !== 'all' && m.status !== this.statusFilter) return false;
      if (this.domainFilter !== 'all') {
        const grp = SPECIALTY_GROUPS.find((g) => g.key === this.domainFilter);
        const mgrSpecs = new Set(Array.isArray(m.specialties) ? m.specialties : []);
        if (grp && !grp.items.some((it) => mgrSpecs.has(it))) return false;
      }
      if (query) {
        const hay = `${m.code} ${m.name} ${m.professionalTitle} ${m.entityOrder} ${m.licenseNumber} ${m.nif} ${(m.specialties || []).join(' ')}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const activeCount = managers.filter((m) => m.status === 'ativo').length;
    const eletricaSpecs = new Set(SPECIALTY_GROUPS.find((g) => g.key === 'eletrica')?.items || []);
    const alturaSpecs = new Set(SPECIALTY_GROUPS.find((g) => g.key === 'altura_seguranca')?.items || []);
    const eletricaCount = managers.filter((m) => (m.specialties || []).some((s) => eletricaSpecs.has(s))).length;
    const alturaCount = managers.filter((m) => (m.specialties || []).some((s) => alturaSpecs.has(s))).length;
    const expiredCertsCount = certs.filter((c) => c.expiryDate && c.expiryDate < today).length;

    const certsByMgr = new Map();
    certs.forEach((c) => {
      if (!certsByMgr.has(c.managerId)) certsByMgr.set(c.managerId, []);
      certsByMgr.get(c.managerId).push(c);
    });

    const projectsByMgr = new Map();
    (state.projects || []).forEach((p) => {
      if (p.managerId) {
        if (!projectsByMgr.has(p.managerId)) projectsByMgr.set(p.managerId, []);
        projectsByMgr.get(p.managerId).push(p);
      }
    });

    const canManage = this._canManage(ctx);
    const canDelete = !ctx.can || ctx.can('op_obras', 'excluir') || ctx.can('op_obras', 'responsaveis');

    container.innerHTML = `
      <div class="erp-kpi-grid">
        <div class="erp-kpi-card erp-kpi-card--primary">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Responsáveis Técnicos</span>
            <span class="erp-kpi-card__icon">${ICONS.users}</span>
          </div>
          <div class="erp-kpi-card__value">${managers.length}</div>
          <div class="erp-kpi-card__meta">${activeCount} ativo(s) disponíveis para obras</div>
        </div>

        <div class="erp-kpi-card">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Habilitados Elétrica / DGEG</span>
            <span class="erp-kpi-card__icon">${ICONS.checkCircle}</span>
          </div>
          <div class="erp-kpi-card__value">${eletricaCount}</div>
          <div class="erp-kpi-card__meta">Execução, Exploração &amp; ITED</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--success">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Altura, Andaimes &amp; Segurança</span>
            <span class="erp-kpi-card__icon">${ICONS.building}</span>
          </div>
          <div class="erp-kpi-card__value">${alturaCount}</div>
          <div class="erp-kpi-card__meta">ACT, IRATA, Andaimes &amp; CSO</div>
        </div>

        <div class="erp-kpi-card ${expiredCertsCount > 0 ? 'erp-kpi-card--danger' : 'erp-kpi-card--warning'}">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Certificados PDF Arquivados</span>
            <span class="erp-kpi-card__icon">${ICONS.paperclip}</span>
          </div>
          <div class="erp-kpi-card__value">${certs.length}</div>
          <div class="erp-kpi-card__meta">${expiredCertsCount > 0 ? `${expiredCertsCount} certificado(s) expirado(s)` : 'Todos os certificados dentro da validade'}</div>
        </div>
      </div>

      <div class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-panel__title-group">
            <h2 class="erp-panel__title">Responsáveis Técnicos, Especialidades &amp; Certificados PDF</h2>
            <p class="erp-panel__desc">Clique em qualquer responsável técnico para visualizar todas as suas especialidades, obras e certificados em PDF.</p>
          </div>
          <div class="erp-panel__actions">
            <select class="erp-select-sm" id="filterTechDomain" title="Filtrar por Área Técnica">
              <option value="all">Todas as Áreas Técnicas</option>
              ${SPECIALTY_GROUPS.map((g) => `<option value="${escapeHtml(g.key)}" ${this.domainFilter === g.key ? 'selected' : ''}>${escapeHtml(g.label)}</option>`).join('')}
            </select>
            <select class="erp-select-sm" id="filterTechStatus" title="Estado">
              <option value="all" ${this.statusFilter === 'all' ? 'selected' : ''}>Estado: Todos</option>
              <option value="ativo" ${this.statusFilter === 'ativo' ? 'selected' : ''}>Ativos</option>
              <option value="inativo" ${this.statusFilter === 'inativo' ? 'selected' : ''}>Inativos</option>
            </select>
            ${
              canManage
                ? `<button type="button" class="erp-btn erp-btn--primary" id="btnNewTechManager">
                    ${ICONS.plus}<span>Novo Responsável Técnico</span>
                  </button>`
                : ''
            }
          </div>
        </div>

        ${
          filtered.length === 0
            ? `<div class="erp-empty">${ICONS.users}<div class="erp-empty__title">Nenhum responsável técnico registado</div><p>Cadastre os engenheiros, encarregados e técnicos habilitados (DGEG, trabalho em altura, segurança, construção civil) para associá-los às obras.</p></div>`
            : `
          <div class="erp-table-wrap">
            <table class="erp-table">
              <thead>
                <tr>
                  <th>Responsável Técnico</th>
                  <th>Ordem / Cédula &amp; NIF</th>
                  <th>Especialidades</th>
                  <th>Certificados PDF</th>
                  <th>Obras</th>
                  <th>Estado</th>
                  <th style="text-align:right">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${filtered
                  .map((m) => {
                    const mCerts = certsByMgr.get(m.id) || [];
                    const mProjs = projectsByMgr.get(m.id) || [];
                    const specs = Array.isArray(m.specialties) ? m.specialties : [];
                    const hasExpired = mCerts.some((c) => c.expiryDate && c.expiryDate < today);
                    return `
                    <tr class="erp-proj-row" data-tech-row="${escapeHtml(m.id)}" title="Clique para ver todas as especialidades e certificados PDF">
                      <td>
                        <div class="erp-person-cell">
                          <span class="erp-avatar">${escapeHtml(getInitials(m.name))}</span>
                          <div>
                            <div class="erp-cell-title">${escapeHtml(m.name)}</div>
                            <div class="erp-cell-sub">${escapeHtml(m.code)} · ${escapeHtml(m.professionalTitle)}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(m.licenseNumber || 'Sem cédula')}</div>
                        <div class="erp-cell-sub">${escapeHtml(m.entityOrder || '—')}${m.nif ? ` · NIF ${escapeHtml(m.nif)}` : ''}</div>
                      </td>
                      <td>
                        <div class="erp-perm-tags">
                          ${specs.slice(0, 2).map((sp) => `<span class="erp-perm-tag">${escapeHtml(sp)}</span>`).join('')}
                          ${specs.length > 2 ? `<span class="erp-badge erp-badge--info">+${specs.length - 2} especialidade(s)</span>` : ''}
                          ${specs.length === 0 ? '<span class="erp-cell-sub">Sem especialidades</span>' : ''}
                        </div>
                      </td>
                      <td>
                        <span class="erp-badge ${hasExpired ? 'erp-badge--danger' : mCerts.length > 0 ? 'erp-badge--success' : 'erp-badge--neutral'}">
                          ${mCerts.length} certificado(s)${hasExpired ? ' · Expirado' : ''}
                        </span>
                      </td>
                      <td>
                        <span class="erp-badge erp-badge--neutral">${mProjs.length} obra(s)</span>
                      </td>
                      <td>
                        <span class="erp-badge ${m.status === 'ativo' ? 'erp-badge--success' : 'erp-badge--neutral'}">
                          ${m.status === 'ativo' ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td>
                        <div class="erp-row-actions">
                          <button type="button" class="erp-icon-btn" title="Ver Todas as Especialidades &amp; Certificados PDF" data-tech-view="${escapeHtml(m.id)}">${ICONS.eye}</button>
                          ${canManage ? `<button type="button" class="erp-icon-btn" title="Anexar Certificado PDF" data-tech-cert="${escapeHtml(m.id)}">${ICONS.paperclip}</button>` : ''}
                          ${canManage ? `<button type="button" class="erp-icon-btn" title="Editar Responsável Técnico" data-tech-edit="${escapeHtml(m.id)}">${ICONS.edit}</button>` : ''}
                          ${canDelete ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" title="Excluir Responsável Técnico" data-tech-del="${escapeHtml(m.id)}">${ICONS.trash}</button>` : ''}
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

    container.querySelector('#filterTechDomain').addEventListener('change', (e) => {
      this.domainFilter = e.target.value;
      store._commit();
    });

    container.querySelector('#filterTechStatus').addEventListener('change', (e) => {
      this.statusFilter = e.target.value;
      store._commit();
    });

    container.querySelector('#btnNewTechManager')?.addEventListener('click', () => {
      this.openNewTechnicalManager();
    });

    container.querySelectorAll('[data-tech-row]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.erp-row-actions, button, a')) return;
        this._openManagerDetailPopup(row.dataset.techRow);
      });
    });

    container.querySelectorAll('[data-tech-view]').forEach((btn) => {
      btn.addEventListener('click', () => this._openManagerDetailPopup(btn.dataset.techView));
    });

    container.querySelectorAll('[data-tech-cert]').forEach((btn) => {
      btn.addEventListener('click', () => this._openAddCertificateModal(btn.dataset.techCert));
    });

    container.querySelectorAll('[data-tech-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mgr = (store.getState().technicalManagers || []).find((x) => x.id === btn.dataset.techEdit);
        if (mgr) this._openManagerFormModal(mgr);
      });
    });

    container.querySelectorAll('[data-tech-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mgr = (store.getState().technicalManagers || []).find((x) => x.id === btn.dataset.techDel);
        if (!mgr) return;
        confirmAction({
          title: 'Remover Responsável Técnico',
          message: `Tem a certeza de que pretende eliminar "${mgr.name}" (${mgr.code}) e todos os seus certificados PDF arquivados?`,
          onConfirm: () => {
            store.deleteTechnicalManager(mgr.id);
            showToast(`Responsável técnico ${mgr.name} removido.`);
          },
        });
      });
    });
  }

  openNewTechnicalManager() {
    this._openManagerFormModal(null);
  }

  _openManagerDetailPopup(managerId) {
    const state = store.getState();
    const mgr = (state.technicalManagers || []).find((m) => m.id === managerId || m.code === managerId);
    if (!mgr) return;

    const certs = (state.technicalCertificates || []).filter(
      (c) => c.managerId === mgr.id || c.managerId === mgr.code
    );
    const assignedProjects = (state.projects || []).filter(
      (p) => p.managerId === mgr.id || p.managerId === mgr.code
    );
    const specSet = new Set(Array.isArray(mgr.specialties) ? mgr.specialties : []);
    const canManage = this._canManage({ can: this._can });
    const canDelete = !this._can || this._can('op_obras', 'excluir') || this._can('op_obras', 'responsaveis');

    const groupedSpecsHtml = SPECIALTY_GROUPS.map((grp) => {
      const matched = grp.items.filter((it) => specSet.has(it));
      if (matched.length === 0) return '';
      return `
        <div class="erp-perm-card">
          <div class="erp-perm-card__head">
            <span class="erp-perm-card__title">${escapeHtml(grp.label)} (${matched.length})</span>
          </div>
          <div class="erp-perm-tags">
            ${matched.map((sp) => `<span class="erp-badge erp-badge--info">${escapeHtml(sp)}</span>`).join('')}
          </div>
        </div>
      `;
    }).filter(Boolean).join('');

    openModal({
      title: `${mgr.name} (${mgr.code})`,
      subtitle: `${mgr.professionalTitle} · ${mgr.entityOrder || 'Sem ordem associada'}`,
      size: 'wide',
      bodyHtml: `
        <div class="erp-summary-box" style="margin-bottom:16px;">
          <div>
            <div class="erp-summary-item__label">Cédula / Licença</div>
            <div class="erp-summary-item__val">${escapeHtml(mgr.licenseNumber || '—')}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Especialidades</div>
            <div class="erp-summary-item__val erp-summary-item__val--accent">${specSet.size}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Certificados PDF</div>
            <div class="erp-summary-item__val erp-summary-item__val--success">${certs.length}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Obras Atribuídas</div>
            <div class="erp-summary-item__val">${assignedProjects.length}</div>
          </div>
        </div>

        <div class="erp-form-grid erp-form-grid--3" style="margin-bottom:16px;">
          <div><div class="erp-cell-sub">NIF</div><div class="erp-cell-title">${escapeHtml(mgr.nif || '—')}</div></div>
          <div><div class="erp-cell-sub">Telemóvel</div><div class="erp-cell-title">${escapeHtml(mgr.phone || '—')}</div></div>
          <div><div class="erp-cell-sub">Email</div><div class="erp-cell-title">${escapeHtml(mgr.email || '—')}</div></div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">Especialidades &amp; Habilitações Técnicas (${specSet.size})</div>
          ${
            groupedSpecsHtml
              ? `<div class="erp-perm-matrix">${groupedSpecsHtml}</div>`
              : '<p class="erp-cell-sub">Nenhuma especialidade selecionada para este responsável técnico.</p>'
          }
        </div>

        <div class="erp-form-section">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
            <div class="erp-form-section__title" style="margin-bottom:0;">Certificados &amp; Documentos em PDF (${certs.length})</div>
            ${canManage ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" id="btnMgrAttachCert">${ICONS.plus}<span>Anexar Certificado PDF</span></button>` : ''}
          </div>
          ${
            certs.length === 0
              ? '<div class="erp-empty" style="padding:20px 14px;"><div class="erp-empty__title">Nenhum certificado PDF anexado</div><p>Anexe os certificados em PDF (Trabalho em Altura, DGEG, Cédula OE/OET, ACT, etc.).</p></div>'
              : `
            <div class="erp-table-wrap">
              <table class="erp-table">
                <thead>
                  <tr>
                    <th>Certificado / Entidade</th>
                    <th>N.º Documento</th>
                    <th>Emissão / Validade</th>
                    <th>PDF</th>
                    <th style="text-align:right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  ${certs
                    .map(
                      (c) => `
                    <tr>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(c.certificateType)}</div>
                        <div class="erp-cell-sub">${escapeHtml(c.category)}${c.issuer ? ` · ${escapeHtml(c.issuer)}` : ''}</div>
                      </td>
                      <td>${escapeHtml(c.certificateNumber || '—')}</td>
                      <td>
                        <div class="erp-cell-sub">Emissão: ${c.issueDate ? escapeHtml(formatDatePT(c.issueDate)) : '—'}</div>
                        <div style="margin-top:3px;">${c.expiryDate ? `${escapeHtml(formatDatePT(c.expiryDate))} ` : ''}${getCertificateValidityBadge(c.expiryDate)}</div>
                      </td>
                      <td>
                        ${
                          c.hasFile
                            ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-cert-view="${escapeHtml(c.id)}">${ICONS.eye}<span>Ver PDF</span></button>
                                <button type="button" class="erp-icon-btn" data-cert-dl="${escapeHtml(c.id)}" title="Descarregar Certificado">${ICONS.download}</button>
                              </div>`
                            : '<span class="erp-badge erp-badge--neutral">Sem PDF</span>'
                        }
                      </td>
                      <td style="text-align:right">
                        ${canDelete ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" data-cert-del="${escapeHtml(c.id)}" title="Remover Certificado">${ICONS.trash}</button>` : '—'}
                      </td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          }
        </div>

        ${
          assignedProjects.length > 0
            ? `<div class="erp-form-section">
                <div class="erp-form-section__title">Obras Atribuídas (${assignedProjects.length})</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  ${assignedProjects
                    .map((p) => `<span class="erp-badge erp-badge--neutral">${escapeHtml(p.code)} — ${escapeHtml(p.name)}</span>`)
                    .join('')}
                </div>
              </div>`
            : ''
        }
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
        ${canManage ? `<button type="button" class="erp-btn erp-btn--primary" id="btnMgrEdit">${ICONS.edit}<span>Editar Responsável Técnico</span></button>` : ''}
      `,
      onMount: (modal) => {
        modal.querySelector('#btnMgrEdit')?.addEventListener('click', () => {
          closeModal();
          this._openManagerFormModal(mgr);
        });
        modal.querySelector('#btnMgrAttachCert')?.addEventListener('click', () => {
          this._openAddCertificateModal(mgr.id, mgr.id);
        });
        modal.querySelectorAll('[data-cert-view]').forEach((btn) => {
          btn.addEventListener('click', () => this._previewCertificateById(btn.dataset.certView));
        });
        modal.querySelectorAll('[data-cert-dl]').forEach((btn) => {
          btn.addEventListener('click', () => this._downloadCertificateById(btn.dataset.certDl));
        });
        modal.querySelectorAll('[data-cert-del]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const cert = certs.find((x) => x.id === btn.dataset.certDel);
            if (!cert) return;
            confirmAction({
              title: 'Remover Certificado',
              message: `Eliminar o certificado "${cert.certificateType}"?`,
              onConfirm: () => {
                store.deleteTechnicalCertificate(cert.id);
                showToast('Certificado removido.');
                this._openManagerDetailPopup(mgr.id);
              },
            });
          });
        });
      },
    });
  }

  _openAddCertificateModal(managerId, returnToDetailId = null) {
    const state = store.getState();
    const mgr = (state.technicalManagers || []).find((m) => m.id === managerId || m.code === managerId);
    if (!mgr) return;

    let selectedFile = null;

    openModal({
      title: 'Anexar Certificado Técnico (PDF)',
      subtitle: `${mgr.name} (${mgr.code})`,
      bodyHtml: `
        <form id="techCertForm">
          <div class="erp-form-grid">
            <div class="erp-field erp-field--full">
              <label for="certTypeSel">Tipo de Certificado (Construção Civil, Elétrica, Altura, Segurança — PT) *</label>
              <select id="certTypeSel" required>
                ${CERTIFICATE_CATALOG.map((c) => `<option value="${escapeHtml(c.label)}" data-cat="${escapeHtml(c.category)}">${escapeHtml(c.label)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field">
              <label for="certNum">N.º do Certificado / Cédula</label>
              <input type="text" id="certNum" placeholder="Ex.: OE-45821 / DGEG-9921">
            </div>
            <div class="erp-field">
              <label for="certIssuer">Entidade Emissora</label>
              <input type="text" id="certIssuer" placeholder="Ex.: DGEG, ACT, Ordem dos Engenheiros">
            </div>
            <div class="erp-field">
              <label for="certIssue">Data de Emissão</label>
              <input type="date" id="certIssue" value="${todayISO()}">
            </div>
            <div class="erp-field">
              <label for="certExpiry">Data de Validade (se aplicável)</label>
              <input type="date" id="certExpiry">
            </div>
            <div class="erp-field erp-field--full">
              <label>Ficheiro PDF ou Foto do Certificado *</label>
              <div class="erp-dropzone" id="certDropzone">
                <input type="file" id="certFileInput" accept=".pdf,image/*" style="display:none;">
                <div class="erp-dropzone__title" id="certDropTitle">Clique para selecionar ou arraste o PDF do certificado (até 10 MB)</div>
                <div class="erp-dropzone__hint">Formatos aceites: PDF, PNG, JPG, WEBP</div>
              </div>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" id="btnCancelCert">Cancelar</button>
        <button type="submit" form="techCertForm" class="erp-btn erp-btn--primary" id="btnSubmitCert">${ICONS.plus}<span>Guardar Certificado PDF</span></button>
      `,
      onMount: (modal) => {
        const dropzone = modal.querySelector('#certDropzone');
        const fileInput = modal.querySelector('#certFileInput');
        const dropTitle = modal.querySelector('#certDropTitle');

        const handleFile = (f) => {
          if (!f) return;
          if (f.size > 10 * 1024 * 1024) {
            showToast('O ficheiro do certificado excede 10 MB.', 'danger');
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

        modal.querySelector('#btnCancelCert').addEventListener('click', () => {
          if (returnToDetailId) {
            this._openManagerDetailPopup(returnToDetailId);
          } else {
            closeModal();
          }
        });

        modal.querySelector('#techCertForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!selectedFile) {
            showToast('Anexe o PDF ou imagem do certificado.', 'danger');
            return;
          }
          const btn = modal.querySelector('#btnSubmitCert');
          btn.disabled = true;
          btn.textContent = 'A guardar...';

          const sel = modal.querySelector('#certTypeSel');
          const opt = sel.options[sel.selectedIndex];
          const certId = generateId('CERT');
          let meta;
          try {
            meta = await saveCertificateFile(certId, selectedFile);
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Guardar Certificado PDF';
            showToast(err?.message || 'Erro ao preparar o certificado.', 'danger');
            return;
          }

          await store.addTechnicalCertificate({
            id: certId,
            managerId: mgr.code || mgr.id,
            certificateType: sel.value,
            category: opt?.dataset?.cat || 'Construção Civil',
            certificateNumber: modal.querySelector('#certNum').value.trim(),
            issuer: modal.querySelector('#certIssuer').value.trim(),
            issueDate: modal.querySelector('#certIssue').value || '',
            expiryDate: modal.querySelector('#certExpiry').value || '',
            notes: '',
            fileName: meta.name,
            fileType: meta.type,
            fileSize: meta.size,
            hasFile: true,
            createdAt: todayISO(),
          });

          showToast('Certificado PDF anexado com sucesso.');
          if (returnToDetailId) {
            this._openManagerDetailPopup(returnToDetailId);
          } else {
            closeModal();
          }
        });
      },
    });
  }

  _openManagerFormModal(existing = null) {
    const state = store.getState();
    const isEdit = Boolean(existing);
    const mgr = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
          code: `TEC-${String((state.technicalManagers || []).length + 1).padStart(3, '0')}`,
          name: '',
          professionalTitle: PROFESSIONAL_TITLES[0],
          entityOrder: ENTITY_ORDERS[0],
          licenseNumber: '',
          nif: '',
          cc: '',
          phone: '+351 ',
          email: '',
          specialties: [],
          status: 'ativo',
          notes: '',
        };

    const formCerts = isEdit
      ? (state.technicalCertificates || [])
          .filter((c) => c.managerId === mgr.id || c.managerId === mgr.code)
          .map((c) => ({ ...c, isNew: false }))
      : [];
    const deletedCertIds = [];
    const selectedSpecs = new Set(Array.isArray(mgr.specialties) ? mgr.specialties : []);

    const bodyHtml = `
      <form id="techManagerForm">
        <div class="erp-form-section">
          <div class="erp-form-section__title">1. Identificação &amp; Qualificação Profissional</div>
          <div class="erp-form-grid erp-form-grid--3">
            <div class="erp-field">
              <label for="mgrCode">Código Interno *</label>
              <input type="text" id="mgrCode" required value="${escapeHtml(mgr.code)}" ${isEdit ? 'readonly' : ''}>
            </div>
            <div class="erp-field" style="grid-column:span 2;">
              <label for="mgrName">Nome Completo *</label>
              <input type="text" id="mgrName" required value="${escapeHtml(mgr.name)}" placeholder="Ex.: Eng. João Manuel Ferreira">
            </div>

            <div class="erp-field">
              <label for="mgrTitle">Titulação / Função Técnica *</label>
              <select id="mgrTitle" required>
                ${PROFESSIONAL_TITLES.map((t) => `<option value="${escapeHtml(t)}" ${mgr.professionalTitle === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field">
              <label for="mgrEntity">Ordem / Entidade Reguladora</label>
              <select id="mgrEntity">
                ${ENTITY_ORDERS.map((o) => `<option value="${escapeHtml(o)}" ${mgr.entityOrder === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field">
              <label for="mgrLicense">N.º Cédula / Carteira / DGEG</label>
              <input type="text" id="mgrLicense" value="${escapeHtml(mgr.licenseNumber)}" placeholder="Ex.: OE 54210 / DGEG 8821">
            </div>

            <div class="erp-field">
              <label for="mgrNif">NIF (Portugal)</label>
              <input type="text" id="mgrNif" maxlength="9" value="${escapeHtml(mgr.nif)}" placeholder="9 dígitos">
            </div>
            <div class="erp-field">
              <label for="mgrPhone">Telemóvel *</label>
              <input type="tel" id="mgrPhone" required value="${escapeHtml(mgr.phone)}" placeholder="+351 912 345 678">
            </div>
            <div class="erp-field">
              <label for="mgrEmail">Email Profissional</label>
              <input type="email" id="mgrEmail" value="${escapeHtml(mgr.email)}" placeholder="tecnico@sparksmirk.pt">
            </div>

            <div class="erp-field">
              <label for="mgrCc">Cartão de Cidadão (Opcional)</label>
              <input type="text" id="mgrCc" value="${escapeHtml(mgr.cc)}" placeholder="Ex.: 12345678 9 ZX0">
            </div>
            <div class="erp-field">
              <label for="mgrStatus">Estado</label>
              <select id="mgrStatus">
                <option value="ativo" ${mgr.status === 'ativo' ? 'selected' : ''}>Ativo (Disponível para Obras)</option>
                <option value="inativo" ${mgr.status === 'inativo' ? 'selected' : ''}>Inativo</option>
              </select>
            </div>
            <div class="erp-field">
              <label for="mgrNotes">Observações Técnicas</label>
              <input type="text" id="mgrNotes" value="${escapeHtml(mgr.notes)}" placeholder="Ex.: Disponibilidade Norte/Centro">
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">2. Especialidades &amp; Habilitações (Construção Civil, Elétrica, Trabalho em Altura &amp; Segurança)</div>
          <div class="erp-perm-matrix">
            ${SPECIALTY_GROUPS.map(
              (grp) => `
              <div class="erp-perm-card" data-spec-group="${escapeHtml(grp.key)}">
                <div class="erp-perm-card__head">
                  <span class="erp-perm-card__title">${escapeHtml(grp.label)}</span>
                  <div style="display:flex;gap:6px;">
                    <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-spec-all="${escapeHtml(grp.key)}">Marcar Todas</button>
                    <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-spec-none="${escapeHtml(grp.key)}">Limpar</button>
                  </div>
                </div>
                <div class="erp-perm-grid">
                  ${grp.items
                    .map(
                      (sp) => `
                    <label class="erp-perm-chip">
                      <input type="checkbox" name="specialties" value="${escapeHtml(sp)}" ${selectedSpecs.has(sp) ? 'checked' : ''}>
                      <span>${escapeHtml(sp)}</span>
                    </label>`
                    )
                    .join('')}
                </div>
              </div>`
            ).join('')}
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">3. Certificados &amp; Habilitações em PDF</div>
          <div class="erp-inline-invoice-box">
            <div class="erp-form-grid erp-form-grid--3">
              <div class="erp-field" style="grid-column:span 2;">
                <label for="formCertType">Tipo de Certificado *</label>
                <select id="formCertType">
                  ${CERTIFICATE_CATALOG.map((c) => `<option value="${escapeHtml(c.label)}" data-cat="${escapeHtml(c.category)}">${escapeHtml(c.label)}</option>`).join('')}
                </select>
              </div>
              <div class="erp-field">
                <label for="formCertNum">N.º Certificado / Registo</label>
                <input type="text" id="formCertNum" placeholder="Ex.: CERT-2026-01">
              </div>

              <div class="erp-field">
                <label for="formCertIssuer">Entidade Emissora</label>
                <input type="text" id="formCertIssuer" placeholder="Ex.: DGEG / ACT / OE / IRATA">
              </div>
              <div class="erp-field">
                <label for="formCertIssue">Data Emissão</label>
                <input type="date" id="formCertIssue" value="${todayISO()}">
              </div>
              <div class="erp-field">
                <label for="formCertExpiry">Data de Validade</label>
                <input type="date" id="formCertExpiry">
              </div>

              <div class="erp-field" style="grid-column:span 2;">
                <label for="formCertFile">Anexar Certificado PDF / Imagem (até 10 MB)</label>
                <input type="file" id="formCertFile" accept=".pdf,image/*">
              </div>
              <div class="erp-field" style="justify-content:flex-end;">
                <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnAddFormCert">
                  ${ICONS.plus}<span>Anexar Certificado PDF</span>
                </button>
              </div>
            </div>
            <div class="erp-cell-sub" id="formCertFileLabel" style="margin-top:6px;">Selecione o tipo e anexe o ficheiro PDF do certificado (Trabalho em Altura, DGEG, Cédula, CAP, etc.).</div>
          </div>
          <div id="formCertsList"></div>
        </div>
      </form>
    `;

    openModal({
      title: isEdit ? `Editar Responsável Técnico — ${mgr.name}` : 'Cadastrar Responsável Técnico',
      subtitle: 'Construção Civil, Instalações Elétricas, Trabalho em Altura e Segurança em Portugal',
      size: 'wide',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="techManagerForm" class="erp-btn erp-btn--primary" id="btnSubmitTechMgr">${isEdit ? 'Guardar Alterações' : 'Registar Responsável Técnico'}</button>
      `,
      onMount: (modal) => {
        const certsListEl = modal.querySelector('#formCertsList');
        const certFileInput = modal.querySelector('#formCertFile');
        const certFileLabel = modal.querySelector('#formCertFileLabel');

        modal.querySelectorAll('[data-spec-all]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const card = modal.querySelector(`[data-spec-group="${btn.dataset.specAll}"]`);
            card?.querySelectorAll('input[type="checkbox"]').forEach((c) => {
              c.checked = true;
            });
          });
        });

        modal.querySelectorAll('[data-spec-none]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const card = modal.querySelector(`[data-spec-group="${btn.dataset.specNone}"]`);
            card?.querySelectorAll('input[type="checkbox"]').forEach((c) => {
              c.checked = false;
            });
          });
        });

        const renderFormCerts = () => {
          if (!certsListEl) return;
          if (formCerts.length === 0) {
            certsListEl.innerHTML = '<div class="erp-cell-sub" style="padding:8px 4px;">Ainda não existem certificados PDF anexados a este responsável técnico.</div>';
            return;
          }
          certsListEl.innerHTML = `
            <div class="erp-table-wrap">
              <table class="erp-table">
                <thead>
                  <tr>
                    <th>Tipo de Certificado</th>
                    <th>N.º / Entidade</th>
                    <th>Validade</th>
                    <th>PDF</th>
                    <th style="text-align:right">Remover</th>
                  </tr>
                </thead>
                <tbody>
                  ${formCerts
                    .map(
                      (c, idx) => `
                    <tr>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(c.certificateType)}</div>
                        <div class="erp-cell-sub">${escapeHtml(c.category)}</div>
                      </td>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(c.certificateNumber || '—')}</div>
                        <div class="erp-cell-sub">${escapeHtml(c.issuer || '—')}</div>
                      </td>
                      <td>${c.expiryDate ? `${escapeHtml(formatDatePT(c.expiryDate))} ` : ''}${getCertificateValidityBadge(c.expiryDate)}</td>
                      <td><span class="erp-badge erp-badge--info">${escapeHtml(c.fileName || 'PDF Anexado')}</span></td>
                      <td style="text-align:right">
                        <button type="button" class="erp-icon-btn erp-icon-btn--danger" data-form-cert-del="${idx}" title="Remover certificado">${ICONS.trash}</button>
                      </td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          `;
          certsListEl.querySelectorAll('[data-form-cert-del]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const idx = Number(btn.dataset.formCertDel);
              const removed = formCerts.splice(idx, 1)[0];
              if (removed && !removed.isNew && removed.id) {
                deletedCertIds.push(removed.id);
              }
              renderFormCerts();
            });
          });
        };

        if (certFileInput && certFileLabel) {
          certFileInput.addEventListener('change', () => {
            const f = certFileInput.files?.[0];
            certFileLabel.textContent = f
              ? `Ficheiro selecionado: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`
              : 'Selecione o tipo e anexe o ficheiro PDF do certificado.';
          });
        }

        modal.querySelector('#btnAddFormCert')?.addEventListener('click', async () => {
          const typeSel = modal.querySelector('#formCertType');
          const opt = typeSel.options[typeSel.selectedIndex];
          const file = certFileInput?.files?.[0] || null;
          if (!file) {
            showToast('Anexe o ficheiro PDF ou imagem do certificado.', 'danger');
            return;
          }
          const certId = generateId('CERT');
          let meta;
          try {
            meta = await saveCertificateFile(certId, file);
          } catch (err) {
            showToast(err?.message || 'Erro ao preparar o ficheiro do certificado.', 'danger');
            return;
          }

          formCerts.unshift({
            id: certId,
            certificateType: typeSel.value,
            category: opt?.dataset?.cat || 'Construção Civil',
            certificateNumber: modal.querySelector('#formCertNum').value.trim(),
            issuer: modal.querySelector('#formCertIssuer').value.trim(),
            issueDate: modal.querySelector('#formCertIssue').value || '',
            expiryDate: modal.querySelector('#formCertExpiry').value || '',
            notes: '',
            fileName: meta.name,
            fileType: meta.type,
            fileSize: meta.size,
            hasFile: true,
            createdAt: todayISO(),
            isNew: true,
          });

          modal.querySelector('#formCertNum').value = '';
          modal.querySelector('#formCertIssuer').value = '';
          modal.querySelector('#formCertExpiry').value = '';
          if (certFileInput) certFileInput.value = '';
          if (certFileLabel) {
            certFileLabel.textContent = 'Selecione o tipo e anexe o ficheiro PDF do certificado.';
          }

          renderFormCerts();
          showToast('Certificado adicionado à lista.');
        });

        renderFormCerts();

        modal.querySelector('#techManagerForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const cleanNif = modal.querySelector('#mgrNif').value.replace(/\D/g, '');
          if (cleanNif && !isValidNIF(cleanNif)) {
            showToast('NIF inválido. Verifique os 9 dígitos do contribuinte.', 'danger');
            return;
          }

          const specs = [...modal.querySelectorAll('input[name="specialties"]:checked')].map((c) => c.value);
          if (specs.length === 0) {
            showToast('Selecione pelo menos uma especialidade técnica para este responsável.', 'warning');
            return;
          }

          const submitBtn = modal.querySelector('#btnSubmitTechMgr');
          submitBtn.disabled = true;
          submitBtn.textContent = 'A guardar...';

          const payload = {
            code: modal.querySelector('#mgrCode').value.trim(),
            name: modal.querySelector('#mgrName').value.trim(),
            professionalTitle: modal.querySelector('#mgrTitle').value,
            entityOrder: modal.querySelector('#mgrEntity').value,
            licenseNumber: modal.querySelector('#mgrLicense').value.trim(),
            nif: cleanNif,
            cc: modal.querySelector('#mgrCc').value.trim(),
            phone: modal.querySelector('#mgrPhone').value.trim(),
            email: modal.querySelector('#mgrEmail').value.trim(),
            specialties: specs,
            status: modal.querySelector('#mgrStatus').value,
            notes: modal.querySelector('#mgrNotes').value.trim(),
          };

          const mgrCode = payload.code || (isEdit ? mgr.code : generateId('TEC'));
          if (isEdit) {
            await store.updateTechnicalManager(mgr.id, payload);
          } else {
            await store.addTechnicalManager({ id: mgrCode, ...payload });
          }

          for (const delId of deletedCertIds) {
            store.deleteTechnicalCertificate(delId);
          }

          const newCerts = formCerts.filter((c) => c.isNew);
          for (const c of newCerts) {
            await store.addTechnicalCertificate({
              ...c,
              managerId: mgrCode,
            });
          }

          showToast(
            isEdit
              ? `Responsável técnico ${payload.name} atualizado.`
              : `Responsável técnico ${payload.name} registado com ${specs.length} especialidade(s).`
          );
          closeModal();
        });
      },
    });
  }

  async _previewCertificateById(certId) {
    const record = await getTechnicalCertificateFile(certId);
    if (!record) return;

    const blob = new window.Blob([record.data], { type: record.type });
    const url = window.URL.createObjectURL(blob);
    const isPdf = (record.type || '').includes('pdf') || record.name.toLowerCase().endsWith('.pdf');

    openModal({
      title: `Certificado Técnico — ${record.name}`,
      subtitle: `${Math.max(1, Math.round(record.size / 1024))} KB`,
      size: 'wide',
      bodyHtml: isPdf
        ? `<iframe class="erp-attachment-preview" src="${url}" title="Pré-visualização do certificado"></iframe>`
        : `<img class="erp-attachment-img" src="${url}" alt="Certificado técnico">`,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
        <a href="${url}" download="${escapeHtml(record.name)}" class="erp-btn erp-btn--primary">${ICONS.download}<span>Descarregar PDF</span></a>
      `,
    });
  }

  async _downloadCertificateById(certId) {
    const record = await getTechnicalCertificateFile(certId);
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
}
