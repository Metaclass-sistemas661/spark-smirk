/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Conta Pessoal & Configurações do Utilizador
   ═══════════════════════════════════════════════════════════ */

import { escapeHtml, getInitials, isValidNIF } from '../core/formatters.js';
import { ICONS, showToast } from '../core/ui.js';
import { ROLE_LABELS } from '../../shared/permissions.js';
import {
  authenticatedApiFetch,
  getSupabaseClient,
  validateStrongPassword,
} from '../../shared/supabase-client.js';

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
    const showRecoveryWarning = !recoveryEmail;

    container.innerHTML = `
      <div class="erp-account-hero">
        <div class="erp-account-hero__identity">
          <div class="erp-account-avatar">${escapeHtml(getInitials(displayName))}</div>
          <div>
            <div class="erp-account-hero__kicker">Perfil &amp; Definições Pessoais</div>
            <h2 class="erp-account-hero__name">${escapeHtml(displayName)}</h2>
            <div class="erp-account-hero__meta">
              <span class="erp-badge erp-badge--primary">${escapeHtml(roleLabel)}</span>
              <span class="erp-badge erp-badge--neutral">${escapeHtml(usernameValue)}</span>
              ${
                profile.nif
                  ? `<span class="erp-badge erp-badge--info">NIF ${escapeHtml(profile.nif)}</span>`
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
                    <strong>Email de recuperação ativo</strong>
                    <span>Os emails de recuperação de palavra-passe serão enviados para <b>${escapeHtml(recoveryEmail)}</b>.</span>
                  </div>
                </div>`
          }
        </div>
      </div>

      <div class="erp-account-grid">
        <section class="erp-panel">
          <div class="erp-panel__header">
            <div>
              <h3 class="erp-panel__title">Dados Cadastrais &amp; Contacto</h3>
              <p class="erp-panel__subtitle">
                Mantenha os seus dados pessoais, NIF, telefone e email de recuperação atualizados na base de dados.
              </p>
            </div>
          </div>
          <div class="erp-panel__body">
            <form id="formAccountProfile" novalidate>
              <div class="erp-form-grid">
                <div class="erp-field">
                  <label>Identificador de Login</label>
                  <input type="text" value="${escapeHtml(profile.username || recoveryEmail || '—')}" disabled />
                </div>
                <div class="erp-field">
                  <label>Perfil de Acesso</label>
                  <input type="text" value="${escapeHtml(roleLabel)}" disabled />
                </div>

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
                  <small style="color:var(--erp-text-muted);font-size:11.5px;margin-top:4px;display:block;">
                    Quando solicitar &ldquo;Esqueceu a palavra-passe?&rdquo; (mesmo entrando com nome de utilizador), a ligação de recuperação será enviada para este email.
                  </small>
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
                  <label for="accMorada">Morada</label>
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
                <button type="submit" class="erp-btn erp-btn--primary" id="btnSaveAccountProfile">
                  ${ICONS.checkCircle}
                  <span>Guardar Configurações</span>
                </button>
              </div>
            </form>
          </div>
        </section>

        <section class="erp-panel">
          <div class="erp-panel__header">
            <div>
              <h3 class="erp-panel__title">Segurança &amp; Palavra-passe</h3>
              <p class="erp-panel__subtitle">
                Atualize a sua palavra-passe de acesso seguindo todos os critérios obrigatórios de segurança.
              </p>
            </div>
          </div>
          <div class="erp-panel__body">
            <form id="formAccountPassword" novalidate>
              <div class="erp-form-grid">
                <div class="erp-field erp-field--full">
                  <label for="accNewPassword">Nova Palavra-passe *</label>
                  <input
                    id="accNewPassword"
                    name="new_password"
                    type="password"
                    autocomplete="new-password"
                    placeholder="Mínimo 8 caracteres fortes"
                  />
                </div>

                <div class="erp-field erp-field--full">
                  <label for="accConfirmPassword">Confirmar Nova Palavra-passe *</label>
                  <input
                    id="accConfirmPassword"
                    name="confirm_password"
                    type="password"
                    autocomplete="new-password"
                    placeholder="Repita exatamente a nova palavra-passe"
                  />
                </div>
              </div>

              <ul class="erp-pw-checklist" id="accPwChecklist" style="margin-top:14px;">
                <li data-rule="minLen">Mínimo 8 caracteres</li>
                <li data-rule="upper">Letra maiúscula (A–Z)</li>
                <li data-rule="lower">Letra minúscula (a–z)</li>
                <li data-rule="number">Pelo menos 1 número (0–9)</li>
                <li data-rule="special">Carácter especial (!@#$...)</li>
                <li data-rule="match">Palavras-passe coincidem</li>
              </ul>

              <div class="erp-form-error" id="accPasswordError" hidden></div>

              <div class="erp-account-actions">
                <button type="submit" class="erp-btn erp-btn--dark" id="btnSaveAccountPassword">
                  <span>Atualizar Palavra-passe</span>
                </button>
              </div>
            </form>
          </div>
        </section>
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
          saveProfileBtn.querySelector('span').textContent = 'Guardar Configurações';
        }
      }
    });

    const pwForm = container.querySelector('#formAccountPassword');
    const pw1Input = container.querySelector('#accNewPassword');
    const pw2Input = container.querySelector('#accConfirmPassword');
    const pwChecklist = container.querySelector('#accPwChecklist');
    const pwErrEl = container.querySelector('#accPasswordError');
    const savePwBtn = container.querySelector('#btnSaveAccountPassword');

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
        savePwBtn.textContent = 'A atualizar...';
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
          savePwBtn.textContent = 'Atualizar Palavra-passe';
        }
      }
    });
  }
}
