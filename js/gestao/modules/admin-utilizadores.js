/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Administração: Utilizadores & Permissões
   Ligado ao Supabase Auth + seguranca.perfis_utilizadores
   ═══════════════════════════════════════════════════════════ */

import { authenticatedApiFetch } from '../../shared/supabase-client.js';
import {
  PERMISSION_MODULES,
  ROLE_LABELS,
  createRolePermissions,
  normalizePermissions,
  hasPermission,
  blockAllFinancialPermissions,
  areAllFinancialValuesBlocked,
  countGrantedPermissions,
} from '../../shared/permissions.js';
import { escapeHtml, getInitials, formatDatePT } from '../core/formatters.js';
import { ICONS, openModal, closeModal, confirmAction, showToast } from '../core/ui.js';

function generateProvisionalPassword(length = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '@#$%&*!';
  const all = upper + lower + digits + special;

  const pick = (pool) => pool[Math.floor(Math.random() * pool.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < length) {
    chars.push(pick(all));
  }
  return chars.sort(() => Math.random() - 0.5).join('');
}

function summarizeModules(user) {
  if (user.nivel_acesso === 'administrador' && !areAllFinancialValuesBlocked(user.permissoes)) {
    return '<span class="erp-perm-tag">Acesso Total (Todos os Módulos)</span>';
  }
  const tags = [];
  if (areAllFinancialValuesBlocked(user.permissoes)) {
    tags.push('<span class="erp-badge erp-badge--danger" style="font-size:10.5px;">Valores € Bloqueados</span>');
  }
  for (const mod of PERMISSION_MODULES) {
    const perms = user.permissoes?.[mod.key] || {};
    const granted = mod.actions.filter((a) => perms[a.key] === true).length;
    if (granted > 0) {
      const shortName = mod.label.split('—')[0].trim();
      tags.push(`<span class="erp-perm-tag">${escapeHtml(shortName)} (${granted})</span>`);
    }
  }
  return tags.length
    ? tags.join('')
    : '<span class="erp-perm-tag">Sem acessos atribuídos</span>';
}

export class AdminUtilizadoresModule {
  constructor({ onUsersUpdated, onProfileUpdated } = {}) {
    this.onUsersUpdated = onUsersUpdated;
    this.onProfileUpdated = onProfileUpdated;
    this.users = [];
    this.loading = false;
    this.loadedOnce = false;
    this.loadError = '';
    this.dbWarning = '';
    this.roleFilter = 'todos';
    this.statusFilter = 'todos';
    this.currentProfile = null;
    this.hostContainer = null;
    this.lastCtx = {};
  }

  setCurrentProfile(profile) {
    this.currentProfile = profile;
  }

  getUsersCount() {
    return this.users.length;
  }

  async fetchUsers({ silent = false } = {}) {
    if (this.loading) return;
    this.loading = true;
    this.loadError = '';
    if (!silent && this.hostContainer) {
      this._renderInto(this.hostContainer, this.lastCtx);
    }

    try {
      const data = await authenticatedApiFetch('/api/admin/users', { method: 'GET' });
      this.users = Array.isArray(data?.users) ? data.users : [];
      if (data?.dbWarning) {
        console.warn('Sync warning:', data.dbWarning);
      }
      this.loadedOnce = true;
      if (typeof this.onUsersUpdated === 'function') {
        this.onUsersUpdated(this.users.length);
      }
    } catch (err) {
      this.loadError = err?.message || 'Não foi possível carregar a lista de utilizadores.';
      this.loadedOnce = true;
    } finally {
      this.loading = false;
      if (this.hostContainer) {
        this._renderInto(this.hostContainer, this.lastCtx);
      }
    }
  }

  render(container, ctx = {}) {
    this.hostContainer = container;
    this.lastCtx = ctx;

    if (!this.loadedOnce && !this.loading) {
      this._renderInto(container, ctx);
      this.fetchUsers({ silent: true });
      return;
    }
    this._renderInto(container, ctx);
  }

  _renderInto(container, ctx) {
    const canCreate = hasPermission(this.currentProfile, 'admin_utilizadores', 'criar');
    const canEdit = hasPermission(this.currentProfile, 'admin_utilizadores', 'editar');
    const canDelete = hasPermission(this.currentProfile, 'admin_utilizadores', 'excluir');

    const search = (ctx?.search || '').trim().toLowerCase();
    const filtered = this.users.filter((u) => {
      if (this.roleFilter !== 'todos' && u.nivel_acesso !== this.roleFilter) return false;
      if (this.statusFilter === 'ativos' && !u.ativo) return false;
      if (this.statusFilter === 'inativos' && u.ativo) return false;
      if (this.statusFilter === 'provisoria' && !u.senha_provisoria) return false;
      if (!search) return true;
      return (
        (u.nome_completo || '').toLowerCase().includes(search) ||
        (u.email || '').toLowerCase().includes(search) ||
        (u.cargo || '').toLowerCase().includes(search) ||
        (u.departamento || '').toLowerCase().includes(search)
      );
    });

    const total = this.users.length;
    const ativos = this.users.filter((u) => u.ativo).length;
    const admins = this.users.filter((u) => u.nivel_acesso === 'administrador').length;
    const provisorias = this.users.filter((u) => u.senha_provisoria).length;

    container.innerHTML = `
      <div class="erp-kpi-grid">
        <article class="erp-kpi-card">
          <div class="erp-kpi-card__top">
            <span class="erp-kpi-card__label">Contas no Sistema</span>
            <div class="erp-kpi-card__icon erp-kpi-card__icon--navy">${ICONS.users}</div>
          </div>
          <div class="erp-kpi-card__value">${total}</div>
          <div class="erp-kpi-card__sub">${ativos} contas ativas no sistema</div>
        </article>

        <article class="erp-kpi-card">
          <div class="erp-kpi-card__top">
            <span class="erp-kpi-card__label">Administradores</span>
            <div class="erp-kpi-card__icon erp-kpi-card__icon--orange">${ICONS.checkCircle}</div>
          </div>
          <div class="erp-kpi-card__value">${admins}</div>
          <div class="erp-kpi-card__sub">Gestores com controlo integral</div>
        </article>

        <article class="erp-kpi-card">
          <div class="erp-kpi-card__top">
            <span class="erp-kpi-card__label">Senhas Provisórias</span>
            <div class="erp-kpi-card__icon erp-kpi-card__icon--amber">${ICONS.clock}</div>
          </div>
          <div class="erp-kpi-card__value">${provisorias}</div>
          <div class="erp-kpi-card__sub">A aguardar troca no 1.º acesso</div>
        </article>

        <article class="erp-kpi-card">
          <div class="erp-kpi-card__top">
            <span class="erp-kpi-card__label">Contas Bloqueadas</span>
            <div class="erp-kpi-card__icon erp-kpi-card__icon--green">${ICONS.alert}</div>
          </div>
          <div class="erp-kpi-card__value">${total - ativos}</div>
          <div class="erp-kpi-card__sub">Sem acesso permitido ao sistema</div>
        </article>
      </div>

      ${
        this.loadError
          ? `<div class="erp-panel" style="border-left:4px solid var(--erp-danger);padding:14px 18px;">
              <strong style="color:var(--erp-danger);display:block;margin-bottom:4px;">Não foi possível ligar ao serviço de utilizadores:</strong>
              <span style="font-size:12.5px;color:var(--erp-text-secondary);">${escapeHtml(this.loadError)}</span>
            </div>`
          : ''
      }

      <section class="erp-panel">
        <header class="erp-panel__header">
          <div>
            <h2 class="erp-panel__title">Gestão de Utilizadores, Perfis e Permissões</h2>
            <p class="erp-panel__subtitle">Crie acessos com senha provisória e defina exatamente o que cada colaborador pode ver, criar, editar ou excluir.</p>
          </div>

          <div class="erp-filter-bar">
            <select class="erp-select-sm" id="admRoleFilter" aria-label="Filtrar por perfil">
              <option value="todos" ${this.roleFilter === 'todos' ? 'selected' : ''}>Todos os Perfis</option>
              <option value="administrador" ${this.roleFilter === 'administrador' ? 'selected' : ''}>Administrador</option>
              <option value="rh" ${this.roleFilter === 'rh' ? 'selected' : ''}>Gestor RH</option>
              <option value="operacional" ${this.roleFilter === 'operacional' ? 'selected' : ''}>Gestor Operacional</option>
              <option value="operador" ${this.roleFilter === 'operador' ? 'selected' : ''}>Operador / Consulta</option>
            </select>

            <select class="erp-select-sm" id="admStatusFilter" aria-label="Filtrar por estado">
              <option value="todos" ${this.statusFilter === 'todos' ? 'selected' : ''}>Todos os Estados</option>
              <option value="ativos" ${this.statusFilter === 'ativos' ? 'selected' : ''}>Apenas Ativos</option>
              <option value="inativos" ${this.statusFilter === 'inativos' ? 'selected' : ''}>Bloqueados / Inativos</option>
              <option value="provisoria" ${this.statusFilter === 'provisoria' ? 'selected' : ''}>Com Senha Provisória</option>
            </select>

            <button type="button" class="erp-btn erp-btn--ghost" id="btnRefreshUsers" ${this.loading ? 'disabled' : ''}>
              ${this.loading ? 'A sincronizar...' : 'Atualizar'}
            </button>

            ${
              canCreate
                ? `<button type="button" class="erp-btn erp-btn--primary" id="btnNewSystemUser">
                    ${ICONS.plus} Novo Utilizador
                  </button>`
                : ''
            }
          </div>
        </header>

        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Utilizador</th>
                <th>Cargo / Depto</th>
                <th>Perfil</th>
                <th>Permissões no Sistema</th>
                <th>Estado &amp; Senha</th>
                <th>Último Acesso</th>
                <th style="text-align:right;">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${
                this.loading && !this.loadedOnce
                  ? `<tr><td colspan="7" class="erp-empty">A carregar utilizadores...</td></tr>`
                  : filtered.length === 0
                    ? `<tr><td colspan="7" class="erp-empty">Nenhum utilizador encontrado para os filtros aplicados.</td></tr>`
                    : filtered
                        .map((u) => {
                          const isSelf = u.id === this.currentProfile?.id;
                          const roleLabel = ROLE_LABELS[u.nivel_acesso] || u.nivel_acesso;
                          const roleBadgeClass =
                            u.nivel_acesso === 'administrador'
                              ? 'erp-badge--orange'
                              : u.nivel_acesso === 'rh'
                                ? 'erp-badge--info'
                                : u.nivel_acesso === 'operacional'
                                  ? 'erp-badge--success'
                                  : 'erp-badge--neutral';

                          const lastLogin = u.ultimo_login_em
                            ? `${formatDatePT(u.ultimo_login_em.slice(0, 10))} ${u.ultimo_login_em.slice(11, 16)}`
                            : 'Nunca acedeu';

                          return `
                            <tr>
                              <td>
                                <div class="erp-person-cell">
                                  <div class="erp-avatar">${escapeHtml(getInitials(u.nome_completo))}</div>
                                  <div>
                                    <div style="font-weight:700;color:var(--erp-heading);">
                                      ${escapeHtml(u.nome_completo)}
                                      ${isSelf ? '<span class="erp-badge erp-badge--neutral" style="margin-left:4px;">Você</span>' : ''}
                                    </div>
                                    <div style="font-size:12px;color:var(--erp-text-muted);">
                                      ${escapeHtml(
                                        u.username
                                          ? `@${u.username}${
                                              u.email_recuperacao
                                                ? ` · ${u.email_recuperacao}`
                                                : ' · Email por configurar'
                                            }`
                                          : String(u.email || '').endsWith('@sistema.sparksmirk.internal')
                                            ? u.email_recuperacao || 'Email por configurar'
                                            : u.email
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <div style="font-weight:600;">${escapeHtml(u.cargo || '—')}</div>
                                <div style="font-size:11.5px;color:var(--erp-text-muted);">${escapeHtml(u.departamento || 'Geral')}</div>
                              </td>
                              <td><span class="erp-badge ${roleBadgeClass}">${escapeHtml(roleLabel)}</span></td>
                              <td><div class="erp-perm-tags">${summarizeModules(u)}</div></td>
                              <td>
                                <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
                                  <span class="erp-badge ${u.ativo ? 'erp-badge--success' : 'erp-badge--danger'}">
                                    ${u.ativo ? 'Ativo' : 'Bloqueado'}
                                  </span>
                                  ${
                                    u.senha_provisoria
                                      ? '<span class="erp-badge erp-badge--warning">Senha Provisória</span>'
                                      : '<span style="font-size:11px;color:var(--erp-text-muted);">Senha definitiva</span>'
                                  }
                                </div>
                              </td>
                              <td style="font-size:12.5px;color:var(--erp-text-secondary);">${escapeHtml(lastLogin)}</td>
                              <td>
                                <div class="erp-row-actions" style="justify-content:flex-end;">
                                  ${
                                    canEdit
                                      ? `<button type="button" class="erp-icon-btn" data-edit-user="${escapeHtml(u.id)}" title="Editar Utilizador e Permissões">
                                          ${ICONS.edit}
                                        </button>`
                                      : ''
                                  }
                                  ${
                                    canDelete && !isSelf
                                      ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" data-delete-user="${escapeHtml(u.id)}" title="Remover Utilizador">
                                          ${ICONS.trash}
                                        </button>`
                                      : ''
                                  }
                                </div>
                              </td>
                            </tr>
                          `;
                        })
                        .join('')
              }
            </tbody>
          </table>
        </div>
      </section>
    `;

    container.querySelector('#admRoleFilter')?.addEventListener('change', (e) => {
      this.roleFilter = e.target.value;
      this._renderInto(container, ctx);
    });

    container.querySelector('#admStatusFilter')?.addEventListener('change', (e) => {
      this.statusFilter = e.target.value;
      this._renderInto(container, ctx);
    });

    container.querySelector('#btnRefreshUsers')?.addEventListener('click', () => {
      this.fetchUsers();
    });

    container.querySelector('#btnNewSystemUser')?.addEventListener('click', () => {
      this.openUserModal(null);
    });

    container.querySelectorAll('[data-edit-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = this.users.find((u) => u.id === btn.dataset.editUser);
        if (target) this.openUserModal(target);
      });
    });

    container.querySelectorAll('[data-delete-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = this.users.find((u) => u.id === btn.dataset.deleteUser);
        if (!target) return;
        confirmAction({
          title: 'Remover Utilizador do Sistema',
          message: `Tem a certeza de que pretende eliminar "${target.nome_completo}" (${target.email})? A conta perderá imediatamente o acesso ao sistema interno.`,
          confirmLabel: 'Eliminar Utilizador',
          onConfirm: () => this._deleteUser(target),
        });
      });
    });
  }

  async _deleteUser(target) {
    try {
      await authenticatedApiFetch(`/api/admin/users/${encodeURIComponent(target.id)}`, {
        method: 'DELETE',
      });
      showToast(`Utilizador ${target.nome_completo} removido do sistema.`);
      await this.fetchUsers({ silent: true });
    } catch (err) {
      showToast(err?.message || 'Erro ao remover utilizador.', 'error');
    }
  }

  openNewUserModal() {
    if (!hasPermission(this.currentProfile, 'admin_utilizadores', 'criar')) {
      showToast('Sem permissão para criar utilizadores.', 'error');
      return;
    }
    this.openUserModal(null);
  }

  openUserModal(existingUser = null) {
    const isEdit = Boolean(existingUser);
    const isSelf = isEdit && existingUser.id === this.currentProfile?.id;
    const initialRole = existingUser?.nivel_acesso || 'operador';
    let workingPerms = normalizePermissions(existingUser?.permissoes, initialRole);
    const initialProvPassword = isEdit ? '' : generateProvisionalPassword();

    const renderMatrixHtml = (perms) =>
      PERMISSION_MODULES.map((mod) => {
        const modPerms = perms[mod.key] || {};
        const totalMod = mod.actions.length;
        const checkedMod = mod.actions.filter((a) => modPerms[a.key] === true).length;

        return `
          <div class="erp-perm-card" data-perm-module="${mod.key}">
            <div class="erp-perm-card__head">
              <span class="erp-perm-card__title">${escapeHtml(mod.label)}</span>
              <button type="button" class="erp-btn erp-btn--ghost" style="padding:4px 9px;font-size:11px;" data-toggle-module="${mod.key}">
                ${checkedMod === totalMod ? 'Desmarcar tudo' : 'Marcar tudo'}
              </button>
            </div>
            <div class="erp-perm-grid">
              ${mod.actions
                .map(
                  (act) => `
                <label class="erp-perm-chip">
                  <input type="checkbox" data-perm-key="${mod.key}.${act.key}" ${modPerms[act.key] ? 'checked' : ''}>
                  <span>${escapeHtml(act.label)}</span>
                </label>
              `
                )
                .join('')}
            </div>
          </div>
        `;
      }).join('');

    openModal({
      title: isEdit ? `Editar Utilizador — ${existingUser.nome_completo}` : 'Criar Novo Utilizador do Sistema',
      subtitle: isEdit
        ? 'Atualize dados, estado da conta, palavra-passe provisória e permissões granulares.'
        : 'Defina as permissões de acesso e uma senha provisória. No 1.º acesso o sistema solicitará uma nova palavra-passe.',
      size: 'wide',
      bodyHtml: `
        <form id="erpUserForm">
          <div class="erp-form-section">
            <div class="erp-form-section__title">1. Dados do Utilizador</div>
            <div class="erp-form-grid">
              <div class="erp-field">
                <label for="usrName">Nome Completo <span class="req">*</span></label>
                <input type="text" id="usrName" required value="${escapeHtml(existingUser?.nome_completo || '')}" placeholder="Ex.: Maria João Pereira">
              </div>

              <div class="erp-field">
                <label for="usrEmail">Email Corporativo (Login) <span class="req">*</span></label>
                <input type="email" id="usrEmail" required value="${escapeHtml(existingUser?.email || '')}" placeholder="nome@sparksmirk.pt">
              </div>

              <div class="erp-field">
                <label for="usrCargo">Cargo / Função</label>
                <input type="text" id="usrCargo" value="${escapeHtml(existingUser?.cargo || '')}" placeholder="Ex.: Gestor de Obra, Técnica RH">
              </div>

              <div class="erp-field">
                <label for="usrDepto">Departamento</label>
                <select id="usrDepto">
                  ${['Administração', 'Recursos Humanos', 'Operacional / Obras', 'Financeiro & Orçamentos', 'Geral']
                    .map(
                      (d) =>
                        `<option value="${escapeHtml(d)}" ${(existingUser?.departamento || 'Geral') === d ? 'selected' : ''}>${escapeHtml(d)}</option>`
                    )
                    .join('')}
                </select>
              </div>

              <div class="erp-field">
                <label for="usrPhone">Telemóvel</label>
                <input type="text" id="usrPhone" value="${escapeHtml(existingUser?.telefone || '')}" placeholder="+351 910 000 000">
              </div>

              <div class="erp-field">
                <label for="usrStatus">Estado da Conta</label>
                <select id="usrStatus" ${isSelf ? 'disabled' : ''}>
                  <option value="true" ${existingUser?.ativo !== false ? 'selected' : ''}>Ativa (Acesso Permitido)</option>
                  <option value="false" ${existingUser?.ativo === false ? 'selected' : ''}>Bloqueada / Suspensa</option>
                </select>
              </div>
            </div>
          </div>

          <div class="erp-form-section">
            <div class="erp-form-section__title">2. Senha Provisória &amp; Segurança</div>
            <div class="erp-form-grid">
              <div class="erp-field erp-field--full">
                <label for="usrTempPassword">
                  ${isEdit ? 'Redefinir Palavra-passe Provisória (deixe em branco para manter a atual)' : 'Palavra-passe Provisória Inicial'}
                  ${!isEdit ? '<span class="req">*</span>' : ''}
                </label>
                <div class="erp-pw-generator">
                  <input type="text" id="usrTempPassword" ${!isEdit ? 'required minlength="8"' : 'minlength="8"'} value="${escapeHtml(initialProvPassword)}" placeholder="${isEdit ? 'Opcional: introduza nova senha provisória (mín. 8 car.)' : 'Mínimo 8 caracteres'}">
                  <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnGenProvPw">Gerar Senha</button>
                  <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnCopyProvPw">Copiar</button>
                </div>
                <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12.5px;color:var(--erp-text-secondary);cursor:pointer;">
                  <input type="checkbox" id="usrForceChange" style="width:auto;accent-color:var(--erp-primary);" ${!isEdit || existingUser?.senha_provisoria ? 'checked' : ''}>
                  <span>Exigir que o utilizador crie uma nova palavra-passe definitiva ao iniciar sessão</span>
                </label>
              </div>
            </div>
          </div>

          <div class="erp-form-section">
            <div class="erp-form-section__title">3. Perfil &amp; Permissões de Acesso no Sistema</div>
            <div class="erp-field erp-field--full">
              <label for="usrRole">Perfil Base de Acesso</label>
              <div class="erp-role-templates" style="margin-top:6px;">
                <select id="usrRole" style="min-width:220px;" ${isSelf ? 'disabled' : ''}>
                  <option value="administrador" ${initialRole === 'administrador' ? 'selected' : ''}>Administrador (Acesso Total)</option>
                  <option value="rh" ${initialRole === 'rh' ? 'selected' : ''}>Gestor de Recursos Humanos</option>
                  <option value="operacional" ${initialRole === 'operacional' ? 'selected' : ''}>Gestor Operacional &amp; Obras</option>
                  <option value="operador" ${initialRole === 'operador' ? 'selected' : ''}>Operador / Personalizado</option>
                </select>
                <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-apply-template="administrador">Admin Total</button>
                <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-apply-template="rh">Equipa RH</button>
                <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-apply-template="operacional">Obras</button>
                <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-apply-template="operador">Consulta</button>
              </div>

              <div class="erp-inline-invoice-box" style="margin:12px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-left:4px solid var(--erp-danger);">
                <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;flex:1;min-width:240px;">
                  <input type="checkbox" id="usrBlockAllFinancial" style="width:16px;height:16px;margin-top:2px;accent-color:var(--erp-danger);" ${areAllFinancialValuesBlocked(workingPerms) ? 'checked' : ''} ${isSelf ? 'disabled' : ''}>
                  <span>
                    <strong style="display:block;color:var(--erp-heading);font-size:13px;">Bloquear TODOS os valores financeiros, ordenados e saldos (€)</strong>
                    <span class="erp-cell-sub">Oculta valores no Dashboard, ordenados/diárias de funcionários, valores a pagar (fecho do mês/vales), recibos, orçamentos e faturas (€) tanto na interface como nas respostas do servidor.</span>
                  </span>
                </label>
                <span class="erp-badge ${areAllFinancialValuesBlocked(workingPerms) ? 'erp-badge--danger' : 'erp-badge--success'}" id="usrFinancialLockBadge">
                  ${areAllFinancialValuesBlocked(workingPerms) ? 'Valores € Bloqueados' : 'Personalizável por Módulo'}
                </span>
              </div>

              <div id="usrPermMatrix" class="erp-perm-matrix">
                ${renderMatrixHtml(workingPerms)}
              </div>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="erpUserForm" class="erp-btn erp-btn--primary" id="btnSubmitUserForm">
          ${isEdit ? 'Guardar Alterações' : 'Criar Utilizador'}
        </button>
      `,
      onMount: (modal) => {
        const matrixEl = modal.querySelector('#usrPermMatrix');
        const roleSelect = modal.querySelector('#usrRole');
        const pwInput = modal.querySelector('#usrTempPassword');
        const forceCheckbox = modal.querySelector('#usrForceChange');
        const blockAllFinCheckbox = modal.querySelector('#usrBlockAllFinancial');
        const finLockBadge = modal.querySelector('#usrFinancialLockBadge');

        const syncFinancialBadge = () => {
          const allBlocked = areAllFinancialValuesBlocked(workingPerms);
          if (blockAllFinCheckbox) blockAllFinCheckbox.checked = allBlocked;
          if (finLockBadge) {
            finLockBadge.className = `erp-badge ${allBlocked ? 'erp-badge--danger' : 'erp-badge--success'}`;
            finLockBadge.textContent = allBlocked ? 'Valores € Bloqueados' : 'Personalizável por Módulo';
          }
        };

        const syncCheckboxesFromWorking = () => {
          matrixEl.innerHTML = renderMatrixHtml(workingPerms);
          syncFinancialBadge();
          bindMatrixEvents();
        };

        const bindMatrixEvents = () => {
          matrixEl.querySelectorAll('[data-perm-key]').forEach((cb) => {
            cb.addEventListener('change', () => {
              const [modKey, actKey] = cb.dataset.permKey.split('.');
              if (!workingPerms[modKey]) workingPerms[modKey] = {};
              workingPerms[modKey][actKey] = cb.checked;

              if (actKey === 'ver' && !cb.checked) {
                for (const key of Object.keys(workingPerms[modKey])) {
                  workingPerms[modKey][key] = false;
                }
                syncCheckboxesFromWorking();
                return;
              }
              if (actKey !== 'ver' && cb.checked && 'ver' in workingPerms[modKey] && !workingPerms[modKey].ver) {
                workingPerms[modKey].ver = true;
                syncCheckboxesFromWorking();
                return;
              }

              const card = cb.closest('[data-perm-module]');
              const toggleBtn = card?.querySelector('[data-toggle-module]');
              const allCbs = Array.from(card?.querySelectorAll('[data-perm-key]') || []);
              if (toggleBtn) {
                toggleBtn.textContent = allCbs.every((x) => x.checked) ? 'Desmarcar tudo' : 'Marcar tudo';
              }
              syncFinancialBadge();
            });
          });

          matrixEl.querySelectorAll('[data-toggle-module]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const modKey = btn.dataset.toggleModule;
              const modSpec = PERMISSION_MODULES.find((m) => m.key === modKey);
              if (!modSpec) return;
              const allChecked = modSpec.actions.every((a) => workingPerms[modKey]?.[a.key] === true);
              for (const act of modSpec.actions) {
                workingPerms[modKey][act.key] = !allChecked;
              }
              syncCheckboxesFromWorking();
            });
          });
        };

        bindMatrixEvents();

        modal.querySelectorAll('[data-apply-template]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const tpl = btn.dataset.applyTemplate;
            if (!isSelf) roleSelect.value = tpl;
            workingPerms = createRolePermissions(tpl);
            syncCheckboxesFromWorking();
          });
        });

        roleSelect?.addEventListener('change', () => {
          workingPerms = createRolePermissions(roleSelect.value);
          syncCheckboxesFromWorking();
        });

        blockAllFinCheckbox?.addEventListener('change', () => {
          if (blockAllFinCheckbox.checked) {
            workingPerms = blockAllFinancialPermissions(workingPerms);
            syncCheckboxesFromWorking();
            showToast('Todos os valores financeiros, ordenados e saldos foram bloqueados para este utilizador.');
          } else {
            workingPerms = createRolePermissions(roleSelect?.value || initialRole);
            syncCheckboxesFromWorking();
          }
        });

        modal.querySelector('#btnGenProvPw')?.addEventListener('click', () => {
          if (pwInput) {
            pwInput.value = generateProvisionalPassword();
            if (forceCheckbox) forceCheckbox.checked = true;
          }
        });

        modal.querySelector('#btnCopyProvPw')?.addEventListener('click', async () => {
          const val = pwInput?.value?.trim();
          if (!val) {
            showToast('Não há palavra-passe no campo para copiar.', 'warning');
            return;
          }
          try {
            await window.navigator.clipboard.writeText(val);
            showToast('Palavra-passe provisória copiada.');
          } catch {
            showToast('Selecione e copie manualmente a senha apresentada.', 'info');
          }
        });

        const form = modal.querySelector('#erpUserForm');
        const submitBtn = modal.querySelector('#btnSubmitUserForm');

        form?.addEventListener('submit', async (e) => {
          e.preventDefault();

          const nome_completo = modal.querySelector('#usrName')?.value.trim();
          const email = modal.querySelector('#usrEmail')?.value.trim().toLowerCase();
          const cargo = modal.querySelector('#usrCargo')?.value.trim() || 'Colaborador Interno';
          const departamento = modal.querySelector('#usrDepto')?.value || 'Geral';
          const telefone = modal.querySelector('#usrPhone')?.value.trim() || '';
          const ativo = modal.querySelector('#usrStatus')?.value !== 'false';
          const nivel_acesso = roleSelect?.value || initialRole;
          const provisionalPassword = pwInput?.value.trim() || '';
          const senha_provisoria = Boolean(forceCheckbox?.checked);

          if (!nome_completo || !email) {
            showToast('Preencha o nome completo e o email corporativo.', 'error');
            return;
          }

          if (!isEdit && provisionalPassword.length < 8) {
            showToast('A senha provisória inicial deve ter no mínimo 8 caracteres.', 'error');
            return;
          }

          if (isEdit && provisionalPassword && provisionalPassword.length < 8) {
            showToast('A nova senha provisória deve ter no mínimo 8 caracteres.', 'error');
            return;
          }

          const grantedCount = countGrantedPermissions(workingPerms);
          if (nivel_acesso !== 'administrador' && grantedCount === 0) {
            showToast('Selecione pelo menos uma permissão de módulo para este utilizador.', 'error');
            return;
          }

          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = isEdit ? 'A guardar...' : 'A criar utilizador...';
          }

          try {
            const endpoint = isEdit
              ? `/api/admin/users/${encodeURIComponent(existingUser.id)}`
              : '/api/admin/users';
            const method = isEdit ? 'PUT' : 'POST';

            const payload = {
              nome_completo,
              email,
              cargo,
              departamento,
              telefone,
              nivel_acesso,
              ativo,
              permissoes: workingPerms,
              senha_provisoria,
              ...(provisionalPassword ? { provisionalPassword } : {}),
            };

            const res = await authenticatedApiFetch(endpoint, { method, body: payload });
            closeModal();

            if (res?.user && typeof this.onProfileUpdated === 'function') {
              this.onProfileUpdated(res.user);
            }

            if (!isEdit || provisionalPassword) {
              this._showCredentialsModal({
                user: res.user,
                provisionalPassword,
                isReset: isEdit,
              });
            } else {
              showToast(`Utilizador ${nome_completo} atualizado com sucesso.`);
            }

            await this.fetchUsers({ silent: true });
          } catch (err) {
            showToast(err?.message || 'Não foi possível guardar os dados do utilizador.', 'error');
          } finally {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = isEdit ? 'Guardar Alterações' : 'Criar Utilizador';
            }
          }
        });
      },
    });
  }

  _showCredentialsModal({ user, provisionalPassword, isReset }) {
    openModal({
      title: isReset ? 'Nova Senha Provisória Definida' : 'Utilizador Criado com Sucesso',
      subtitle: 'Entregue estas credenciais ao colaborador. No primeiro acesso o sistema exigirá a criação de uma nova palavra-passe.',
      size: 'narrow',
      bodyHtml: `
        <div class="erp-cred-box">
          <div><strong>Utilizador:</strong> ${escapeHtml(user?.nome_completo || '')}</div>
          <div><strong>Email de Login:</strong> ${escapeHtml(user?.email || '')}</div>
          <div><strong>Perfil:</strong> ${escapeHtml(ROLE_LABELS[user?.nivel_acesso] || user?.nivel_acesso)}</div>
          <div><strong>Palavra-passe Provisória:</strong></div>
          <div class="erp-cred-box__code" id="createdCredPw">${escapeHtml(provisionalPassword)}</div>
          <div style="font-size:12px;color:var(--erp-text-secondary);">
            Acesso em: <code>${escapeHtml(window.location.origin)}/login</code>
          </div>
        </div>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--ghost" id="btnCopyFullCreds">Copiar Credenciais</button>
        <button type="button" class="erp-btn erp-btn--primary" data-modal-close>Concluir</button>
      `,
      onMount: (modal) => {
        modal.querySelector('#btnCopyFullCreds')?.addEventListener('click', async () => {
          const text = `Spark & Smirk — Acesso ao Sistema Interno\nURL: ${window.location.origin}/login\nEmail: ${user?.email}\nSenha provisória: ${provisionalPassword}\n(Será solicitada nova palavra-passe no 1.º acesso)`;
          try {
            await window.navigator.clipboard.writeText(text);
            showToast('Credenciais copiadas para a área de transferência.');
          } catch {
            showToast('Copie manualmente os dados acima.', 'info');
          }
        });
      },
    });
  }
}
