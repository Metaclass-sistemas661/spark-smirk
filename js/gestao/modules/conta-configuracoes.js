/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Conta Pessoal & Configurações do Utilizador
   Design Enterprise com sincronização completa Supabase + Auth
   ═══════════════════════════════════════════════════════════ */

import { escapeHtml, formatDatePT, getInitials, isValidNIF } from '../core/formatters.js';
import { ICONS, showToast } from '../core/ui.js';
import { ROLE_LABELS } from '../../shared/permissions.js';
import {
  authenticatedApiFetch,
  getSupabaseClient,
  validateStrongPassword,
} from '../../shared/supabase-client.js';

const LOCAL_ICONS = {
  userCard:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>',
  sliders:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
};

function formatAuditDate(isoValue) {
  if (!isoValue) return 'Sem registo';
  const raw = String(isoValue);
  const datePart = raw.slice(0, 10);
  const formattedDate = formatDatePT(datePart);
  const timeMatch = raw.match(/T(\d{2}:\d{2})/);
  return timeMatch ? `${formattedDate} · ${timeMatch[1]}` : formattedDate;
}

export class ContaConfiguracoesModule {
  constructor({ onProfileUpdated } = {}) {
    this.onProfileUpdated = onProfileUpdated;
    this.savingProfile = false;
    this.savingPassword = false;
  }

