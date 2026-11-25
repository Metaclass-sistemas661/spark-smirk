/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — Login & Recuperação Segura de Acesso
   ═══════════════════════════════════════════════════════════ */

import {
  getSupabaseClient,
  verifyAuthenticatedUser,
  loadSupabaseConfig,
  isRecoverySessionToken,
  validateStrongPassword,
} from '../shared/supabase-client.js';
import { getFirebaseApp } from '../shared/firebase-client.js';

const REMEMBER_EMAIL_KEY = 'spark_login_remember_email';
const MAX_FAILED_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 30;

let failedAttempts = 0;
let cooldownUntil = 0;
let cooldownIntervalId = null;
let recoveryEmail = '';

const VIEW_META = {
  login: {
    title: 'Iniciar Sessão',
    subtitle: 'Introduza o seu utilizador ou email corporativo para aceder ao painel interno.',
  },
  forgot: {
    title: 'Recuperar Acesso',
    subtitle: 'Introduza o email registado nas Configurações ou o seu nome de utilizador.',
  },
};

function showAlert(type, message, targetId = 'loginAlert') {
  const alertEl = document.getElementById(targetId);
  if (!alertEl) return;
  alertEl.className = `login-alert is-visible login-alert--${type}`;
  alertEl.textContent = message;
}

function clearAlert(targetId = 'loginAlert') {
  const alertEl = document.getElementById(targetId);
  if (!alertEl) return;
  alertEl.className = 'login-alert';
  alertEl.textContent = '';
}

function setActiveView(viewName) {
  const titleEl = document.getElementById('loginPaneTitle');
  const subtitleEl = document.getElementById('loginPaneSubtitle');
  const loginView = document.getElementById('loginView');
  const forgotView = document.getElementById('forgotView');

  if (loginView) loginView.hidden = viewName !== 'login';
  if (forgotView) forgotView.hidden = viewName !== 'forgot';

  const meta = VIEW_META[viewName] || VIEW_META.login;
  if (titleEl) titleEl.textContent = meta.title;
  if (subtitleEl) subtitleEl.textContent = meta.subtitle;
}

function openResetPasswordModal({ verifying = false, email = '' } = {}) {
  const modal = document.getElementById('resetPasswordModal');
  const verifyingBox = document.getElementById('resetVerifyingBox');
  const resetForm = document.getElementById('resetForm');
  const subtitleEl = document.getElementById('resetModalAccount');

  if (modal) modal.hidden = false;
  if (verifyingBox) verifyingBox.hidden = !verifying;
  if (resetForm) resetForm.hidden = verifying;
  if (subtitleEl) {
    subtitleEl.textContent = email
      ? `Conta verificada: ${email}`
      : 'Crie uma nova palavra-passe segura para a sua conta corporativa.';
  }
}

function closeResetPasswordModal() {
  const modal = document.getElementById('resetPasswordModal');
  const verifyingBox = document.getElementById('resetVerifyingBox');
  const resetForm = document.getElementById('resetForm');
  if (modal) modal.hidden = true;
  if (verifyingBox) verifyingBox.hidden = true;
  if (resetForm) resetForm.hidden = false;
  clearAlert('resetModalAlert');
}

function translateAuthError(error) {
  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('invalid login credentials')) {
    return 'Email ou palavra-passe inválidos. Verifique as suas credenciais e tente novamente.';
  }
  if (msg.includes('email not confirmed')) {
    return 'O email ainda não foi confirmado. Verifique a sua caixa de entrada.';
  }
  if (msg.includes('too many requests') || msg.includes('rate limit')) {
    return 'Demasiadas tentativas seguidas. Aguarde alguns instantes antes de tentar novamente.';
  }
  if (msg.includes('expired') || msg.includes('invalid') || msg.includes('otp')) {
    return 'A ligação de recuperação expirou ou já foi utilizada. Solicite um novo email de recuperação.';
  }
  if (msg.includes('same password') || msg.includes('different from the old password')) {
    return 'A nova palavra-passe deve ser diferente da palavra-passe atual.';
  }
  return error?.message || 'Não foi possível concluir o pedido. Tente novamente.';
}

