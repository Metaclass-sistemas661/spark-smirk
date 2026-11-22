/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Cloud-Synced Store (PostgreSQL + Storage)
   Sem dados sensíveis em localStorage; sincronizado ao vivo com
   a base de dados central e armazenamento privado de anexos.
   ═══════════════════════════════════════════════════════════ */

import { authenticatedApiFetch } from '../../shared/supabase-client.js';
import { createSeedData } from '../data/seed.js';
import { showToast } from './ui.js';

const pendingAttachmentPayloads = new Map();

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

const EMPTY_STATE = {
  employees: [],
  attendance: {},
  payslips: [],
  attachedReceipts: [],
  projects: [],
};

class ErpStore {
  constructor() {
    this.state = { ...EMPTY_STATE };
    this.listeners = new Set();
    this.initialized = false;
  }

  async init(profile = null) {
    try {
      // Remove qualquer cache antigo legado em localStorage por segurança
      window.localStorage.removeItem('spark_smirk_erp_v1');
    } catch {
      // Ignore storage cleanup
    }

    const snapshot = await authenticatedApiFetch('/api/erp/bootstrap', { method: 'GET' });
    this.state = this._normalizeSnapshot(snapshot);
    this.initialized = true;

    // Seed inicial automático uma única vez se a base estiver completamente vazia e o utilizador for admin
    const isCompletelyEmpty =
      this.state.employees.length === 0 &&
      this.state.projects.length === 0 &&
      this.state.payslips.length === 0;
    const isAdminEditor = profile?.permissoes?.admin_utilizadores?.editar === true;

    if (isCompletelyEmpty && isAdminEditor) {
      const seedKey = 'spark_erp_initial_seed_checked';
      const alreadyChecked = window.sessionStorage.getItem(seedKey) === '1';
      if (!alreadyChecked) {
        window.sessionStorage.setItem(seedKey, '1');
        try {
          const seeded = await authenticatedApiFetch('/api/erp/bootstrap-seed', {
            method: 'POST',
            body: createSeedData(),
          });
          this.state = this._normalizeSnapshot(seeded);
        } catch {
          // Segue com estado vazio se não aplicável
        }
      }
    }

    this._notify();
    return this.state;
  }

  _normalizeSnapshot(snapshot) {
    return {
      employees: Array.isArray(snapshot?.employees) ? snapshot.employees : [],
      attendance: snapshot?.attendance && typeof snapshot.attendance === 'object' ? snapshot.attendance : {},
      payslips: Array.isArray(snapshot?.payslips) ? snapshot.payslips : [],
      attachedReceipts: Array.isArray(snapshot?.attachedReceipts) ? snapshot.attachedReceipts : [],
      projects: Array.isArray(snapshot?.projects) ? snapshot.projects : [],
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

  async resetDemo() {
    const seeded = await this._syncMutation(
      '/api/erp/bootstrap-seed',
      'POST',
      createSeedData(),
      'Erro ao repor dados de demonstração na base de dados.'
    );
    if (seeded) {
      this.state = this._normalizeSnapshot(seeded);
      this._notify();
      showToast('Dados de demonstração gravados na base de dados.');
    }
  }

  /* ── Funcionários ── */
  addEmployee(emp) {
    this.state.employees.unshift(emp);
    this._notify();
    this._syncMutation('/api/erp/employees', 'POST', emp, 'Erro ao guardar funcionário na base de dados.');
  }

  updateEmployee(id, patch) {
    const idx = this.state.employees.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const updated = { ...this.state.employees[idx], ...patch };
    this.state.employees[idx] = updated;
    this._notify();
    this._syncMutation(
      `/api/erp/employees/${encodeURIComponent(id)}`,
      'PUT',
      updated,
      'Erro ao atualizar funcionário na base de dados.'
    );
  }

  deleteEmployee(id) {
    this.state.employees = this.state.employees.filter((e) => e.id !== id);
    delete this.state.attendance[id];
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

  /* ── Presenças e Faltas ── */
  setAttendance(employeeId, dateISO, status, note = '') {
    if (!this.state.attendance[employeeId]) {
      this.state.attendance[employeeId] = {};
    }
    if (!status) {
      delete this.state.attendance[employeeId][dateISO];
    } else {
      this.state.attendance[employeeId][dateISO] = { status, note };
    }
    this._notify();
    this._syncMutation(
      '/api/erp/attendance',
      'PUT',
      { employeeId, dateISO, status: status || '', note },
      'Erro ao guardar assiduidade na base de dados.'
    );
  }

  markAllPresent(dateISO) {
    this.state.employees
      .filter((e) => e.status === 'ativo')
      .forEach((emp) => {
        if (!this.state.attendance[emp.id]) {
          this.state.attendance[emp.id] = {};
        }
        if (!this.state.attendance[emp.id][dateISO]) {
          this.state.attendance[emp.id][dateISO] = { status: 'P', note: '' };
        }
      });
    this._notify();
    this._syncMutation(
      '/api/erp/attendance',
      'PUT',
      { action: 'mark_all_present', dateISO },
      'Erro ao registar presenças em lote na base de dados.'
    );
  }

  /* ── Recibos de Vencimento ── */
  addPayslip(payslip) {
    this.state.payslips.unshift(payslip);
    this._notify();
    this._syncMutation('/api/erp/payslips', 'POST', payslip, 'Erro ao guardar vencimento na base de dados.');
  }

  updatePayslip(id, patch) {
    const idx = this.state.payslips.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const updated = { ...this.state.payslips[idx], ...patch };
    this.state.payslips[idx] = updated;
    this._notify();
    this._syncMutation(
      `/api/erp/payslips/${encodeURIComponent(id)}`,
      'PUT',
      updated,
      'Erro ao atualizar vencimento na base de dados.'
    );
  }

  deletePayslip(id) {
    this.state.payslips = this.state.payslips.filter((p) => p.id !== id);
    this._notify();
    this._syncMutation(
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

    this._syncMutation(
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
    this._syncMutation(
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
    this._syncMutation('/api/erp/projects', 'POST', project, 'Erro ao guardar obra na base de dados.');
  }

  updateProject(id, patch) {
    const idx = this.state.projects.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const current = this.state.projects[idx];
    const updated = { ...current, ...patch };
    this.state.projects[idx] = updated;
    this._notify();

    const patchKeys = Object.keys(patch || {});
    const isPaymentsOnly = patchKeys.length === 1 && patchKeys[0] === 'payments';
    const body = isPaymentsOnly ? { code: current.code || id, payments: patch.payments } : updated;

    this._syncMutation(
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
    this._notify();
    this._syncMutation(
      `/api/erp/projects/${encodeURIComponent(code)}`,
      'DELETE',
      null,
      'Erro ao excluir obra na base de dados.'
    );
  }
}

export const store = new ErpStore();
