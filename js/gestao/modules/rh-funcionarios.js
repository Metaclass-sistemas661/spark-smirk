/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — RH: Funcionários, Presenças & Relatório
   ═══════════════════════════════════════════════════════════ */

import { store, saveEmployeeContractFile, getEmployeeContractFile } from '../core/store.js';
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
  parseCurrencyInput,
  todayISO,
  downloadCSV,
} from '../core/formatters.js';
import { ICONS, openModal, closeModal, confirmAction, showToast } from '../core/ui.js';

function isSaturdayISO(dateISO) {
  const parts = String(dateISO || '').split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return false;
  return new Date(parts[0], parts[1] - 1, parts[2]).getDay() === 6;
}

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

function computeMonthlyAttendance(employee, attendanceMap = {}, yearMonth) {
  const empAtt = attendanceMap[employee?.id] || {};
  const daysCount = getDaysInMonth(yearMonth);
  let workingDays = 0;
  let present = 0;
  let weekdayPresent = 0;
  let saturdayCount = 0;
  let saturdayBonusTotal = 0;
  let saturdayReceiptTotal = 0;
  let saturdayOffTotal = 0;
  let totalHours = 0;
  let justified = 0;
  let unjustified = 0;
  let vacation = 0;

  for (let d = 1; d <= daysCount; d += 1) {
    const wd = getWeekdayShortPT(yearMonth, d);
    if (wd !== 0 && wd !== 6) workingDays += 1;
    const dateISO = `${yearMonth}-${String(d).padStart(2, '0')}`;
    const rec = empAtt[dateISO];
    if (!rec) continue;
    if (rec.status === 'P') {
      present += 1;
      totalHours += Number(rec.hours) > 0 ? Number(rec.hours) : 8;
      if (wd === 6) {
        saturdayCount += 1;
        const satVal = Math.max(0, Number(rec.saturdayBonus) || 0);
        saturdayBonusTotal += satVal;
        if (rec.saturdayTaxMode === 'recibo_ss') {
          saturdayReceiptTotal += satVal;
        } else {
          saturdayOffTotal += satVal;
        }
      } else {
        weekdayPresent += 1;
      }
    } else if (rec.status === 'FJ') {
      justified += 1;
    } else if (rec.status === 'FI') {
      unjustified += 1;
    } else if (rec.status === 'FE') {
      vacation += 1;
    }
  }

  const totalAbsences = justified + unjustified;
  const accounted = present + totalAbsences;
  const attendanceRate = accounted > 0 ? Math.round((present / accounted) * 100) : 100;
  return {
    workingDays,
    present,
    weekdayPresent,
    saturdayCount,
    saturdayBonusTotal: Number(saturdayBonusTotal.toFixed(2)),
    saturdayReceiptTotal: Number(saturdayReceiptTotal.toFixed(2)),
    saturdayOffTotal: Number(saturdayOffTotal.toFixed(2)),
    totalHours,
    justified,
    unjustified,
    vacation,
    totalAbsences,
    attendanceRate,
    remunerationType: ['diaria', 'hora', 'mensal'].includes(employee?.remunerationType)
      ? employee.remunerationType
      : 'mensal',
  };
}

export class RhFuncionariosModule {
  constructor() {
    this.viewMode = 'directory'; // 'directory' | 'daily' | 'report'
    this.selectedDate = todayISO();
    this.deptFilter = 'all';
    this.statusFilter = 'all';
  }

