/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Persistent Store (localStorage + IndexedDB)
   IndexedDB armazena anexos PDF/imagens reais dos recibos
   ═══════════════════════════════════════════════════════════ */

import { createSeedData } from '../data/seed.js';

const STORAGE_KEY = 'spark_smirk_erp_v1';
const IDB_NAME = 'spark_smirk_erp_files';
const IDB_STORE = 'attachments';

function openFileDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB indisponível'));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function saveAttachmentFile(id, file) {
  const db = await openFileDB();
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({
      id,
      name: file.name,
      type: file.type || 'application/pdf',
      size: file.size,
      data: buffer,
      uploadedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve({ id, name: file.name, type: file.type, size: file.size });
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAttachmentFile(id) {
  if (!id) return null;
  const db = await openFileDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAttachmentFile(id) {
  if (!id) return;
  try {
    const db = await openFileDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
  } catch {
    // Ignore cleanup errors
  }
}

class ErpStore {
  constructor() {
    this.state = this._load();
    this.listeners = new Set();
  }

  _load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.employees) && Array.isArray(parsed.projects)) {
          if (!Array.isArray(parsed.attachedReceipts)) {
            parsed.attachedReceipts = [];
          }
          return parsed;
        }
      }
    } catch {
      // Fallback to seed
    }
    const seed = createSeedData();
    this._saveRaw(seed);
    return seed;
  }

  _saveRaw(data) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('Erro ao gravar no localStorage:', err);
    }
  }

  _commit() {
    this._saveRaw(this.state);
    this.listeners.forEach((fn) => fn(this.state));
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState() {
    return this.state;
  }

  resetDemo() {
    this.state = createSeedData();
    this._commit();
  }

  /* ── Funcionários ── */
  addEmployee(emp) {
    this.state.employees.unshift(emp);
    this._commit();
  }

  updateEmployee(id, patch) {
    const idx = this.state.employees.findIndex((e) => e.id === id);
    if (idx === -1) return;
    this.state.employees[idx] = { ...this.state.employees[idx], ...patch };
    this._commit();
  }

  deleteEmployee(id) {
    this.state.employees = this.state.employees.filter((e) => e.id !== id);
    delete this.state.attendance[id];
    this.state.payslips = this.state.payslips.filter((p) => p.employeeId !== id);
    this._commit();
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
    this._commit();
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
    this._commit();
  }

  /* ── Recibos de Vencimento ── */
  addPayslip(payslip) {
    this.state.payslips.unshift(payslip);
    this._commit();
  }

  updatePayslip(id, patch) {
    const idx = this.state.payslips.findIndex((p) => p.id === id);
    if (idx === -1) return;
    this.state.payslips[idx] = { ...this.state.payslips[idx], ...patch };
    this._commit();
  }

  deletePayslip(id) {
    const found = this.state.payslips.find((p) => p.id === id);
    if (found?.attachment?.id) {
      deleteAttachmentFile(found.attachment.id);
    }
    this.state.payslips = this.state.payslips.filter((p) => p.id !== id);
    this._commit();
  }

  /* ── Recibos Anexados (Arquivo Anual por Funcionário/Mês) ── */
  addAttachedReceipt(receipt) {
    if (!Array.isArray(this.state.attachedReceipts)) {
      this.state.attachedReceipts = [];
    }
    this.state.attachedReceipts.unshift(receipt);
    this._commit();
  }

  deleteAttachedReceipt(id) {
    deleteAttachmentFile(id);
    this.state.attachedReceipts = (this.state.attachedReceipts || []).filter((r) => r.id !== id);
    this._commit();
  }

  /* ── Obras / Projetos ── */
  addProject(project) {
    this.state.projects.unshift(project);
    this._commit();
  }

  updateProject(id, patch) {
    const idx = this.state.projects.findIndex((p) => p.id === id);
    if (idx === -1) return;
    this.state.projects[idx] = { ...this.state.projects[idx], ...patch };
    this._commit();
  }

  deleteProject(id) {
    this.state.projects = this.state.projects.filter((p) => p.id !== id);
    this._commit();
  }
}

export const store = new ErpStore();
