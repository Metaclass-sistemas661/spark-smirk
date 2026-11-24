/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — Login & Recuperação Segura de Acesso
   ═══════════════════════════════════════════════════════════ */

import {
  getSupabaseClient,
  verifyAuthenticatedUser,
  loadSupabaseConfig,
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
    subtitle: 'Introduza as suas credenciais corporativas para aceder ao painel interno.',
  },
  forgot: {
    title: 'Recuperar Acesso',
    subtitle: 'Introduza o seu email corporativo para receber uma ligação segura de redefinição.',
  },
  reset: {
    title: 'Nova Palavra-passe',
    subtitle: 'Defina uma nova palavra-passe segura para a sua conta corporativa Spark & Smirk.',
  },
};

function showAlert(type, message) {
  const alertEl = document.getElementById('loginAlert');
  if (!alertEl) return;
  alertEl.className = `login-alert is-visible login-alert--${type}`;
  alertEl.textContent = message;
}

function clearAlert() {
  const alertEl = document.getElementById('loginAlert');
  if (!alertEl) return;
  alertEl.className = 'login-alert';
  alertEl.textContent = '';
}

function setActiveView(viewName) {
  const titleEl = document.getElementById('loginPaneTitle');
  const subtitleEl = document.getElementById('loginPaneSubtitle');
  const views = {
    login: document.getElementById('loginView'),
    forgot: document.getElementById('forgotView'),
    reset: document.getElementById('resetView'),
  };

  Object.entries(views).forEach(([key, el]) => {
    if (el) el.hidden = key !== viewName;
  });

  const meta = VIEW_META[viewName] || VIEW_META.login;
  if (titleEl) titleEl.textContent = meta.title;
  if (subtitleEl) subtitleEl.textContent = meta.subtitle;
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
    const cleanUrl = `${window.location.pathname}`;
    window.history.replaceState({}, document.title, cleanUrl);
  } catch {
    // Ignore history errors
  }
}

function validatePasswordStrength(password, confirmPassword) {
  const rules = {
    len: password.length >= 8,
    letter: /[a-zA-Z]/.test(password),
    digit: /\d/.test(password),
    match: password.length > 0 && password === confirmPassword,
  };
  const valid = rules.len && rules.letter && rules.digit && rules.match;
  return { valid, rules };
}

function bindPasswordChecklist() {
  const pw1 = document.getElementById('resetNewPassword');
  const pw2 = document.getElementById('resetConfirmPassword');
  const checklist = document.getElementById('resetPwChecklist');

  const refresh = () => {
    const { rules } = validatePasswordStrength(pw1?.value || '', pw2?.value || '');
    if (checklist) {
      Object.entries(rules).forEach(([ruleKey, met]) => {
        const item = checklist.querySelector(`[data-rule="${ruleKey}"]`);
        if (item) item.classList.toggle('is-met', met);
      });
    }
  };

  pw1?.addEventListener('input', refresh);
  pw2?.addEventListener('input', refresh);
  refresh();
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

async function resolveRecoverySession(recoveryCtx) {
  const verifyingBox = document.getElementById('resetVerifyingBox');
  const resetForm = document.getElementById('resetForm');

  setActiveView('reset');
  if (verifyingBox) verifyingBox.hidden = false;
  if (resetForm) resetForm.hidden = true;

  if (recoveryCtx.urlError) {
    stripSensitiveUrlParams();
    setActiveView('forgot');
    showAlert(
      'error',
      'A ligação de recuperação expirou ou já foi utilizada. Introduza o seu email corporativo para receber uma nova ligação.'
    );
    return;
  }

  const supabase = await getSupabaseClient();
  if (!supabase) {
    if (verifyingBox) verifyingBox.hidden = true;
    setActiveView('forgot');
    showAlert('error', 'Serviço de segurança temporariamente indisponível. Tente novamente.');
    return;
  }

  let activeSession = null;

  try {
    if (recoveryCtx.tokenHash) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: recoveryCtx.tokenHash,
        type: recoveryCtx.otpType || 'recovery',
      });
      stripSensitiveUrlParams();
      if (error || !data?.session) {
        setActiveView('forgot');
        showAlert('error', translateAuthError(error));
        return;
      }
      activeSession = data.session;
    } else {
      const { data: currentData } = await supabase.auth.getSession();
      activeSession = currentData?.session || null;

      if (!activeSession && recoveryCtx.authCode) {
        const { data: exchangeData, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(
          recoveryCtx.authCode
        );
        if (!exchangeErr && exchangeData?.session) {
          activeSession = exchangeData.session;
        }
      }
      stripSensitiveUrlParams();
    }
  } catch {
    stripSensitiveUrlParams();
    setActiveView('forgot');
    showAlert(
      'error',
      'Não foi possível validar a ligação de recuperação. Solicite um novo email de recuperação.'
    );
    return;
  }

  if (verifyingBox) verifyingBox.hidden = true;

  if (!activeSession || !activeSession.user) {
    setActiveView('forgot');
    showAlert(
      'error',
      'A ligação de recuperação é inválida ou já expirou. Introduza o seu email para pedir uma nova.'
    );
    return;
  }

  recoveryEmail = activeSession.user.email || '';
  if (resetForm) resetForm.hidden = false;
  showAlert(
    'info',
    recoveryEmail
      ? `Conta verificada (${recoveryEmail}). Introduza a sua nova palavra-passe abaixo.`
      : 'Ligação validada. Introduza a sua nova palavra-passe abaixo.'
  );
  document.getElementById('resetNewPassword')?.focus();
}