function startCooldown(submitBtn) {
  cooldownUntil = Date.now() + COOLDOWN_SECONDS * 1000;
  if (cooldownIntervalId) {
    window.clearInterval(cooldownIntervalId);
  }

  const updateButton = () => {
    const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      window.clearInterval(cooldownIntervalId);
      cooldownIntervalId = null;
      failedAttempts = 0;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Entrar no Sistema';
      }
      return;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = `Bloqueado (${remaining}s)`;
    }
    showAlert(
      'error',
      `Demasiadas tentativas falhadas. Por segurança, aguarde ${remaining} segundos antes de tentar novamente.`
    );
  };

  updateButton();
  cooldownIntervalId = window.setInterval(updateButton, 1000);
}

function getSafeRedirectTarget() {
  try {
    const params = new window.URLSearchParams(window.location.search);
    const next = params.get('redirect') || '';
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      const parsed = new window.URL(next, window.location.origin);
      if (
        parsed.origin === window.location.origin &&
        (parsed.pathname === '/gestao' || parsed.pathname.startsWith('/gestao/'))
      ) {
        return parsed.pathname + parsed.search;
      }
    }
  } catch {
    // Ignore query parse error
  }
  return '/gestao/';
}

function showRedirectNoticeIfNeeded() {
  try {
    const params = new window.URLSearchParams(window.location.search);
    const reason = params.get('reason');
    if (reason === 'timeout') {
      showAlert('info', 'A sua sessão expirou por inatividade. Inicie sessão novamente para continuar.');
    } else if (reason === 'disabled') {
      showAlert('error', 'A sua conta encontra-se desativada ou bloqueada. Contacte o administrador do sistema.');
    } else if (reason === 'unavailable') {
      showAlert('error', 'Não foi possível validar a sessão com o servidor de segurança. Tente novamente.');
    } else if (reason === 'unauthenticated') {
      showAlert('info', 'Área reservada. Autentique-se com a sua conta Spark & Smirk para aceder ao sistema interno.');
    } else if (reason === 'logged_out') {
      showAlert('success', 'Sessão terminada com segurança.');
    }
  } catch {
    // Ignore query parse error
  }
}

function parseRecoveryUrlContext() {
  const searchParams = new window.URLSearchParams(window.location.search);
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new window.URLSearchParams(rawHash);

  const tokenHash = searchParams.get('token_hash') || searchParams.get('recovery_token') || '';
  const queryType = searchParams.get('type') || '';
  const queryMode = searchParams.get('mode') || '';
  const authCode = searchParams.get('code') || '';
  const hashType = hashParams.get('type') || '';
  const hasAccessTokenInHash = Boolean(hashParams.get('access_token'));
  const urlError =
    searchParams.get('error_description') ||
    hashParams.get('error_description') ||
    searchParams.get('error') ||
    hashParams.get('error') ||
    '';

  const isRecovery = Boolean(
    tokenHash ||
      authCode ||
      hashType === 'recovery' ||
      queryType === 'recovery' ||
      queryMode === 'recovery' ||
      (hasAccessTokenInHash && hashType === 'recovery') ||
      urlError
  );

  return {
    isRecovery,
    tokenHash,
    otpType: queryType || 'recovery',
    authCode,
    hashType,
    urlError,
  };
}

function stripSensitiveUrlParams() {
  try {
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch {
    // Ignore history errors
  }
}

function refreshPasswordChecklistUi() {
  const pw1 = document.getElementById('resetNewPassword');
  const pw2 = document.getElementById('resetConfirmPassword');
  const checklist = document.getElementById('resetPwChecklist');
  const submitBtn = document.getElementById('btnResetSubmit');

  const { valid, rules } = validateStrongPassword(pw1?.value || '', pw2?.value || '');
  if (checklist) {
    Object.entries(rules).forEach(([ruleKey, met]) => {
      const item = checklist.querySelector(`[data-rule="${ruleKey}"]`);
      if (item) {
        item.classList.toggle('is-met', met);
        item.classList.toggle('is-unmet', !met);
      }
    });
  }
  if (submitBtn) {
    submitBtn.disabled = !valid;
  }
  return valid;
}

function bindPasswordChecklist() {
  const pw1 = document.getElementById('resetNewPassword');
  const pw2 = document.getElementById('resetConfirmPassword');
  pw1?.addEventListener('input', refreshPasswordChecklistUi);
  pw2?.addEventListener('input', refreshPasswordChecklistUi);
  refreshPasswordChecklistUi();
}

function bindTogglePasswordButtons() {
  const mainToggle = document.getElementById('btnTogglePassword');
  const mainInput = document.getElementById('loginPassword');
  if (mainToggle && mainInput) {
    mainToggle.addEventListener('click', () => {
      const isPassword = mainInput.type === 'password';
      mainInput.type = isPassword ? 'text' : 'password';
      mainToggle.textContent = isPassword ? 'OCULTAR' : 'MOSTRAR';
    });
  }

  document.querySelectorAll('[data-toggle-input]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle-input');
      const targetInput = targetId ? document.getElementById(targetId) : null;
      if (!targetInput) return;
      const isPassword = targetInput.type === 'password';
      targetInput.type = isPassword ? 'text' : 'password';
      btn.textContent = isPassword ? 'OCULTAR' : 'MOSTRAR';
    });
  });
}

