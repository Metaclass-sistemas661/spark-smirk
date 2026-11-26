/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — RH: Candidaturas & Currículos (Trabalhe Connosco)
   ═══════════════════════════════════════════════════════════ */

import { store, getCandidateCvFile } from '../core/store.js';
import {
  downloadCSV,
  escapeHtml,
  formatDatePT,
  getInitials,
} from '../core/formatters.js';
import { ICONS, openModal, closeModal, confirmAction, showToast } from '../core/ui.js';

const CANDIDATE_STATUS_META = {
  Nova: { cls: 'erp-badge--primary', label: 'Nova' },
  'Em Análise': { cls: 'erp-badge--warning', label: 'Em Análise' },
  Entrevista: { cls: 'erp-badge--info', label: 'Entrevista' },
  Contratado: { cls: 'erp-badge--success', label: 'Contratado' },
  Arquivada: { cls: 'erp-badge--neutral', label: 'Arquivada' },
};

export class RhCandidaturasModule {
  constructor() {
    this.statusFilter = 'all';
    this.specialtyFilter = 'all';
    this.refreshing = false;
  }

  render(container, ctx) {
    const state = store.getState();
    const candidates = Array.isArray(state.candidates) ? state.candidates : [];
    const query = (ctx?.search || '').trim().toLowerCase();
    const canEdit = ctx?.can ? ctx.can('rh_funcionarios', 'editar') || ctx.can('rh_funcionarios', 'criar') : true;
    const canDelete = ctx?.can ? ctx.can('rh_funcionarios', 'excluir') : true;

    const specialties = [...new Set(candidates.map((c) => c.specialty).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'pt')
    );

    if (this.specialtyFilter !== 'all' && !specialties.includes(this.specialtyFilter)) {
      this.specialtyFilter = 'all';
    }

    const filtered = candidates.filter((c) => {
      if (this.statusFilter !== 'all' && c.status !== this.statusFilter) return false;
      if (this.specialtyFilter !== 'all' && c.specialty !== this.specialtyFilter) return false;
      if (query) {
        const hay = `${c.id} ${c.fullName} ${c.email} ${c.phone} ${c.district} ${c.specialty} ${c.certifications} ${c.message}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const totalCount = candidates.length;
    const newCount = candidates.filter((c) => c.status === 'Nova').length;
    const interviewCount = candidates.filter((c) => c.status === 'Entrevista' || c.status === 'Em Análise').length;
    const withCvCount = candidates.filter((c) => Boolean(c.cvFileName || c.cvStoragePath)).length;

    container.innerHTML = `
      <div class="erp-kpi-grid">
        <div class="erp-kpi-card erp-kpi-card--primary">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Total de Candidaturas</span>
            <span class="erp-kpi-card__icon">${ICONS.users}</span>
          </div>
          <div class="erp-kpi-card__value">${totalCount}</div>
          <div class="erp-kpi-card__meta">Recebidas via Trabalhe Connosco</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--warning">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Novas por Analisar</span>
            <span class="erp-kpi-card__icon">${ICONS.clock}</span>
          </div>
          <div class="erp-kpi-card__value">${newCount}</div>
          <div class="erp-kpi-card__meta">Aguardam triagem de RH</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--info">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Em Análise / Entrevista</span>
            <span class="erp-kpi-card__icon">${ICONS.checkCircle}</span>
          </div>
          <div class="erp-kpi-card__value">${interviewCount}</div>
          <div class="erp-kpi-card__meta">Perfis em avaliação ativa</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--success">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Com Currículo (CV)</span>
            <span class="erp-kpi-card__icon">${ICONS.paperclip}</span>
          </div>
          <div class="erp-kpi-card__value">${withCvCount}</div>
          <div class="erp-kpi-card__meta">Documentos arquivados em nuvem</div>
        </div>
      </div>

      <div class="erp-panel">
        <div class="erp-panel__header">
          <div>
            <h2 class="erp-panel__title">Candidaturas Recebidas — Recrutamento</h2>
            <p class="erp-panel__subtitle">
              Dados completos enviados pelos candidatos na página Trabalhe Connosco com acesso direto ao currículo anexado.
            </p>
          </div>
          <div class="erp-panel__actions">
            <button type="button" class="erp-btn erp-btn--outline" id="btnRefreshCandidates">
              <span>${this.refreshing ? 'A atualizar...' : 'Atualizar Lista'}</span>
            </button>
            <button type="button" class="erp-btn erp-btn--outline" id="btnExportCandidatesCsv">
              ${ICONS.download}
              <span>Exportar CSV</span>
            </button>
          </div>
        </div>

        <div class="erp-attendance-controls">
          <div class="erp-filter-bar">
            <select class="erp-select-sm" id="filterCandStatus" title="Estado da candidatura">
              <option value="all" ${this.statusFilter === 'all' ? 'selected' : ''}>Estado: Todos</option>
              <option value="Nova" ${this.statusFilter === 'Nova' ? 'selected' : ''}>Nova</option>
              <option value="Em Análise" ${this.statusFilter === 'Em Análise' ? 'selected' : ''}>Em Análise</option>
              <option value="Entrevista" ${this.statusFilter === 'Entrevista' ? 'selected' : ''}>Entrevista</option>
              <option value="Contratado" ${this.statusFilter === 'Contratado' ? 'selected' : ''}>Contratado</option>
              <option value="Arquivada" ${this.statusFilter === 'Arquivada' ? 'selected' : ''}>Arquivada</option>
            </select>

            <select class="erp-select-sm" id="filterCandSpecialty" title="Especialidade">
              <option value="all">Todas as Especialidades</option>
              ${specialties
                .map((sp) => `<option value="${escapeHtml(sp)}" ${this.specialtyFilter === sp ? 'selected' : ''}>${escapeHtml(sp)}</option>`)
                .join('')}
            </select>
          </div>

          ${
            this.statusFilter !== 'all' || this.specialtyFilter !== 'all'
              ? `<button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnClearCandFilters">Limpar Filtros</button>`
              : `<span class="erp-cell-sub">${filtered.length} candidatura(s) apresentada(s)</span>`
          }
        </div>

        ${
          filtered.length === 0
            ? `<div class="erp-empty">
                ${ICONS.users}
                <div class="erp-empty__title">Sem candidaturas para apresentar</div>
                <p>Assim que um candidato submeter o formulário na página Trabalhe Connosco, os dados e o currículo ficarão disponíveis aqui.</p>
              </div>`
            : `<div class="erp-table-wrap">
                <table class="erp-table">
                  <thead>
                    <tr>
                      <th>Candidato &amp; Contacto</th>
                      <th>Especialidade &amp; Experiência</th>
                      <th>Disponibilidade &amp; Carta</th>
                      <th>Currículo Anexado</th>
                      <th>Estado</th>
                      <th>Data</th>
                      <th style="text-align:right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filtered
                      .map((c) => {
                        const statusMeta = CANDIDATE_STATUS_META[c.status] || CANDIDATE_STATUS_META.Nova;
                        const sizeKb = c.cvFileSize ? `${Math.max(1, Math.round(Number(c.cvFileSize) / 1024))} KB` : '';
                        return `
                        <tr>
                          <td>
                            <div class="erp-person-cell">
                              <span class="erp-avatar">${escapeHtml(getInitials(c.fullName))}</span>
                              <div>
                                <div class="erp-cell-title">${escapeHtml(c.fullName)}</div>
                                <div class="erp-cell-sub">${escapeHtml(c.email)} · ${escapeHtml(c.phone)}</div>
                                <div class="erp-cell-sub">${escapeHtml(c.district || 'Porto')} · ${escapeHtml(c.id)}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div class="erp-cell-title">${escapeHtml(c.specialty)}</div>
                            <div class="erp-cell-sub">Experiência: ${escapeHtml(c.experience)}</div>
                            ${
                              c.certifications
                                ? `<div class="erp-cell-sub">Cert.: ${escapeHtml(c.certifications)}</div>`
                                : ''
                            }
                          </td>
                          <td>
                            <div class="erp-cell-title">${escapeHtml(c.availability)}</div>
                            <div class="erp-cell-sub">${escapeHtml(c.drivingLicense || 'Não indicada')}</div>
                          </td>
                          <td>
                            ${
                              c.cvFileName
                                ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                     <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-view-cv="${escapeHtml(c.id)}" title="${escapeHtml(c.cvFileName)}">
                                       ${ICONS.eye}
                                       <span>Ver CV</span>
                                     </button>
                                     <button type="button" class="erp-icon-btn" title="Descarregar ${escapeHtml(c.cvFileName)}" data-dl-cv="${escapeHtml(c.id)}">${ICONS.download}</button>
                                   </div>
                                   <div class="erp-cell-sub" style="margin-top:4px;">${escapeHtml(c.cvFileName)}${sizeKb ? ` (${escapeHtml(sizeKb)})` : ''}</div>`
                                : '<span class="erp-badge erp-badge--neutral">Sem ficheiro</span>'
                            }
                          </td>
                          <td>
                            <span class="erp-badge ${statusMeta.cls}">${escapeHtml(statusMeta.label)}</span>
                          </td>
                          <td>
                            <div class="erp-cell-sub">${c.createdAt ? escapeHtml(formatDatePT(c.createdAt)) : '—'}</div>
                          </td>
                          <td>
                            <div class="erp-row-actions">
                              <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-open-cand="${escapeHtml(c.id)}">
                                <span>Ficha</span>
                              </button>
                              ${
                                canDelete
                                  ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" title="Excluir Candidatura" data-del-cand="${escapeHtml(c.id)}">${ICONS.trash}</button>`
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
      </div>
    `;

    this._bindEvents(container, filtered, { canEdit, canDelete });
  }

  _bindEvents(container, filtered, perms) {
    container.querySelector('#filterCandStatus')?.addEventListener('change', (e) => {
      this.statusFilter = e.target.value;
      store._commit();
    });

    container.querySelector('#filterCandSpecialty')?.addEventListener('change', (e) => {
      this.specialtyFilter = e.target.value;
      store._commit();
    });

    container.querySelector('#btnClearCandFilters')?.addEventListener('click', () => {
      this.statusFilter = 'all';
      this.specialtyFilter = 'all';
      store._commit();
    });

    container.querySelector('#btnRefreshCandidates')?.addEventListener('click', async () => {
      if (this.refreshing) return;
      this.refreshing = true;
      store._commit();
      try {
        await store.fetchCandidates();
        showToast('Lista de candidaturas atualizada.');
      } finally {
        this.refreshing = false;
        store._commit();
      }
    });

    container.querySelector('#btnExportCandidatesCsv')?.addEventListener('click', () => {
      const headers = [
        'Código',
        'Nome',
        'Email',
        'Telemóvel',
        'Distrito',
        'Especialidade',
        'Experiência',
        'Disponibilidade',
        'Carta de Condução',
        'Certificações',
        'Currículo',
        'Estado',
        'Data',
      ];
      const rows = filtered.map((c) => [
        c.id,
        c.fullName,
        c.email,
        c.phone,
        c.district,
        c.specialty,
        c.experience,
        c.availability,
        c.drivingLicense,
        c.certifications,
        c.cvFileName,
        c.status,
        c.createdAt,
      ]);
      downloadCSV('candidaturas-spark-smirk.csv', headers, rows);
      showToast('Lista de candidaturas exportada em CSV.');
    });

    container.querySelectorAll('[data-view-cv]').forEach((btn) => {
      btn.addEventListener('click', () => this._previewCandidateCv(btn.dataset.viewCv));
    });

    container.querySelectorAll('[data-dl-cv]').forEach((btn) => {
      btn.addEventListener('click', () => this._downloadCandidateCv(btn.dataset.dlCv));
    });

    container.querySelectorAll('[data-open-cand]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cand = (store.getState().candidates || []).find((x) => x.id === btn.dataset.openCand);
        if (cand) this._openCandidateModal(cand, perms);
      });
    });

    container.querySelectorAll('[data-del-cand]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cand = (store.getState().candidates || []).find((x) => x.id === btn.dataset.delCand);
        if (!cand) return;
        confirmAction({
          title: 'Remover Candidatura',
          message: `Tem a certeza de que pretende eliminar permanentemente a candidatura de "${cand.fullName}" e o respetivo currículo?`,
          confirmLabel: 'Eliminar Candidatura',
          onConfirm: async () => {
            const res = await store.deleteCandidate(cand.id);
            if (res !== null) {
              showToast('Candidatura removida.');
            }
          },
        });
      });
    });
  }

  async _previewCandidateCv(code) {
    const record = await getCandidateCvFile(code);
    if (!record) return;

    const blob = new window.Blob([record.data], { type: record.type });
    const url = window.URL.createObjectURL(blob);
    const lowerName = String(record.name || '').toLowerCase();
    const isPdf = (record.type || '').includes('pdf') || lowerName.endsWith('.pdf');
    const isImage = (record.type || '').startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(lowerName);

    if (!isPdf && !isImage) {
      // Para Word (.doc/.docx), descarrega diretamente com aviso
      const a = document.createElement('a');
      a.href = url;
      a.download = record.name || 'curriculo.docx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('Currículo em Word descarregado para visualização local.');
      return;
    }

    openModal({
      title: `Currículo — ${record.name}`,
      subtitle: `${Math.max(1, Math.round((record.size || 0) / 1024))} KB`,
      size: 'wide',
      bodyHtml: isPdf
        ? `<iframe class="erp-attachment-preview" src="${url}" title="Pré-visualização do currículo"></iframe>`
        : `<img class="erp-attachment-img" src="${url}" alt="Currículo do candidato">`,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
        <a href="${url}" download="${escapeHtml(record.name)}" class="erp-btn erp-btn--primary">${ICONS.download}<span>Descarregar</span></a>
      `,
    });
  }

  async _downloadCandidateCv(code) {
    const record = await getCandidateCvFile(code);
    if (!record) return;
    const blob = new window.Blob([record.data], { type: record.type });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = record.name || `${code}-cv.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  _openCandidateModal(cand, { canEdit }) {
    const statusMeta = CANDIDATE_STATUS_META[cand.status] || CANDIDATE_STATUS_META.Nova;
    const sizeKb = cand.cvFileSize ? `${Math.max(1, Math.round(Number(cand.cvFileSize) / 1024))} KB` : '';

    const bodyHtml = `
      <form id="candidateReviewForm">
        <div class="erp-form-section">
          <div class="erp-form-section__title">1. Dados Submetidos pelo Candidato</div>
          <div class="erp-form-grid">
            <div class="erp-field">
              <label>Nome Completo</label>
              <input type="text" value="${escapeHtml(cand.fullName)}" disabled>
            </div>
            <div class="erp-field">
              <label>Código / Data de Submissão</label>
              <input type="text" value="${escapeHtml(cand.id)} · ${escapeHtml(cand.createdAt ? formatDatePT(cand.createdAt) : '—')}" disabled>
            </div>
            <div class="erp-field">
              <label>Email</label>
              <input type="text" value="${escapeHtml(cand.email)}" disabled>
            </div>
            <div class="erp-field">
              <label>Telemóvel / Telefone</label>
              <input type="text" value="${escapeHtml(cand.phone)}" disabled>
            </div>
            <div class="erp-field">
              <label>Distrito / Localidade</label>
              <input type="text" value="${escapeHtml(cand.district || 'Porto')}" disabled>
            </div>
            <div class="erp-field">
              <label>Área / Especialidade Pretendida</label>
              <input type="text" value="${escapeHtml(cand.specialty)}" disabled>
            </div>
            <div class="erp-field">
              <label>Experiência Profissional</label>
              <input type="text" value="${escapeHtml(cand.experience)}" disabled>
            </div>
            <div class="erp-field">
              <label>Disponibilidade</label>
              <input type="text" value="${escapeHtml(cand.availability)}" disabled>
            </div>
            <div class="erp-field">
              <label>Carta de Condução</label>
              <input type="text" value="${escapeHtml(cand.drivingLicense || 'Não indicada')}" disabled>
            </div>
            <div class="erp-field">
              <label>Certificações / Carteiras</label>
              <input type="text" value="${escapeHtml(cand.certifications || 'Nenhuma indicada')}" disabled>
            </div>
            <div class="erp-field erp-field--full">
              <label>Apresentação / Nota do Candidato</label>
              <textarea rows="3" disabled>${escapeHtml(cand.message || 'Sem nota adicional.')}</textarea>
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">2. Currículo Anexado</div>
          ${
            cand.cvFileName
              ? `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:12px 14px;border:1px solid var(--erp-border);border-radius:var(--erp-radius-md);background:var(--erp-surface-alt);">
                   <div>
                     <div style="font-weight:700;color:var(--erp-heading);">${escapeHtml(cand.cvFileName)}</div>
                     <div style="font-size:12px;color:var(--erp-text-muted);">${escapeHtml(sizeKb || 'Documento anexado')}</div>
                   </div>
                   <div style="display:flex;gap:8px;flex-wrap:wrap;">
                     <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnModalViewCv">${ICONS.eye}<span>Visualizar Currículo</span></button>
                     <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" id="btnModalDlCv">${ICONS.download}<span>Descarregar</span></button>
                   </div>
                 </div>`
              : `<p class="erp-cell-sub">Nenhum ficheiro de currículo anexado.</p>`
          }
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">3. Triagem &amp; Avaliação Interna (RH)</div>
          <div class="erp-form-grid">
            <div class="erp-field">
              <label for="candModalStatus">Estado Atual</label>
              <select id="candModalStatus" name="status" ${canEdit ? '' : 'disabled'}>
                <option value="Nova" ${cand.status === 'Nova' ? 'selected' : ''}>Nova</option>
                <option value="Em Análise" ${cand.status === 'Em Análise' ? 'selected' : ''}>Em Análise</option>
                <option value="Entrevista" ${cand.status === 'Entrevista' ? 'selected' : ''}>Entrevista</option>
                <option value="Contratado" ${cand.status === 'Contratado' ? 'selected' : ''}>Contratado</option>
                <option value="Arquivada" ${cand.status === 'Arquivada' ? 'selected' : ''}>Arquivada</option>
              </select>
            </div>
            <div class="erp-field">
              <label>Classificação</label>
              <div style="padding-top:8px;">
                <span class="erp-badge ${statusMeta.cls}">${escapeHtml(statusMeta.label)}</span>
              </div>
            </div>
            <div class="erp-field erp-field--full">
              <label for="candModalNotes">Notas Internas de Recrutamento</label>
              <textarea id="candModalNotes" name="internalNotes" rows="3" placeholder="Registe feedback de entrevista, disponibilidade salarial ou observações da equipa..." ${canEdit ? '' : 'disabled'}>${escapeHtml(cand.internalNotes || '')}</textarea>
            </div>
          </div>
        </div>
      </form>
    `;

    openModal({
      title: `Ficha de Candidato — ${cand.fullName}`,
      subtitle: `${cand.specialty} · ${cand.district || 'Portugal'}`,
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
        ${canEdit ? '<button type="submit" form="candidateReviewForm" id="btnSaveCandReview" class="erp-btn erp-btn--primary">Guardar Avaliação</button>' : ''}
      `,
      onMount: (modal) => {
        modal.querySelector('#btnModalViewCv')?.addEventListener('click', () => this._previewCandidateCv(cand.id));
        modal.querySelector('#btnModalDlCv')?.addEventListener('click', () => this._downloadCandidateCv(cand.id));

        const reviewForm = modal.querySelector('#candidateReviewForm');
        const saveBtn = modal.querySelector('#btnSaveCandReview');
        reviewForm?.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!canEdit) return;
          const status = modal.querySelector('#candModalStatus').value;
          const internalNotes = modal.querySelector('#candModalNotes').value;
          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'A guardar...';
          }
          try {
            const res = await store.updateCandidate(cand.id, { status, internalNotes });
            if (res !== null) {
              closeModal();
              showToast('Avaliação da candidatura guardada com sucesso.');
            }
          } finally {
            if (saveBtn) {
              saveBtn.disabled = false;
              saveBtn.textContent = 'Guardar Avaliação';
            }
          }
        });
      },
    });
  }
}