  render(container, { currentProfile = null, currentUser = null } = {}) {
    const profile = currentProfile || {};
    const rawEmail = String(profile.email || currentUser?.email || '');
    const isPlaceholderEmail =
      Boolean(profile.is_placeholder_email) ||
      rawEmail.toLowerCase().endsWith('@sistema.sparksmirk.internal');
    const recoveryEmail =
      profile.email_recuperacao || (!isPlaceholderEmail ? rawEmail : '') || '';
    const displayName =
      profile.nome_completo ||
      currentUser?.user_metadata?.nome_completo ||
      profile.username ||
      'Utilizador';
    const roleLabel = ROLE_LABELS[profile.nivel_acesso] || 'Utilizador';
    const usernameValue = profile.username ? `@${profile.username}` : 'Login por email';
    const loginIdentifier = profile.username || recoveryEmail || '—';
    const showRecoveryWarning = !recoveryEmail;
    const isDarkTheme = document.documentElement.getAttribute('data-erp-theme') === 'dark';
    const isPrivacyMasked = document.documentElement.getAttribute('data-erp-values-masked') === 'true';

    container.innerHTML = `
      <div class="erp-account-hero">
        <div class="erp-account-hero__identity">
          <div class="erp-account-avatar">${escapeHtml(getInitials(displayName))}</div>
          <div>
            <div class="erp-account-hero__kicker">Conta Pessoal &amp; Segurança Corporativa</div>
            <h2 class="erp-account-hero__name">${escapeHtml(displayName)}</h2>
            <div class="erp-account-hero__meta">
              <span class="erp-badge erp-badge--info">${escapeHtml(roleLabel)}</span>
              <span class="erp-badge erp-badge--neutral">${escapeHtml(usernameValue)}</span>
              <span class="erp-badge ${profile.ativo !== false ? 'erp-badge--success' : 'erp-badge--danger'}">
                ${profile.ativo !== false ? 'Conta Ativa' : 'Conta Suspensa'}
              </span>
              ${
                profile.nif
                  ? `<span class="erp-badge erp-badge--neutral">NIF ${escapeHtml(profile.nif)}</span>`
                  : ''
              }
            </div>
          </div>
        </div>
        <div class="erp-account-hero__status">
          ${
            showRecoveryWarning
              ? `<div class="erp-account-notice erp-account-notice--warn">
                  ${ICONS.alert}
                  <div>
                    <strong>Email de recuperação por configurar</strong>
                    <span>Registe abaixo o seu email pessoal ou corporativo para poder receber códigos e links caso esqueça a palavra-passe.</span>
                  </div>
                </div>`
              : `<div class="erp-account-notice erp-account-notice--ok">
                  ${ICONS.checkCircle}
                  <div>
                    <strong>Email de recuperação sincronizado com a base de dados</strong>
                    <span>Os emails de recuperação de palavra-passe serão enviados para <b>${escapeHtml(recoveryEmail)}</b>.</span>
                  </div>
                </div>`
          }
        </div>
      </div>

      <div class="erp-account-grid">
        <section class="erp-panel">
          <div class="erp-panel__header">
            <div class="erp-panel__head-flex">
              <span class="erp-panel__icon">${LOCAL_ICONS.userCard}</span>
              <div class="erp-panel__title-group">
                <h3 class="erp-panel__title">Dados Cadastrais &amp; Contacto</h3>
                <p class="erp-panel__desc">
                  Informação pessoal sincronizada diretamente com a tabela de perfis no Supabase.
                </p>
              </div>
            </div>
            <span class="erp-badge erp-badge--success">Base de Dados Ativa</span>
          </div>

          <div class="erp-panel__body">
            <div class="erp-account-identity-bar">
              <div class="erp-account-id-tile">
                <div class="erp-account-id-tile__label">Identificador Login</div>
                <div class="erp-account-id-tile__val" title="${escapeHtml(loginIdentifier)}">${escapeHtml(loginIdentifier)}</div>
              </div>
              <div class="erp-account-id-tile">
                <div class="erp-account-id-tile__label">Perfil de Acesso</div>
                <div class="erp-account-id-tile__val">${escapeHtml(roleLabel)}</div>
              </div>
              <div class="erp-account-id-tile">
                <div class="erp-account-id-tile__label">Departamento</div>
                <div class="erp-account-id-tile__val">${escapeHtml(profile.departamento || 'Geral')}</div>
              </div>
            </div>

            <form id="formAccountProfile" novalidate>
              <div class="erp-form-grid">
                <div class="erp-field erp-field--full">
                  <label for="accNomeCompleto">Nome Completo *</label>
                  <input
                    id="accNomeCompleto"
                    name="nome_completo"
                    type="text"
                    required
                    value="${escapeHtml(profile.nome_completo || '')}"
                    placeholder="Ex.: André Silva"
                  />
                </div>

                <div class="erp-field erp-field--full">
                  <label for="accEmailRecuperacao">Email de Contacto / Recuperação de Palavra-passe *</label>
                  <input
                    id="accEmailRecuperacao"
                    name="email_recuperacao"
                    type="email"
                    required
                    value="${escapeHtml(recoveryEmail)}"
                    placeholder="nome@empresa.pt"
                  />
                  <span class="erp-field__hint">
                    Ao guardar, o endereço fica também associado à sua autenticação Supabase para recuperação de conta.
                  </span>
                </div>

                <div class="erp-field">
                  <label for="accNif">NIF (Número de Contribuinte)</label>
                  <input
                    id="accNif"
                    name="nif"
                    type="text"
                    inputmode="numeric"
                    maxlength="9"
                    value="${escapeHtml(profile.nif || '')}"
                    placeholder="9 dígitos (ex.: 245890123)"
                  />
                </div>

                <div class="erp-field">
                  <label for="accTelefone">Telemóvel / Telefone</label>
                  <input
                    id="accTelefone"
                    name="telefone"
                    type="tel"
                    value="${escapeHtml(profile.telefone || '')}"
                    placeholder="+351 910 000 000"
                  />
                </div>

                <div class="erp-field">
                  <label for="accCargo">Cargo / Função</label>
                  <input
                    id="accCargo"
                    name="cargo"
                    type="text"
                    value="${escapeHtml(profile.cargo || '')}"
                    placeholder="Ex.: Administrador / Gestor"
                  />
                </div>

                <div class="erp-field">
                  <label for="accDepartamento">Departamento</label>
                  <input
                    id="accDepartamento"
                    name="departamento"
                    type="text"
                    value="${escapeHtml(profile.departamento || '')}"
                    placeholder="Ex.: Direção Geral"
                  />
                </div>

                <div class="erp-field erp-field--full">
                  <label for="accMorada">Morada Completa</label>
                  <input
                    id="accMorada"
                    name="morada"
                    type="text"
                    value="${escapeHtml(profile.morada || '')}"
                    placeholder="Rua, código postal e localidade"
                  />
                </div>
              </div>

              <div class="erp-form-error" id="accProfileError" hidden></div>

              <div class="erp-account-actions">
                <span class="erp-cell-sub">Alterações ficam registadas em auditoria.</span>
                <button type="submit" class="erp-btn erp-btn--primary" id="btnSaveAccountProfile">
                  ${ICONS.checkCircle}
                  <span>Guardar Dados na Base de Dados</span>
                </button>
              </div>
            </form>
          </div>
        </section>

        <div class="erp-account-side-stack">
          <section class="erp-panel">
            <div class="erp-panel__header">
              <div class="erp-panel__head-flex">
                <span class="erp-panel__icon erp-panel__icon--info">${LOCAL_ICONS.shield}</span>
                <div class="erp-panel__title-group">
                  <h3 class="erp-panel__title">Segurança &amp; Palavra-passe</h3>
                  <p class="erp-panel__desc">
                    Atualize a palavra-passe de acesso com encriptação Supabase Auth.
                  </p>
                </div>
              </div>
            </div>

            <div class="erp-panel__body">
              <form id="formAccountPassword" novalidate>
                <div class="erp-form-grid">
                  <div class="erp-field erp-field--full">
                    <label for="accNewPassword">Nova Palavra-passe *</label>
                    <div class="erp-pw-input-wrap">
                      <input
                        id="accNewPassword"
                        name="new_password"
                        type="password"
                        autocomplete="new-password"
                        placeholder="Mínimo 8 caracteres fortes"
                      />
                      <button type="button" class="erp-pw-toggle" data-toggle-acc-pw="accNewPassword">MOSTRAR</button>
                    </div>
                  </div>

                  <div class="erp-field erp-field--full">
                    <label for="accConfirmPassword">Confirmar Nova Palavra-passe *</label>
                    <div class="erp-pw-input-wrap">
                      <input
                        id="accConfirmPassword"
                        name="confirm_password"
                        type="password"
                        autocomplete="new-password"
                        placeholder="Repita exatamente a nova palavra-passe"
                      />
                      <button type="button" class="erp-pw-toggle" data-toggle-acc-pw="accConfirmPassword">MOSTRAR</button>
                    </div>
                  </div>
                </div>

                <div class="erp-pw-meter">
                  <div class="erp-pw-meter__track">
                    <div class="erp-pw-meter__fill" id="accPwMeterFill"></div>
                  </div>
                  <span class="erp-pw-meter__label" id="accPwMeterLabel">Por definir</span>
                </div>

                <ul class="erp-pw-checklist" id="accPwChecklist" style="margin-top:12px;">
                  <li data-rule="minLen">Mínimo 8 caracteres</li>
                  <li data-rule="upper">Letra maiúscula (A–Z)</li>
                  <li data-rule="lower">Letra minúscula (a–z)</li>
                  <li data-rule="number">Pelo menos 1 número (0–9)</li>
                  <li data-rule="special">Carácter especial (!@#$...)</li>
                  <li data-rule="match">Palavras-passe coincidem</li>
                </ul>

                <div class="erp-form-error" id="accPasswordError" hidden></div>

                <div class="erp-account-actions">
                  <span class="erp-cell-sub">Sessão permanece ativa</span>
                  <button type="submit" class="erp-btn erp-btn--primary" id="btnSaveAccountPassword">
                    ${ICONS.checkCircle}
                    <span>Atualizar Palavra-passe</span>
                  </button>
                </div>
              </form>
            </div>
          </section>

          <section class="erp-panel">
            <div class="erp-panel__header">
              <div class="erp-panel__head-flex">
                <span class="erp-panel__icon">${LOCAL_ICONS.sliders}</span>
                <div class="erp-panel__title-group">
                  <h3 class="erp-panel__title">Preferências &amp; Auditoria da Conta</h3>
                  <p class="erp-panel__desc">
                    Ajustes visuais do posto de trabalho e rastreio de sessão.
                  </p>
                </div>
              </div>
            </div>

            <div class="erp-panel__body">
              <div class="erp-pref-list">
                <div class="erp-pref-row">
                  <div>
                    <div class="erp-pref-row__title">Tema da Interface</div>
                    <div class="erp-pref-row__desc" id="accThemeStatus">${isDarkTheme ? 'Modo Escuro Executivo ativo' : 'Modo Claro Executivo ativo'}</div>
                  </div>
                  <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnAccSwitchTheme">
                    ${isDarkTheme ? 'Mudar para Claro' : 'Mudar para Escuro'}
                  </button>
                </div>

                <div class="erp-pref-row">
                  <div>
                    <div class="erp-pref-row__title">Privacidade Financeira (€)</div>
                    <div class="erp-pref-row__desc" id="accPrivacyStatus">${isPrivacyMasked ? 'Valores monetários ocultados no ecrã' : 'Valores monetários visíveis no ecrã'}</div>
                  </div>
                  <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnAccSwitchPrivacy">
                    ${isPrivacyMasked ? 'Mostrar Valores' : 'Ocultar Valores'}
                  </button>
                </div>
              </div>

              <div class="erp-account-audit">
                <div>
                  <div class="erp-account-id-tile__label">Último Acesso</div>
                  <div class="erp-cell-title">${escapeHtml(formatAuditDate(profile.ultimo_login_em || currentUser?.last_sign_in_at))}</div>
                </div>
                <div>
                  <div class="erp-account-id-tile__label">Última Alteração de Senha</div>
                  <div class="erp-cell-title">${escapeHtml(formatAuditDate(profile.senha_alterada_em))}</div>
                </div>
                <div>
                  <div class="erp-account-id-tile__label">Email de Autenticação</div>
                  <div class="erp-cell-sub" style="word-break:break-all;">${escapeHtml(rawEmail || '—')}</div>
                </div>
                <div>
                  <div class="erp-account-id-tile__label">Estado de Segurança</div>
                  <div class="erp-cell-sub">${profile.senha_provisoria ? 'Senha provisória pendente' : 'Palavra-passe definitiva'}</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;

    this._bindEvents(container, profile);
  }

  _bindEvents(container, profile) {
    const profileForm = container.querySelector('#formAccountProfile');
    const profileErrEl = container.querySelector('#accProfileError');
    const saveProfileBtn = container.querySelector('#btnSaveAccountProfile');

    const showProfileError = (msg) => {
      if (!profileErrEl) return;
      profileErrEl.textContent = msg;
      profileErrEl.hidden = !msg;
    };

    profileForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.savingProfile) return;
      showProfileError('');

      const fd = new window.FormData(profileForm);
      const nome_completo = String(fd.get('nome_completo') || '').trim();
      const email_recuperacao = String(fd.get('email_recuperacao') || '').trim().toLowerCase();
      const rawNif = String(fd.get('nif') || '').replace(/\D/g, '');
      const telefone = String(fd.get('telefone') || '').trim();
      const cargo = String(fd.get('cargo') || '').trim();
      const departamento = String(fd.get('departamento') || '').trim();
      const morada = String(fd.get('morada') || '').trim();

      if (nome_completo.length < 2) {
        showProfileError('Introduza o seu nome completo (mínimo 2 caracteres).');
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_recuperacao)) {
        showProfileError('Introduza um endereço de email válido para contacto e recuperação.');
        return;
      }

      if (rawNif && !isValidNIF(rawNif)) {
        showProfileError('O NIF introduzido é inválido. Deve conter exatamente 9 dígitos portugueses válidos.');
        return;
      }

      this.savingProfile = true;
      if (saveProfileBtn) {
        saveProfileBtn.disabled = true;
        saveProfileBtn.querySelector('span').textContent = 'A guardar...';
      }

      try {
        const res = await authenticatedApiFetch('/api/account/profile', {
          method: 'PUT',
          body: {
            nome_completo,
            email_recuperacao,
            nif: rawNif,
            telefone,
            cargo: cargo || profile.cargo || '',
            departamento: departamento || profile.departamento || '',
            morada,
          },
        });

        showToast(res?.message || 'Configurações da conta atualizadas com sucesso!');
        if (res?.profile && this.onProfileUpdated) {
          this.onProfileUpdated(res.profile);
        }
      } catch (err) {
        showProfileError(err?.message || 'Não foi possível guardar as configurações.');
      } finally {
        this.savingProfile = false;
        if (saveProfileBtn) {
          saveProfileBtn.disabled = false;
          saveProfileBtn.querySelector('span').textContent = 'Guardar Dados na Base de Dados';
        }
      }
    });

    container.querySelectorAll('[data-toggle-acc-pw]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = container.querySelector(`#${btn.dataset.toggleAccPw}`);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'OCULTAR' : 'MOSTRAR';
      });
    });

    const pwForm = container.querySelector('#formAccountPassword');
    const pw1Input = container.querySelector('#accNewPassword');
    const pw2Input = container.querySelector('#accConfirmPassword');
    const pwChecklist = container.querySelector('#accPwChecklist');
    const pwErrEl = container.querySelector('#accPasswordError');
    const savePwBtn = container.querySelector('#btnSaveAccountPassword');
    const meterFill = container.querySelector('#accPwMeterFill');
    const meterLabel = container.querySelector('#accPwMeterLabel');

    const showPwError = (msg) => {
      if (!pwErrEl) return;
      pwErrEl.textContent = msg;
      pwErrEl.hidden = !msg;
    };

    const syncChecklist = (forceInvalid = false) => {
      const pw1 = pw1Input?.value || '';
      const pw2 = pw2Input?.value || '';
      const status = validateStrongPassword(pw1, pw2);
      const hasTyped = pw1.length > 0 || pw2.length > 0;

      let passed = 0;
      const ruleKeys = ['minLen', 'upper', 'lower', 'number', 'special', 'match'];
      ruleKeys.forEach((rk) => {
        if (status[rk]) passed += 1;
      });

      if (meterFill && meterLabel) {
        if (!hasTyped) {
          meterFill.style.width = '0%';
          meterFill.style.background = 'var(--erp-text-muted)';
          meterLabel.textContent = 'Por definir';
          meterLabel.style.color = 'var(--erp-text-muted)';
        } else {
          const pct = Math.round((passed / ruleKeys.length) * 100);
          meterFill.style.width = `${pct}%`;
          if (passed <= 2) {
            meterFill.style.background = 'var(--erp-danger)';
            meterLabel.textContent = 'Fraca';
            meterLabel.style.color = 'var(--erp-danger)';
          } else if (passed <= 4) {
            meterFill.style.background = 'var(--erp-warning)';
            meterLabel.textContent = 'Média';
            meterLabel.style.color = 'var(--erp-warning)';
          } else if (passed < 6) {
            meterFill.style.background = 'var(--erp-info)';
            meterLabel.textContent = 'Quase lá';
            meterLabel.style.color = 'var(--erp-info)';
          } else {
            meterFill.style.background = 'var(--erp-success)';
            meterLabel.textContent = 'Forte';
            meterLabel.style.color = 'var(--erp-success)';
          }
        }
      }

      pwChecklist?.querySelectorAll('li[data-rule]').forEach((li) => {
        const rule = li.dataset.rule;
        const ok = Boolean(status[rule]);
        li.classList.toggle('is-valid', ok);
        const shouldMarkInvalid = !ok && (forceInvalid || (rule === 'match' ? pw2.length > 0 : hasTyped));
        li.classList.toggle('is-invalid', shouldMarkInvalid);
      });
      return status;
    };

    pw1Input?.addEventListener('input', () => {
      showPwError('');
      syncChecklist(false);
    });
    pw2Input?.addEventListener('input', () => {
      showPwError('');
      syncChecklist(false);
    });

    pwForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.savingPassword) return;
      showPwError('');

      const pw1 = pw1Input?.value || '';
      const status = syncChecklist(true);

      if (!status.allOk) {
        showPwError('A nova palavra-passe deve cumprir todos os critérios assinalados a verde.');
        return;
      }

      this.savingPassword = true;
      if (savePwBtn) {
        savePwBtn.disabled = true;
        savePwBtn.querySelector('span').textContent = 'A atualizar...';
      }

      try {
        const supabase = await getSupabaseClient();
        if (!supabase) {
          throw new Error('Serviço de autenticação indisponível de momento.');
        }

        const { error } = await supabase.auth.updateUser({ password: pw1 });
        if (error) {
          throw new Error(error.message || 'Erro ao atualizar a palavra-passe.');
        }

        if (pw1Input) pw1Input.value = '';
        if (pw2Input) pw2Input.value = '';
        syncChecklist(false);
        showToast('Palavra-passe atualizada com segurança!');
      } catch (err) {
        showPwError(err?.message || 'Não foi possível atualizar a palavra-passe.');
      } finally {
        this.savingPassword = false;
        if (savePwBtn) {
          savePwBtn.disabled = false;
          savePwBtn.querySelector('span').textContent = 'Atualizar Palavra-passe';
        }
      }
    });

    container.querySelector('#btnAccSwitchTheme')?.addEventListener('click', () => {
      document.getElementById('btnToggleTheme')?.click();
      const dark = document.documentElement.getAttribute('data-erp-theme') === 'dark';
      const statusEl = container.querySelector('#accThemeStatus');
      const btn = container.querySelector('#btnAccSwitchTheme');
      if (statusEl) statusEl.textContent = dark ? 'Modo Escuro Executivo ativo' : 'Modo Claro Executivo ativo';
      if (btn) btn.textContent = dark ? 'Mudar para Claro' : 'Mudar para Escuro';
    });

    container.querySelector('#btnAccSwitchPrivacy')?.addEventListener('click', () => {
      document.getElementById('btnToggleValuesVisibility')?.click();
      const masked = document.documentElement.getAttribute('data-erp-values-masked') === 'true';
      const statusEl = container.querySelector('#accPrivacyStatus');
      const btn = container.querySelector('#btnAccSwitchPrivacy');
      if (statusEl) {
        statusEl.textContent = masked
          ? 'Valores monetários ocultados no ecrã'
          : 'Valores monetários visíveis no ecrã';
      }
      if (btn) btn.textContent = masked ? 'Mostrar Valores' : 'Ocultar Valores';
    });
  }
}
