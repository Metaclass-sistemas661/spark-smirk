/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — RH: Funcionários, Presenças & Relatório
   ═══════════════════════════════════════════════════════════ */

import { store } from '../core/store.js';
import {
  escapeHtml,
  formatCurrency,
  formatDatePT,
  formatMonthLabel,
  getDaysInMonth,
  getInitials,
  getWeekdayShortPT,
  isValidNIF,
  generateId,
  todayISO,
  downloadCSV,
} from '../core/formatters.js';
import { ICONS, openModal, closeModal, confirmAction, showToast } from '../core/ui.js';

const ATTENDANCE_LABELS = {
  P: { code: 'P', label: 'Presente', cls: 'P' },
  FJ: { code: 'FJ', label: 'Falta Justificada', cls: 'FJ' },
  FI: { code: 'FI', label: 'Falta Injustificada', cls: 'FI' },
  FE: { code: 'FE', label: 'Férias', cls: 'FE' },
};

const DEPARTMENTS = [
  'Engenharia',
  'Construção Civil',
  'Reabilitação',
  'Instalações Elétricas',
  'Espaços Verdes',
  'Administrativo',
];

const CONTRACTS = ['Sem Termo', 'Termo Certo', 'Termo Incerto', 'Prestação de Serviços'];

function computeMonthlyAttendance(employee, attendanceMap, yearMonth) {
  const empAtt = attendanceMap[employee.id] || {};
  const daysCount = getDaysInMonth(yearMonth);
  let workingDays = 0;
  let present = 0;
  let justified = 0;
  let unjustified = 0;
  let vacation = 0;

  for (let d = 1; d <= daysCount; d += 1) {
    const wd = getWeekdayShortPT(yearMonth, d);
    if (wd !== 0 && wd !== 6) workingDays += 1;
    const dateISO = `${yearMonth}-${String(d).padStart(2, '0')}`;
    const rec = empAtt[dateISO];
    if (!rec) continue;
    if (rec.status === 'P') present += 1;
    else if (rec.status === 'FJ') justified += 1;
    else if (rec.status === 'FI') unjustified += 1;
    else if (rec.status === 'FE') vacation += 1;
  }

  const totalAbsences = justified + unjustified;
  const accounted = present + totalAbsences;
  const attendanceRate = accounted > 0 ? Math.round((present / accounted) * 100) : 100;
  const mealEarned = present * (Number(employee.mealAllowance) || 0);

  return {
    workingDays,
    present,
    justified,
    unjustified,
    vacation,
    totalAbsences,
    attendanceRate,
    mealEarned,
  };
}

export class RhFuncionariosModule {
  constructor(options = {}) {
    this.viewMode = 'directory'; // 'directory' | 'daily' | 'report'
    this.selectedDate = todayISO();
    this.deptFilter = 'all';
    this.statusFilter = 'all';
    this.onOpenPayslips = options.onOpenPayslips || null;
  }

