/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Main App Controller
   ═══════════════════════════════════════════════════════════ */

import { store } from './core/store.js';
import {
  currentYearMonth,
  getInitials,
  isValuesMasked,
  setValuesMasked,
} from './core/formatters.js';
import { confirmAction, showToast } from './core/ui.js';
import { DashboardModule } from './modules/dashboard.js';
import { RhFuncionariosModule } from './modules/rh-funcionarios.js';
import { RhRecibosModule } from './modules/rh-recibos.js';
import { OperacionalObrasModule } from './modules/operacional-obras.js';
import { OperacionalResponsaveisModule } from './modules/operacional-responsaveis.js';
import { AdminUtilizadoresModule } from './modules/admin-utilizadores.js';
import { ContaConfiguracoesModule } from './modules/conta-configuracoes.js';
import { hasPermission, ROLE_LABELS } from '../shared/permissions.js';
import {
  getSupabaseClient,
  verifyAuthenticatedUser,
  verifyWithBackendEndpoint,
  authenticatedApiFetch,
  signOutUser,
  isRecoverySessionToken,
  validateStrongPassword,
} from '../shared/supabase-client.js';

const SIDEBAR_COLLAPSE_KEY = 'spark_erp_sidebar_collapsed';
const ERP_THEME_KEY = 'spark_erp_theme';
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos de inatividade

const ROUTES = {
  dashboard: {
    kicker: 'Visão Geral',
    title: 'Dashboard Executivo',
    perm: ['dashboard', 'ver'],
  },
  'rh-funcionarios': {
    kicker: 'Recursos Humanos',
    title: 'Funcionários & Assiduidade',
    perm: ['rh_funcionarios', 'ver'],
  },
  'rh-recibos': {
    kicker: 'Recursos Humanos',
    title: 'Recibos de Vencimento',
    perm: ['rh_recibos', 'ver'],
  },
  'op-andamento': {
    kicker: 'Operacional',
    title: 'Obras em Andamento',
    status: 'em_andamento',
    perm: ['op_obras', 'ver'],
  },
  'op-iniciar': {
    kicker: 'Operacional',
    title: 'Obras a Iniciar',
    status: 'a_iniciar',
    perm: ['op_obras', 'ver'],
  },
  'op-concluidas': {
    kicker: 'Operacional',
    title: 'Obras Concluídas',
    status: 'concluida',
    perm: ['op_obras', 'ver'],
  },
  'op-responsaveis': {
    kicker: 'Operacional',
    title: 'Responsáveis Técnicos',
    perm: ['op_obras', 'ver'],
  },
  'admin-utilizadores': {
    kicker: 'Administração',
    title: 'Utilizadores & Acessos',
    perm: ['admin_utilizadores', 'ver'],
  },
  'conta-configuracoes': {
    kicker: 'Conta Pessoal',
    title: 'Configurações da Conta',
    perm: null,
  },
};

const QUICK_ACTION_PERMS = {
  'new-employee': ['rh_funcionarios', 'criar'],
  'attendance-daily': ['rh_funcionarios', 'assiduidade'],
  'attendance-report': ['rh_funcionarios', 'ver'],
  'new-payslip': ['rh_recibos', 'emitir'],
  'new-project': ['op_obras', 'criar'],
  'new-invoice': ['op_obras', 'faturas'],
  'new-tech-manager': ['op_obras', 'responsaveis'],
  'view-ongoing': ['op_obras', 'ver'],
  'new-user': ['admin_utilizadores', 'criar'],
};