  render(container, ctx) {
    this._can = ctx.can || (() => true);
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
            <span class="erp-kpi-card__label">Contratos &amp; Dossiê RH</span>
            <span class="erp-kpi-card__icon">${ICONS.paperclip}</span>
          </div>
          <div class="erp-kpi-card__value">${totalContractsCount} PDF</div>
          <div class="erp-kpi-card__meta">Documentos contratuais arquivados</div>
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
        <span class="erp-cell-sub">Cadastro, contratos e assiduidade de ${escapeHtml(formatMonthLabel(month))} · Ordenados e pagamentos geridos na aba Ordenados &amp; Pagamentos</span>
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
                <th>Assiduidade (${escapeHtml(month)})</th>
                <th>Estado</th>
                <th style="text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${employees
                .map((emp) => {
                  const stats = computeMonthlyAttendance(emp, attendanceMap, month);
                  const empContractsCount = (store.getState().employeeContracts || []).filter(
                    (c) => c.employeeId === emp.id
                  ).length;
                  const remLabel = REMUNERATION_LABELS[stats.remunerationType] || 'Fixo Mensal';
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
                      <div class="erp-cell-sub">${escapeHtml(emp.contractType)} · Adm. ${escapeHtml(formatDatePT(emp.admissionDate))} · ${escapeHtml(remLabel)}</div>
                      ${empContractsCount > 0 ? `<div style="margin-top:4px;"><span class="erp-badge erp-badge--info">${empContractsCount} contrato(s) PDF</span></div>` : ''}
                    </td>
                    <td>
                      <div style="display:flex;gap:4px;flex-wrap:nowrap;margin-bottom:4px;">
                        <span class="erp-att-pill erp-att-pill--P">${stats.present}P</span>
                        <span class="erp-att-pill erp-att-pill--FJ">${stats.justified}FJ</span>
                        <span class="erp-att-pill erp-att-pill--FI">${stats.unjustified}FI</span>
                      </div>
                      <div class="erp-cell-sub">Taxa: ${stats.attendanceRate}%${stats.vacation > 0 ? ` · ${stats.vacation}FE` : ''}</div>
                    </td>
                    <td>
                      <span class="erp-badge ${emp.status === 'ativo' ? 'erp-badge--success' : 'erp-badge--neutral'}">
                        ${emp.status === 'ativo' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>
                      <div class="erp-row-actions">
                        <button type="button" class="erp-icon-btn" title="Contratos de Trabalho (PDF)" data-emp-contracts="${escapeHtml(emp.id)}">${ICONS.paperclip}</button>
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

    target.querySelectorAll('[data-emp-contracts]').forEach((btn) => {
      btn.addEventListener('click', () => this._openEmployeeContractsModal(btn.dataset.empContracts));
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
    const isSatSelected = isSaturdayISO(this.selectedDate);

    target.innerHTML = `
      <div class="erp-attendance-controls">
        <div class="erp-filter-bar">
          <label style="font-size:12.5px;font-weight:700;color:var(--erp-heading);">Data da Folha de Ponto:</label>
          <input type="date" class="erp-select-sm" id="attDatePicker" value="${escapeHtml(this.selectedDate)}">
          ${isSatSelected ? '<span class="erp-badge erp-badge--warning">Sábado — Valor Adicional Configurável</span>' : ''}
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

      ${
        isSatSelected
          ? `<div class="erp-smart-banner" style="margin-bottom:12px;">
               <span><strong>Dia de Sábado (${escapeHtml(formatDatePT(this.selectedDate))}):</strong> A empresa opera de Seg–Sex; ao marcar Presença (P) neste sábado será pedido o valor pago pelo sábado e se entra <strong>Por Fora</strong> ou em <strong>Segurança Social</strong>.</span>
             </div>`
          : ''
      }

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
                const remTag = REMUNERATION_LABELS[remType] || 'Fixo Mensal';
                const dayHours = Number(rec.hours) > 0 ? Number(rec.hours) : 8;
                const satBonus = Number(rec.saturdayBonus) || 0;
                const satTaxLabel = rec.saturdayTaxMode === 'recibo_ss' ? 'c/ SS' : 'Por Fora SS';
                return `
                <tr>
                  <td>
                    <div class="erp-person-cell">
                      <span class="erp-avatar">${escapeHtml(getInitials(emp.name))}</span>
                      <div>
                        <div class="erp-cell-title">${escapeHtml(emp.name)}</div>
                        <div class="erp-cell-sub">${escapeHtml(emp.role)} · ${escapeHtml(remTag)}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    ${
                      meta
                        ? `<span class="erp-att-pill erp-att-pill--${meta.cls}">${meta.code} · ${escapeHtml(meta.label)}${rec.status === 'P' && remType === 'hora' ? ` (${dayHours}h)` : ''}</span>
                           ${isSatSelected && rec.status === 'P' ? `<div class="erp-cell-sub" style="margin-top:4px;color:var(--erp-accent-dark);font-weight:600;">Sábado: +${escapeHtml(formatCurrency(satBonus))} (${escapeHtml(satTaxLabel)})</div>` : ''}`
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
      if (isSaturdayISO(this.selectedDate)) {
        this._openSaturdayAttendanceModal({
          mode: 'batch',
          dateISO: this.selectedDate,
          activeCount: activeEmployees.length,
        });
        return;
      }
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
        const emp = store.getState().employees.find((x) => x.id === empId);

        if (code === 'P' && isSaturdayISO(this.selectedDate) && emp) {
          this._openSaturdayAttendanceModal({
            mode: 'single',
            emp,
            dateISO: this.selectedDate,
            hours: hrs,
            note: noteInput ? noteInput.value : '',
          });
          return;
        }

        store.setAttendance(empId, this.selectedDate, code, noteInput ? noteInput.value : '', hrs, 0, 'por_fora');

        if (emp) {
          if (code === 'P') {
            showToast(`Presença registada (${emp.name}).`, 'success');
          } else if (code === 'FJ' || code === 'FI') {
            showToast(
              `${code === 'FJ' ? 'Falta Justificada' : 'Falta Injustificada'} registada (${emp.name}).`,
              'warning'
            );
          } else if (code === 'FE') {
            showToast(`Férias registadas (${emp.name}).`, 'info');
          }
        }
      });
    });

    target.querySelectorAll('[data-att-note]').forEach((input) => {
      input.addEventListener('change', () => {
        const empId = input.dataset.attNote;
        const current = (store.getState().attendance[empId] || {})[this.selectedDate];
        if (current && current.status) {
          store.setAttendance(
            empId,
            this.selectedDate,
            current.status,
            input.value,
            current.hours || 8,
            current.saturdayBonus || 0,
            current.saturdayTaxMode || 'por_fora'
          );
          showToast('Observação guardada.');
        }
      });
    });
  }

  _openSaturdayAttendanceModal({ mode, emp = null, dateISO, hours = 8, note = '', activeCount = 0 }) {
    const existing = emp ? (store.getState().attendance[emp.id] || {})[dateISO] || {} : {};
    const defaultAmt = Number(existing.saturdayBonus) > 0 ? Number(existing.saturdayBonus) : 0;
    const defaultTaxMode = existing.saturdayTaxMode === 'recibo_ss' ? 'recibo_ss' : 'por_fora';
    const remHint =
      mode === 'single' && emp
        ? emp.remunerationType === 'diaria'
          ? `Referência Seg–Sex: diária normal de ${formatCurrency(emp.dailyRate)}. Indique quanto irá pagar por este Sábado.`
          : emp.remunerationType === 'hora'
            ? `Referência Seg–Sex: ${formatCurrency(emp.hourlyRate)}/h. Indique o valor total pago por este Sábado.`
            : 'Colaborador em Ordenado Fixo (cobre Seg–Sex): o valor abaixo soma como extra de Sábado.'
        : `Aplicar o valor deste Sábado aos ${activeCount} colaboradores ativos ainda sem marcação nesta data.`;

    openModal({
      title: `Presença ao Sábado — ${formatDatePT(dateISO)}`,
      subtitle: mode === 'single' && emp ? `${emp.name} · ${emp.role}` : 'Marcação em lote (Todos Presentes)',
      bodyHtml: `
        <form id="satAttendanceForm">
          <div class="erp-smart-banner" style="margin-bottom:14px;">
            <span>${escapeHtml(remHint)}</span>
          </div>

          <div class="erp-form-grid">
            <div class="erp-field erp-field--full">
              <label for="satPayAmount">Valor a pagar por este Sábado (€) *</label>
              <input type="text" inputmode="numeric" data-currency-euro id="satPayAmount" value="${escapeHtml(defaultAmt)}" required placeholder="€ 0,00">
            </div>

            <div class="erp-field erp-field--full">
              <label>Como este valor de Sábado será processado? *</label>
              <div class="erp-regime-group" id="satTaxGroup">
                <label class="erp-regime-option ${defaultTaxMode === 'por_fora' ? 'is-selected' : ''}">
                  <input type="radio" name="satTaxMode" value="por_fora" ${defaultTaxMode === 'por_fora' ? 'checked' : ''}>
                  <div>
                    <div class="erp-cell-title">Por Fora da Segurança Social</div>
                    <div class="erp-cell-sub">Sem desconto de SS — soma integral ao total final a pagar.</div>
                  </div>
                </label>
                <label class="erp-regime-option ${defaultTaxMode === 'recibo_ss' ? 'is-selected' : ''}">
                  <input type="radio" name="satTaxMode" value="recibo_ss" ${defaultTaxMode === 'recibo_ss' ? 'checked' : ''}>
                  <div>
                    <div class="erp-cell-title">Em Recibo (Segurança Social)</div>
                    <div class="erp-cell-sub">Entra no recibo oficial e aplica o desconto de SS do colaborador.</div>
                  </div>
                </label>
              </div>
            </div>

            ${
              mode === 'single'
                ? `<div class="erp-field erp-field--full">
                     <label for="satAttNote">Observação / Obra deste Sábado</label>
                     <input type="text" id="satAttNote" value="${escapeHtml(note || existing.note || '')}" placeholder="Ex.: Turno extra de sábado em obra">
                   </div>`
                : ''
            }
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="erp-btn erp-btn--outline" data-modal-close>Cancelar</button>
        <button type="submit" form="satAttendanceForm" class="erp-btn erp-btn--primary">
          ${ICONS.checkCircle}<span>Confirmar Presença no Sábado</span>
        </button>
      `,
      onMount: (modal) => {
        modal.querySelectorAll('input[name="satTaxMode"]').forEach((r) => {
          r.addEventListener('change', () => {
            modal.querySelectorAll('#satTaxGroup .erp-regime-option').forEach((lbl) => {
              lbl.classList.toggle('is-selected', Boolean(lbl.querySelector('input')?.checked));
            });
          });
        });

        modal.querySelector('#satAttendanceForm')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const amt = Math.max(0, parseCurrencyInput(modal.querySelector('#satPayAmount')?.value));
          const taxMode = modal.querySelector('input[name="satTaxMode"]:checked')?.value === 'recibo_ss' ? 'recibo_ss' : 'por_fora';
          const satNote = modal.querySelector('#satAttNote')?.value?.trim() || note || '';

          if (mode === 'batch') {
            await store.markAllPresent(dateISO, amt, taxMode);
            showToast(
              `Sábado (${formatDatePT(dateISO)}) marcado para todos os ativos (${formatCurrency(amt)} · ${taxMode === 'recibo_ss' ? 'Segurança Social' : 'Por Fora SS'}).`,
              'success',
              4500
            );
          } else if (emp) {
            await store.setAttendance(emp.id, dateISO, 'P', satNote, hours, amt, taxMode);
            showToast(
              `Sábado registado para ${emp.name}: +${formatCurrency(amt)} (${taxMode === 'recibo_ss' ? 'Recibo c/ SS' : 'Por Fora SS'}).`,
              'success',
              4500
            );
          }
          closeModal();
        });
      },
    });
  }