  render(container, ctx) {
    const state = store.getState();
    const { month, search } = ctx;
    const query = (search || '').trim().toLowerCase();

    const filtered = state.employees.filter((e) => {
      if (this.deptFilter !== 'all' && e.department !== this.deptFilter) return false;
      if (this.statusFilter !== 'all' && e.status !== this.statusFilter) return false;
      if (query) {
        const hay = `${e.name} ${e.role} ${e.department} ${e.nif} ${e.email}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const activeCount = state.employees.filter((e) => e.status === 'ativo').length;
    const totalPayrollBase = state.employees
      .filter((e) => e.status === 'ativo')
      .reduce((acc, e) => acc + (Number(e.baseSalary) || 0), 0);

    let totalPresentMonth = 0;
    let totalAbsencesMonth = 0;
    state.employees.forEach((emp) => {
      const m = computeMonthlyAttendance(emp, state.attendance, month);
      totalPresentMonth += m.present;
      totalAbsencesMonth += m.totalAbsences;
    });

    container.innerHTML = `
      <div class="erp-kpi-grid">
        <div class="erp-kpi-card erp-kpi-card--primary">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Equipa Ativa</span>
            <span class="erp-kpi-card__icon">${ICONS.users}</span>
          </div>
          <div class="erp-kpi-card__value">${activeCount} <span style="font-size:13px;font-weight:600;color:var(--erp-text-muted)">/ ${state.employees.length}</span></div>
          <div class="erp-kpi-card__meta">Colaboradores registados em RH</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--success">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Presenças (${escapeHtml(formatMonthLabel(month))})</span>
            <span class="erp-kpi-card__icon">${ICONS.checkCircle}</span>
          </div>
          <div class="erp-kpi-card__value">${totalPresentMonth} dias</div>
          <div class="erp-kpi-card__meta">Total de dias trabalhados no mês</div>
        </div>

        <div class="erp-kpi-card erp-kpi-card--warning">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Faltas no Mês</span>
            <span class="erp-kpi-card__icon">${ICONS.alert}</span>
          </div>
          <div class="erp-kpi-card__value">${totalAbsencesMonth} ${totalAbsencesMonth === 1 ? 'dia' : 'dias'}</div>
          <div class="erp-kpi-card__meta">Justificadas + injustificadas</div>
        </div>

        <div class="erp-kpi-card">
          <div class="erp-kpi-card__head">
            <span class="erp-kpi-card__label">Massa Salarial Base</span>
            <span class="erp-kpi-card__icon">${ICONS.euro}</span>
          </div>
          <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalPayrollBase))}</div>
          <div class="erp-kpi-card__meta">Vencimentos base mensais (ativos)</div>
        </div>
      </div>

      <div class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-subtabs" role="tablist">
            <button type="button" class="erp-subtab ${this.viewMode === 'directory' ? 'is-active' : ''}" data-rh-view="directory">
              ${ICONS.users}
              <span>Diretório de Funcionários</span>
              <span class="erp-subtab__badge">${filtered.length}</span>
            </button>
            <button type="button" class="erp-subtab ${this.viewMode === 'daily' ? 'is-active' : ''}" data-rh-view="daily" ${(ctx.can ? ctx.can('rh_funcionarios', 'assiduidade') : true) ? '' : 'style="display:none"'}>
              ${ICONS.calendar}
              <span>Marcar Presenças &amp; Faltas</span>
            </button>
            <button type="button" class="erp-subtab ${this.viewMode === 'report' ? 'is-active' : ''}" data-rh-view="report">
              ${ICONS.chart}
              <span>Relatório Mensal de Assiduidade</span>
            </button>
          </div>

          <div class="erp-panel__actions">
            ${
              this.viewMode === 'report'
                ? `<button type="button" class="erp-btn erp-btn--outline" id="btnExportAttendanceCsv">${ICONS.download}<span>Exportar CSV</span></button>`
                : ''
            }
            ${
              (ctx.can ? ctx.can('rh_funcionarios', 'criar') : true)
                ? `<button type="button" class="erp-btn erp-btn--primary" id="btnNewEmployee">
                    ${ICONS.plus}
                    <span>Novo Funcionário</span>
                  </button>`
                : ''
            }
          </div>
        </div>

        <div id="rhViewBody"></div>
      </div>
    `;

    this._can = ctx.can || (() => true);
    if (this.viewMode === 'daily' && !this._can('rh_funcionarios', 'assiduidade')) {
      this.viewMode = 'directory';
    }

    container.querySelectorAll('[data-rh-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.viewMode = btn.dataset.rhView;
        this.render(container, ctx);
      });
    });

    container.querySelector('#btnNewEmployee')?.addEventListener('click', () => {
      this._openEmployeeModal(null);
    });

    const exportBtn = container.querySelector('#btnExportAttendanceCsv');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this._exportMonthlyReportCSV(state, month));
    }

    const body = container.querySelector('#rhViewBody');
    if (this.viewMode === 'directory') {
      this._renderDirectory(body, filtered, state.attendance, month);
    } else if (this.viewMode === 'daily') {
      this._renderDailyAttendance(body, state.employees, state.attendance);
    } else {
      this._renderMonthlyReport(body, filtered, state.attendance, month);
    }
  }

  _renderDirectory(target, employees, attendanceMap, month) {
    target.innerHTML = `
      <div class="erp-attendance-controls">
        <div class="erp-filter-bar">
          <select class="erp-select-sm" id="filterDept">
            <option value="all">Todos os Departamentos</option>
            ${DEPARTMENTS.map(
              (d) => `<option value="${escapeHtml(d)}" ${this.deptFilter === d ? 'selected' : ''}>${escapeHtml(d)}</option>`
            ).join('')}
          </select>
          <select class="erp-select-sm" id="filterEmpStatus">
            <option value="all">Todos os Estados</option>
            <option value="ativo" ${this.statusFilter === 'ativo' ? 'selected' : ''}>Ativos</option>
            <option value="inativo" ${this.statusFilter === 'inativo' ? 'selected' : ''}>Inativos</option>
          </select>
        </div>
        <span class="erp-cell-sub">Assiduidade referente a ${escapeHtml(formatMonthLabel(month))}</span>
      </div>

      ${
        employees.length === 0
          ? `<div class="erp-empty">${ICONS.users}<div class="erp-empty__title">Nenhum funcionário encontrado</div><p>Ajuste os filtros ou adicione um novo colaborador.</p></div>`
          : `
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>NIF / NISS</th>
                <th>Departamento &amp; Contrato</th>
                <th>Vencimento Base</th>
                <th>Mês (${escapeHtml(month)})</th>
                <th>Estado</th>
                <th style="text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${employees
                .map((emp) => {
                  const stats = computeMonthlyAttendance(emp, attendanceMap, month);
                  return `
                  <tr>
                    <td>
                      <div class="erp-person-cell">
                        <span class="erp-avatar">${escapeHtml(getInitials(emp.name))}</span>
                        <div>
                          <div class="erp-cell-title">${escapeHtml(emp.name)}</div>
                          <div class="erp-cell-sub">${escapeHtml(emp.role)} · ${escapeHtml(emp.phone)}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="erp-cell-title">NIF ${escapeHtml(emp.nif)}</div>
                      <div class="erp-cell-sub">NISS ${escapeHtml(emp.niss || '—')}</div>
                    </td>
                    <td>
                      <div class="erp-cell-title">${escapeHtml(emp.department)}</div>
                      <div class="erp-cell-sub">${escapeHtml(emp.contractType)} · Adm. ${escapeHtml(formatDatePT(emp.admissionDate))}</div>
                    </td>
                    <td>
                      <div class="erp-cell-title">${escapeHtml(formatCurrency(emp.baseSalary))}</div>
                      <div class="erp-cell-sub">Sub. Alim. ${escapeHtml(formatCurrency(emp.mealAllowance))}/dia</div>
                    </td>
                    <td>
                      <div style="display:flex;gap:5px;flex-wrap:nowrap;">
                        <span class="erp-att-pill erp-att-pill--P">${stats.present}P</span>
                        <span class="erp-att-pill erp-att-pill--FJ">${stats.justified}FJ</span>
                        <span class="erp-att-pill erp-att-pill--FI">${stats.unjustified}FI</span>
                      </div>
                    </td>
                    <td>
                      <span class="erp-badge ${emp.status === 'ativo' ? 'erp-badge--success' : 'erp-badge--neutral'}">
                        ${emp.status === 'ativo' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>
                      <div class="erp-row-actions">
                        <button type="button" class="erp-icon-btn" title="Ver Recibos do Ano" data-emp-payslips="${escapeHtml(emp.id)}">${ICONS.receipt}</button>
                        <button type="button" class="erp-icon-btn" title="Calendário Mensal" data-emp-calendar="${escapeHtml(emp.id)}">${ICONS.calendar}</button>
                        ${!this._can || this._can('rh_funcionarios', 'editar') ? `<button type="button" class="erp-icon-btn" title="Editar Funcionário" data-emp-edit="${escapeHtml(emp.id)}">${ICONS.edit}</button>` : ''}
                        ${!this._can || this._can('rh_funcionarios', 'excluir') ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" title="Excluir Funcionário" data-emp-delete="${escapeHtml(emp.id)}">${ICONS.trash}</button>` : ''}
                      </div>
                    </td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`
      }
    `;

    target.querySelector('#filterDept').addEventListener('change', (e) => {
      this.deptFilter = e.target.value;
      store._commit();
    });
    target.querySelector('#filterEmpStatus').addEventListener('change', (e) => {
      this.statusFilter = e.target.value;
      store._commit();
    });

    target.querySelectorAll('[data-emp-payslips]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (typeof this.onOpenPayslips === 'function') {
          this.onOpenPayslips(btn.dataset.empPayslips);
        }
      });
    });
    target.querySelectorAll('[data-emp-calendar]').forEach((btn) => {
      btn.addEventListener('click', () => this._openEmployeeCalendarModal(btn.dataset.empCalendar, month));
    });
    target.querySelectorAll('[data-emp-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emp = store.getState().employees.find((x) => x.id === btn.dataset.empEdit);
        if (emp) this._openEmployeeModal(emp);
      });
    });
    target.querySelectorAll('[data-emp-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emp = store.getState().employees.find((x) => x.id === btn.dataset.empDelete);
        if (!emp) return;
        confirmAction({
          title: 'Excluir Funcionário',
          message: `Tem a certeza de que pretende eliminar "${emp.name}"? Os registos de assiduidade e recibos associados também serão removidos.`,
          onConfirm: () => {
            store.deleteEmployee(emp.id);
            showToast(`Funcionário ${emp.name} removido.`, 'success');
          },
        });
      });
    });
  }

  _renderDailyAttendance(target, employees, attendanceMap) {
    const activeEmployees = employees.filter((e) => e.status === 'ativo');

    target.innerHTML = `
      <div class="erp-attendance-controls">
        <div class="erp-filter-bar">
          <label style="font-size:12.5px;font-weight:700;color:var(--erp-navy);">Data da Folha de Ponto:</label>
          <input type="date" class="erp-select-sm" id="attDatePicker" value="${escapeHtml(this.selectedDate)}">
          <button type="button" class="erp-btn erp-btn--secondary erp-btn--sm" id="btnMarkAllPresent">
            ${ICONS.checkCircle}
            <span>Marcar Todos Presentes</span>
          </button>
        </div>
        <div class="erp-legend">
          <span class="erp-legend__item"><span class="erp-att-pill erp-att-pill--P">P</span> Presente</span>
          <span class="erp-legend__item"><span class="erp-att-pill erp-att-pill--FJ">FJ</span> Falta Justificada</span>
          <span class="erp-legend__item"><span class="erp-att-pill erp-att-pill--FI">FI</span> Falta Injustificada</span>
          <span class="erp-legend__item"><span class="erp-att-pill erp-att-pill--FE">FE</span> Férias</span>
        </div>
      </div>

      <div class="erp-table-wrap">
        <table class="erp-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Estado em ${escapeHtml(formatDatePT(this.selectedDate))}</th>
              <th>Marcar Presença / Falta</th>
              <th>Observação / Justificação</th>
            </tr>
          </thead>
          <tbody>
            ${activeEmployees
              .map((emp) => {
                const rec = (attendanceMap[emp.id] || {})[this.selectedDate] || { status: '', note: '' };
                const meta = ATTENDANCE_LABELS[rec.status];
                return `
                <tr>
                  <td>
                    <div class="erp-person-cell">
                      <span class="erp-avatar">${escapeHtml(getInitials(emp.name))}</span>
                      <div>
                        <div class="erp-cell-title">${escapeHtml(emp.name)}</div>
                        <div class="erp-cell-sub">${escapeHtml(emp.role)}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    ${
                      meta
                        ? `<span class="erp-att-pill erp-att-pill--${meta.cls}">${meta.code} · ${escapeHtml(meta.label)}</span>`
                        : `<span class="erp-att-pill erp-att-pill--empty">Sem registo</span>`
                    }
                  </td>
                  <td>
                    <div class="erp-att-quick-group">
                      ${['P', 'FJ', 'FI', 'FE']
                        .map(
                          (code) => `
                        <button type="button"
                          class="erp-att-quick-btn ${rec.status === code ? `is-selected-${code}` : ''}"
                          data-att-emp="${escapeHtml(emp.id)}"
                          data-att-code="${code}">${code}</button>`
                        )
                        .join('')}
                      <button type="button" class="erp-att-quick-btn" data-att-emp="${escapeHtml(emp.id)}" data-att-code="">Limpar</button>
                    </div>
                  </td>
                  <td>
                    <input type="text"
                      class="erp-select-sm"
                      style="width:100%;min-width:190px;"
                      placeholder="Nota ou justificação..."
                      value="${escapeHtml(rec.note || '')}"
                      data-att-note="${escapeHtml(emp.id)}">
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;

    target.querySelector('#attDatePicker').addEventListener('change', (e) => {
      this.selectedDate = e.target.value || todayISO();
      store._commit();
    });

    target.querySelector('#btnMarkAllPresent').addEventListener('click', () => {
      store.markAllPresent(this.selectedDate);
      showToast(`Presenças marcadas para ${formatDatePT(this.selectedDate)}.`);
    });

    target.querySelectorAll('[data-att-code]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const empId = btn.dataset.attEmp;
        const code = btn.dataset.attCode;
        const noteInput = target.querySelector(`[data-att-note="${empId}"]`);
        store.setAttendance(empId, this.selectedDate, code, noteInput ? noteInput.value : '');
      });
    });

    target.querySelectorAll('[data-att-note]').forEach((input) => {
      input.addEventListener('change', () => {
        const empId = input.dataset.attNote;
        const current = (store.getState().attendance[empId] || {})[this.selectedDate];
        if (current && current.status) {
          store.setAttendance(empId, this.selectedDate, current.status, input.value);
          showToast('Observação guardada.');
        }
      });
    });
  }

  _renderMonthlyReport(target, employees, attendanceMap, month) {
    target.innerHTML = `
      <div class="erp-attendance-controls">
        <span class="erp-cell-title">Relatório Consolidado — ${escapeHtml(formatMonthLabel(month))}</span>
        <span class="erp-cell-sub">Clique no ícone de calendário de cada colaborador para editar qualquer dia do mês.</span>
      </div>

      <div class="erp-table-wrap">
        <table class="erp-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Dias Úteis</th>
              <th>Trabalhados (P)</th>
              <th>Faltas Just. (FJ)</th>
              <th>Faltas Injust. (FI)</th>
              <th>Férias (FE)</th>
              <th>Taxa Assiduidade</th>
              <th>Sub. Alim. Apurado</th>
              <th style="text-align:right">Calendário</th>
            </tr>
          </thead>
          <tbody>
            ${employees
              .map((emp) => {
                const s = computeMonthlyAttendance(emp, attendanceMap, month);
                return `
                <tr>
                  <td>
                    <div class="erp-person-cell">
                      <span class="erp-avatar">${escapeHtml(getInitials(emp.name))}</span>
                      <div>
                        <div class="erp-cell-title">${escapeHtml(emp.name)}</div>
                        <div class="erp-cell-sub">${escapeHtml(emp.department)}</div>
                      </div>
                    </div>
                  </td>
                  <td>${s.workingDays} d</td>
                  <td><span class="erp-att-pill erp-att-pill--P">${s.present} dias</span></td>
                  <td><span class="erp-att-pill erp-att-pill--FJ">${s.justified} dias</span></td>
                  <td><span class="erp-att-pill erp-att-pill--FI">${s.unjustified} dias</span></td>
                  <td><span class="erp-att-pill erp-att-pill--FE">${s.vacation} dias</span></td>
                  <td>
                    <div class="erp-progress">
                      <div class="erp-progress__track"><div class="erp-progress__fill" style="width:${s.attendanceRate}%"></div></div>
                      <span class="erp-progress__label">${s.attendanceRate}%</span>
                    </div>
                  </td>
                  <td><span class="erp-cell-title">${escapeHtml(formatCurrency(s.mealEarned))}</span></td>
                  <td style="text-align:right">
                    <button type="button" class="erp-icon-btn" title="Abrir Calendário do Mês" data-rep-cal="${escapeHtml(emp.id)}">${ICONS.calendar}</button>
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;

    target.querySelectorAll('[data-rep-cal]').forEach((btn) => {
      btn.addEventListener('click', () => this._openEmployeeCalendarModal(btn.dataset.repCal, month));
    });
  }

  _exportMonthlyReportCSV(state, month) {
    const headers = [
      'ID',
      'Nome',
      'Cargo',
      'Departamento',
      'NIF',
      'Dias Úteis',
      'Dias Trabalhados',
      'Faltas Justificadas',
      'Faltas Injustificadas',
      'Total Faltas',
      'Férias',
      'Taxa Assiduidade (%)',
      'Subsídio Alimentação Apurado (€)',
    ];
    const rows = state.employees.map((emp) => {
      const s = computeMonthlyAttendance(emp, state.attendance, month);
      return [
        emp.id,
        emp.name,
        emp.role,
        emp.department,
        emp.nif,
        s.workingDays,
        s.present,
        s.justified,
        s.unjustified,
        s.totalAbsences,
        s.vacation,
        s.attendanceRate,
        s.mealEarned.toFixed(2),
      ];
    });
    downloadCSV(`relatorio-assiduidade-${month}.csv`, headers, rows);
    showToast('Relatório CSV exportado com sucesso.');
  }

  _openEmployeeCalendarModal(empId, month) {
    const state = store.getState();
    const emp = state.employees.find((e) => e.id === empId);
    if (!emp) return;

    const renderCalendarBody = () => {
      const att = store.getState().attendance[emp.id] || {};
      const days = getDaysInMonth(month);
      const firstWd = getWeekdayShortPT(month, 1); // 0=Dom..6=Sab
      const offset = firstWd === 0 ? 6 : firstWd - 1; // Segunda=0
      const stats = computeMonthlyAttendance(emp, store.getState().attendance, month);

      let cells = '';
      for (let i = 0; i < offset; i += 1) {
        cells += '<div></div>';
      }
      for (let d = 1; d <= days; d += 1) {
        const wd = getWeekdayShortPT(month, d);
        const isWeekend = wd === 0 || wd === 6;
        const dateISO = `${month}-${String(d).padStart(2, '0')}`;
        const rec = att[dateISO];
        const code = rec ? rec.status : '';
        const pillCls = code ? `erp-att-pill--${code}` : 'erp-att-pill--empty';
        cells += `
          <button type="button" class="erp-cal-day ${isWeekend ? 'erp-cal-day--weekend' : ''}" data-cal-day="${dateISO}">
            <span class="erp-cal-day__num">${d}</span>
            <span class="erp-att-pill ${pillCls}">${code || '—'}</span>
          </button>`;
      }

      return `
        <div class="erp-summary-box" style="margin-bottom:14px;">
          <div>
            <div class="erp-summary-item__label">Trabalhados (P)</div>
            <div class="erp-summary-item__val erp-summary-item__val--success">${stats.present} dias</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Faltas Just. (FJ)</div>
            <div class="erp-summary-item__val">${stats.justified} dias</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Faltas Injust. (FI)</div>
            <div class="erp-summary-item__val erp-summary-item__val--danger">${stats.unjustified} dias</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Assiduidade</div>
            <div class="erp-summary-item__val erp-summary-item__val--accent">${stats.attendanceRate}%</div>
          </div>
        </div>
        <p class="erp-cell-sub" style="margin-bottom:10px;">Clique num dia para alternar: Presente (P) → Falta Justificada (FJ) → Falta Injustificada (FI) → Férias (FE) → Sem registo.</p>
        <div class="erp-cal-grid">
          <div class="erp-cal-head">Seg</div>
          <div class="erp-cal-head">Ter</div>
          <div class="erp-cal-head">Qua</div>
          <div class="erp-cal-head">Qui</div>
          <div class="erp-cal-head">Sex</div>
          <div class="erp-cal-head">Sáb</div>
          <div class="erp-cal-head">Dom</div>
          ${cells}
        </div>
      `;
    };

    openModal({
      title: `Folha Mensal — ${emp.name}`,
      subtitle: `${emp.role} · ${formatMonthLabel(month)}`,
      bodyHtml: `<div id="empCalWrap">${renderCalendarBody()}</div>`,
      footerHtml: `<button type="button" class="erp-btn erp-btn--primary" data-modal-close>Concluir</button>`,
      onMount: (modal) => {
        const cycle = ['', 'P', 'FJ', 'FI', 'FE'];
        const bindDays = () => {
          modal.querySelectorAll('[data-cal-day]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const dateISO = btn.dataset.calDay;
              const current = ((store.getState().attendance[emp.id] || {})[dateISO] || {}).status || '';
              const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
              store.setAttendance(emp.id, dateISO, next, '');
              modal.querySelector('#empCalWrap').innerHTML = renderCalendarBody();
              bindDays();
            });
          });
        };
        bindDays();
      },
    });
  }

  openNewEmployee() {
    this._openEmployeeModal(null);
  }

  _openEmployeeModal(existing) {
    const isEdit = Boolean(existing);
    const emp = existing || {
      name: '',
      role: '',
      department: 'Construção Civil',
      nif: '',
      niss: '',
      cc: '',
      phone: '+351 ',
      email: '',
      address: '',
      iban: 'PT50 ',
      contractType: 'Sem Termo',
      admissionDate: todayISO(),
      baseSalary: 1100,
      mealAllowance: 9.6,
      twelfths: 'Não',
      status: 'ativo',
      notes: '',
    };

    const bodyHtml = `
      <form id="employeeForm">
        <div class="erp-form-section">
          <div class="erp-form-section__title">1. Identificação &amp; Contactos (Portugal)</div>
          <div class="erp-form-grid">
            <div class="erp-field erp-field--full">
              <label for="empName">Nome Completo *</label>
              <input type="text" id="empName" name="name" required value="${escapeHtml(emp.name)}" placeholder="Ex.: João Pedro Ferreira">
            </div>
            <div class="erp-field">
              <label for="empNif">NIF (Contribuinte) *</label>
              <input type="text" id="empNif" name="nif" required maxlength="9" value="${escapeHtml(emp.nif)}" placeholder="9 dígitos">
              <span class="erp-field__hint">Validado segundo algoritmo oficial da AT</span>
            </div>
            <div class="erp-field">
              <label for="empNiss">NISS (Segurança Social)</label>
              <input type="text" id="empNiss" name="niss" maxlength="11" value="${escapeHtml(emp.niss)}" placeholder="11 dígitos">
            </div>
            <div class="erp-field">
              <label for="empCc">Cartão de Cidadão</label>
              <input type="text" id="empCc" name="cc" value="${escapeHtml(emp.cc)}" placeholder="Ex.: 14092831 2 ZZ4">
            </div>
            <div class="erp-field">
              <label for="empPhone">Telemóvel *</label>
              <input type="tel" id="empPhone" name="phone" required value="${escapeHtml(emp.phone)}" placeholder="+351 912 345 678">
            </div>
            <div class="erp-field">
              <label for="empEmail">Email</label>
              <input type="email" id="empEmail" name="email" value="${escapeHtml(emp.email)}" placeholder="nome@sparksmirk.pt">
            </div>
            <div class="erp-field erp-field--full">
              <label for="empAddress">Morada Completa</label>
              <input type="text" id="empAddress" name="address" value="${escapeHtml(emp.address)}" placeholder="Rua, número, código postal (0000-000) e localidade">
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">2. Enquadramento Profissional</div>
          <div class="erp-form-grid erp-form-grid--3">
            <div class="erp-field">
              <label for="empRole">Cargo / Categoria *</label>
              <input type="text" id="empRole" name="role" required value="${escapeHtml(emp.role)}" placeholder="Ex.: Oficial de Pedreiro">
            </div>
            <div class="erp-field">
              <label for="empDept">Departamento</label>
              <select id="empDept" name="department">
                ${DEPARTMENTS.map((d) => `<option value="${escapeHtml(d)}" ${emp.department === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field">
              <label for="empContract">Tipo de Contrato</label>
              <select id="empContract" name="contractType">
                ${CONTRACTS.map((c) => `<option value="${escapeHtml(c)}" ${emp.contractType === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
              </select>
            </div>
            <div class="erp-field">
              <label for="empAdmission">Data de Admissão</label>
              <input type="date" id="empAdmission" name="admissionDate" value="${escapeHtml(emp.admissionDate)}">
            </div>
            <div class="erp-field">
              <label for="empStatus">Estado</label>
              <select id="empStatus" name="status">
                <option value="ativo" ${emp.status === 'ativo' ? 'selected' : ''}>Ativo</option>
                <option value="inativo" ${emp.status === 'inativo' ? 'selected' : ''}>Inativo</option>
              </select>
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">3. Condições Salariais &amp; Dados Bancários</div>
          <div class="erp-form-grid erp-form-grid--3">
            <div class="erp-field">
              <label for="empSalary">Vencimento Base Ilíquido (€) *</label>
              <input type="number" id="empSalary" name="baseSalary" required min="0" step="0.01" value="${escapeHtml(emp.baseSalary)}">
            </div>
            <div class="erp-field">
              <label for="empMeal">Sub. Alimentação (€/dia)</label>
              <input type="number" id="empMeal" name="mealAllowance" min="0" step="0.01" value="${escapeHtml(emp.mealAllowance)}">
            </div>
            <div class="erp-field">
              <label for="empTwelfths">Duodécimos (Férias/Natal)</label>
              <select id="empTwelfths" name="twelfths">
                <option value="Não" ${emp.twelfths === 'Não' ? 'selected' : ''}>Não (Pagamento integral)</option>
                <option value="Sim" ${emp.twelfths === 'Sim' ? 'selected' : ''}>Sim (Mensal em duodécimos)</option>
              </select>
            </div>
            <div class="erp-field erp-field--full">
              <label for="empIban">IBAN para Transferência</label>
              <input type="text" id="empIban" name="iban" value="${escapeHtml(emp.iban)}" placeholder="PT50 0000 0000 0000 0000 0000 0">
            </div>
            <div class="erp-field erp-field--full">
              <label for="empNotes">Notas / Certificações</label>
              <textarea id="empNotes" name="notes" rows="2" placeholder="Ex.: Carta de condução, CAP, formação em segurança em obra...">${escapeHtml(emp.notes)}</textarea>
            </div>
          </div>
        </div>
      </form>
    `;

    openModal({
      title: isEdit ? `Editar Funcionário — ${emp.name}` : 'Adicionar Novo Funcionário',
      subtitle: 'Ficha completa de colaborador Spark & Smirk, Lda.',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="employeeForm" class="erp-btn erp-btn--primary">${isEdit ? 'Guardar Alterações' : 'Registar Funcionário'}</button>
      `,
      onMount: (modal) => {
        const form = modal.querySelector('#employeeForm');
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const data = Object.fromEntries(fd.entries());
          const cleanNif = String(data.nif || '').replace(/\D/g, '');
          if (!isValidNIF(cleanNif)) {
            showToast('NIF inválido. Verifique os 9 dígitos do contribuinte.', 'danger');
            return;
          }
          const payload = {
            ...data,
            nif: cleanNif,
            baseSalary: Number(data.baseSalary) || 0,
            mealAllowance: Number(data.mealAllowance) || 0,
          };
          if (isEdit) {
            store.updateEmployee(emp.id, payload);
            showToast(`Dados de ${payload.name} atualizados.`);
          } else {
            store.addEmployee({ id: generateId('FUNC'), ...payload });
            showToast(`Funcionário ${payload.name} registado com sucesso.`);
          }
          closeModal();
        });
      },
    });
  }
}