async function requestPersonalizedRecoveryEmail(email) {
  const response = await window.fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ email }),
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
    await resolveRecoverySession(recoveryCtx);
  } else {
    showRedirectNoticeIfNeeded();

    const auth = await verifyAuthenticatedUser();
    if (auth.authenticated) {
      window.location.replace(getSafeRedirectTarget());
      return;
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
        setActiveView('reset');
        const verifyingBox = document.getElementById('resetVerifyingBox');
        if (verifyingBox) verifyingBox.hidden = true;
        if (resetForm) resetForm.hidden = false;
        showAlert(
          'info',
          recoveryEmail
            ? `Conta verificada (${recoveryEmail}). Introduza a sua nova palavra-passe abaixo.`
            : 'Ligação validada. Introduza a sua nova palavra-passe abaixo.'
        );
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

  if (backFromResetBtn) {
    backFromResetBtn.addEventListener('click', async () => {
      clearAlert();
      const client = await getSupabaseClient();
      if (client) {
        await client.auth.signOut().catch(() => {});
      }
      if (resetNewPwInput) resetNewPwInput.value = '';
      if (resetConfirmPwInput) resetConfirmPwInput.value = '';
      setActiveView('login');
      emailInput?.focus();
    });
  }

  // Submeter pedido de recuperação personalizado conectado à base de dados
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert();

      const email = (forgotEmailInput?.value || '').trim().toLowerCase();
      if (!email) {
        showAlert('error', 'Introduza o seu email corporativo para recuperar o acesso.');
        forgotEmailInput?.focus();
        return;
      }

      if (forgotSubmitBtn) {
        forgotSubmitBtn.disabled = true;
        forgotSubmitBtn.textContent = 'A enviar pedido seguro...';
      }

      try {
        const res = await requestPersonalizedRecoveryEmail(email);
        showAlert(
          'success',
          res.message ||
            `Enviámos instruções personalizadas de recuperação para ${email}. Verifique a sua caixa de entrada e a pasta de spam.`
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

  // Submeter nova palavra-passe após clicar no link do email
  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert();

      const newPassword = resetNewPwInput?.value || '';
      const confirmPassword = resetConfirmPwInput?.value || '';
      const check = validatePasswordStrength(newPassword, confirmPassword);

      if (!check.rules.len || !check.rules.letter || !check.rules.digit) {
        showAlert(
          'error',
          'A nova palavra-passe deve ter no mínimo 8 caracteres, incluindo letras e números.'
        );
        return;
      }
      if (!check.rules.match) {
        showAlert('error', 'As palavras-passe introduzidas não coincidem.');
        return;
      }

      const supabase = await getSupabaseClient();
      if (!supabase) {
        showAlert('error', 'Serviço de segurança temporariamente indisponível.');
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
          showAlert('error', translateAuthError(updateErr));
          return;
        }

        await notifyBackendRecoveryCompleted(activeToken);
        await supabase.auth.signOut().catch(() => {});

        if (resetNewPwInput) resetNewPwInput.value = '';
        if (resetConfirmPwInput) resetConfirmPwInput.value = '';
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
          'Não foi possível guardar a nova palavra-passe. Solicite uma nova ligação de recuperação.'
        );
      } finally {
        if (resetSubmitBtn) {
          resetSubmitBtn.disabled = false;
          resetSubmitBtn.textContent = 'Guardar Nova Palavra-passe';
        }
      }
    });
  }

  // Submissão de login normal
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (Date.now() < cooldownUntil) return;

      clearAlert();
      const email = emailInput?.value.trim() || '';
      const password = passwordInput?.value || '';

      if (!email || !password) {
        showAlert('error', 'Preencha o email corporativo e a palavra-passe.');
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
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error || !data?.session || !data?.user) {
          failedAttempts += 1;
          if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
            startCooldown(submitBtn);
            return;
          }
          showAlert('error', translateAuthError(error));
          return;
        }

        try {
          if (rememberCheckbox?.checked) {
            window.localStorage.setItem(REMEMBER_EMAIL_KEY, email);
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
