/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Cloud-Synced Store (PostgreSQL + Storage)
   Sem dados mock nem persistência sensível em localStorage;
   sincronizado ao vivo com a base de dados central.
   ═══════════════════════════════════════════════════════════ */

import { authenticatedApiFetch } from '../../shared/supabase-client.js';
import { showToast } from './ui.js';

const pendingAttachmentPayloads = new Map();
const pendingInvoicePayloads = new Map();
const pendingContractPayloads = new Map();
const pendingCertificatePayloads = new Map();
const pendingEmployeeContractPayloads = new Map();

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Erro ao ler ficheiro.'));
    reader.readAsDataURL(file);
  });
}

function base64ToArrayBuffer(base64) {
  const binaryStr = window.atob(base64);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function saveAttachmentFile(id, file) {
  if (!id || !file) throw new Error('Ficheiro inválido.');
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('O ficheiro excede o limite máximo de 10 MB.');
  }
  const base64 = await fileToBase64(file);
  pendingAttachmentPayloads.set(id, {
    name: file.name,
    type: file.type || 'application/pdf',
    size: file.size,
    base64,
  });
  return { id, name: file.name, type: file.type, size: file.size };
}

export async function getAttachmentFile(id) {
  if (!id) return null;
  try {
    const res = await authenticatedApiFetch(`/api/erp/attachments/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    if (!res?.base64) return null;
    return {
      id: res.id,
      name: res.name,
      type: res.type || 'application/pdf',
      size: res.size || 0,
      data: base64ToArrayBuffer(res.base64),
    };
  } catch (err) {
    showToast(err?.message || 'Não foi possível transferir o ficheiro anexo.', 'error');
    return null;
  }
}

export async function deleteAttachmentFile(_id) {
  // Eliminado de forma transacional em deleteAttachedReceipt() no servidor
}

export async function saveInvoiceFile(id, file) {
  if (!id || !file) throw new Error('Ficheiro inválido.');
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('O ficheiro da fatura excede o limite máximo de 10 MB.');
  }
  const base64 = await fileToBase64(file);
  pendingInvoicePayloads.set(id, {
    name: file.name,
    type: file.type || 'application/pdf',
    size: file.size,
    base64,
  });
  return { id, name: file.name, type: file.type || 'application/pdf', size: file.size };
}

export async function getProjectInvoiceFile(id) {
  if (!id) return null;
  try {
    const res = await authenticatedApiFetch(`/api/erp/project-invoices/${encodeURIComponent(id)}/file`, {
      method: 'GET',
    });
    if (!res?.base64) return null;
    return {
      id: res.id,
      name: res.name,
      type: res.type || 'application/pdf',
      size: res.size || 0,
      data: base64ToArrayBuffer(res.base64),
    };
  } catch (err) {
    showToast(err?.message || 'Não foi possível transferir o PDF da fatura.', 'error');
    return null;
  }
}

export async function saveContractFile(id, file) {
  if (!id || !file) throw new Error('Ficheiro de contrato inválido.');
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('O ficheiro do contrato excede o limite máximo de 10 MB.');
  }
  const base64 = await fileToBase64(file);
  pendingContractPayloads.set(id, {
    name: file.name,
    type: file.type || 'application/pdf',
    size: file.size,
    base64,
  });
  return { id, name: file.name, type: file.type || 'application/pdf', size: file.size };
}

export async function getProjectContractFile(id) {
  if (!id) return null;
  try {
    const res = await authenticatedApiFetch(`/api/erp/project-contracts/${encodeURIComponent(id)}/file`, {
      method: 'GET',
    });
    if (!res?.base64) return null;
    return {
      id: res.id,
      name: res.name,
      type: res.type || 'application/pdf',
      size: res.size || 0,
      data: base64ToArrayBuffer(res.base64),
    };
  } catch (err) {
    showToast(err?.message || 'Não foi possível transferir o PDF do contrato.', 'error');
    return null;
  }
}

export async function saveCertificateFile(id, file) {
  if (!id || !file) throw new Error('Ficheiro de certificado inválido.');
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('O ficheiro do certificado excede o limite máximo de 10 MB.');
  }
  const base64 = await fileToBase64(file);
  pendingCertificatePayloads.set(id, {
    name: file.name,
    type: file.type || 'application/pdf',
    size: file.size,
    base64,
  });
  return { id, name: file.name, type: file.type || 'application/pdf', size: file.size };
}

export async function getTechnicalCertificateFile(id) {
  if (!id) return null;
  try {
    const res = await authenticatedApiFetch(`/api/erp/technical-certificates/${encodeURIComponent(id)}/file`, {
      method: 'GET',
    });
    if (!res?.base64) return null;
    return {
      id: res.id,
      name: res.name,
      type: res.type || 'application/pdf',
      size: res.size || 0,
      data: base64ToArrayBuffer(res.base64),
    };
  } catch (err) {
    showToast(err?.message || 'Não foi possível transferir o PDF do certificado.', 'error');
    return null;
  }
}

export async function saveEmployeeContractFile(id, file) {
  if (!id || !file) throw new Error('Ficheiro de contrato inválido.');
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('O ficheiro do contrato excede o limite máximo de 10 MB.');
  }
  const base64 = await fileToBase64(file);
  pendingEmployeeContractPayloads.set(id, {
    name: file.name,
    type: file.type || 'application/pdf',
    size: file.size,
    base64,
  });
  return { id, name: file.name, type: file.type || 'application/pdf', size: file.size };
}

export async function getEmployeeContractFile(id) {
  if (!id) return null;
  try {
    const res = await authenticatedApiFetch(`/api/erp/employee-contracts/${encodeURIComponent(id)}/file`, {
      method: 'GET',
    });
    if (!res?.base64) return null;
    return {
      id: res.id,
      name: res.name,
      type: res.type || 'application/pdf',
      size: res.size || 0,
      data: base64ToArrayBuffer(res.base64),
    };
  } catch (err) {
    showToast(err?.message || 'Não foi possível transferir o PDF do contrato.', 'error');
    return null;
  }
}

export async function getCandidateCvFile(code) {
  if (!code) return null;
  try {
    const res = await authenticatedApiFetch(`/api/erp/candidates/${encodeURIComponent(code)}/cv`, {
      method: 'GET',
    });
    if (!res?.base64) return null;
    return {
      id: res.id,
      name: res.name,
      type: res.type || 'application/pdf',
      size: res.size || 0,
      data: base64ToArrayBuffer(res.base64),
    };
  } catch (err) {
    showToast(err?.message || 'Não foi possível transferir o currículo anexado.', 'error');
    return null;
  }
}

const EMPTY_STATE = {
  employees: [],
  attendance: {},
  employeeAdvances: [],
  employeeContracts: [],
  candidates: [],
  payslips: [],
  attachedReceipts: [],
  projects: [],
  projectInvoices: [],
  projectContracts: [],
  technicalManagers: [],
  technicalCertificates: [],
  cashMovements: [],
  cashOpeningBalance: 0,
  cashOpeningNote: '',
};

class ErpStore {
  constructor() {
    this.state = { ...EMPTY_STATE };
    this.listeners = new Set();
    this.initialized = false;
  }

  async init() {
    try {
      // Remove qualquer cache antigo legado em localStorage por segurança
      window.localStorage.removeItem('spark_smirk_erp_v1');
      window.sessionStorage.removeItem('spark_erp_initial_seed_checked');
    } catch {
      // Ignore storage cleanup
    }

    const snapshot = await authenticatedApiFetch('/api/erp/bootstrap', { method: 'GET' });
    this.state = this._normalizeSnapshot(snapshot);
    this.initialized = true;
    this._notify();
    return this.state;
  }

  _normalizeSnapshot(snapshot) {
    return {
      employees: Array.isArray(snapshot?.employees) ? snapshot.employees : [],
      attendance: snapshot?.attendance && typeof snapshot.attendance === 'object' ? snapshot.attendance : {},
      employeeAdvances: Array.isArray(snapshot?.employeeAdvances) ? snapshot.employeeAdvances : [],
      employeeContracts: Array.isArray(snapshot?.employeeContracts) ? snapshot.employeeContracts : [],
      candidates: Array.isArray(snapshot?.candidates) ? snapshot.candidates : [],
      payslips: Array.isArray(snapshot?.payslips) ? snapshot.payslips : [],
      attachedReceipts: Array.isArray(snapshot?.attachedReceipts) ? snapshot.attachedReceipts : [],
      projects: Array.isArray(snapshot?.projects) ? snapshot.projects : [],
      projectInvoices: Array.isArray(snapshot?.projectInvoices) ? snapshot.projectInvoices : [],
      projectContracts: Array.isArray(snapshot?.projectContracts) ? snapshot.projectContracts : [],
      technicalManagers: Array.isArray(snapshot?.technicalManagers) ? snapshot.technicalManagers : [],
      technicalCertificates: Array.isArray(snapshot?.technicalCertificates) ? snapshot.technicalCertificates : [],
      cashMovements: Array.isArray(snapshot?.cashMovements) ? snapshot.cashMovements : [],
      cashOpeningBalance: Number(snapshot?.cashOpeningBalance) || 0,
      cashOpeningNote: String(snapshot?.cashOpeningNote || ''),
    };
  }

  async _refreshFromServer() {
    try {
      const snapshot = await authenticatedApiFetch('/api/erp/bootstrap', { method: 'GET' });
      this.state = this._normalizeSnapshot(snapshot);
      this._notify();
    } catch {
      // Ignore refresh failure
    }
  }

  async _syncMutation(endpoint, method, body, fallbackToast) {
    try {
      return await authenticatedApiFetch(endpoint, { method, body });
    } catch (err) {
      showToast(err?.message || fallbackToast, 'error');
      await this._refreshFromServer();
      return null;
    }
  }

  _commit() {
    this._notify();
  }

  _notify() {
    this.listeners.forEach((fn) => fn(this.state));
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState() {
    return this.state;
  }

  /* ── Funcionários ── */
  addEmployee(emp) {
    this.state.employees.unshift(emp);
    this._notify();
    return this._syncMutation('/api/erp/employees', 'POST', emp, 'Erro ao guardar funcionário na base de dados.');
  }

  updateEmployee(id, patch) {
    const idx = this.state.employees.findIndex((e) => e.id === id);
    if (idx === -1) return Promise.resolve(null);
    const updated = { ...this.state.employees[idx], ...patch };
    this.state.employees[idx] = updated;
    this._notify();
    return this._syncMutation(
      `/api/erp/employees/${encodeURIComponent(id)}`,
      'PUT',
      updated,
      'Erro ao atualizar funcionário na base de dados.'
    );
  }

  deleteEmployee(id) {
    this.state.employees = this.state.employees.filter((e) => e.id !== id);
    delete this.state.attendance[id];
    this.state.employeeAdvances = (this.state.employeeAdvances || []).filter((a) => a.employeeId !== id);
    this.state.employeeContracts = (this.state.employeeContracts || []).filter((c) => c.employeeId !== id);
    this.state.payslips = this.state.payslips.filter((p) => p.employeeId !== id);
    this.state.attachedReceipts = (this.state.attachedReceipts || []).filter((r) => r.employeeId !== id);
    this._notify();
    this._syncMutation(
      `/api/erp/employees/${encodeURIComponent(id)}`,
      'DELETE',
      null,
      'Erro ao remover funcionário na base de dados.'
    );
  }

  /* ── Presenças e Faltas (com suporte a Sábado Pago) ── */
  setAttendance(
    employeeId,
    dateISO,
    status,
    note = '',
    hours = 8,
    saturdayBonus = 0,
    saturdayTaxMode = 'por_fora'
  ) {
    if (!this.state.attendance[employeeId]) {
      this.state.attendance[employeeId] = {};
    }
    const satBonus = Math.max(0, Number(saturdayBonus) || 0);
    const satMode = saturdayTaxMode === 'recibo_ss' ? 'recibo_ss' : 'por_fora';
    if (!status) {
      delete this.state.attendance[employeeId][dateISO];
    } else {
      this.state.attendance[employeeId][dateISO] = {
        status,
        note,
        hours: status === 'P' ? Number(hours) || 8 : 0,
        saturdayBonus: status === 'P' ? satBonus : 0,
        saturdayTaxMode: status === 'P' ? satMode : 'por_fora',
      };
    }
    this._notify();
    return this._syncMutation(
      '/api/erp/attendance',
      'PUT',
      {
        employeeId,
        dateISO,
        status: status || '',
        note,
        hours: Number(hours) || 8,
        saturdayBonus: satBonus,
        saturdayTaxMode: satMode,
      },
      'Erro ao guardar assiduidade na base de dados.'
    );
  }

  markAllPresent(dateISO, saturdayBonus = 0, saturdayTaxMode = 'por_fora') {
    const satBonus = Math.max(0, Number(saturdayBonus) || 0);
    const satMode = saturdayTaxMode === 'recibo_ss' ? 'recibo_ss' : 'por_fora';
    this.state.employees
      .filter((e) => e.status === 'ativo')
      .forEach((emp) => {
        if (!this.state.attendance[emp.id]) {
          this.state.attendance[emp.id] = {};
        }
        if (!this.state.attendance[emp.id][dateISO]) {
          this.state.attendance[emp.id][dateISO] = {
            status: 'P',
            note: '',
            hours: 8,
            saturdayBonus: satBonus,
            saturdayTaxMode: satMode,
          };
        }
      });
    this._notify();
    return this._syncMutation(
      '/api/erp/attendance',
      'PUT',
      { action: 'mark_all_present', dateISO, saturdayBonus: satBonus, saturdayTaxMode: satMode },
      'Erro ao registar presenças em lote na base de dados.'
    );
  }

  _syncLocalCashOrigin(originType, originCode, movData) {
    if (!Array.isArray(this.state.cashMovements)) {
      this.state.cashMovements = [];
    }
    this.state.cashMovements = this.state.cashMovements.filter(
      (m) => !(m.originType === originType && m.originCode === originCode)
    );
    if (movData && (Number(movData.amount) || 0) > 0) {
      this.state.cashMovements.unshift({
        ...movData,
        originType,
        originCode,
      });
    }
  }

  /* ── Caixa da Empresa (Entradas, Saídas & Saldo Inicial) ── */
  addCashMovement(mov) {
    if (!Array.isArray(this.state.cashMovements)) {
      this.state.cashMovements = [];
    }
    this.state.cashMovements.unshift({ ...mov, originType: 'manual' });
    this._notify();
    return this._syncMutation(
      '/api/erp/cash-movements',
      'POST',
      mov,
      'Erro ao registar movimento no caixa da empresa.'
    );
  }

  deleteCashMovement(id) {
    this.state.cashMovements = (this.state.cashMovements || []).filter((m) => m.id !== id);
    this._notify();
    return this._syncMutation(
      `/api/erp/cash-movements/${encodeURIComponent(id)}`,
      'DELETE',
      null,
      'Erro ao eliminar movimento de caixa.'
    );
  }

  setCashOpeningBalance(openingBalance, openingNote = '') {
    this.state.cashOpeningBalance = Number(openingBalance) || 0;
    this.state.cashOpeningNote = String(openingNote || '');
    this._notify();
    return this._syncMutation(
      '/api/erp/cash-opening',
      'PUT',
      { openingBalance: this.state.cashOpeningBalance, openingNote: this.state.cashOpeningNote },
      'Erro ao guardar saldo inicial de caixa.'
    );
  }

  /* ── Adiantamentos Salariais (Vales) ── */
  addEmployeeAdvance(advance) {
    if (!Array.isArray(this.state.employeeAdvances)) {
      this.state.employeeAdvances = [];
    }
    this.state.employeeAdvances.unshift(advance);
    const emp = (this.state.employees || []).find((e) => e.id === advance.employeeId);
    this._syncLocalCashOrigin('adiantamento', advance.id, {
      id: `CX-ADT-${advance.id}`,
      type: 'saida',
      category: 'Adiantamento / Vale',
      date: advance.date,
      month: advance.month || String(advance.date || '').slice(0, 7),
      description: `Vale / Adiantamento — ${emp?.name || 'Colaborador'}`,
      amount: Number(advance.amount) || 0,
      taxMode: 'adiantamento',
      employeeId: advance.employeeId,
      notes: advance.notes || '',
    });
    this._notify();
    return this._syncMutation(
      '/api/erp/employee-advances',
      'POST',
      advance,
      'Erro ao registar adiantamento salarial na base de dados.'
    );
  }

  deleteEmployeeAdvance(id) {
    this.state.employeeAdvances = (this.state.employeeAdvances || []).filter((a) => a.id !== id);
    this._syncLocalCashOrigin('adiantamento', id, null);
    this._notify();
    this._syncMutation(
      `/api/erp/employee-advances/${encodeURIComponent(id)}`,
      'DELETE',
      null,
      'Erro ao eliminar adiantamento salarial da base de dados.'
    );
  }

  /* ── Contratos de Trabalho dos Funcionários (PDF) ── */
  addEmployeeContract(contract) {
    if (!Array.isArray(this.state.employeeContracts)) {
      this.state.employeeContracts = [];
    }
    this.state.employeeContracts.unshift(contract);
    this._notify();

    const pending = pendingEmployeeContractPayloads.get(contract.id);
    pendingEmployeeContractPayloads.delete(contract.id);

    return this._syncMutation(
      '/api/erp/employee-contracts',
      'POST',
      {
        ...contract,
        fileBase64: pending?.base64 || '',
        fileName: pending?.name || contract.fileName || '',
        fileType: pending?.type || contract.fileType || '',
        fileSize: pending?.size || contract.fileSize || 0,
      },
      'Erro ao anexar contrato do funcionário na base de dados.'
    );
  }

  deleteEmployeeContract(id) {
    this.state.employeeContracts = (this.state.employeeContracts || []).filter((c) => c.id !== id);
    this._notify();
    return this._syncMutation(
      `/api/erp/employee-contracts/${encodeURIComponent(id)}`,
      'DELETE',
      null,
      'Erro ao remover o contrato do funcionário na base de dados.'
    );
  }

  /* ── Candidaturas & Currículos ("Trabalhe Connosco") ── */
  async fetchCandidates() {
    try {
      const res = await authenticatedApiFetch('/api/erp/candidates', { method: 'GET' });
      this.state.candidates = Array.isArray(res?.candidates) ? res.candidates : [];
      this._notify();
      return this.state.candidates;
    } catch (err) {
      showToast(err?.message || 'Não foi possível atualizar a lista de candidaturas.', 'error');
      return null;
    }
  }

  updateCandidate(code, patch) {
    const idx = (this.state.candidates || []).findIndex((c) => c.id === code);
    if (idx >= 0) {
      this.state.candidates[idx] = { ...this.state.candidates[idx], ...patch };
      this._notify();
    }
    return this._syncMutation(
      `/api/erp/candidates/${encodeURIComponent(code)}`,
      'PUT',
      patch,
      'Erro ao atualizar o estado da candidatura.'
    );
  }

  deleteCandidate(code) {
    this.state.candidates = (this.state.candidates || []).filter((c) => c.id !== code);
    this._notify();
    return this._syncMutation(
      `/api/erp/candidates/${encodeURIComponent(code)}`,
      'DELETE',
      null,
      'Erro ao remover a candidatura da base de dados.'
    );
  }

  /* ── Recibos de Vencimento ── */
  addPayslip(payslip) {
    this.state.payslips.unshift(payslip);
    const emp = (this.state.employees || []).find((e) => e.id === payslip.employeeId);
    if (payslip.status === 'pago' && (Number(payslip.netSalary) || 0) > 0) {
      this._syncLocalCashOrigin('recibo_vencimento', payslip.id, {
        id: `CX-REC-${payslip.id}`,
        type: 'saida',
        category: 'Salários & Ordenados',
        date: payslip.paymentDate || `${payslip.month || ''}-28`,
        month: payslip.month,
        description: `Pagamento de ordenado — ${emp?.name || 'Colaborador'} (${payslip.month || ''})`,
        amount: Number(payslip.netSalary) || 0,
        taxMode: (Number(payslip.offPayroll) || 0) > 0 ? 'misto' : 'recibo_ss',
        employeeId: payslip.employeeId,
        notes: payslip.notes || '',
      });
    }
    this._notify();
    return this._syncMutation(
      '/api/erp/payslips',
      'POST',
      payslip,
      'Erro ao guardar vencimento na base de dados.'
    );
  }

  updatePayslip(id, patch) {
    const idx = this.state.payslips.findIndex((p) => p.id === id);
    if (idx === -1) return Promise.resolve(null);
    const updated = { ...this.state.payslips[idx], ...patch };
    this.state.payslips[idx] = updated;
    const emp = (this.state.employees || []).find((e) => e.id === updated.employeeId);
    if (updated.status === 'pago' && (Number(updated.netSalary) || 0) > 0) {
      this._syncLocalCashOrigin('recibo_vencimento', updated.id, {
        id: `CX-REC-${updated.id}`,
        type: 'saida',
        category: 'Salários & Ordenados',
        date: updated.paymentDate || `${updated.month || ''}-28`,
        month: updated.month,
        description: `Pagamento de ordenado — ${emp?.name || 'Colaborador'} (${updated.month || ''})`,
        amount: Number(updated.netSalary) || 0,
        taxMode: (Number(updated.offPayroll) || 0) > 0 ? 'misto' : 'recibo_ss',
        employeeId: updated.employeeId,
        notes: updated.notes || '',
      });
    } else {
      this._syncLocalCashOrigin('recibo_vencimento', updated.id, null);
    }
    this._notify();
    return this._syncMutation(
      `/api/erp/payslips/${encodeURIComponent(id)}`,
      'PUT',
      updated,
      'Erro ao atualizar vencimento na base de dados.'
    );
  }

  deletePayslip(id) {
    this.state.payslips = this.state.payslips.filter((p) => p.id !== id);
    this._syncLocalCashOrigin('recibo_vencimento', id, null);
    this._notify();
    return this._syncMutation(
      `/api/erp/payslips/${encodeURIComponent(id)}`,
      'DELETE',
      null,
      'Erro ao eliminar vencimento na base de dados.'
    );
  }

  /* ── Recibos Anexados (Arquivo Privado na Nuvem) ── */
  addAttachedReceipt(receipt) {
    if (!Array.isArray(this.state.attachedReceipts)) {
      this.state.attachedReceipts = [];
    }
    this.state.attachedReceipts.unshift(receipt);
    this._notify();

    const pending = pendingAttachmentPayloads.get(receipt.id);
    pendingAttachmentPayloads.delete(receipt.id);

    return this._syncMutation(
      '/api/erp/attachments',
      'POST',
      {
        ...receipt,
        fileBase64: pending?.base64 || '',
      },
      'Erro ao enviar o recibo anexo para o servidor.'
    );
  }

  deleteAttachedReceipt(id) {
    this.state.attachedReceipts = (this.state.attachedReceipts || []).filter((r) => r.id !== id);
    this._notify();
    return this._syncMutation(
      `/api/erp/attachments/${encodeURIComponent(id)}`,
      'DELETE',
      null,
      'Erro ao remover ficheiro anexo do servidor.'
    );
  }

  /* ── Obras / Projetos ── */
  addProject(project) {
    this.state.projects.unshift(project);
    this._notify();
    return this._syncMutation('/api/erp/projects', 'POST', project, 'Erro ao guardar obra na base de dados.');
  }

  updateProject(id, patch) {
    const idx = this.state.projects.findIndex((p) => p.id === id);
    if (idx === -1) return Promise.resolve(null);
    const current = this.state.projects[idx];
    const updated = { ...current, ...patch };
    this.state.projects[idx] = updated;
    if (Array.isArray(updated.payments)) {
      updated.payments.forEach((pay) => {
        if (pay.status === 'pago' && (Number(pay.amount) || 0) > 0) {
          const dt = pay.paidDate || pay.dueDate || '';
          this._syncLocalCashOrigin('recebimento_obra', pay.id, {
            id: `CX-PAG-${pay.id}`,
            type: 'entrada',
            category: 'Recebimento de Obra',
            date: dt,
            month: String(dt).slice(0, 7),
            description: `Recebimento (${updated.code || 'Obra'}) — ${pay.description || updated.name || 'Prestação'}`,
            amount: Number(pay.amount) || 0,
            taxMode: 'receita',
            projectId: updated.code || updated.id,
            notes: pay.method || 'Transferência Bancária',
          });
        } else {
          this._syncLocalCashOrigin('recebimento_obra', pay.id, null);
        }
      });
    }
    this._notify();

    const patchKeys = Object.keys(patch || {});
    const isPaymentsOnly = patchKeys.length === 1 && patchKeys[0] === 'payments';
    const body = isPaymentsOnly ? { code: current.code || id, payments: patch.payments } : updated;

    return this._syncMutation(
      `/api/erp/projects/${encodeURIComponent(current.code || id)}`,
      'PUT',
      body,
      'Erro ao atualizar obra na base de dados.'
    );
  }

  deleteProject(id) {
    const target = this.state.projects.find((p) => p.id === id);
    const code = target?.code || id;
    this.state.projects = this.state.projects.filter((p) => p.id !== id);
    this.state.projectInvoices = (this.state.projectInvoices || []).filter(
      (inv) => inv.projectId !== id && inv.projectId !== code
    );
    this.state.projectContracts = (this.state.projectContracts || []).filter(
      (ctr) => ctr.projectId !== id && ctr.projectId !== code
    );
    this._notify();
    this._syncMutation(
      `/api/erp/projects/${encodeURIComponent(code)}`,
      'DELETE',
      null,
      'Erro ao excluir obra na base de dados.'
    );
  }

  /* ── Faturas de Compra & Materiais por Obra ── */
  addProjectInvoice(invoice) {
    if (!Array.isArray(this.state.projectInvoices)) {
      this.state.projectInvoices = [];
    }
    this.state.projectInvoices.unshift(invoice);
    this._syncLocalCashOrigin('fatura_obra', invoice.id, {
      id: `CX-FAT-${invoice.id}`,
      type: 'saida',
      category: 'Fatura de Obra / Materiais',
      date: invoice.invoiceDate || invoice.createdAt || '',
      month: String(invoice.invoiceDate || invoice.createdAt || '').slice(0, 7),
      description: `Fatura #${invoice.invoiceNumber || invoice.id} — ${invoice.supplier || 'Fornecedor'}`,
      amount: Number(invoice.amount) || 0,
      taxMode: 'fatura',
      projectId: invoice.projectId || '',
      notes: invoice.category || 'Materiais de Construção',
    });
    this._notify();

    const pending = pendingInvoicePayloads.get(invoice.id);
    pendingInvoicePayloads.delete(invoice.id);

    return this._syncMutation(
      '/api/erp/project-invoices',
      'POST',
      {
        ...invoice,
        fileBase64: pending?.base64 || '',
        fileName: pending?.name || invoice.fileName || '',
        fileType: pending?.type || invoice.fileType || '',
        fileSize: pending?.size || invoice.fileSize || 0,
      },
      'Erro ao registar a fatura da obra na base de dados.'
    );
  }

  deleteProjectInvoice(id) {
    this.state.projectInvoices = (this.state.projectInvoices || []).filter((inv) => inv.id !== id);
    this._syncLocalCashOrigin('fatura_obra', id, null);
    this._notify();
    this._syncMutation(
      `/api/erp/project-invoices/${encodeURIComponent(id)}`,
      'DELETE',
      null,
      'Erro ao eliminar a fatura da base de dados.'
    );
  }

  /* ── Contratos da Obra (PDF) ── */
  addProjectContract(contract) {
    if (!Array.isArray(this.state.projectContracts)) {
      this.state.projectContracts = [];
    }
    this.state.projectContracts.unshift(contract);
    this._notify();

    const pending = pendingContractPayloads.get(contract.id);
    pendingContractPayloads.delete(contract.id);

    return this._syncMutation(
      '/api/erp/project-contracts',
      'POST',
      {
        ...contract,
        fileBase64: pending?.base64 || '',
        fileName: pending?.name || contract.fileName || '',
        fileType: pending?.type || contract.fileType || '',
        fileSize: pending?.size || contract.fileSize || 0,
      },
      'Erro ao registar o contrato da obra na base de dados.'
    );
  }

  deleteProjectContract(id) {
    this.state.projectContracts = (this.state.projectContracts || []).filter((c) => c.id !== id);
    this._notify();
    this._syncMutation(
      `/api/erp/project-contracts/${encodeURIComponent(id)}`,
      'DELETE',
      null,
      'Erro ao eliminar o contrato da base de dados.'
    );
  }

  /* ── Responsáveis Técnicos & Certificados PDF ── */
  addTechnicalManager(manager) {
    if (!Array.isArray(this.state.technicalManagers)) {
      this.state.technicalManagers = [];
    }
    this.state.technicalManagers.unshift(manager);
    this._notify();
    return this._syncMutation(
      '/api/erp/technical-managers',
      'POST',
      manager,
      'Erro ao guardar responsável técnico na base de dados.'
    );
  }

  updateTechnicalManager(id, patch) {
    const idx = (this.state.technicalManagers || []).findIndex((m) => m.id === id);
    if (idx === -1) return Promise.resolve(null);
    const current = this.state.technicalManagers[idx];
    const updated = { ...current, ...patch };
    this.state.technicalManagers[idx] = updated;
    this._notify();
    return this._syncMutation(
      `/api/erp/technical-managers/${encodeURIComponent(current.code || id)}`,
      'PUT',
      updated,
      'Erro ao atualizar responsável técnico na base de dados.'
    );
  }

  deleteTechnicalManager(id) {
    const target = (this.state.technicalManagers || []).find((m) => m.id === id);
    const code = target?.code || id;
    this.state.technicalManagers = (this.state.technicalManagers || []).filter((m) => m.id !== id);
    this.state.technicalCertificates = (this.state.technicalCertificates || []).filter(
      (c) => c.managerId !== id && c.managerId !== code
    );
    this._notify();
    this._syncMutation(
      `/api/erp/technical-managers/${encodeURIComponent(code)}`,
      'DELETE',
      null,
      'Erro ao remover responsável técnico da base de dados.'
    );
  }

  addTechnicalCertificate(cert) {
    if (!Array.isArray(this.state.technicalCertificates)) {
      this.state.technicalCertificates = [];
    }
    this.state.technicalCertificates.unshift(cert);
    this._notify();

    const pending = pendingCertificatePayloads.get(cert.id);
    pendingCertificatePayloads.delete(cert.id);

    return this._syncMutation(
      '/api/erp/technical-certificates',
      'POST',
      {
        ...cert,
        fileBase64: pending?.base64 || '',
        fileName: pending?.name || cert.fileName || '',
        fileType: pending?.type || cert.fileType || '',
        fileSize: pending?.size || cert.fileSize || 0,
      },
      'Erro ao anexar certificado técnico na base de dados.'
    );
  }

  deleteTechnicalCertificate(id) {
    this.state.technicalCertificates = (this.state.technicalCertificates || []).filter((c) => c.id !== id);
    this._notify();
    this._syncMutation(
      `/api/erp/technical-certificates/${encodeURIComponent(id)}`,
      'DELETE',
      null,
      'Erro ao eliminar o certificado da base de dados.'
    );
  }
}

export const store = new ErpStore();