class ErpApp {
  constructor() {
    this.activeRoute = 'dashboard';
    this.month = currentYearMonth();
    this.search = '';
    this.currentUser = null;
    this.currentProfile = null;

    this.dashboard = new DashboardModule({
      onNavigate: (route, openProjectId = null) => {
        if (!this._canAccessRoute(route)) {
          showToast('Sem permissão para aceder a este módulo.', 'warning');
          return;
        }
        this.activeRoute = route;
        this.render();
        if (openProjectId && this.opObras) {
          this.opObras.openProjectDetail(openProjectId);
        }
      },
      onQuickAction: (action) => this._handleQuickAction(action),
    });
    this.rhRecibos = new RhRecibosModule();
    this.rhFuncionarios = new RhFuncionariosModule({
      onOpenPayslips: (empId) => {
        if (!this._canAccessRoute('rh-recibos')) {
          showToast('Sem permissão para consultar recibos de vencimento.', 'warning');
          return;
        }
        this.activeRoute = 'rh-recibos';
        this.rhRecibos.focusEmployeeYear(empId, this.month.slice(0, 4));
        this.render();
      },
    });
    this.opObras = new OperacionalObrasModule();
    this.opResponsaveis = new OperacionalResponsaveisModule();
    this.adminUtilizadores = new AdminUtilizadoresModule({
      onUsersUpdated: (count) => {
        const el = document.getElementById('cntUsers');
        if (el) el.textContent = String(count);
      },
      onProfileUpdated: (updatedUser) => {
        if (updatedUser?.id && updatedUser.id === this.currentProfile?.id) {
          this.currentProfile = updatedUser;
          this.adminUtilizadores.setCurrentProfile(updatedUser);
          this._renderOperatorInfo();
          this._applyPermissionsUi();
          this.render();
        }
      },
    });
    this.contaConfiguracoes = new ContaConfiguracoesModule({
      onProfileUpdated: (updatedProfile) => {
        if (!updatedProfile) return;
        this.currentProfile = { ...(this.currentProfile || {}), ...updatedProfile };
        this.adminUtilizadores.setCurrentProfile(this.currentProfile);
        this._renderOperatorInfo();
        this._applyPermissionsUi();
        this.render();
      },
    });
  }