  _renderMonthlyReport(target, employees, attendanceMap, month) {
    target.innerHTML = `
      <div class="erp-attendance-controls">
        <span class="erp-cell-title">Relatório Consolidado de Assiduidade — ${escapeHtml(formatMonthLabel(month))}</span>
        <span class="erp-cell-sub">Clique no ícone de calendário de cada colaborador para editar qualquer dia do mês.</span>
      </div>

      <div class="erp-table-wrap">
        <table class="erp-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Trabalhados (Seg–Sex / Sáb.)</th>
              <th>Sábados (€)</th>
              <th>Faltas (FJ / FI)</th>
              <th>Férias (FE)</th>
              <th>Taxa de Assiduidade</th>
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
                        <div class="erp-cell-sub">${escapeHtml(emp.role)} · ${escapeHtml(REMUNERATION_LABELS[s.remunerationType] || 'Fixo Mensal')}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="erp-att-pill erp-att-pill--P">${s.weekdayPresent} d${s.remunerationType === 'hora' ? ` (${s.totalHours}h)` : ''}</span>
                    ${s.saturdayCount > 0 ? `<span class="erp-badge erp-badge--warning" style="margin-left:4px;">${s.saturdayCount} Sáb.</span>` : ''}
                  </td>
                  <td>
                    ${
                      s.saturdayCount > 0
                        ? `<div class="erp-cell-title" style="color:var(--erp-accent-dark);">+${escapeHtml(formatCurrency(s.saturdayBonusTotal))}</div>
                           <div class="erp-cell-sub">${s.saturdayReceiptTotal > 0 ? `SS: ${formatCurrency(s.saturdayReceiptTotal)}` : ''}${s.saturdayReceiptTotal > 0 && s.saturdayOffTotal > 0 ? ' · ' : ''}${s.saturdayOffTotal > 0 ? `Fora: ${formatCurrency(s.saturdayOffTotal)}` : ''}</div>`
                        : '<span class="erp-cell-sub">—</span>'
                    }
                  </td>
                  <td>
                    <span class="erp-att-pill erp-att-pill--FJ">${s.justified}FJ</span>
                    <span class="erp-att-pill erp-att-pill--FI">${s.unjustified}FI</span>
                  </td>
                  <td><span class="erp-att-pill erp-att-pill--FE">${s.vacation}FE</span></td>
                  <td><strong>${s.attendanceRate}%</strong> <span class="erp-cell-sub">(${s.present}/${s.present + s.totalAbsences} dias reg.)</span></td>
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
      ];
    });
    downloadCSV(`relatorio-assiduidade-${month}.csv`, headers, rows);
    showToast('Relatório CSV exportado com sucesso.');
  }

  _openEmployeeCalendarModal(empId, month) {
    const state = store.getState();
    const emp = state.employees.find((e) => e.id === empId);
    if (!emp) return;

    let pendingSaturdayISO = null;

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
        const satSub =
          wd === 6 && code === 'P' && Number(rec?.saturdayBonus) > 0
            ? `<span style="font-size:9px;font-weight:700;color:var(--erp-accent-dark);display:block;margin-top:2px;">+${escapeHtml(formatCurrency(rec.saturdayBonus))}</span>`
            : '';
        cells += `
          <button type="button" class="erp-cal-day ${isWeekend ? 'erp-cal-day--weekend' : ''}" data-cal-day="${dateISO}">
            <span class="erp-cal-day__num">${d}</span>
            <span class="erp-att-pill ${pillCls}">${code || '—'}</span>
            ${satSub}
          </button>`;
      }

      const satEditorHtml = pendingSaturdayISO
        ? `<div class="erp-inline-invoice-box" style="margin-bottom:14px;border-color:var(--erp-primary-border);">
             <div class="erp-form-section__title" style="margin-bottom:8px;">Configurar Pagamento deste Sábado (${escapeHtml(formatDatePT(pendingSaturdayISO))})</div>
             <div class="erp-form-grid">
               <div class="erp-field">
                 <label for="calSatBonus">Valor pago no Sábado (€) *</label>
                 <input type="text" inputmode="numeric" id="calSatBonus" value="0" placeholder="€ 0,00">
               </div>
               <div class="erp-field">
                 <label for="calSatTaxMode">Regime do Sábado</label>
                 <select id="calSatTaxMode">
                   <option value="por_fora">Por Fora da Segurança Social (sem desconto SS)</option>
                   <option value="recibo_ss">Em Recibo (sujeito a Segurança Social)</option>
                 </select>
               </div>
             </div>
             <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
               <button type="button" class="erp-btn erp-btn--outline erp-btn--sm" id="btnCalSatCancel">Cancelar</button>
               <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" id="btnCalSatConfirm">Confirmar Sábado (P)</button>
             </div>
           </div>`
        : '';

      return `
        <div class="erp-summary-box" style="margin-bottom:14px;">
          <div>
            <div class="erp-summary-item__label">Seg–Sex / Total (P)</div>
            <div class="erp-summary-item__val erp-summary-item__val--success">${stats.weekdayPresent} ú. + ${stats.saturdayCount} sáb.</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Sábados Pagos</div>
            <div class="erp-summary-item__val" style="color:var(--erp-accent-dark);">+${escapeHtml(formatCurrency(stats.saturdayBonusTotal))}</div>
          </div>
          <div>
            <div class="erp-summary-item__label">Faltas (FJ / FI)</div>
            <div class="erp-summary-item__val">${stats.justified}FJ · <span style="color:var(--erp-danger)">${stats.unjustified}FI</span></div>
          </div>
          <div>
            <div class="erp-summary-item__label">Taxa Assiduidade</div>
            <div class="erp-summary-item__val erp-summary-item__val--accent">${stats.attendanceRate}%</div>
          </div>
        </div>
        ${satEditorHtml}
        <p class="erp-cell-sub" style="margin-bottom:10px;">Clique num dia para alternar: Presente (P) → Falta Justificada (FJ) → Falta Injustificada (FI) → Férias (FE) → Sem registo. Aos sábados, ao marcar (P), define valor e regime (Por Fora / SS).</p>
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
              const currentRec = (store.getState().attendance[emp.id] || {})[dateISO] || {};
              const current = currentRec.status || '';
              const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];

