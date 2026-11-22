/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — Login Controller (Supabase Auth + Barriers)
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
  return error?.message || 'Não foi possível iniciar sessão. Tente novamente.';
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
    if (next.startsWith('/gestao')) {
      return next;
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
    } else if (reason === 'unauthenticated') {
      showAlert('info', 'Área reservada. Autentique-se com a sua conta Spark & Smirk para aceder ao sistema interno.');
    } else if (reason === 'logged_out') {
      showAlert('success', 'Sessão terminada com segurança.');
    }
  } catch {
    // Ignore query parse error
  }
}

async function initLoginPage() {
  getFirebaseApp();
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const rememberCheckbox = document.getElementById('loginRemember');
  const togglePasswordBtn = document.getElementById('btnTogglePassword');
  const forgotBtn = document.getElementById('btnForgotPassword');
  const submitBtn = document.getElementById('btnLoginSubmit');

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

  // Toggle MOSTRAR / OCULTAR palavra-passe
  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      togglePasswordBtn.textContent = isPassword ? 'OCULTAR' : 'MOSTRAR';
    });
  }

  showRedirectNoticeIfNeeded();

  // Verificar se já existe sessão válida
  const auth = await verifyAuthenticatedUser();
  if (auth.authenticated) {
    window.location.replace(getSafeRedirectTarget());
    return;
  }

  const config = await loadSupabaseConfig();
  if (!config) {
    showAlert(
      'info',
      'Ligação ao Supabase ainda não configurada neste ambiente. Defina VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ou os segredos no Firebase Secret Manager.'
    );
  }

  // Recuperação de palavra-passe
  if (forgotBtn) {
    forgotBtn.addEventListener('click', async () => {
      clearAlert();
      const email = emailInput?.value.trim() || '';
      if (!email) {
        showAlert('info', 'Introduza primeiro o seu email corporativo para receber o link de recuperação.');
        emailInput?.focus();
        return;
      }

      const supabase = await getSupabaseClient();
      if (!supabase) {
        showAlert(
          'error',
          'Não é possível recuperar a palavra-passe porque as credenciais do Supabase ainda não estão configuradas.'
        );
        return;
      }

      forgotBtn.disabled = true;
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login/`,
        });
        if (error) {
          showAlert('error', translateAuthError(error));
        } else {
          showAlert(
            'success',
            `Enviámos instruções de recuperação para ${email}. Verifique a sua caixa de entrada.`
          );
        }
      } catch {
        showAlert('error', 'Erro ao solicitar recuperação de palavra-passe.');
      } finally {
        forgotBtn.disabled = false;
      }
    });
  }

  // Submissão de login
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
          'Configuração Supabase em falta. Configure o Firebase Secret Manager (SUPABASE_URL e SUPABASE_ANON_KEY) ou o ficheiro .env antes de iniciar sessão.'
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

        // Guardar ou limpar email lembrado
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
        showAlert('error', 'Falha de rede ao contactar o servidor de autenticação Supabase.');
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