  init(user = null, profile = null) {
    this.currentUser = user;
    this.currentProfile = profile;
    this.adminUtilizadores.setCurrentProfile(profile);

    this.shell = document.getElementById('erpShell');
    this.authGate = document.getElementById('erpAuthGate');
    this.forcePwGate = document.getElementById('erpForcePasswordGate');
    this.workspace = document.getElementById('erpWorkspace');
    this.sidebar = document.getElementById('erpSidebar');
    this.backdrop = document.getElementById('erpBackdrop');
    this.monthInput = document.getElementById('erpMonthInput');
    this.searchInput = document.getElementById('erpSearchInput');
    this.kickerEl = document.getElementById('erpKicker');
    this.titleEl = document.getElementById('erpTitle');

    this._restoreSidebarCollapse();
    this._restoreTheme();
    this._restorePrivacyMask();
    this._bindAuthWatchers();
    this._bindInactivityWatch();
    this._renderOperatorInfo();
    this._applyPermissionsUi();

    if (this.monthInput) {
      this.monthInput.value = this.month;
      this.monthInput.addEventListener('change', () => {
        this.month = this.monthInput.value || currentYearMonth();
        this.render();
      });
    }

    if (this.searchInput) {
      this.searchInput.addEventListener('input', () => {
        this.search = this.searchInput.value;
        this.render();
      });
    }

    document.querySelectorAll('[data-route]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextRoute = btn.dataset.route;
        if (!this._canAccessRoute(nextRoute)) {
          showToast('Sem permissão para aceder a este módulo.', 'warning');
          return;
        }
        this.activeRoute = nextRoute;
        this._closeMobileSidebar();
        this.render();
      });
    });

    const collapseBtn = document.getElementById('btnCollapseSidebar');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => this._toggleSidebarCollapse());
    }

    const themeBtn = document.getElementById('btnToggleTheme');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => this._toggleTheme());
    }

    const privacyBtn = document.getElementById('btnToggleValuesVisibility');
    if (privacyBtn) {
      privacyBtn.addEventListener('click', () => this._togglePrivacyMask());
    }

    const operatorCard = document.getElementById('erpOperatorCard');
    if (operatorCard) {
      operatorCard.addEventListener('click', () => {
        this.activeRoute = 'conta-configuracoes';
        this._closeMobileSidebar();
        this.render();
      });
    }

    document.querySelectorAll('[data-quick]').forEach((btn) => {
      btn.addEventListener('click', () => this._handleQuickAction(btn.dataset.quick));
    });

    const menuBtn = document.getElementById('erpMenuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', () => {
        this.sidebar.classList.toggle('is-open');
        this.backdrop.classList.toggle('is-open');
      });
    }

    if (this.backdrop) {
      this.backdrop.addEventListener('click', () => this._closeMobileSidebar());
    }

    const modalOverlay = document.getElementById('erpModalOverlay');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
          modalOverlay.classList.remove('is-open');
          document.body.style.overflow = '';
        }
      });
    }

    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) {
      const opHint =
        this.currentProfile?.email_recuperacao ||
        (this.currentProfile?.username ? `@${this.currentProfile.username}` : '') ||
        (!String(this.currentUser?.email || '').endsWith('@sistema.sparksmirk.internal')
          ? this.currentUser?.email
          : '');
      if (opHint) {
        logoutBtn.title = `Terminar sessão (${opHint})`;
      }
      logoutBtn.addEventListener('click', () => {
        confirmAction({
          title: 'Sair do Sistema de Gestão',
          message: 'Tem a certeza de que pretende terminar a sua sessão atual no sistema Spark & Smirk?',
          confirmLabel: 'Terminar Sessão',
          onConfirm: () => this._logout(),
        });
      });
    }

    if (this.authGate) {
      this.authGate.classList.add('is-hidden');
    }
    if (this.forcePwGate) {
      this.forcePwGate.classList.add('is-hidden');
    }
    if (this.shell) {
      this.shell.classList.remove('is-hidden');
    }

    // Pré-carregar contagem de utilizadores para administradores
    if (this._canAccessRoute('admin-utilizadores')) {
      this.adminUtilizadores.fetchUsers({ silent: true });
    }

    store.subscribe(() => this.render());
    this.render();
  }

  _canAccessRoute(routeKey) {
    const spec = ROUTES[routeKey];
    if (!spec || !this.currentProfile) return false;
    if (!spec.perm) return true;
    return hasPermission(this.currentProfile, spec.perm[0], spec.perm[1]);
  }

  _canQuickAction(actionKey) {
    const perm = QUICK_ACTION_PERMS[actionKey];
    if (!perm || !this.currentProfile) return false;
    return (
      hasPermission(this.currentProfile, perm[0], 'ver') &&
      hasPermission(this.currentProfile, perm[0], perm[1])
    );
  }

  _renderOperatorInfo() {
    const nameEl = document.getElementById('erpOperatorName');
    const roleEl = document.getElementById('erpOperatorRole');
    const avatarEl = document.getElementById('erpOperatorInitials');
    const displayName =
      this.currentProfile?.nome_completo ||
      this.currentUser?.user_metadata?.nome_completo ||
      this.currentUser?.email ||
      'Operador';
    const roleLabel =
      ROLE_LABELS[this.currentProfile?.nivel_acesso] || 'Administrador';

    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = roleLabel;
    if (avatarEl) avatarEl.textContent = getInitials(displayName);
  }

  _applyPermissionsUi() {
    if (!this.currentProfile) return;

    document.querySelectorAll('[data-route]').forEach((btn) => {
      const allowed = this._canAccessRoute(btn.dataset.route);
      btn.style.display = allowed ? '' : 'none';
    });

    // Oculta grupo Administração se não tiver acesso a Utilizadores
    const adminGroup = document.getElementById('erpNavGroupAdmin');
    if (adminGroup) {
      adminGroup.style.display = this._canAccessRoute('admin-utilizadores') ? '' : 'none';
    }

    document.querySelectorAll('[data-quick]').forEach((btn) => {
      const allowed = this._canQuickAction(btn.dataset.quick);
      btn.style.display = allowed ? '' : 'none';
    });

    if (!this._canAccessRoute(this.activeRoute)) {
      const firstAllowed = Object.keys(ROUTES).find((k) => this._canAccessRoute(k));
      this.activeRoute = firstAllowed || 'dashboard';
    }
  }

  _restoreSidebarCollapse() {
    try {
      const collapsed = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
      this.shell?.classList.toggle('is-sidebar-collapsed', collapsed);
    } catch {
      // Ignore storage error
    }
  }

  _toggleSidebarCollapse() {
    if (!this.shell) return;
    const isCollapsed = this.shell.classList.toggle('is-sidebar-collapsed');
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, isCollapsed ? '1' : '0');
    } catch {
      // Ignore storage error
    }
  }

  _restoreTheme() {
    try {
      const theme = window.localStorage.getItem(ERP_THEME_KEY) === 'dark' ? 'dark' : 'light';
      this._applyTheme(theme);
    } catch {
      this._applyTheme('light');
    }
  }

  _applyTheme(theme) {
    const isDark = theme === 'dark';
    if (isDark) {
      document.documentElement.setAttribute('data-erp-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-erp-theme');
    }
    const btn = document.getElementById('btnToggleTheme');
    if (btn) {
      btn.setAttribute('data-tooltip', isDark ? 'Ativar Modo Claro' : 'Ativar Modo Escuro');
    }
  }

  _toggleTheme() {
    const isCurrentlyDark = document.documentElement.getAttribute('data-erp-theme') === 'dark';
    const next = isCurrentlyDark ? 'light' : 'dark';
    this._applyTheme(next);
    try {
      window.localStorage.setItem(ERP_THEME_KEY, next);
    } catch {
      // Ignore storage error
    }
    showToast(next === 'dark' ? 'Modo escuro ativado no sistema de gestão.' : 'Modo claro ativado no sistema de gestão.');
  }

  _restorePrivacyMask() {
    this._applyPrivacyMask(isValuesMasked());
  }

  _applyPrivacyMask(masked) {
    setValuesMasked(Boolean(masked));
    const btn = document.getElementById('btnToggleValuesVisibility');
    const label = document.getElementById('erpPrivacyLabel');
    if (btn) {
      btn.setAttribute('aria-pressed', masked ? 'true' : 'false');
      const tip = masked ? 'Mostrar valores financeiros' : 'Ocultar valores financeiros';
      btn.setAttribute('data-tooltip', tip);
      btn.setAttribute('title', tip);
    }
    if (label) {
      label.textContent = masked ? 'Valores Ocultos' : 'Ocultar Valores';
    }
  }

  _togglePrivacyMask() {
    const next = !isValuesMasked();
    this._applyPrivacyMask(next);
    this.render();
    showToast(
      next
        ? 'Modo privacidade ativo: todos os valores foram ocultados.'
        : 'Modo privacidade desativado: valores financeiros visíveis.'
    );
  }

  async _bindAuthWatchers() {
    const supabase = await getSupabaseClient();
    if (!supabase) return;

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        window.location.replace('/login/?reason=logged_out');
      }
    });
  }

  _bindInactivityWatch() {
    let inactivityTimer = null;
    const resetTimer = () => {
      if (inactivityTimer) {
        window.clearTimeout(inactivityTimer);
      }
      inactivityTimer = window.setTimeout(async () => {
        await signOutUser();
        window.location.replace('/login/?reason=timeout');
      }, INACTIVITY_TIMEOUT_MS);
    };

    ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach((evt) => {
      window.addEventListener(evt, resetTimer, { passive: true });
    });
    resetTimer();
  }

  async _logout(reason = 'logged_out') {
    this._closeMobileSidebar();
    await signOutUser();
    window.location.replace(`/login/?reason=${encodeURIComponent(reason)}`);
  }

  _handleQuickAction(action) {
    if (!this._canQuickAction(action)) {
      showToast('Não tem permissão para executar esta ação.', 'warning');
      return;
    }

    if (action === 'new-employee') {
      this.activeRoute = 'rh-funcionarios';
      this.rhFuncionarios.viewMode = 'directory';
      this.render();
      this.rhFuncionarios.openNewEmployee();
    } else if (action === 'attendance-daily') {
      this.activeRoute = 'rh-funcionarios';
      this.rhFuncionarios.viewMode = 'daily';
      this.render();
      showToast('Folha de presenças diária aberta.');
    } else if (action === 'attendance-report') {
      this.activeRoute = 'rh-funcionarios';
      this.rhFuncionarios.viewMode = 'report';
      this.render();
    } else if (action === 'new-payslip') {
      this.activeRoute = 'rh-recibos';
      this.render();
      this.rhRecibos.openNewPayslip(this.month);
    } else if (action === 'new-project') {
      const targetStatus = ROUTES[this.activeRoute]?.status || 'em_andamento';
      if (!ROUTES[this.activeRoute]?.status) {
        this.activeRoute = 'op-andamento';
      }
      this.render();
      this.opObras.openNewProject(targetStatus);
    } else if (action === 'new-invoice') {
      if (!ROUTES[this.activeRoute]?.status) {
        this.activeRoute = 'op-andamento';
      }
      this.render();
      this.opObras.openLaunchInvoiceModal();
    } else if (action === 'new-tech-manager') {
      this.activeRoute = 'op-responsaveis';
      this.render();
      this.opResponsaveis.openNewTechnicalManager();
    } else if (action === 'view-ongoing') {
      this.activeRoute = 'op-andamento';
      this.render();
    } else if (action === 'new-user') {
      this.activeRoute = 'admin-utilizadores';
      this.render();
      this.adminUtilizadores.openNewUserModal();
    }
  }

  _closeMobileSidebar() {
    this.sidebar?.classList.remove('is-open');
    this.backdrop?.classList.remove('is-open');
  }

  _updateSidebarBadges() {
    const state = store.getState();
    const setBadge = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    setBadge('cntEmployees', state.employees.length);
    setBadge('cntPayslips', state.payslips.length);
    setBadge('cntAndamento', state.projects.filter((p) => p.status === 'em_andamento').length);
    setBadge('cntIniciar', state.projects.filter((p) => p.status === 'a_iniciar').length);
    setBadge('cntConcluidas', state.projects.filter((p) => p.status === 'concluida').length);
    setBadge('cntResponsaveis', (state.technicalManagers || []).length);
    setBadge('cntUsers', this.adminUtilizadores.getUsersCount());
  }

  render() {
    if (!this._canAccessRoute(this.activeRoute)) {
      const firstAllowed = Object.keys(ROUTES).find((k) => this._canAccessRoute(k));
      if (firstAllowed) {
        this.activeRoute = firstAllowed;
      } else {
        if (this.kickerEl) this.kickerEl.textContent = 'Acesso Restrito';
        if (this.titleEl) this.titleEl.textContent = 'Sem Módulos Atribuídos';
        document.querySelectorAll('[data-route]').forEach((btn) => btn.classList.remove('is-active'));
        if (this.workspace) {
          this.workspace.innerHTML = `
            <div class="erp-panel" style="padding:28px;text-align:center;">
              <h2 class="erp-panel__title">Sem permissões ativas</h2>
              <p class="erp-panel__subtitle" style="margin-top:6px;">A sua conta ainda não possui módulos autorizados. Contacte o administrador do sistema.</p>
            </div>
          `;
        }
        return;
      }
    }

    const route = ROUTES[this.activeRoute] || ROUTES.dashboard;
    if (this.kickerEl) this.kickerEl.textContent = route.kicker;
    if (this.titleEl) this.titleEl.textContent = route.title;

    document.querySelectorAll('[data-route]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.route === this.activeRoute);
    });

    this._updateSidebarBadges();

    const ctx = {
      month: this.month,
      search: this.search,
      can: (mod, act) => (this.currentProfile ? hasPermission(this.currentProfile, mod, act) : false),
    };
    if (this.activeRoute === 'dashboard') {
      this.dashboard.render(this.workspace, ctx);
    } else if (this.activeRoute === 'rh-funcionarios') {
      this.rhFuncionarios.render(this.workspace, ctx);
    } else if (this.activeRoute === 'rh-recibos') {
      this.rhRecibos.render(this.workspace, ctx);
    } else if (this.activeRoute === 'admin-utilizadores') {
      this.adminUtilizadores.render(this.workspace, ctx);
    } else if (this.activeRoute === 'op-responsaveis') {
      this.opResponsaveis.render(this.workspace, ctx);
    } else if (this.activeRoute === 'conta-configuracoes') {
      this.contaConfiguracoes.render(this.workspace, {
        currentProfile: this.currentProfile,
        currentUser: this.currentUser,
      });
    } else {
      this.opObras.render(this.workspace, { ...ctx, statusFilter: route.status });
    }
  }
}