              if (next === 'P' && isSaturdayISO(dateISO)) {
                pendingSaturdayISO = dateISO;
                modal.querySelector('#empCalWrap').innerHTML = renderCalendarBody();
                bindDays();
                modal.querySelector('#calSatBonus')?.focus();
                return;
              }

              pendingSaturdayISO = null;
              store.setAttendance(emp.id, dateISO, next, '', currentRec.hours || 8, 0, 'por_fora');
              modal.querySelector('#empCalWrap').innerHTML = renderCalendarBody();
              bindDays();
            });
          });

          modal.querySelector('#btnCalSatCancel')?.addEventListener('click', () => {
            pendingSaturdayISO = null;
            modal.querySelector('#empCalWrap').innerHTML = renderCalendarBody();
            bindDays();
          });

          modal.querySelector('#btnCalSatConfirm')?.addEventListener('click', () => {
            if (!pendingSaturdayISO) return;
            const bonus = Math.max(0, parseCurrencyInput(modal.querySelector('#calSatBonus')?.value));
            const mode = modal.querySelector('#calSatTaxMode')?.value === 'recibo_ss' ? 'recibo_ss' : 'por_fora';
            const rec = (store.getState().attendance[emp.id] || {})[pendingSaturdayISO] || {};
            store.setAttendance(emp.id, pendingSaturdayISO, 'P', rec.note || '', rec.hours || 8, bonus, mode);
            showToast(
              `Sábado (${formatDatePT(pendingSaturdayISO)}) registado: +${formatCurrency(bonus)} (${mode === 'recibo_ss' ? 'Recibo c/ SS' : 'Por Fora SS'}).`
            );
            pendingSaturdayISO = null;
            modal.querySelector('#empCalWrap').innerHTML = renderCalendarBody();
            bindDays();
          });
        };
        bindDays();
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
      contractType: 'Sem Termo',
      admissionDate: todayISO(),
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
          <div class="erp-form-section__title">2. Enquadramento Profissional &amp; Notas</div>
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
          <div class="erp-form-grid" style="margin-top:10px;">
            <div class="erp-field erp-field--full">
              <label for="empNotes">Notas / Certificações</label>
              <textarea id="empNotes" name="notes" rows="2" placeholder="Ex.: Carta de condução, CAP, formação em segurança em obra...">${escapeHtml(emp.notes)}</textarea>
            </div>
          </div>
          <div class="erp-inline-invoice-box" style="margin-top:10px;">
            <div class="erp-cell-sub">
              <strong>Nota:</strong> Condições salariais (ordenado/diária, Segurança Social, duodécimos, pagamento por fora da SS e IBAN) são configuradas na aba <strong>Ordenados &amp; Pagamentos</strong>.
            </div>
          </div>
        </div>

        <div class="erp-form-section">
          <div class="erp-form-section__title">3. Contrato de Trabalho em PDF</div>
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

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const data = Object.fromEntries(fd.entries());
          const cleanNif = String(data.nif || '').replace(/\D/g, '');
          if (!isValidNIF(cleanNif)) {
            showToast('NIF inválido. Verifique os 9 dígitos do contribuinte.', 'danger');
            return;
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

          const cadastroPayload = {
            ...data,
            nif: cleanNif,
          };
          const empId = isEdit ? emp.id : generateId('FUNC');
          if (isEdit) {
            await store.updateEmployee(emp.id, cadastroPayload);
          } else {
            await store.addEmployee({
              id: empId,
              ...cadastroPayload,
              iban: '',
              remunerationType: 'mensal',
              baseSalary: 0,
              dailyRate: 0,
              hourlyRate: 0,
              ssPercentage: 11,
              mealAllowance: 0,
              offPayrollType: 'mensal',
              offPayrollAmount: 0,
              twelfths: 'Não',
              twelfthsVacationManual: 0,
              twelfthsChristmasManual: 0,
            });
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
              ? `Dados cadastrais de ${cadastroPayload.name} atualizados.`
              : `Funcionário ${cadastroPayload.name} registado. Configure o ordenado na aba Ordenados & Pagamentos.`
          );
          closeModal();
        });
      },
    });
  }
}
