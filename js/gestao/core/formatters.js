/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Formatters & Validators (PT-PT)
   ═══════════════════════════════════════════════════════════ */

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const ERP_PRIVACY_MASK_KEY = 'spark_erp_values_masked';

export function isValuesMasked() {
  try {
    return window.localStorage.getItem(ERP_PRIVACY_MASK_KEY) === '1';
  } catch {
    return false;
  }
}

export function setValuesMasked(masked) {
  try {
    window.localStorage.setItem(ERP_PRIVACY_MASK_KEY, masked ? '1' : '0');
  } catch {
    // Ignore storage error
  }
  if (masked) {
    document.documentElement.setAttribute('data-erp-values-masked', 'true');
  } else {
    document.documentElement.removeAttribute('data-erp-values-masked');
  }
}

export function formatCurrency(amount) {
  if (isValuesMasked()) {
    return '•••• €';
  }
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
  }).format(num);
}

export function formatEuroInputValue(amount) {
  const n = Math.max(0, Number(amount) || 0);
  const cents = Math.round(n * 100);
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = String(cents % 100).padStart(2, '0');
  return `€ ${whole},${dec}`;
}

export function parseCurrencyInput(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  const raw = String(value || '').trim();
  if (!raw) return 0;

  // Formato com máscara europeia (ex.: "€ 100.000,50" ou "2.000,00")
  if (raw.includes(',')) {
    const normalized = raw.replace(/[^0-9,-]/g, '').replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Formato simples numérico ou decimal com ponto (ex.: "1500.50")
  const clean = raw.replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDatePT(isoDate) {
  if (!isoDate) return '—';
  const parts = String(isoDate).split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatMonthLabel(yearMonth) {
  if (!yearMonth) return '';
  const [y, m] = yearMonth.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, 1);
  const formatted = new Intl.DateTimeFormat('pt-PT', {
    month: 'long',
    year: 'numeric',
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function getInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'SS';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentYearMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getDaysInMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function getWeekdayShortPT(yearMonth, day) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1, day);
  return d.getDay(); // 0 = Dom, 6 = Sab
}

export function isValidNIF(nif) {
  const clean = String(nif || '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(clean)) return false;
  const first = Number(clean[0]);
  if (![1, 2, 3, 5, 6, 8, 9].includes(first)) return false;
  let total = 0;
  for (let i = 0; i < 8; i += 1) {
    total += Number(clean[i]) * (9 - i);
  }
  const mod = total % 11;
  const check = mod < 2 ? 0 : 11 - mod;
  return check === Number(clean[8]);
}

export function generateId(prefix) {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix}-${ts}${rand}`;
}

export function downloadCSV(filename, headers, rows) {
  const sep = ';';
  const escapeCell = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const lines = [
    headers.map(escapeCell).join(sep),
    ...rows.map((r) => r.map(escapeCell).join(sep)),
  ];
  const bom = '\uFEFF';
  const blob = new window.Blob([bom + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export function computeBudgetTotals(budget) {
  const items = Array.isArray(budget?.items) ? budget.items : [];
  const subtotal = items.reduce(
    (sum, item) => sum + (Number(item.qty) || 0) * (Number(item.unitPrice) || 0),
    0
  );
  const contingencyPct = Number(budget?.contingencyPct) || 0;
  const contingencyVal = subtotal * (contingencyPct / 100);
  const netTotal = subtotal + contingencyVal;
  const vatRate = Number(budget?.vatRate ?? 23);
  const vatVal = netTotal * (vatRate / 100);
  const grossTotal = netTotal + vatVal;
  return { subtotal, contingencyVal, netTotal, vatRate, vatVal, grossTotal };
}

export function computeProjectFinancials(project) {
  const totals = computeBudgetTotals(project.budget);
  const payments = Array.isArray(project.payments) ? project.payments : [];
  const today = todayISO();

  let paidAmount = 0;
  let openAmount = 0;
  let overdueCount = 0;
  let nextDueDate = null;

  payments.forEach((p) => {
    const val = Number(p.amount) || 0;
    if (p.status === 'pago') {
      paidAmount += val;
    } else {
      openAmount += val;
      if (p.dueDate && p.dueDate < today) {
        overdueCount += 1;
      }
      if (p.dueDate && (!nextDueDate || p.dueDate < nextDueDate)) {
        nextDueDate = p.dueDate;
      }
    }
  });

  // Se houver orçamento maior que as parcelas lançadas ou sem parcelas, refletir o valor contratual
  const contractTotal = totals.grossTotal > 0 ? totals.grossTotal : paidAmount + openAmount;
  const balanceOpen = Math.max(0, contractTotal - paidAmount);
  const paidPct = contractTotal > 0 ? Math.min(100, Math.round((paidAmount / contractTotal) * 100)) : 0;

  return {
    ...totals,
    contractTotal,
    paidAmount,
    scheduledOpen: openAmount,
    balanceOpen,
    paidPct,
    overdueCount,
    nextDueDate,
  };
}

export function computeProjectInvoiceSummary(project, projectInvoices = []) {
  const fin = computeProjectFinancials(project || {});
  const manualCap = Math.max(0, Number(project?.manualBudgetCap) || 0);
  const budgetTotal = manualCap > 0 ? manualCap : fin.contractTotal;

  const projRefSet = new Set([project?.id, project?.code].filter(Boolean));
  const invoices = (Array.isArray(projectInvoices) ? projectInvoices : []).filter((inv) =>
    projRefSet.has(inv.projectId)
  );

  const spentOnInvoices = invoices.reduce((sum, inv) => sum + Math.max(0, Number(inv.amount) || 0), 0);
  const remainingBudget = budgetTotal - spentOnInvoices;
  const spentPct = budgetTotal > 0 ? Math.round((spentOnInvoices / budgetTotal) * 100) : 0;
  const isOverBudget = budgetTotal > 0 && remainingBudget < -0.009;
  const isWarningBudget = budgetTotal > 0 && !isOverBudget && spentPct >= 80;

  return {
    invoices,
    invoiceCount: invoices.length,
    budgetTotal,
    isManualCap: manualCap > 0,
    spentOnInvoices,
    remainingBudget,
    spentPct,
    isOverBudget,
    isWarningBudget,
  };
}

export function computeEmployeeMonthlyPayroll(employee, attendanceMap = {}, employeeAdvances = [], yearMonth = currentYearMonth()) {
  const empAtt = attendanceMap[employee?.id] || {};
  const daysCount = getDaysInMonth(yearMonth);
  let workingDays = 0;
  let present = 0;
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

  const remType = ['diaria', 'hora', 'mensal'].includes(employee?.remunerationType)
    ? employee.remunerationType
    : 'mensal';
  const dailyRate = Number(employee?.dailyRate) || 0;
  const hourlyRate = Number(employee?.hourlyRate) || 0;
  const baseSalaryFixed = Number(employee?.baseSalary) || 0;

  let earnedBase = baseSalaryFixed;
  if (remType === 'diaria') {
    earnedBase = present * dailyRate;
  } else if (remType === 'hora') {
    earnedBase = totalHours * hourlyRate;
  }

  const mealEarned = present * (Number(employee?.mealAllowance) || 0);
  const grossPay = earnedBase + mealEarned;
  const ssPercentage =
    employee?.ssPercentage !== undefined && employee?.ssPercentage !== null && employee?.ssPercentage !== ''
      ? Math.min(100, Math.max(0, Number(employee.ssPercentage) || 0))
      : 11;
  const ssDeduction = Number((earnedBase * (ssPercentage / 100)).toFixed(2));

  const monthAdvances = (Array.isArray(employeeAdvances) ? employeeAdvances : []).filter(
    (adv) => adv.employeeId === employee?.id && String(adv.month || adv.date || '').slice(0, 7) === yearMonth
  );
  const advancesTotal = monthAdvances.reduce((sum, adv) => sum + (Number(adv.amount) || 0), 0);
  const rawNetPay = grossPay - ssDeduction - advancesTotal;
  const netToPay = Math.max(0, Number(rawNetPay.toFixed(2)));

  return {
    workingDays,
    present,
    totalHours,
    justified,
    unjustified,
    vacation,
    totalAbsences,
    attendanceRate,
    remunerationType: remType,
    dailyRate,
    hourlyRate,
    baseSalaryFixed,
    earnedBase: Number(earnedBase.toFixed(2)),
    mealEarned: Number(mealEarned.toFixed(2)),
    grossPay: Number(grossPay.toFixed(2)),
    ssPercentage,
    ssDeduction,
    monthAdvances,
    advancesTotal: Number(advancesTotal.toFixed(2)),
    rawNetPay: Number(rawNetPay.toFixed(2)),
    netToPay,
  };
}