function showForcedPasswordChangeGate({ user, profile, onComplete }) {
  const authGate = document.getElementById('erpAuthGate');
  const forceGate = document.getElementById('erpForcePasswordGate');
  const infoEl = document.getElementById('forcePwUserInfo');
  const alertEl = document.getElementById('forcePwAlert');
  const form = document.getElementById('forcePwForm');
  const newPwInput = document.getElementById('forceNewPassword');
  const confirmPwInput = document.getElementById('forceConfirmPassword');
  const checklistEl = document.getElementById('forcePwChecklist');
  const saveBtn = document.getElementById('btnSaveForcedPw');
  const logoutBtn = document.getElementById('btnForcePwLogout');

  if (authGate) authGate.classList.add('is-hidden');
  if (!forceGate) return;
  forceGate.classList.remove('is-hidden');

  const displayName = profile?.nome_completo || user?.email || '';
  if (infoEl && displayName) {
    infoEl.textContent = `Olá ${displayName}, a sua conta foi criada com uma senha provisória. Por segurança, crie agora uma nova palavra-passe definitiva antes de aceder ao sistema.`;
  }

  const showGateError = (msg) => {
    if (!alertEl) return;
    alertEl.className = 'erp-force-pw-alert is-visible erp-force-pw-alert--error';
    alertEl.textContent = msg;
  };

  forceGate.querySelectorAll('[data-toggle-pw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.togglePw);
      if (!target) return;
      const isPw = target.type === 'password';
      target.type = isPw ? 'text' : 'password';
      btn.textContent = isPw ? 'OCULTAR' : 'MOSTRAR';
    });
  });

  const validateRules = () => {
    const { valid, rules } = validateStrongPassword(newPwInput?.value || '', confirmPwInput?.value || '');
    checklistEl?.querySelectorAll('[data-rule]').forEach((li) => {
      const met = Boolean(rules[li.dataset.rule]);
      li.classList.toggle('is-valid', met);
      li.classList.toggle('is-invalid', !met);
    });
    return valid;
  };

  newPwInput?.addEventListener('input', validateRules);
  confirmPwInput?.addEventListener('input', validateRules);
  validateRules();

  logoutBtn?.addEventListener('click', async () => {
    await signOutUser();
    window.location.replace('/login/?reason=logged_out');
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateRules()) {
      showGateError(
        'A nova palavra-passe deve cumprir todos os requisitos (mín. 8 caracteres, maiúscula, minúscula, número, carácter especial ex: @ e confirmação igual).'
      );
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'A guardar palavra-passe...';
    }

    try {
      const supabase = await getSupabaseClient();
      if (!supabase) throw new Error('Serviço de autenticação temporariamente indisponível.');

      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPwInput.value,
      });
      if (updateErr) {
        throw new Error(updateErr.message || 'Não foi possível atualizar a palavra-passe.');
      }

      const completion = await authenticatedApiFetch('/api/auth/complete-password-change', {
        method: 'POST',
      });

      const updatedProfile = completion?.profile || {
        ...(profile || {}),
        senha_provisoria: false,
      };
      showToast('Palavra-passe definitiva guardada com segurança!');
      onComplete(updatedProfile);
    } catch (err) {
      showGateError(err?.message || 'Não foi possível atualizar a sua palavra-passe.');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar Nova Palavra-passe e Entrar';
      }
    }
  });
}

