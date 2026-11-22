/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Main App Controller
   ═══════════════════════════════════════════════════════════ */

import { store } from './core/store.js';
import { currentYearMonth } from './core/formatters.js';
import { confirmAction, showToast } from './core/ui.js';
import { DashboardModule } from './modules/dashboard.js';
import { RhFuncionariosModule } from './modules/rh-funcionarios.js';
import { RhRecibosModule } from './modules/rh-recibos.js';
import { OperacionalObrasModule } from './modules/operacional-obras.js';
import {
  getSupabaseClient,
  verifyAuthenticatedUser,
  verifyWithBackendEndpoint,
  signOutUser,
} from '../shared/supabase-client.js';

const SIDEBAR_COLLAPSE_KEY = 'spark_erp_sidebar_collapsed';
const ERP_THEME_KEY = 'spark_erp_theme';
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos de inatividade

const ROUTES = {
  dashboard: {
    kicker: 'Visão Geral',
    title: 'Dashboard Executivo',
  },
  'rh-funcionarios': {
    kicker: 'Recursos Humanos',
    title: 'Funcionários & Assiduidade',
  },
  'rh-recibos': {
    kicker: 'Recursos Humanos',
    title: 'Recibos de Vencimento',
  },
  'op-andamento': {
    kicker: 'Operacional',
    title: 'Obras em Andamento',
    status: 'em_andamento',
  },
  'op-iniciar': {
    kicker: 'Operacional',
    title: 'Obras a Iniciar',
    status: 'a_iniciar',
  },
  'op-concluidas': {
    kicker: 'Operacional',
    title: 'Obras Concluídas',
    status: 'concluida',
  },
};

class ErpApp {
  constructor() {
    this.activeRoute = 'dashboard';
    this.month = currentYearMonth();
    this.search = '';

    this.dashboard = new DashboardModule({
      onNavigate: (route, openProjectId = null) => {
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
        this.activeRoute = 'rh-recibos';
        this.rhRecibos.focusEmployeeYear(empId, this.month.slice(0, 4));
        this.render();
      },
    });
    this.opObras = new OperacionalObrasModule();
  }

  init(user = null) {
    this.currentUser = user;
    this.shell = document.getElementById('erpShell');
    this.authGate = document.getElementById('erpAuthGate');
    this.workspace = document.getElementById('erpWorkspace');
    this.sidebar = document.getElementById('erpSidebar');
    this.backdrop = document.getElementById('erpBackdrop');
    this.monthInput = document.getElementById('erpMonthInput');
    this.searchInput = document.getElementById('erpSearchInput');
    this.kickerEl = document.getElementById('erpKicker');
    this.titleEl = document.getElementById('erpTitle');

    this._restoreSidebarCollapse();
    this._restoreTheme();
    this._bindAuthWatchers();
    this._bindInactivityWatch();

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
        this.activeRoute = btn.dataset.route;
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

    const resetBtn = document.getElementById('btnResetDemo');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        confirmAction({
          title: 'Repor Dados de Demonstração',
          message: 'Pretende restaurar os funcionários, presenças, recibos e obras iniciais de demonstração?',
          confirmLabel: 'Repor Dados',
          onConfirm: () => {
            store.resetDemo();
            showToast('Dados de demonstração restaurados.');
          },
        });
      });
    }

    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) {
      if (this.currentUser?.email) {
        logoutBtn.title = `Terminar sessão (${this.currentUser.email})`;
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
    if (this.shell) {
      this.shell.classList.remove('is-hidden');
    }

    store.subscribe(() => this.render());
    this.render();
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
    } else if (action === 'view-ongoing') {
      this.activeRoute = 'op-andamento';
      this.render();
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
  }

  render() {
    const route = ROUTES[this.activeRoute] || ROUTES['rh-funcionarios'];
    if (this.kickerEl) this.kickerEl.textContent = route.kicker;
    if (this.titleEl) this.titleEl.textContent = route.title;

    document.querySelectorAll('[data-route]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.route === this.activeRoute);
    });

    this._updateSidebarBadges();

    const ctx = { month: this.month, search: this.search };
    if (this.activeRoute === 'dashboard') {
      this.dashboard.render(this.workspace, ctx);
    } else if (this.activeRoute === 'rh-funcionarios') {
      this.rhFuncionarios.render(this.workspace, ctx);
    } else if (this.activeRoute === 'rh-recibos') {
      this.rhRecibos.render(this.workspace, ctx);
    } else {
      this.opObras.render(this.workspace, { ...ctx, statusFilter: route.status });
    }
  }
}

async function bootstrapErp() {
  const auth = await verifyAuthenticatedUser();
  if (!auth.authenticated || !auth.session?.access_token) {
    const redirectTarget = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login/?reason=unauthenticated&redirect=${redirectTarget}`);
    return;
  }

  const backendVerified = await verifyWithBackendEndpoint(auth.session.access_token);
  if (!backendVerified) {
    await signOutUser();
    window.location.replace('/login/?reason=unauthenticated');
    return;
  }

  const app = new ErpApp();
  app.init(auth.user);
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrapErp();
});