async function resolveRecoveryModalFlow(recoveryCtx, existingSession = null) {
  openResetPasswordModal({ verifying: true, email: existingSession?.user?.email || '' });

  if (recoveryCtx?.urlError) {
    stripSensitiveUrlParams();
    closeResetPasswordModal();
    setActiveView('forgot');
    showAlert(
      'error',
      'A ligação de recuperação expirou ou já foi utilizada. Introduza o seu email corporativo para receber uma nova ligação.'
    );
    return;
  }

  const supabase = await getSupabaseClient();
  if (!supabase) {
    closeResetPasswordModal();
    setActiveView('forgot');
    showAlert('error', 'Serviço de segurança temporariamente indisponível. Tente novamente.');
    return;
  }

  let activeSession = existingSession;

  try {
    if (!activeSession && recoveryCtx?.tokenHash) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: recoveryCtx.tokenHash,
        type: recoveryCtx.otpType || 'recovery',
      });
      stripSensitiveUrlParams();
      if (error || !data?.session) {
        closeResetPasswordModal();
        setActiveView('forgot');
        showAlert('error', translateAuthError(error));
        return;
      }
      activeSession = data.session;
    } else if (!activeSession) {
      const { data: currentData } = await supabase.auth.getSession();
      activeSession = currentData?.session || null;

      if (!activeSession && recoveryCtx?.authCode) {
        const { data: exchangeData, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(
          recoveryCtx.authCode
        );
        if (!exchangeErr && exchangeData?.session) {
          activeSession = exchangeData.session;
        }
      }
      stripSensitiveUrlParams();
    } else {
      stripSensitiveUrlParams();
    }
  } catch {
    stripSensitiveUrlParams();
    closeResetPasswordModal();
    setActiveView('forgot');
    showAlert(
      'error',
      'Não foi possível validar a ligação de recuperação. Solicite um novo email de recuperação.'
    );
    return;
  }

  if (!activeSession || !activeSession.user) {
    closeResetPasswordModal();
    setActiveView('forgot');
    showAlert(
      'error',
      'A ligação de recuperação é inválida ou já expirou. Introduza o seu email para pedir uma nova.'
    );
    return;
  }

  recoveryEmail = activeSession.user.email || '';
  openResetPasswordModal({ verifying: false, email: recoveryEmail });
  clearAlert('resetModalAlert');
  showAlert(
    'info',
    'Ligação validada com segurança. Defina abaixo a sua nova palavra-passe cumprindo todos os critérios.',
    'resetModalAlert'
  );
  refreshPasswordChecklistUi();
  document.getElementById('resetNewPassword')?.focus();
}

async function requestPersonalizedRecoveryEmail(identifier) {
  const response = await window.fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ identifier, email: identifier }),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.message || 'Não foi possível enviar o email de recuperação.');
    err.status = response.status;
    throw err;
  }
  return payload;
}

async function loginWithIdentifierAndPassword(identifier, password) {
  const response = await window.fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ identifier, password }),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

async function notifyBackendRecoveryCompleted(accessToken) {
  if (!accessToken) return;
  try {
    await window.fetch('/api/auth/complete-password-recovery', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    });
  } catch {
    // Password was already updated safely; backend audit sync is best-effort here
  }
}

async function cancelRecoveryAndReturnToLogin(emailInput) {
  clearAlert();
  closeResetPasswordModal();
  const client = await getSupabaseClient();
  if (client) {
    await client.auth.signOut().catch(() => {});
  }
  const pw1 = document.getElementById('resetNewPassword');
  const pw2 = document.getElementById('resetConfirmPassword');
  if (pw1) pw1.value = '';
  if (pw2) pw2.value = '';
  refreshPasswordChecklistUi();
  setActiveView('login');
  emailInput?.focus();
}