async function bootstrapErp() {
  const combinedUrl = `${window.location.search || ''}&${window.location.hash || ''}`;
  if (
    combinedUrl.includes('type=recovery') ||
    combinedUrl.includes('token_hash=') ||
    combinedUrl.includes('recovery_token=')
  ) {
    window.location.replace(`/login/${window.location.search}${window.location.hash}`);
    return;
  }

  const auth = await verifyAuthenticatedUser();
  if (!auth.authenticated || !auth.session?.access_token) {
    const redirectTarget = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login/?reason=unauthenticated&redirect=${redirectTarget}`);
    return;
  }

  if (isRecoverySessionToken(auth.session.access_token)) {
    window.location.replace('/login/?mode=recovery');
    return;
  }

  const backendCheck = await verifyWithBackendEndpoint(auth.session.access_token);
  if (!backendCheck.authenticated || !backendCheck.profile) {
    if (backendCheck.error === 'RECOVERY_PASSWORD_REQUIRED') {
      window.location.replace('/login/?mode=recovery');
      return;
    }
    await signOutUser();
    const reason =
      backendCheck.error === 'ACCOUNT_DISABLED'
        ? 'disabled'
        : backendCheck.error === 'VERIFICATION_UNAVAILABLE'
          ? 'unavailable'
          : 'unauthenticated';
    window.location.replace(`/login/?reason=${reason}`);
    return;
  }

  const profile = backendCheck.profile;
  const mustChangePassword = Boolean(
    profile?.senha_provisoria || auth.user?.app_metadata?.must_change_password
  );

  if (mustChangePassword) {
    showForcedPasswordChangeGate({
      user: auth.user,
      profile,
      onComplete: async (updatedProfile) => {
        try {
          await store.init(updatedProfile);
        } catch (err) {
          showToast(err?.message || 'Erro ao sincronizar dados iniciais.', 'error');
        }
        const app = new ErpApp();
        app.init(auth.user, updatedProfile);
      },
    });
    return;
  }

  try {
    await store.init(profile);
  } catch (err) {
    showToast(err?.message || 'Erro ao carregar dados do sistema.', 'error');
  }

  const app = new ErpApp();
  app.init(auth.user, profile);
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrapErp();
});
