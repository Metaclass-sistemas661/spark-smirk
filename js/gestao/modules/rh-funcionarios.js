/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — RH: Funcionários, Presenças & Relatório
   ═══════════════════════════════════════════════════════════ */

import { store, saveEmployeeContractFile, getEmployeeContractFile } from '../core/store.js';
import {
  computeEmployeeMonthlyPayroll,
  escapeHtml,
  formatCurrency,
  formatDatePT,
  formatMonthLabel,
  getDaysInMonth,
  getInitials,
  getWeekdayShortPT,
  isValidNIF,
  parseCurrencyInput,
  generateId,
  todayISO,
  downloadCSV,
} from '../core/formatters.js';
import { ICONS, openModal, closeModal, confirmAction, showToast, attachEuroMasks } from '../core/ui.js';

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

const REMUNERATION_LABELS = {
  mensal: 'Fixo Mensal',
  diaria: 'Por Dia (Diária)',
  hora: 'Por Hora',
};

function computeMonthlyAttendance(employee, attendanceMap, yearMonth, employeeAdvances = []) {
  return computeEmployeeMonthlyPayroll(employee, attendanceMap, employeeAdvances, yearMonth);
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
    this._can = ctx.can || (() => true);
    const canSeeSalary = this._can('rh_funcionarios', 'ordenados');
    const canSeePayable = this._can('rh_funcionarios', 'pagamentos');
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
    const totalContractsCount = (state.employeeContracts || []).length;
    const totalPayrollEstimated = canSeePayable
      ? state.employees
          .filter((e) => e.status === 'ativo')
          .reduce(
            (acc, e) => acc + computeMonthlyAttendance(e, state.attendance, month, state.employeeAdvances).netToPay,
            0
          )
      : 0;

    let totalPresentMonth = 0;
    let totalAbsencesMonth = 0;
    state.employees.forEach((emp) => {
      const m = computeMonthlyAttendance(emp, state.attendance, month, state.employeeAdvances);
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

        ${
          canSeePayable
            ? `<div class="erp-kpi-card">
                <div class="erp-kpi-card__head">
                  <span class="erp-kpi-card__label">Líquido a Pagar (${escapeHtml(month)})</span>
                  <span class="erp-kpi-card__icon">${ICONS.euro}</span>
                </div>
                <div class="erp-kpi-card__value">${escapeHtml(formatCurrency(totalPayrollEstimated))}</div>
                <div class="erp-kpi-card__meta">${canSeeSalary ? 'Recibo (c/ SS%), Por Fora SS e vales' : 'Resumo de pagamentos'}</div>
              </div>`
            : `<div class="erp-kpi-card">
                <div class="erp-kpi-card__head">
                  <span class="erp-kpi-card__label">Contratos &amp; Dossiê RH</span>
                  <span class="erp-kpi-card__icon">${ICONS.paperclip}</span>
                </div>
                <div class="erp-kpi-card__value">${totalContractsCount} PDF</div>
                <div class="erp-kpi-card__meta">Valores a pagar restritos para este perfil</div>
              </div>`
        }
      </div>

      <div class="erp-panel">
        <div class="erp-panel__header">
          <div class="erp-subtabs" role="tablist">
            <button type="button" class="erp-subtab ${this.viewMode === 'directory' ? 'is-active' : ''}" data-rh-view="directory">
              ${ICONS.users}
              <span>Diretório de Funcionários</span>
              <span class="erp-subtab__badge">${filtered.length}</span>
            </button>
            <button type="button" class="erp-subtab ${this.viewMode === 'daily' ? 'is-active' : ''}" data-rh-view="daily" ${this._can('rh_funcionarios', 'assiduidade') ? '' : 'style="display:none"'}>
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
              this._can('rh_funcionarios', 'criar')
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
    const canSeeSalary = !this._can || this._can('rh_funcionarios', 'ordenados');
    const canSeePayable = !this._can || this._can('rh_funcionarios', 'pagamentos');
    const canSeeRecibos = !this._can || this._can('rh_recibos', 'ver');

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
        <span class="erp-cell-sub">${canSeePayable ? 'Clique no funcionário para registar adiantamento · ' : ''}Assiduidade de ${escapeHtml(formatMonthLabel(month))}</span>
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
                <th>${canSeeSalary ? 'Remuneração &amp; SS%' : 'Modalidade Contratual'}</th>
                <th>${canSeePayable ? `Mês (${escapeHtml(month)}) / Líquido` : `Assiduidade (${escapeHtml(month)})`}</th>
                <th>Estado</th>
                <th style="text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${employees
                .map((emp) => {
                  const stats = computeMonthlyAttendance(emp, attendanceMap, month, store.getState().employeeAdvances);
                  const empContractsCount = (store.getState().employeeContracts || []).filter(
                    (c) => c.employeeId === emp.id
                  ).length;
                  const remLabel = REMUNERATION_LABELS[stats.remunerationType] || 'Fixo Mensal';
                  const rateValue =
                    stats.remunerationType === 'diaria'
                      ? `${formatCurrency(stats.dailyRate)}/dia`
                      : stats.remunerationType === 'hora'
                        ? `${formatCurrency(stats.hourlyRate)}/h`
                        : `${formatCurrency(stats.baseSalaryFixed)}/mês`;
                  return `
                  <tr class="${canSeePayable ? 'erp-proj-row' : ''}" data-emp-row="${escapeHtml(emp.id)}" title="${canSeePayable ? 'Clique para registar/consultar adiantamentos (valores retirados do ordenado)' : escapeHtml(emp.name)}">
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
                      ${empContractsCount > 0 ? `<div style="margin-top:4px;"><span class="erp-badge erp-badge--info">${empContractsCount} contrato(s) PDF</span></div>` : ''}
                    </td>
                    <td>
                      ${
                        canSeeSalary
                          ? `<div class="erp-cell-title">${escapeHtml(rateValue)}</div>
                             <div class="erp-cell-sub">${escapeHtml(remLabel)} · SS ${stats.ssPercentage}%${stats.remunerationType !== 'mensal' && Number(emp.mealAllowance) > 0 ? ` · Sub. Alim. ${escapeHtml(formatCurrency(emp.mealAllowance))}/d` : ''}</div>
                             ${stats.offPayrollAmount > 0 ? `<div class="erp-cell-sub" style="color:var(--erp-accent-dark);font-weight:600;">+ Por fora SS: ${escapeHtml(formatCurrency(stats.offPayrollAmount))}/${stats.offPayrollType === 'diaria' ? 'dia' : 'mês'}</div>` : ''}`
                          : `<div class="erp-cell-title">${escapeHtml(remLabel)}</div>
                             <div class="erp-cell-sub">Valores de ordenado restritos</div>`
                      }
                    </td>
                    <td>
                      <div style="display:flex;gap:4px;flex-wrap:nowrap;margin-bottom:4px;">
                        <span class="erp-att-pill erp-att-pill--P">${stats.present}P</span>
                        <span class="erp-att-pill erp-att-pill--FJ">${stats.justified}FJ</span>
                        <span class="erp-att-pill erp-att-pill--FI">${stats.unjustified}FI</span>
                      </div>
                      ${
                        canSeePayable
                          ? `<div class="erp-cell-sub" style="font-weight:700;color:var(--erp-success);">
                               A pagar: ${escapeHtml(formatCurrency(stats.netToPay))}${stats.advancesTotal > 0 ? ` <span style="color:var(--erp-danger);">(-${escapeHtml(formatCurrency(stats.advancesTotal))} vale)</span>` : ''}
                             </div>
                             ${stats.offPayrollEarned > 0 && canSeeSalary ? `<div class="erp-cell-sub">Recibo ${escapeHtml(formatCurrency(stats.receiptNetPay))} + Por fora ${escapeHtml(formatCurrency(stats.offPayrollEarned))}</div>` : ''}`
                          : `<div class="erp-cell-sub">Pagamento restrito</div>`
                      }
                    </td>
                    <td>
                      <span class="erp-badge ${emp.status === 'ativo' ? 'erp-badge--success' : 'erp-badge--neutral'}">
                        ${emp.status === 'ativo' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>
                      <div class="erp-row-actions">
                        ${canSeePayable ? `<button type="button" class="erp-btn erp-btn--outline erp-btn--sm" title="Fechar Mês e Ver Valor a Pagar" data-emp-close-month="${escapeHtml(emp.id)}">Fechar Mês</button>` : ''}
                        <button type="button" class="erp-icon-btn" title="Contratos de Trabalho (PDF)" data-emp-contracts="${escapeHtml(emp.id)}">${ICONS.paperclip}</button>
                        ${canSeeRecibos ? `<button type="button" class="erp-icon-btn" title="Ver Recibos do Ano" data-emp-payslips="${escapeHtml(emp.id)}">${ICONS.receipt}</button>` : ''}
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

    if (canSeePayable) {
      target.querySelectorAll('[data-emp-row]').forEach((row) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.erp-row-actions, button, a')) return;
          this._openAdvancePopup(row.dataset.empRow, month);
        });
      });
    }

    target.querySelectorAll('[data-emp-close-month]').forEach((btn) => {
      btn.addEventListener('click', () => this._openCloseMonthModal(btn.dataset.empCloseMonth, month));
    });

    target.querySelectorAll('[data-emp-contracts]').forEach((btn) => {
      btn.addEventListener('click', () => this._openEmployeeContractsModal(btn.dataset.empContracts));
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
    const canSeeSalary = !this._can || this._can('rh_funcionarios', 'ordenados');
    const canSeePayable = !this._can || this._can('rh_funcionarios', 'pagamentos');
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
              <th>Marcar Presença / Falta (Horas se aplicável)</th>
              <th>Observação / Justificação</th>
            </tr>
          </thead>
          <tbody>
            ${activeEmployees
              .map((emp) => {
                const rec = (attendanceMap[emp.id] || {})[this.selectedDate] || { status: '', note: '', hours: 8 };
                const meta = ATTENDANCE_LABELS[rec.status];
                const remType = emp.remunerationType || 'mensal';
                const offTag =
                  Number(emp.offPayrollAmount) > 0
                    ? ` + ${formatCurrency(emp.offPayrollAmount)}/${remType === 'diaria' && emp.offPayrollType === 'diaria' ? 'dia' : 'mês'} fora SS`
                    : '';
                const remTag =
                  remType === 'diaria'
                    ? `Por Dia: ${formatCurrency(emp.dailyRate)}/dia${offTag}`
                    : remType === 'hora'
                      ? `Por Hora: ${formatCurrency(emp.hourlyRate)}/h${offTag}`
                      : `Fixo Mensal: ${formatCurrency(emp.baseSalary)}/mês${offTag}`;
                const dayHours = Number(rec.hours) > 0 ? Number(rec.hours) : 8;
                return `
                <tr>
                  <td>
                    <div class="erp-person-cell">
                      <span class="erp-avatar">${escapeHtml(getInitials(emp.name))}</span>
                      <div>
                        <div class="erp-cell-title">${escapeHtml(emp.name)}</div>
                        <div class="erp-cell-sub">${escapeHtml(emp.role)}${canSeeSalary ? ` · <strong>${escapeHtml(remTag)}</strong>` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    ${
                      meta
                        ? `<span class="erp-att-pill erp-att-pill--${meta.cls}">${meta.code} · ${escapeHtml(meta.label)}${rec.status === 'P' && remType === 'hora' ? ` (${dayHours}h)` : ''}</span>`
                        : `<span class="erp-att-pill erp-att-pill--empty">Sem registo</span>`
                    }
                  </td>
                  <td>
                    <div class="erp-att-quick-group" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                      ${
                        remType === 'hora'
                          ? `<input type="number" min="0.5" max="24" step="0.5" class="erp-select-sm" style="width:68px;" title="Horas trabalhadas no dia" value="${dayHours}" data-att-hours="${escapeHtml(emp.id)}">`
                          : ''
                      }
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
        const hoursInput = target.querySelector(`[data-att-hours="${empId}"]`);
        const hrs = hoursInput ? Number(hoursInput.value) || 8 : 8;
        store.setAttendance(empId, this.selectedDate, code, noteInput ? noteInput.value : '', hrs);

        const emp = store.getState().employees.find((x) => x.id === empId);
        if (emp) {
          const ym = String(this.selectedDate).slice(0, 7);
          const updatedPayroll = computeMonthlyAttendance(
            emp,
            store.getState().attendance,
            ym,
            store.getState().employeeAdvances
          );
          if (code === 'P' && (emp.remunerationType === 'diaria' || emp.remunerationType === 'hora')) {
            if (canSeeSalary || canSeePayable) {
              const mealDay = Number(emp.mealAllowance) || 0;
              const offDay = emp.offPayrollType === 'diaria' ? Number(emp.offPayrollAmount) || 0 : 0;
              const addedVal =
                emp.remunerationType === 'diaria'
                  ? (Number(emp.dailyRate) || 0) + mealDay + offDay
                  : hrs * (Number(emp.hourlyRate) || 0) + mealDay + offDay;
              showToast(
                `Presença registada (${emp.name}): + ${formatCurrency(addedVal)} · Total líquido no mês: ${formatCurrency(updatedPayroll.netToPay)}`,
                'success',
                4500
              );
            } else {
              showToast(`Presença registada (${emp.name}).`, 'success');
            }
          } else if (code === 'P') {
            showToast(
              canSeeSalary || canSeePayable
                ? `Presença registada (${emp.name}) · Ordenado fixo mensal mantém-se inalterado (${formatCurrency(updatedPayroll.netToPay)}).`
                : `Presença registada (${emp.name}).`,
              'success',
              4000
            );
          } else if (code === 'FJ' || code === 'FI') {
            showToast(
              canSeeSalary || canSeePayable
                ? `${code === 'FJ' ? 'Falta Justificada' : 'Falta Injustificada'} registada (${emp.name}) — € 0,00 acrescentado.`
                : `${code === 'FJ' ? 'Falta Justificada' : 'Falta Injustificada'} registada (${emp.name}).`,
              'warning'
            );
          }
        }
      });
    });

    target.querySelectorAll('[data-att-note]').forEach((input) => {
      input.addEventListener('change', () => {
        const empId = input.dataset.attNote;
        const current = (store.getState().attendance[empId] || {})[this.selectedDate];
        if (current && current.status) {
          store.setAttendance(empId, this.selectedDate, current.status, input.value, current.hours || 8);
          showToast('Observação guardada.');
        }
      });
    });
  }

  _renderMonthlyReport(target, employees, attendanceMap, month) {
    const canSeeSalary = !this._can || this._can('rh_funcionarios', 'ordenados');
    const canSeePayable = !this._can || this._can('rh_funcionarios', 'pagamentos');
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
              <th>Trabalhados / Horas</th>
              <th>Faltas (FJ / FI)</th>
              ${canSeeSalary ? '<th>Base Recibo</th><th>SS (%)</th><th>Por Fora SS</th>' : ''}
              ${canSeePayable ? '<th>Adiantamentos</th><th>Líquido Final</th>' : ''}
              <th style="text-align:right">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${employees
              .map((emp) => {
                const s = computeMonthlyAttendance(emp, attendanceMap, month, store.getState().employeeAdvances);
                return `
                <tr>
                  <td>
                    <div class="erp-person-cell">
                      <span class="erp-avatar">${escapeHtml(getInitials(emp.name))}</span>
                      <div>
                        <div class="erp-cell-title">${escapeHtml(emp.name)}</div>
                        <div class="erp-cell-sub">${escapeHtml(REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal')}</div>
                      </div>
                    </div>
                  </td>
                  <td><span class="erp-att-pill erp-att-pill--P">${s.present} d${s.remunerationType === 'hora' ? ` (${s.totalHours}h)` : ''}</span></td>
                  <td>
                    <span class="erp-att-pill erp-att-pill--FJ">${s.justified}FJ</span>
                    <span class="erp-att-pill erp-att-pill--FI">${s.unjustified}FI</span>
                  </td>
                  ${
                    canSeeSalary
                      ? `<td><span class="erp-cell-title">${escapeHtml(formatCurrency(s.earnedBase))}</span></td>
                         <td>-${escapeHtml(formatCurrency(s.ssDeduction))} (${s.ssPercentage}%)</td>
                         <td><span style="color:${s.offPayrollEarned > 0 ? 'var(--erp-accent-dark)' : 'var(--erp-text-muted)'};font-weight:${s.offPayrollEarned > 0 ? '700' : '400'};">${s.offPayrollEarned > 0 ? `+${escapeHtml(formatCurrency(s.offPayrollEarned))}` : '€ 0,00'}</span></td>`
                      : ''
                  }
                  ${
                    canSeePayable
                      ? `<td style="color:${s.advancesTotal > 0 ? 'var(--erp-danger)' : 'var(--erp-text-muted)'};">
                           ${s.advancesTotal > 0 ? `-${escapeHtml(formatCurrency(s.advancesTotal))}` : '€ 0,00'}
                         </td>
                         <td><span class="erp-cell-title" style="color:var(--erp-success);">${escapeHtml(formatCurrency(s.netToPay))}</span></td>`
                      : ''
                  }
                  <td style="text-align:right">
                    <div class="erp-row-actions">
                      ${canSeePayable ? `<button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-rep-close="${escapeHtml(emp.id)}">Fechar Mês</button>` : ''}
                      <button type="button" class="erp-icon-btn" title="Abrir Calendário do Mês" data-rep-cal="${escapeHtml(emp.id)}">${ICONS.calendar}</button>
                    </div>
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;

    target.querySelectorAll('[data-rep-close]').forEach((btn) => {
      btn.addEventListener('click', () => this._openCloseMonthModal(btn.dataset.repClose, month));
    });
    target.querySelectorAll('[data-rep-cal]').forEach((btn) => {
      btn.addEventListener('click', () => this._openEmployeeCalendarModal(btn.dataset.repCal, month));
    });
  }

  _exportMonthlyReportCSV(state, month) {
    const canSeeSalary = !this._can || this._can('rh_funcionarios', 'ordenados');
    const canSeePayable = !this._can || this._can('rh_funcionarios', 'pagamentos');
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
      ...(canSeeSalary ? ['Base Recibo (€)', 'Subsídio Alimentação Apurado (€)', 'SS (€)', 'Por Fora SS (€)'] : []),
      ...(canSeePayable ? ['Líquido Final a Pagar (€)'] : []),
    ];
    const rows = state.employees.map((emp) => {
      const s = computeMonthlyAttendance(emp, state.attendance, month, state.employeeAdvances);
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
        ...(canSeeSalary ? [s.earnedBase.toFixed(2), s.mealEarned.toFixed(2), s.ssDeduction.toFixed(2), s.offPayrollEarned.toFixed(2)] : []),
        ...(canSeePayable ? [s.netToPay.toFixed(2)] : []),
      ];
    });
    downloadCSV(`relatorio-assiduidade-${month}.csv`, headers, rows);
    showToast('Relatório CSV exportado com sucesso.');
  }

  _openEmployeeCalendarModal(empId, month) {
    const state = store.getState();
    const emp = state.employees.find((e) => e.id === empId);
    if (!emp) return;
    const canSeeSalary = !this._can || this._can('rh_funcionarios', 'ordenados');
    const canSeePayable = !this._can || this._can('rh_funcionarios', 'pagamentos');

    const renderCalendarBody = () => {
      const att = store.getState().attendance[emp.id] || {};
      const days = getDaysInMonth(month);
      const firstWd = getWeekdayShortPT(month, 1); // 0=Dom..6=Sab
      const offset = firstWd === 0 ? 6 : firstWd - 1; // Segunda=0
      const stats = computeMonthlyAttendance(emp, store.getState().attendance, month, store.getState().employeeAdvances);

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
            <div class="erp-summary-item__val erp-summary-item__val--success">${stats.present} d${stats.remunerationType === 'hora' ? ` (${stats.totalHours}h)` : ''}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Faltas (FJ / FI)</div>
            <div class="erp-summary-item__val">${stats.justified}FJ · <span style="color:var(--erp-danger)">${stats.unjustified}FI</span></div>
          </div>
          ${
            canSeeSalary
              ? `<div>
                   <div class="erp-summary-item__label">Base Recibo</div>
                   <div class="erp-summary-item__val">${escapeHtml(formatCurrency(stats.earnedBase))}</div>
                 </div>
                 ${
                   stats.offPayrollEarned > 0
                     ? `<div>
                          <div class="erp-summary-item__label">+ Por Fora SS</div>
                          <div class="erp-summary-item__val" style="color:var(--erp-accent-dark)">${escapeHtml(formatCurrency(stats.offPayrollEarned))}</div>
                        </div>`
                     : ''
                 }`
              : ''
          }
          ${
            canSeePayable
              ? `<div>
                   <div class="erp-summary-item__label">Total Final (c/ SS &amp; Vales)</div>
                   <div class="erp-summary-item__val erp-summary-item__val--accent">${escapeHtml(formatCurrency(stats.netToPay))}</div>
                 </div>`
              : ''
          }
        </div>
        <p class="erp-cell-sub" style="margin-bottom:10px;">Clique num dia para alternar: Presente (P) → Falta Justificada (FJ) → Falta Injustificada (FI) → Férias (FE) → Sem registo.${stats.remunerationType === 'mensal' ? ' Em ordenado fixo mensal, as presenças não alteram o valor a pagar.' : ''}</p>
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
      footerHtml: `
        ${canSeePayable ? '<button type="button" class="erp-btn erp-btn--outline" id="btnCalCloseMonth">Fechar Mês</button>' : ''}
        <button type="button" class="erp-btn erp-btn--primary" data-modal-close>Concluir</button>
      `,
      onMount: (modal) => {
        const cycle = ['', 'P', 'FJ', 'FI', 'FE'];
        const bindDays = () => {
          modal.querySelectorAll('[data-cal-day]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const dateISO = btn.dataset.calDay;
              const currentRec = (store.getState().attendance[emp.id] || {})[dateISO] || {};
              const current = currentRec.status || '';
              const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
              store.setAttendance(emp.id, dateISO, next, '', currentRec.hours || 8);
              modal.querySelector('#empCalWrap').innerHTML = renderCalendarBody();
              bindDays();
            });
          });
        };
        bindDays();
        modal.querySelector('#btnCalCloseMonth')?.addEventListener('click', () => {
          this._openCloseMonthModal(emp.id, month);
        });
      },
    });
  }

  _openAdvancePopup(empId, month) {
    if (this._can && !this._can('rh_funcionarios', 'pagamentos')) {
      showToast('Sem permissão para consultar valores a pagar ou registar adiantamentos.', 'warning');
      return;
    }
    const state = store.getState();
    const emp = state.employees.find((e) => e.id === empId);
    if (!emp) return;

    const s = computeMonthlyAttendance(emp, state.attendance, month, state.employeeAdvances);
    const canEdit = !this._can || this._can('rh_funcionarios', 'editar') || this._can('rh_funcionarios', 'assiduidade');

    openModal({
      title: `Ordenado & Adiantamentos — ${emp.name}`,
      subtitle: `${REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal'} · ${formatMonthLabel(month)}`,
      bodyHtml: `
        <div class="erp-summary-box" style="margin-bottom:16px;">
          <div>
            <div class="erp-summary-item__label">Líquido Recibo (c/ SS ${s.ssPercentage}%)</div>
            <div class="erp-summary-item__val">${escapeHtml(formatCurrency(s.receiptNetPay))}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">+ Por Fora SS</div>
            <div class="erp-summary-item__val" style="color:var(--erp-accent-dark);">+${escapeHtml(formatCurrency(s.offPayrollEarned))}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Vales Retirados (${s.monthAdvances.length})</div>
            <div class="erp-summary-item__val erp-summary-item__val--danger">-${escapeHtml(formatCurrency(s.advancesTotal))}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Total Final a Receber</div>
            <div class="erp-summary-item__val erp-summary-item__val--success">${escapeHtml(formatCurrency(s.netToPay))}</div>
          </div>
        </div>

        ${
          canEdit
            ? `<form id="empAdvanceForm" class="erp-inline-invoice-box">
                <div class="erp-form-section__title" style="margin-bottom:10px;">Este funcionário retirou algum valor antecipado do seu ordenado?</div>
                <div class="erp-regime-group" style="margin-bottom:12px;">
                  <label class="erp-regime-option is-selected" id="advOptYesWrap">
                    <input type="radio" name="hasAdvance" value="sim" checked>
                    <div>
                      <div class="erp-cell-title">Sim — Registar Adiantamento</div>
                      <div class="erp-cell-sub">Abate automaticamente no salário final de ${escapeHtml(formatMonthLabel(month))}.</div>
                    </div>
                  </label>
                  <label class="erp-regime-option" id="advOptNoWrap">
                    <input type="radio" name="hasAdvance" value="nao">
                    <div>
                      <div class="erp-cell-title">Não Retirou / Só Consultar</div>
                      <div class="erp-cell-sub">Consultar resumo ou ir diretamente para o fecho do mês.</div>
                    </div>
                  </label>
                </div>

                <div id="advFieldsWrap">
                  <div class="erp-form-grid erp-form-grid--3">
                    <div class="erp-field">
                      <label for="advAmount">Qual o valor retirado antecipado? (€) *</label>
                      <input type="text" inputmode="numeric" data-currency-euro id="advAmount" placeholder="€ 0,00">
                    </div>
                    <div class="erp-field">
                      <label for="advDate">Data do Levantamento</label>
                      <input type="date" id="advDate" value="${todayISO()}">
                    </div>
                    <div class="erp-field">
                      <label for="advNotes">Observação / Motivo</label>
                      <input type="text" id="advNotes" placeholder="Ex.: Adiantamento quinzenal">
                    </div>
                  </div>
                  <div class="erp-invoice-sim" style="margin-top:10px;grid-template-columns:repeat(3,minmax(0,1fr));">
                    <div>
                      <div class="erp-summary-item__label">Líquido Antes do Vale</div>
                      <div class="erp-summary-item__val">${escapeHtml(formatCurrency(s.netToPay))}</div>
                    </div>
                    <div>
                      <div class="erp-summary-item__label">Novo Adiantamento</div>
                      <div class="erp-summary-item__val erp-summary-item__val--danger" id="advSimNew">- € 0,00</div>
                    </div>
                    <div>
                      <div class="erp-summary-item__label">Salário Final Após Abate</div>
                      <div class="erp-summary-item__val erp-summary-item__val--success" id="advSimFinal">${escapeHtml(formatCurrency(s.netToPay))}</div>
                    </div>
                  </div>
                  <div style="display:flex;justify-content:flex-end;margin-top:12px;">
                    <button type="submit" class="erp-btn erp-btn--primary erp-btn--sm" id="btnSaveAdvance">
                      ${ICONS.plus}<span>Registar Adiantamento &amp; Abater no Salário</span>
                    </button>
                  </div>
                </div>
              </form>`
            : ''
        }

        <div class="erp-form-section" style="margin-top:14px;">
          <div class="erp-form-section__title">Adiantamentos Registados em ${escapeHtml(formatMonthLabel(month))} (${s.monthAdvances.length})</div>
          ${
            s.monthAdvances.length === 0
              ? '<div class="erp-cell-sub">Nenhum adiantamento retirado neste mês.</div>'
              : `
            <div class="erp-table-wrap">
              <table class="erp-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição / Motivo</th>
                    <th style="text-align:right">Valor Retirado</th>
                    <th style="text-align:right">Remover</th>
                  </tr>
                </thead>
                <tbody>
                  ${s.monthAdvances
                    .map(
                      (adv) => `
                    <tr>
                      <td>${escapeHtml(formatDatePT(adv.date))}</td>
                      <td>${escapeHtml(adv.notes || 'Adiantamento de ordenado')}</td>
                      <td style="text-align:right;font-weight:700;color:var(--erp-danger);">-${escapeHtml(formatCurrency(adv.amount))}</td>
                      <td style="text-align:right">
                        ${canEdit ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" data-adv-del="${escapeHtml(adv.id)}" title="Remover adiantamento">${ICONS.trash}</button>` : '—'}
                      </td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          }
        </div>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" id="btnAdvGoCloseMonth">${ICONS.euro}<span>Fechar Mês (${escapeHtml(formatCurrency(s.netToPay))})</span></button>
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
      `,
      onMount: (modal) => {
        attachEuroMasks(modal);
        const fieldsWrap = modal.querySelector('#advFieldsWrap');
        const amtInput = modal.querySelector('#advAmount');

        modal.querySelectorAll('input[name="hasAdvance"]').forEach((r) => {
          r.addEventListener('change', () => {
            const isYes = modal.querySelector('input[name="hasAdvance"]:checked')?.value === 'sim';
            modal.querySelector('#advOptYesWrap')?.classList.toggle('is-selected', isYes);
            modal.querySelector('#advOptNoWrap')?.classList.toggle('is-selected', !isYes);
            if (fieldsWrap) fieldsWrap.style.display = isYes ? 'block' : 'none';
          });
        });

        amtInput?.addEventListener('input', () => {
          const val = parseCurrencyInput(amtInput.value);
          const nextNet = Math.max(0, s.netToPay - val);
          const newEl = modal.querySelector('#advSimNew');
          const finEl = modal.querySelector('#advSimFinal');
          if (newEl) newEl.textContent = `- ${formatCurrency(val)}`;
          if (finEl) finEl.textContent = formatCurrency(nextNet);
        });

        modal.querySelector('#empAdvanceForm')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const val = parseCurrencyInput(amtInput?.value);
          if (val <= 0) {
            showToast('Indique um valor retirado superior a € 0,00.', 'danger');
            amtInput?.focus();
            return;
          }
          const advDate = modal.querySelector('#advDate')?.value || todayISO();
          const btn = modal.querySelector('#btnSaveAdvance');
          if (btn) btn.disabled = true;

          await store.addEmployeeAdvance({
            id: generateId('ADT'),
            employeeId: emp.id,
            month: String(advDate).slice(0, 7) || month,
            date: advDate,
            amount: Number(val.toFixed(2)),
            notes: modal.querySelector('#advNotes')?.value.trim() || 'Adiantamento de ordenado',
            createdAt: todayISO(),
          });

          const nextSummary = computeMonthlyAttendance(
            emp,
            store.getState().attendance,
            month,
            store.getState().employeeAdvances
          );
          showToast(
            `Adiantamento de ${formatCurrency(val)} abatido! Novo salário final de ${emp.name}: ${formatCurrency(nextSummary.netToPay)}`,
            'success',
            5500
          );
          this._openAdvancePopup(emp.id, month);
        });

        modal.querySelectorAll('[data-adv-del]').forEach((btn) => {
          btn.addEventListener('click', () => {
            store.deleteEmployeeAdvance(btn.dataset.advDel);
            showToast('Adiantamento removido e salário recalculado.');
            this._openAdvancePopup(emp.id, month);
          });
        });

        modal.querySelector('#btnAdvGoCloseMonth')?.addEventListener('click', () => {
          this._openCloseMonthModal(emp.id, month);
        });
      },
    });
  }

  _openEmployeeContractsModal(empId) {
    const state = store.getState();
    const emp = state.employees.find((e) => e.id === empId);
    if (!emp) return;

    const contracts = (state.employeeContracts || []).filter((c) => c.employeeId === emp.id);
    const canManage = !this._can || this._can('rh_funcionarios', 'editar') || this._can('rh_funcionarios', 'criar');
    const canDelete = !this._can || this._can('rh_funcionarios', 'excluir') || this._can('rh_funcionarios', 'editar');
    let selectedFile = null;

    openModal({
      title: `Contratos de Trabalho (PDF) — ${emp.name}`,
      subtitle: `${emp.role} · ${emp.contractType}`,
      size: 'wide',
      bodyHtml: `
        ${
          canManage
            ? `<form id="empContractQuickForm" class="erp-inline-invoice-box">
                <div class="erp-form-section__title" style="margin-bottom:10px;">Anexar Novo Contrato / Adenda em PDF</div>
                <div class="erp-form-grid erp-form-grid--3">
                  <div class="erp-field">
                    <label for="quickCtrTitle">Título do Documento *</label>
                    <input type="text" id="quickCtrTitle" required value="Contrato de Trabalho" placeholder="Ex.: Contrato Sem Termo / Adenda">
                  </div>
                  <div class="erp-field">
                    <label for="quickCtrType">Modalidade de Contrato</label>
                    <select id="quickCtrType">
                      ${CONTRACTS.map((c) => `<option value="${escapeHtml(c)}" ${emp.contractType === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                    </select>
                  </div>
                  <div class="erp-field">
                    <label for="quickCtrDate">Data de Início / Assinatura</label>
                    <input type="date" id="quickCtrDate" value="${escapeHtml(emp.admissionDate || todayISO())}">
                  </div>
                  <div class="erp-field erp-field--full">
                    <label>Ficheiro do Contrato (PDF ou Imagem até 10 MB) *</label>
                    <div class="erp-dropzone" id="quickCtrDropzone">
                      <input type="file" id="quickCtrFileInput" accept=".pdf,image/*" style="display:none;">
                      <div class="erp-dropzone__title" id="quickCtrDropTitle">Clique para selecionar ou arraste o contrato PDF assinado</div>
                      <div class="erp-dropzone__hint">Formatos aceites: PDF, PNG, JPG, WEBP</div>
                    </div>
                  </div>
                </div>
                <div style="display:flex;justify-content:flex-end;margin-top:10px;">
                  <button type="submit" class="erp-btn erp-btn--primary erp-btn--sm" id="btnSaveQuickEmpCtr">
                    ${ICONS.plus}<span>Guardar Contrato PDF</span>
                  </button>
                </div>
              </form>`
            : ''
        }

        <div class="erp-form-section">
          <div class="erp-form-section__title">Contratos Arquivados (${contracts.length})</div>
          ${
            contracts.length === 0
              ? '<div class="erp-empty" style="padding:22px 14px;"><div class="erp-empty__title">Sem contratos PDF anexados</div><p>Anexe o contrato assinado acima ou na ficha do colaborador.</p></div>'
              : `
            <div class="erp-table-wrap">
              <table class="erp-table">
                <thead>
                  <tr>
                    <th>Data / Documento</th>
                    <th>Tipo de Contrato</th>
                    <th>Ficheiro PDF</th>
                    <th style="text-align:right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  ${contracts
                    .map(
                      (ctr) => `
                    <tr>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(ctr.title)}</div>
                        <div class="erp-cell-sub">${escapeHtml(formatDatePT(ctr.contractDate))}</div>
                      </td>
                      <td><span class="erp-badge erp-badge--neutral">${escapeHtml(ctr.contractType || emp.contractType)}</span></td>
                      <td>
                        ${
                          ctr.hasFile
                            ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" data-emp-ctr-view="${escapeHtml(ctr.id)}">${ICONS.eye}<span>Ver PDF</span></button>
                                <button type="button" class="erp-icon-btn" data-emp-ctr-dl="${escapeHtml(ctr.id)}" title="Descarregar PDF">${ICONS.download}</button>
                              </div>`
                            : '<span class="erp-badge erp-badge--neutral">Sem PDF</span>'
                        }
                      </td>
                      <td style="text-align:right">
                        ${canDelete ? `<button type="button" class="erp-icon-btn erp-icon-btn--danger" data-emp-ctr-del="${escapeHtml(ctr.id)}" title="Remover Contrato">${ICONS.trash}</button>` : '—'}
                      </td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          }
        </div>
      `,
      footerHtml: `<button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>`,
      onMount: (modal) => {
        const dropzone = modal.querySelector('#quickCtrDropzone');
        const fileInput = modal.querySelector('#quickCtrFileInput');
        const dropTitle = modal.querySelector('#quickCtrDropTitle');

        const handleFile = (f) => {
          if (!f) return;
          if (f.size > 10 * 1024 * 1024) {
            showToast('O contrato excede o limite de 10 MB.', 'danger');
            return;
          }
          selectedFile = f;
          if (dropTitle) {
            dropTitle.textContent = `Selecionado: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`;
          }
        };

        dropzone?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', (e) => handleFile(e.target.files?.[0]));
        dropzone?.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropzone.classList.add('is-dragover');
        });
        dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
        dropzone?.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('is-dragover');
          handleFile(e.dataTransfer?.files?.[0]);
        });

        modal.querySelector('#empContractQuickForm')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!selectedFile) {
            showToast('Selecione ou arraste o ficheiro PDF do contrato.', 'danger');
            return;
          }
          const btn = modal.querySelector('#btnSaveQuickEmpCtr');
          if (btn) {
            btn.disabled = true;
            btn.textContent = 'A guardar...';
          }
          const ctrId = generateId('CTRF');
          let meta;
          try {
            meta = await saveEmployeeContractFile(ctrId, selectedFile);
          } catch (err) {
            if (btn) {
              btn.disabled = false;
              btn.textContent = 'Guardar Contrato PDF';
            }
            showToast(err?.message || 'Erro ao ler o ficheiro PDF.', 'danger');
            return;
          }

          await store.addEmployeeContract({
            id: ctrId,
            employeeId: emp.id,
            title: modal.querySelector('#quickCtrTitle').value.trim() || 'Contrato de Trabalho',
            contractType: modal.querySelector('#quickCtrType').value,
            contractDate: modal.querySelector('#quickCtrDate').value || todayISO(),
            notes: '',
            fileName: meta.name,
            fileType: meta.type,
            fileSize: meta.size,
            hasFile: true,
            createdAt: todayISO(),
          });

          showToast('Contrato PDF anexado ao funcionário.');
          this._openEmployeeContractsModal(emp.id);
        });

        modal.querySelectorAll('[data-emp-ctr-view]').forEach((btn) => {
          btn.addEventListener('click', () => this._previewEmployeeContractById(btn.dataset.empCtrView));
        });
        modal.querySelectorAll('[data-emp-ctr-dl]').forEach((btn) => {
          btn.addEventListener('click', () => this._downloadEmployeeContractById(btn.dataset.empCtrDl));
        });
        modal.querySelectorAll('[data-emp-ctr-del]').forEach((btn) => {
          btn.addEventListener('click', () => {
            confirmAction({
              title: 'Remover Contrato',
              message: 'Tem a certeza de que pretende eliminar este contrato em PDF?',
              onConfirm: () => {
                store.deleteEmployeeContract(btn.dataset.empCtrDel);
                showToast('Contrato removido.');
                this._openEmployeeContractsModal(emp.id);
              },
            });
          });
        });
      },
    });
  }

  async _previewEmployeeContractById(contractId) {
    const record = await getEmployeeContractFile(contractId);
    if (!record) return;

    const blob = new window.Blob([record.data], { type: record.type });
    const url = window.URL.createObjectURL(blob);
    const isPdf = (record.type || '').includes('pdf') || record.name.toLowerCase().endsWith('.pdf');

    openModal({
      title: `Contrato de Trabalho — ${record.name}`,
      subtitle: `${Math.max(1, Math.round(record.size / 1024))} KB`,
      size: 'wide',
      bodyHtml: isPdf
        ? `<iframe class="erp-attachment-preview" src="${url}" title="Pré-visualização do contrato"></iframe>`
        : `<img class="erp-attachment-img" src="${url}" alt="Contrato do funcionário">`,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
        <a href="${url}" download="${escapeHtml(record.name)}" class="erp-btn erp-btn--primary">${ICONS.download}<span>Descarregar PDF</span></a>
      `,
    });
  }

  async _downloadEmployeeContractById(contractId) {
    const record = await getEmployeeContractFile(contractId);
    if (!record) return;

    const blob = new window.Blob([record.data], { type: record.type });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = record.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  _openCloseMonthModal(empId, month) {
    if (this._can && !this._can('rh_funcionarios', 'pagamentos')) {
      showToast('Sem permissão para consultar o fecho do mês ou valores a pagar.', 'warning');
      return;
    }
    const state = store.getState();
    const emp = state.employees.find((e) => e.id === empId);
    if (!emp) return;

    const s = computeMonthlyAttendance(emp, state.attendance, month, state.employeeAdvances);
    const canEmitPayslip = !this._can || this._can('rh_recibos', 'emitir');
    const remDesc =
      s.remunerationType === 'diaria'
        ? `${s.present} dia(s) com presença × ${formatCurrency(s.dailyRate)}/dia`
        : s.remunerationType === 'hora'
          ? `${s.totalHours}h em ${s.present} dia(s) × ${formatCurrency(s.hourlyRate)}/h`
          : `Vencimento Fixo Mensal (presenças não alteram este valor)`;

    openModal({
      title: `Fecho de Mês — ${emp.name}`,
      subtitle: `${formatMonthLabel(month)} · ${REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal'}`,
      bodyHtml: `
        <div class="erp-cred-box" style="margin-bottom:16px;text-align:center;">
          <div class="erp-summary-item__label">Total Final a Pagar ao Funcionário em ${escapeHtml(formatMonthLabel(month))}</div>
          <div style="font-family:var(--erp-font-heading);font-size:28px;font-weight:900;color:var(--erp-success);margin:4px 0;">
            ${escapeHtml(formatCurrency(s.netToPay))}
          </div>
          <span class="erp-cell-sub">${escapeHtml(remDesc)}${s.offPayrollEarned > 0 ? ` · + ${escapeHtml(formatCurrency(s.offPayrollEarned))} por fora SS` : ''}</span>
        </div>

        <div class="erp-table-wrap">
          <table class="erp-table">
            <tbody>
              <tr>
                <td><strong>Base em Recibo (${escapeHtml(REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal')})</strong></td>
                <td style="text-align:right;font-weight:700;">+ ${escapeHtml(formatCurrency(s.earnedBase))}</td>
              </tr>
              ${
                s.remunerationType !== 'mensal' || s.mealEarned > 0
                  ? `<tr>
                       <td><strong>Subsídio de Alimentação (${s.present} dia(s) × ${escapeHtml(formatCurrency(emp.mealAllowance))})</strong></td>
                       <td style="text-align:right;font-weight:700;">+ ${escapeHtml(formatCurrency(s.mealEarned))}</td>
                     </tr>`
                  : ''
              }
              <tr>
                <td><strong>Desconto Segurança Social (${s.ssPercentage}% sobre valor em recibo)</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(s.ssDeduction))}</td>
              </tr>
              <tr>
                <td><strong>Pagamento Por Fora da Segurança Social (${s.offPayrollType === 'diaria' ? `${s.present} dia(s) × ${escapeHtml(formatCurrency(s.offPayrollAmount))}` : 'Fixo Mensal — sem desconto SS'})</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-accent-dark);">+ ${escapeHtml(formatCurrency(s.offPayrollEarned))}</td>
              </tr>
              <tr>
                <td><strong>Adiantamentos / Vales Retirados no Mês (${s.monthAdvances.length})</strong></td>
                <td style="text-align:right;font-weight:700;color:var(--erp-danger);">- ${escapeHtml(formatCurrency(s.advancesTotal))}</td>
              </tr>
              <tr style="background:var(--erp-surface-alt);">
                <td><strong style="font-size:14px;">TOTAL FINAL A PAGAR</strong></td>
                <td style="text-align:right;font-size:16px;font-weight:900;color:var(--erp-success);">${escapeHtml(formatCurrency(s.netToPay))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" id="btnCloseMonthAdvance">Registar / Ver Adiantamentos</button>
        ${
          canEmitPayslip
            ? `<button type="button" class="erp-btn erp-btn--primary" id="btnConfirmCloseMonth">${ICONS.checkCircle}<span>Confirmar Fecho &amp; Gerar Recibo</span></button>`
            : ''
        }
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Fechar</button>
      `,
      onMount: (modal) => {
        modal.querySelector('#btnCloseMonthAdvance')?.addEventListener('click', () => {
          this._openAdvancePopup(emp.id, month);
        });
        modal.querySelector('#btnConfirmCloseMonth')?.addEventListener('click', () => {
          const payslipId = generateId('REC');
          store.addPayslip({
            id: payslipId,
            employeeId: emp.id,
            month,
            baseSalary: s.earnedBase,
            mealAllowanceTotal: s.mealEarned,
            overtimeBonus: 0,
            socialSecurity: s.ssDeduction,
            irsRetention: 0,
            otherDeductions: s.advancesTotal,
            offPayroll: s.offPayrollEarned,
            netSalary: s.netToPay,
            paymentDate: todayISO(),
            status: 'pago',
            notes: `Fecho mensal (${REMUNERATION_LABELS[s.remunerationType]} · SS ${s.ssPercentage}%${s.offPayrollEarned > 0 ? ` · Por fora SS: ${formatCurrency(s.offPayrollEarned)}` : ''}${s.advancesTotal > 0 ? ` · Adiantamentos: ${formatCurrency(s.advancesTotal)}` : ''})`,
          });
          showToast(
            `Mês fechado para ${emp.name}! Valor pago registado: ${formatCurrency(s.netToPay)} (${payslipId}).`,
            'success',
            5500
          );
          closeModal();
        });
      },
    });
  }

  openNewEmployee() {
    this._openEmployeeModal(null);
  }

  _openEmployeeModal(existing) {
    const isEdit = Boolean(existing);
    const canSeeSalary = !this._can || this._can('rh_funcionarios', 'ordenados');
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
      remunerationType: 'mensal',
      baseSalary: 1100,
      dailyRate: 0,
      hourlyRate: 0,
      ssPercentage: 11,
      mealAllowance: 0,
      offPayrollType: 'mensal',
      offPayrollAmount: 0,
      twelfths: 'Não',
      status: 'ativo',
      notes: '',
    };
    const remType = ['diaria', 'hora', 'mensal'].includes(emp.remunerationType) ? emp.remunerationType : 'mensal';
    const offType = remType === 'mensal' ? 'mensal' : emp.offPayrollType === 'diaria' ? 'diaria' : 'mensal';

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
          <div class="erp-form-section__title">3. Ordenado em Recibo, Pagamento Por Fora da SS &amp; Dados Bancários</div>
          ${
            canSeeSalary
              ? `<div class="erp-field erp-field--full" style="margin-bottom:12px;">
                   <label>Como este funcionário recebe (Valor em Recibo com Segurança Social)? *</label>
                   <div class="erp-regime-group" style="grid-template-columns:repeat(3,minmax(0,1fr));" id="empRemGroup">
                     <label class="erp-regime-option ${remType === 'mensal' ? 'is-selected' : ''}">
                       <input type="radio" name="remunerationType" value="mensal" ${remType === 'mensal' ? 'checked' : ''}>
                       <div>
                         <div class="erp-cell-title">Valor Fixo por Mês</div>
                         <div class="erp-cell-sub">Salário mensal fixo (presenças não alteram o valor).</div>
                       </div>
                     </label>
                     <label class="erp-regime-option ${remType === 'diaria' ? 'is-selected' : ''}">
                       <input type="radio" name="remunerationType" value="diaria" ${remType === 'diaria' ? 'checked' : ''}>
                       <div>
                         <div class="erp-cell-title">Por Dia (Diária)</div>
                         <div class="erp-cell-sub">Cada presença (P) soma a diária. Faltas não somam.</div>
                       </div>
                     </label>
                     <label class="erp-regime-option ${remType === 'hora' ? 'is-selected' : ''}">
                       <input type="radio" name="remunerationType" value="hora" ${remType === 'hora' ? 'checked' : ''}>
                       <div>
                         <div class="erp-cell-title">Por Hora Trabalhada</div>
                         <div class="erp-cell-sub">Calculado pelas horas de presença registadas.</div>
                       </div>
                     </label>
                   </div>
                 </div>

                 <div class="erp-form-grid erp-form-grid--3">
                   <div class="erp-field" id="wrapBaseSalary" style="display:${remType === 'mensal' ? 'flex' : 'none'};">
                     <label for="empSalary">Vencimento Fixo em Recibo (€/mês) *</label>
                     <input type="text" inputmode="numeric" data-currency-euro id="empSalary" name="baseSalary" value="${escapeHtml(emp.baseSalary)}" placeholder="€ 0,00">
                   </div>
                   <div class="erp-field" id="wrapDailyRate" style="display:${remType === 'diaria' ? 'flex' : 'none'};">
                     <label for="empDailyRate">Valor da Diária em Recibo (€/dia) *</label>
                     <input type="text" inputmode="numeric" data-currency-euro id="empDailyRate" name="dailyRate" value="${escapeHtml(emp.dailyRate)}" placeholder="€ 0,00">
                   </div>
                   <div class="erp-field" id="wrapHourlyRate" style="display:${remType === 'hora' ? 'flex' : 'none'};">
                     <label for="empHourlyRate">Valor por Hora em Recibo (€/hora) *</label>
                     <input type="text" inputmode="numeric" data-currency-euro id="empHourlyRate" name="hourlyRate" value="${escapeHtml(emp.hourlyRate)}" placeholder="€ 0,00">
                   </div>

                   <div class="erp-field">
                     <label for="empSsPct">Desconto Segurança Social (%) *</label>
                     <input type="number" step="0.1" min="0" max="100" id="empSsPct" name="ssPercentage" required value="${escapeHtml(emp.ssPercentage ?? 11)}">
                     <span class="erp-field__hint">Incide apenas sobre o valor em recibo (ex.: 11%)</span>
                   </div>

                   <div class="erp-field" id="wrapMealAllowance" style="display:${remType !== 'mensal' ? 'flex' : 'none'};">
                     <label for="empMeal">Sub. Alimentação em Recibo (€/dia)</label>
                     <input type="text" inputmode="numeric" data-currency-euro id="empMeal" name="mealAllowance" value="${escapeHtml(emp.mealAllowance)}" placeholder="€ 0,00">
                   </div>

                   <div class="erp-field">
                     <label for="empTwelfths">Duodécimos (Férias/Natal)</label>
                     <select id="empTwelfths" name="twelfths">
                       <option value="Não" ${emp.twelfths === 'Não' ? 'selected' : ''}>Não (Pagamento integral)</option>
                       <option value="Sim" ${emp.twelfths === 'Sim' ? 'selected' : ''}>Sim (Mensal em duodécimos)</option>
                     </select>
                   </div>
                 </div>

                 <div class="erp-inline-invoice-box" style="margin:12px 0;">
                   <div class="erp-form-section__title" style="margin-bottom:8px;">Pagamento Por Fora da Segurança Social (Sem Desconto SS)</div>
                   <div class="erp-form-grid">
                     <div class="erp-field">
                       <label for="empOffPayrollType">Periodicidade Por Fora da SS</label>
                       <select id="empOffPayrollType" name="offPayrollType" ${remType === 'mensal' ? 'disabled' : ''}>
                         <option value="mensal" ${offType === 'mensal' ? 'selected' : ''}>Valor Fixo Mensal (€/mês)</option>
                         <option value="diaria" ${offType === 'diaria' ? 'selected' : ''}>Por Dia Trabalhado P (€/dia)</option>
                       </select>
                       <span class="erp-field__hint" id="offPayrollTypeHint">${remType === 'mensal' ? 'Em ordenado fixo, o complemento por fora é fixo por mês (presenças não alteram).' : 'Escolha se o valor por fora soma por dia trabalhado ou se é fixo no mês.'}</span>
                     </div>
                     <div class="erp-field">
                       <label for="empOffPayrollAmount" id="lblOffPayrollAmount">Valor Por Fora da SS (${offType === 'diaria' ? '€/dia' : '€/mês'})</label>
                       <input type="text" inputmode="numeric" data-currency-euro id="empOffPayrollAmount" name="offPayrollAmount" value="${escapeHtml(emp.offPayrollAmount ?? 0)}" placeholder="€ 0,00">
                       <span class="erp-field__hint">Não entra no cálculo da Segurança Social e soma integralmente no total final.</span>
                     </div>
                   </div>
                   <div class="erp-summary-box" id="empSalaryPreview" style="margin-top:12px;margin-bottom:0;"></div>
                 </div>

                 <div class="erp-form-grid">
                   <div class="erp-field erp-field--full">
                     <label for="empIban">IBAN para Transferência</label>
                     <input type="text" id="empIban" name="iban" value="${escapeHtml(emp.iban)}" placeholder="PT50 0000 0000 0000 0000 0000 0">
                   </div>
                 </div>`
              : `<div class="erp-inline-invoice-box" style="margin-bottom:12px;">
                   <strong>Dados salariais e bancários ocultos</strong>
                   <div class="erp-cell-sub">O seu perfil não tem permissão para visualizar ou alterar ordenados, diárias, subsídios ou IBAN. Os valores atuais do colaborador serão preservados automaticamente.</div>
                 </div>`
          }
          <div class="erp-form-grid">
            <div class="erp-field erp-field--full">
              <label for="empNotes">Notas / Certificações</label>
              <textarea id="empNotes" name="notes" rows="2" placeholder="Ex.: Carta de condução, CAP, formação em segurança em obra...">${escapeHtml(emp.notes)}</textarea>
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">4. Contrato de Trabalho em PDF</div>
          <div class="erp-inline-invoice-box">
            <div class="erp-form-grid erp-form-grid--3">
              <div class="erp-field">
                <label for="formEmpCtrTitle">Designação do Contrato</label>
                <input type="text" id="formEmpCtrTitle" value="Contrato de Trabalho" placeholder="Ex.: Contrato Sem Termo">
              </div>
              <div class="erp-field">
                <label for="formEmpCtrDate">Data do Contrato</label>
                <input type="date" id="formEmpCtrDate" value="${escapeHtml(emp.admissionDate || todayISO())}">
              </div>
              <div class="erp-field">
                <label for="formEmpCtrFile">Anexar PDF / Imagem (até 10 MB)</label>
                <input type="file" id="formEmpCtrFile" accept=".pdf,image/*">
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;flex-wrap:wrap;">
              <span class="erp-cell-sub" id="formEmpCtrFileLabel">Anexe o contrato assinado em PDF para ficar arquivado na ficha do colaborador.</span>
              <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnAddFormEmpCtr">
                ${ICONS.plus}<span>Anexar Contrato à Lista</span>
              </button>
            </div>
          </div>
          <div id="formEmpContractsList"></div>
        </div>
      </form>
    `;

    const formEmpContracts = isEdit
      ? (store.getState().employeeContracts || [])
          .filter((c) => c.employeeId === emp.id)
          .map((c) => ({ ...c, isNew: false }))
      : [];
    const deletedEmpContractIds = [];

    openModal({
      title: isEdit ? `Editar Funcionário — ${emp.name}` : 'Adicionar Novo Funcionário',
      subtitle: 'Ficha completa de colaborador Spark & Smirk, Lda.',
      bodyHtml,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="employeeForm" class="erp-btn erp-btn--primary" id="btnSubmitEmployee">${isEdit ? 'Guardar Alterações' : 'Registar Funcionário'}</button>
      `,
      onMount: (modal) => {
        const form = modal.querySelector('#employeeForm');
        const ctrListEl = modal.querySelector('#formEmpContractsList');
        const ctrFileInput = modal.querySelector('#formEmpCtrFile');
        const ctrFileLabel = modal.querySelector('#formEmpCtrFileLabel');

        const renderFormEmpContracts = () => {
          if (!ctrListEl) return;
          if (formEmpContracts.length === 0) {
            ctrListEl.innerHTML = '<div class="erp-cell-sub" style="padding:6px 4px;">Ainda não existem contratos PDF anexados a este funcionário.</div>';
            return;
          }
          ctrListEl.innerHTML = `
            <div class="erp-table-wrap">
              <table class="erp-table">
                <thead>
                  <tr>
                    <th>Data / Título</th>
                    <th>Ficheiro PDF</th>
                    <th style="text-align:right">Remover</th>
                  </tr>
                </thead>
                <tbody>
                  ${formEmpContracts
                    .map(
                      (ctr, idx) => `
                    <tr>
                      <td>
                        <div class="erp-cell-title">${escapeHtml(ctr.title)}</div>
                        <div class="erp-cell-sub">${escapeHtml(formatDatePT(ctr.contractDate))}</div>
                      </td>
                      <td><span class="erp-badge erp-badge--info">${escapeHtml(ctr.fileName || 'PDF Anexado')}</span></td>
                      <td style="text-align:right">
                        <button type="button" class="erp-icon-btn erp-icon-btn--danger" data-form-emp-ctr-del="${idx}" title="Remover contrato">${ICONS.trash}</button>
                      </td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          `;
          ctrListEl.querySelectorAll('[data-form-emp-ctr-del]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const idx = Number(btn.dataset.formEmpCtrDel);
              const removed = formEmpContracts.splice(idx, 1)[0];
              if (removed && !removed.isNew && removed.id) {
                deletedEmpContractIds.push(removed.id);
              }
              renderFormEmpContracts();
            });
          });
        };

        const stageContractFromInput = async () => {
          const f = ctrFileInput?.files?.[0] || null;
          if (!f) return false;
          const ctrId = generateId('CTRF');
          const meta = await saveEmployeeContractFile(ctrId, f);
          formEmpContracts.unshift({
            id: ctrId,
            title: modal.querySelector('#formEmpCtrTitle')?.value.trim() || 'Contrato de Trabalho',
            contractType: modal.querySelector('#empContract')?.value || emp.contractType || 'Sem Termo',
            contractDate: modal.querySelector('#formEmpCtrDate')?.value || todayISO(),
            notes: '',
            fileName: meta.name,
            fileType: meta.type,
            fileSize: meta.size,
            hasFile: true,
            createdAt: todayISO(),
            isNew: true,
          });
          if (ctrFileInput) ctrFileInput.value = '';
          if (ctrFileLabel) {
            ctrFileLabel.textContent = 'Anexe o contrato assinado em PDF para ficar arquivado na ficha do colaborador.';
          }
          renderFormEmpContracts();
          return true;
        };

        if (ctrFileInput && ctrFileLabel) {
          ctrFileInput.addEventListener('change', () => {
            const f = ctrFileInput.files?.[0];
            ctrFileLabel.textContent = f
              ? `Ficheiro selecionado: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`
              : 'Anexe o contrato assinado em PDF para ficar arquivado na ficha do colaborador.';
          });
        }

        modal.querySelector('#btnAddFormEmpCtr')?.addEventListener('click', async () => {
          if (!ctrFileInput?.files?.[0]) {
            showToast('Selecione o ficheiro PDF do contrato antes de anexar.', 'danger');
            return;
          }
          try {
            await stageContractFromInput();
            showToast('Contrato adicionado à lista do funcionário.');
          } catch (err) {
            showToast(err?.message || 'Erro ao ler o ficheiro PDF do contrato.', 'danger');
          }
        });

        renderFormEmpContracts();

        const offPayrollSelect = modal.querySelector('#empOffPayrollType');
        const offPayrollAmountInput = modal.querySelector('#empOffPayrollAmount');
        const offPayrollHint = modal.querySelector('#offPayrollTypeHint');
        const offPayrollLbl = modal.querySelector('#lblOffPayrollAmount');
        const salaryPreviewEl = modal.querySelector('#empSalaryPreview');

        const renderSalaryPreview = () => {
          if (!canSeeSalary || !salaryPreviewEl) return;
          const active = modal.querySelector('input[name="remunerationType"]:checked')?.value || 'mensal';
          const ssPct = Math.min(
            100,
            Math.max(0, Number(modal.querySelector('#empSsPct')?.value ?? 11) || 0)
          );
          const offMode = active === 'mensal' ? 'mensal' : offPayrollSelect?.value === 'diaria' ? 'diaria' : 'mensal';
          const offVal = Math.max(0, parseCurrencyInput(offPayrollAmountInput?.value));
          const mealVal = active !== 'mensal' ? Math.max(0, parseCurrencyInput(modal.querySelector('#empMeal')?.value)) : 0;

          if (offPayrollLbl) {
            offPayrollLbl.textContent = `Valor Por Fora da SS (${offMode === 'diaria' ? '€/dia' : '€/mês'})`;
          }

          let receiptGross = 0;
          let ssBasis = 0;
          let periodTag = 'Mensal';
          let offPeriodVal = offVal;

          if (active === 'mensal') {
            ssBasis = Math.max(0, parseCurrencyInput(modal.querySelector('#empSalary')?.value));
            receiptGross = ssBasis;
            periodTag = 'Mensal Fixo';
          } else if (active === 'diaria') {
            const refDays = 22;
            const dRate = Math.max(0, parseCurrencyInput(modal.querySelector('#empDailyRate')?.value));
            ssBasis = dRate * refDays;
            receiptGross = ssBasis + mealVal * refDays;
            offPeriodVal = offMode === 'diaria' ? offVal * refDays : offVal;
            periodTag = 'Est. 22 dias (P)';
          } else {
            const refHours = 176;
            const hRate = Math.max(0, parseCurrencyInput(modal.querySelector('#empHourlyRate')?.value));
            ssBasis = hRate * refHours;
            receiptGross = ssBasis + mealVal * 22;
            offPeriodVal = offMode === 'diaria' ? offVal * 22 : offVal;
            periodTag = 'Est. 176h/22d';
          }

          const ssCut = Number((ssBasis * (ssPct / 100)).toFixed(2));
          const receiptNet = Math.max(0, Number((receiptGross - ssCut).toFixed(2)));
          const totalFinal = Number((receiptNet + offPeriodVal).toFixed(2));

          salaryPreviewEl.innerHTML = `
            <div>
              <div class="erp-summary-item__label">Líquido Recibo (${escapeHtml(periodTag)} c/ -${ssPct}% SS)</div>
              <div class="erp-summary-item__val">${escapeHtml(formatCurrency(receiptNet))}</div>
            </div>
            <div>
              <div class="erp-summary-item__label">+ Por Fora SS (sem desconto)</div>
              <div class="erp-summary-item__val" style="color:var(--erp-accent-dark);">+${escapeHtml(formatCurrency(offPeriodVal))}</div>
            </div>
            <div>
              <div class="erp-summary-item__label">= Total Final Estimado</div>
              <div class="erp-summary-item__val erp-summary-item__val--success">${escapeHtml(formatCurrency(totalFinal))}</div>
            </div>
          `;
        };

        const syncRemUI = () => {
          if (!canSeeSalary) return;
          const active = modal.querySelector('input[name="remunerationType"]:checked')?.value || 'mensal';
          modal.querySelectorAll('#empRemGroup .erp-regime-option').forEach((lbl) => {
            lbl.classList.toggle('is-selected', Boolean(lbl.querySelector('input')?.checked));
          });
          const wrapBase = modal.querySelector('#wrapBaseSalary');
          const wrapDaily = modal.querySelector('#wrapDailyRate');
          const wrapHourly = modal.querySelector('#wrapHourlyRate');
          const wrapMeal = modal.querySelector('#wrapMealAllowance');
          if (wrapBase) wrapBase.style.display = active === 'mensal' ? 'flex' : 'none';
          if (wrapDaily) wrapDaily.style.display = active === 'diaria' ? 'flex' : 'none';
          if (wrapHourly) wrapHourly.style.display = active === 'hora' ? 'flex' : 'none';
          if (wrapMeal) wrapMeal.style.display = active !== 'mensal' ? 'flex' : 'none';

          if (offPayrollSelect) {
            if (active === 'mensal') {
              offPayrollSelect.value = 'mensal';
              offPayrollSelect.disabled = true;
              if (offPayrollHint) {
                offPayrollHint.textContent = 'Em ordenado fixo, o complemento por fora é fixo por mês (presenças não alteram).';
              }
            } else {
              offPayrollSelect.disabled = false;
              if (offPayrollHint) {
                offPayrollHint.textContent = 'Escolha se o valor por fora soma por dia trabalhado ou se é fixo no mês.';
              }
            }
          }
          renderSalaryPreview();
        };
        modal.querySelectorAll('input[name="remunerationType"]').forEach((r) => {
          r.addEventListener('change', syncRemUI);
        });
        offPayrollSelect?.addEventListener('change', renderSalaryPreview);
        ['#empSalary', '#empDailyRate', '#empHourlyRate', '#empSsPct', '#empMeal', '#empOffPayrollAmount'].forEach((sel) => {
          modal.querySelector(sel)?.addEventListener('input', renderSalaryPreview);
        });
        syncRemUI();

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const data = Object.fromEntries(fd.entries());
          const cleanNif = String(data.nif || '').replace(/\D/g, '');
          if (!isValidNIF(cleanNif)) {
            showToast('NIF inválido. Verifique os 9 dígitos do contribuinte.', 'danger');
            return;
          }
          const chosenType = canSeeSalary ? data.remunerationType || 'mensal' : emp.remunerationType || 'mensal';
          const baseSalary = canSeeSalary ? parseCurrencyInput(data.baseSalary) : emp.baseSalary ?? 0;
          const dailyRate = canSeeSalary ? parseCurrencyInput(data.dailyRate) : emp.dailyRate ?? 0;
          const hourlyRate = canSeeSalary ? parseCurrencyInput(data.hourlyRate) : emp.hourlyRate ?? 0;
          const offPayrollType = canSeeSalary
            ? chosenType === 'mensal'
              ? 'mensal'
              : offPayrollSelect?.value === 'diaria'
                ? 'diaria'
                : 'mensal'
            : emp.offPayrollType || 'mensal';
          const offPayrollAmount = canSeeSalary
            ? Math.max(0, parseCurrencyInput(offPayrollAmountInput?.value ?? data.offPayrollAmount))
            : Number(emp.offPayrollAmount ?? 0);

          if (canSeeSalary) {
            if (chosenType === 'mensal' && baseSalary <= 0) {
              showToast('Indique o vencimento mensal fixo.', 'danger');
              return;
            }
            if (chosenType === 'diaria' && dailyRate <= 0) {
              showToast('Indique o valor da diária do funcionário.', 'danger');
              return;
            }
            if (chosenType === 'hora' && hourlyRate <= 0) {
              showToast('Indique o valor por hora do funcionário.', 'danger');
              return;
            }
          }

          if (ctrFileInput?.files?.[0]) {
            try {
              await stageContractFromInput();
            } catch (err) {
              showToast(err?.message || 'Erro ao preparar o contrato PDF.', 'danger');
              return;
            }
          }

          const submitBtn = modal.querySelector('#btnSubmitEmployee');
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'A guardar...';
          }

          const payload = {
            ...data,
            nif: cleanNif,
            remunerationType: chosenType,
            baseSalary,
            dailyRate,
            hourlyRate,
            ssPercentage: canSeeSalary
              ? Math.min(100, Math.max(0, Number(data.ssPercentage ?? 11) || 0))
              : Number(emp.ssPercentage ?? 11),
            mealAllowance: canSeeSalary
              ? chosenType === 'mensal'
                ? 0
                : parseCurrencyInput(data.mealAllowance)
              : Number(emp.mealAllowance ?? 0),
            offPayrollType,
            offPayrollAmount,
          };
          const empId = isEdit ? emp.id : generateId('FUNC');
          if (isEdit) {
            await store.updateEmployee(emp.id, payload);
          } else {
            await store.addEmployee({ id: empId, ...payload });
          }

          for (const delId of deletedEmpContractIds) {
            store.deleteEmployeeContract(delId);
          }

          const newContracts = formEmpContracts.filter((c) => c.isNew);
          for (const ctr of newContracts) {
            await store.addEmployeeContract({
              ...ctr,
              employeeId: empId,
            });
          }

          showToast(
            isEdit
              ? `Dados de ${payload.name} atualizados.`
              : `Funcionário ${payload.name} registado com sucesso.`
          );
          closeModal();
        });
      },
    });
  }
}