async function initLoginPage() {
  getFirebaseApp();
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const rememberCheckbox = document.getElementById('loginRemember');
  const forgotBtn = document.getElementById('btnForgotPassword');
  const submitBtn = document.getElementById('btnLoginSubmit');

  const forgotForm = document.getElementById('forgotForm');
  const forgotEmailInput = document.getElementById('forgotEmail');
  const forgotSubmitBtn = document.getElementById('btnForgotSubmit');
  const backFromForgotBtn = document.getElementById('btnBackToLoginFromForgot');

  const resetForm = document.getElementById('resetForm');
  const resetNewPwInput = document.getElementById('resetNewPassword');
  const resetConfirmPwInput = document.getElementById('resetConfirmPassword');
  const resetSubmitBtn = document.getElementById('btnResetSubmit');
  const backFromResetBtn = document.getElementById('btnBackToLoginFromReset');
  const cancelResetModalBtn = document.getElementById('btnCancelResetModal');

  // Restaurar email guardado
  try {
    const savedEmail = window.localStorage.getItem(REMEMBER_EMAIL_KEY);
    if (savedEmail && emailInput) {
      emailInput.value = savedEmail;
      if (rememberCheckbox) rememberCheckbox.checked = true;
    }
  } catch {
    // Ignore storage error
  }

  bindTogglePasswordButtons();
  bindPasswordChecklist();

  const recoveryCtx = parseRecoveryUrlContext();

  if (recoveryCtx.isRecovery) {
    await resolveRecoveryModalFlow(recoveryCtx);
  } else {
    showRedirectNoticeIfNeeded();

    const auth = await verifyAuthenticatedUser();
    if (auth.authenticated && auth.session?.access_token) {
      if (isRecoverySessionToken(auth.session.access_token)) {
        await resolveRecoveryModalFlow({ isRecovery: true }, auth.session);
      } else {
        window.location.replace(getSafeRedirectTarget());
        return;
      }
    }

    const config = await loadSupabaseConfig();
    if (!config) {
      showAlert(
        'info',
        'O serviço de autenticação encontra-se temporariamente indisponível. Contacte a administração do sistema.'
      );
    }
  }

  // Subscrever eventos de recuperação caso o navegador processe o token assincronamente
  const supabaseClient = await getSupabaseClient();
  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        recoveryEmail = session.user.email || '';
        openResetPasswordModal({ verifying: false, email: recoveryEmail });
        showAlert(
          'info',
          'Ligação validada com segurança. Defina abaixo a sua nova palavra-passe cumprindo todos os critérios.',
          'resetModalAlert'
        );
        refreshPasswordChecklistUi();
        resetNewPwInput?.focus();
      }
    });
  }

  // Abrir vista de recuperação de palavra-passe
  if (forgotBtn) {
    forgotBtn.addEventListener('click', () => {
      clearAlert();
      const typedEmail = emailInput?.value.trim() || '';
      if (forgotEmailInput && typedEmail) {
        forgotEmailInput.value = typedEmail;
      }
      setActiveView('forgot');
      forgotEmailInput?.focus();
    });
  }

  if (backFromForgotBtn) {
    backFromForgotBtn.addEventListener('click', () => {
      clearAlert();
      const typedForgot = forgotEmailInput?.value.trim() || '';
      if (emailInput && typedForgot && !emailInput.value.trim()) {
        emailInput.value = typedForgot;
      }
      setActiveView('login');
      emailInput?.focus();
    });
  }

  backFromResetBtn?.addEventListener('click', () => cancelRecoveryAndReturnToLogin(emailInput));
  cancelResetModalBtn?.addEventListener('click', () => cancelRecoveryAndReturnToLogin(emailInput));

  // Submeter pedido de recuperação personalizado conectado à base de dados
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert();

      const identifier = (forgotEmailInput?.value || '').trim().toLowerCase();
      if (!identifier) {
        showAlert('error', 'Introduza o seu email de recuperação ou nome de utilizador.');
        forgotEmailInput?.focus();
        return;
      }

      if (forgotSubmitBtn) {
        forgotSubmitBtn.disabled = true;
        forgotSubmitBtn.textContent = 'A enviar pedido seguro...';
      }

      try {
        const res = await requestPersonalizedRecoveryEmail(identifier);
        showAlert(
          'success',
          res.message ||
            'Enviámos instruções personalizadas de recuperação para o email associado à sua conta. Verifique também a pasta de spam.'
        );
      } catch (err) {
        showAlert('error', err?.message || 'Erro ao solicitar recuperação de palavra-passe.');
      } finally {
        if (forgotSubmitBtn) {
          forgotSubmitBtn.disabled = false;
          forgotSubmitBtn.textContent = 'Enviar Email de Recuperação';
        }
      }
    });
  }

  // Submeter nova palavra-passe no pop-up
  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert('resetModalAlert');

      const newPassword = resetNewPwInput?.value || '';
      const confirmPassword = resetConfirmPwInput?.value || '';
      const check = validateStrongPassword(newPassword, confirmPassword);

      if (!check.valid) {
        refreshPasswordChecklistUi();
        showAlert(
          'error',
          'Cumpra todos os requisitos a verde: mín. 8 caracteres, maiúscula, minúscula, número, carácter especial (ex: @) e confirmação igual.',
          'resetModalAlert'
        );
        return;
      }

      const supabase = await getSupabaseClient();
      if (!supabase) {
        showAlert('error', 'Serviço de segurança temporariamente indisponível.', 'resetModalAlert');
        return;
      }

      if (resetSubmitBtn) {
        resetSubmitBtn.disabled = true;
        resetSubmitBtn.textContent = 'A guardar nova palavra-passe...';
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const activeToken = sessionData?.session?.access_token || '';
        const accountEmail = sessionData?.session?.user?.email || recoveryEmail;

        const { error: updateErr } = await supabase.auth.updateUser({
          password: newPassword,
        });

        if (updateErr) {
          showAlert('error', translateAuthError(updateErr), 'resetModalAlert');
          refreshPasswordChecklistUi();
          return;
        }

        await notifyBackendRecoveryCompleted(activeToken);
        await supabase.auth.signOut().catch(() => {});

        if (resetNewPwInput) resetNewPwInput.value = '';
        if (resetConfirmPwInput) resetConfirmPwInput.value = '';
        refreshPasswordChecklistUi();
        closeResetPasswordModal();

        if (emailInput && accountEmail) {
          emailInput.value = accountEmail;
        }
        if (passwordInput) {
          passwordInput.value = '';
        }

        setActiveView('login');
        showAlert(
          'success',
          'Palavra-passe redefinida com sucesso! Inicie sessão com a sua nova palavra-passe.'
        );
        passwordInput?.focus();
      } catch {
        showAlert(
          'error',
          'Não foi possível guardar a nova palavra-passe. Solicite uma nova ligação de recuperação.',
          'resetModalAlert'
        );
      } finally {
        if (resetSubmitBtn) {
          resetSubmitBtn.textContent = 'Guardar Nova Palavra-passe';
          refreshPasswordChecklistUi();
        }
      }
    });
  }

  // Submissão de login normal (suporta nome de utilizador ex: adminspark ou email)
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (Date.now() < cooldownUntil) return;

      clearAlert();
      const identifier = emailInput?.value.trim() || '';
      const password = passwordInput?.value || '';

      if (!identifier || !password) {
        showAlert('error', 'Preencha o utilizador (ou email) e a palavra-passe.');
        return;
      }

      const supabase = await getSupabaseClient();
      if (!supabase) {
        showAlert(
          'error',
          'Não foi possível estabelecer ligação segura ao servidor de autenticação. Tente novamente dentro de instantes.'
        );
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'A autenticar...';
      }

      try {
        const authRes = await loginWithIdentifierAndPassword(identifier, password);
        if (!authRes.ok || !authRes.payload?.session?.access_token) {
          failedAttempts += 1;
          if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
            startCooldown(submitBtn);
            return;
          }
          showAlert(
            'error',
            authRes.payload?.message ||
              'Utilizador ou palavra-passe inválidos. Verifique as suas credenciais e tente novamente.'
          );
          return;
        }

        const { error: setSessErr } = await supabase.auth.setSession({
          access_token: authRes.payload.session.access_token,
          refresh_token: authRes.payload.session.refresh_token,
        });

        if (setSessErr) {
          showAlert('error', translateAuthError(setSessErr));
          return;
        }

        try {
          if (rememberCheckbox?.checked) {
            window.localStorage.setItem(REMEMBER_EMAIL_KEY, identifier);
          } else {
            window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
          }
        } catch {
          // Ignore storage error
        }

        failedAttempts = 0;
        showAlert('success', 'Autenticação validada. A entrar no Sistema de Gestão...');
        window.location.replace(getSafeRedirectTarget());
      } catch {
        showAlert('error', 'Falha de ligação ao servidor de autenticação. Verifique a sua internet e tente novamente.');
      } finally {
        if (Date.now() >= cooldownUntil && submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Entrar no Sistema';
        }
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLoginPage();
});
