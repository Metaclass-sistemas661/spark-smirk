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

export const TWELFTHS_OPTIONS = [
  {
    value: 'Não',
    label: 'Não (Pagamento integral — Junho e Novembro)',
    shortLabel: 'Sem duodécimos',
  },
  {
    value: 'ferias',
    label: 'Só Subsídio de Férias em duodécimos (1/12 = +8,33%/mês)',
    shortLabel: 'Duod. Férias (1/12)',
  },
  {
    value: 'natal',
    label: 'Só Subsídio de Natal em duodécimos (1/12 = +8,33%/mês)',
    shortLabel: 'Duod. Natal (1/12)',
  },
  {
    value: 'ambos_100',
    label: 'Férias + Natal a 100% em duodécimos (2/12 = +16,67%/mês)',
    shortLabel: 'Férias + Natal (100%)',
  },
  {
    value: 'ambos_50',
    label: 'Regime misto: 50% Férias + 50% Natal (1/12 = +8,33%/mês)',
    shortLabel: '50% Férias + Natal',
  },
  {
    value: 'personalizado',
    label: 'Valor manual personalizado (€ Férias / € Natal)',
    shortLabel: 'Duodécimos Manuais',
  },
];

export function normalizeTwelfthsMode(rawMode) {
  if (rawMode === 'Sim') return 'ambos_100';
  const valid = ['Não', 'ferias', 'natal', 'ambos_100', 'ambos_50', 'personalizado'];
  return valid.includes(rawMode) ? rawMode : 'Não';
}

export function getTwelfthsOptionMeta(rawMode) {
  const mode = normalizeTwelfthsMode(rawMode);
  return TWELFTHS_OPTIONS.find((opt) => opt.value === mode) || TWELFTHS_OPTIONS[0];
}

export function computeTwelfthsBreakdown(
  earnedBase = 0,
  rawMode = 'Não',
  customVacation = 0,
  customChristmas = 0
) {
  const mode = normalizeTwelfthsMode(rawMode);
  const base = Math.max(0, Number(earnedBase) || 0);
  let twelfthsVacation = 0;
  let twelfthsChristmas = 0;

  if (mode === 'ferias') {
    twelfthsVacation = base / 12;
  } else if (mode === 'natal') {
    twelfthsChristmas = base / 12;
  } else if (mode === 'ambos_100') {
    twelfthsVacation = base / 12;
    twelfthsChristmas = base / 12;
  } else if (mode === 'ambos_50') {
    twelfthsVacation = base / 24;
    twelfthsChristmas = base / 24;
  } else if (mode === 'personalizado') {
    twelfthsVacation = Math.max(0, Number(customVacation) || 0);
    twelfthsChristmas = Math.max(0, Number(customChristmas) || 0);
  }

  const vac = Number(twelfthsVacation.toFixed(2));
  const xmas = Number(twelfthsChristmas.toFixed(2));
  return {
    twelfthsMode: mode,
    twelfthsVacation: vac,
    twelfthsChristmas: xmas,
    twelfthsTotal: Number((vac + xmas).toFixed(2)),
  };
}

export function computeEmployeeMonthlyPayroll(
  employee,
  attendanceMap = {},
  employeeAdvances = [],
  yearMonth = currentYearMonth()
) {
  const empAtt = attendanceMap[employee?.id] || {};
  const daysCount = getDaysInMonth(yearMonth);
  let workingDays = 0;
  let present = 0;
  let weekdayPresent = 0;
  let weekdayHours = 0;
  let totalHours = 0;
  let justified = 0;
  let unjustified = 0;
  let vacation = 0;
  let saturdayCount = 0;
  let saturdayReceiptTotal = 0;
  let saturdayOffTotal = 0;
  const saturdayDetails = [];

  for (let d = 1; d <= daysCount; d += 1) {
    const wd = getWeekdayShortPT(yearMonth, d);
    const isSat = wd === 6;
    if (wd !== 0 && !isSat) workingDays += 1;
    const dateISO = `${yearMonth}-${String(d).padStart(2, '0')}`;
    const rec = empAtt[dateISO];
    if (!rec) continue;
    if (rec.status === 'P') {
      present += 1;
      const hrs = Number(rec.hours) > 0 ? Number(rec.hours) : 8;
      totalHours += hrs;
      if (isSat) {
        saturdayCount += 1;
        const satBonus = Math.max(0, Number(rec.saturdayBonus) || 0);
        const satMode = rec.saturdayTaxMode === 'recibo_ss' ? 'recibo_ss' : 'por_fora';
        if (satMode === 'recibo_ss') {
          saturdayReceiptTotal += satBonus;
        } else {
          saturdayOffTotal += satBonus;
        }
        saturdayDetails.push({
          date: dateISO,
          hours: hrs,
          saturdayBonus: Number(satBonus.toFixed(2)),
          saturdayTaxMode: satMode,
          note: rec.note || '',
        });
      } else {
        weekdayPresent += 1;
        weekdayHours += hrs;
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

  const remType = ['diaria', 'hora', 'mensal'].includes(employee?.remunerationType)
    ? employee.remunerationType
    : 'mensal';
  const dailyRate = Math.max(0, Number(employee?.dailyRate) || 0);
  const hourlyRate = Math.max(0, Number(employee?.hourlyRate) || 0);
  const baseSalaryFixed = Math.max(0, Number(employee?.baseSalary) || 0);

  // Seg–Sex usa a modalidade base; Sábados pagos utilizam o valor específico registado nesse sábado.
  let earnedBase = baseSalaryFixed;
  if (remType === 'diaria') {
    earnedBase = weekdayPresent * dailyRate;
  } else if (remType === 'hora') {
    earnedBase = weekdayHours * hourlyRate;
  }

  const mealPerDay = Math.max(0, Number(employee?.mealAllowance) || 0);
  const mealEarned = remType === 'diaria' || remType === 'hora' ? weekdayPresent * mealPerDay : 0;

  const {
    twelfthsMode,
    twelfthsVacation,
    twelfthsChristmas,
    twelfthsTotal,
  } = computeTwelfthsBreakdown(
    earnedBase,
    employee?.twelfths,
    employee?.twelfthsVacationManual,
    employee?.twelfthsChristmasManual
  );

  const rawOffType = ['diaria', 'mensal'].includes(employee?.offPayrollType)
    ? employee.offPayrollType
    : 'mensal';
  const offPayrollType = remType === 'mensal' ? 'mensal' : rawOffType;
  const offPayrollAmount = Math.max(0, Number(employee?.offPayrollAmount) || 0);
  const baseOffPayrollEarned =
    offPayrollType === 'diaria' ? weekdayPresent * offPayrollAmount : offPayrollAmount;
  const satReceiptRounded = Number(saturdayReceiptTotal.toFixed(2));
  const satOffRounded = Number(saturdayOffTotal.toFixed(2));
  const saturdayTotal = Number((satReceiptRounded + satOffRounded).toFixed(2));
  const offPayrollEarned = Number((baseOffPayrollEarned + satOffRounded).toFixed(2));

  const grossPay = Number((earnedBase + satReceiptRounded + mealEarned + twelfthsTotal).toFixed(2));
  const ssPercentage =
    employee?.ssPercentage !== undefined && employee?.ssPercentage !== null && employee?.ssPercentage !== ''
      ? Math.min(100, Math.max(0, Number(employee.ssPercentage) || 0))
      : 11;
  // Segurança Social incide sobre vencimento base, sábados em recibo e duodécimos; não incide sobre pagamento por fora.
  const ssSubjectBase = Number((earnedBase + satReceiptRounded + twelfthsTotal).toFixed(2));
  const ssDeduction = Number((ssSubjectBase * (ssPercentage / 100)).toFixed(2));
  const receiptNetPay = Math.max(0, Number((grossPay - ssDeduction).toFixed(2)));
  const totalCombinedGross = Number((grossPay + offPayrollEarned).toFixed(2));

  const monthAdvances = (Array.isArray(employeeAdvances) ? employeeAdvances : []).filter(
    (adv) => adv.employeeId === employee?.id && String(adv.month || adv.date || '').slice(0, 7) === yearMonth
  );
  const advancesTotal = monthAdvances.reduce((sum, adv) => sum + (Number(adv.amount) || 0), 0);
  const rawNetPay = receiptNetPay + offPayrollEarned - advancesTotal;
  const netToPay = Math.max(0, Number(rawNetPay.toFixed(2)));

  return {
    workingDays,
    present,
    weekdayPresent,
    weekdayHours,
    totalHours,
    justified,
    unjustified,
    vacation,
    saturdayCount,
    saturdayReceiptTotal: satReceiptRounded,
    saturdayOffTotal: satOffRounded,
    saturdayTotal,
    saturdayDetails,
    totalAbsences,
    attendanceRate,
    remunerationType: remType,
    dailyRate,
    hourlyRate,
    baseSalaryFixed,
    earnedBase: Number(earnedBase.toFixed(2)),
    mealEarned: Number(mealEarned.toFixed(2)),
    twelfthsMode,
    twelfthsVacation,
    twelfthsChristmas,
    twelfthsTotal,
    grossPay,
    ssPercentage,
    ssDeduction,
    receiptNetPay,
    offPayrollType,
    offPayrollAmount: Number(offPayrollAmount.toFixed(2)),
    baseOffPayrollEarned: Number(baseOffPayrollEarned.toFixed(2)),
    offPayrollEarned,
    totalCombinedGross,
    monthAdvances,
    advancesTotal: Number(advancesTotal.toFixed(2)),
    rawNetPay: Number(rawNetPay.toFixed(2)),
    netToPay,
  };
}

export function buildConsolidatedCashMovements(state = {}) {
  const dbMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  const seenOrigins = new Set(
    dbMovements
      .filter((m) => m.originType && m.originCode)
      .map((m) => `${m.originType}:${m.originCode}`)
  );

  const synthetic = [];
  const empMap = new Map((state.employees || []).map((e) => [e.id, e]));

  (state.payslips || []).forEach((p) => {
    if (p.status !== 'pago' || (Number(p.netSalary) || 0) <= 0) return;
    if (seenOrigins.has(`recibo_vencimento:${p.id}`)) return;
    const emp = empMap.get(p.employeeId);
    const dt = p.paymentDate || `${p.month || currentYearMonth()}-28`;
    synthetic.push({
      id: `CX-REC-${p.id}`,
      type: 'saida',
      category: 'Salários & Ordenados',
      originType: 'recibo_vencimento',
      originCode: p.id,
      date: dt,
      month: p.month || String(dt).slice(0, 7),
      description: `Pagamento de ordenado — ${emp?.name || 'Colaborador'} (${p.month || ''})`,
      amount: Number(p.netSalary) || 0,
      taxMode: (Number(p.offPayroll) || 0) > 0 ? 'misto' : 'recibo_ss',
      projectId: '',
      employeeId: p.employeeId,
      notes: p.notes || '',
    });
  });

  (state.employeeAdvances || []).forEach((adv) => {
    if ((Number(adv.amount) || 0) <= 0) return;
    if (seenOrigins.has(`adiantamento:${adv.id}`)) return;
    const emp = empMap.get(adv.employeeId);
    const dt = adv.date || `${adv.month || currentYearMonth()}-15`;
    synthetic.push({
      id: `CX-ADT-${adv.id}`,
      type: 'saida',
      category: 'Adiantamento / Vale',
      originType: 'adiantamento',
      originCode: adv.id,
      date: dt,
      month: adv.month || String(dt).slice(0, 7),
      description: `Vale / Adiantamento — ${emp?.name || 'Colaborador'}`,
      amount: Number(adv.amount) || 0,
      taxMode: 'adiantamento',
      projectId: '',
      employeeId: adv.employeeId,
      notes: adv.notes || '',
    });
  });

  (state.projectInvoices || []).forEach((inv) => {
    if (seenOrigins.has(`fatura_obra:${inv.id}`)) return;
    const dt = inv.invoiceDate || inv.createdAt || todayISO();
    synthetic.push({
      id: `CX-FAT-${inv.id}`,
      type: 'saida',
      category: 'Fatura de Obra / Materiais',
      originType: 'fatura_obra',
      originCode: inv.id,
      date: dt,
      month: String(dt).slice(0, 7),
      description: `Fatura #${inv.invoiceNumber || inv.id} — ${inv.supplier || 'Fornecedor'}`,
      amount: Number(inv.amount) || 0,
      taxMode: 'fatura',
      projectId: inv.projectId || '',
      employeeId: '',
      notes: inv.category || 'Materiais de Construção',
    });
  });

  (state.projects || []).forEach((proj) => {
    (proj.payments || []).forEach((pay) => {
      if (pay.status !== 'pago' || (Number(pay.amount) || 0) <= 0) return;
      if (seenOrigins.has(`recebimento_obra:${pay.id}`)) return;
      const dt = pay.paidDate || pay.dueDate || todayISO();
      synthetic.push({
        id: `CX-PAG-${pay.id}`,
        type: 'entrada',
        category: 'Recebimento de Obra',
        originType: 'recebimento_obra',
        originCode: pay.id,
        date: dt,
        month: String(dt).slice(0, 7),
        description: `Recebimento (${proj.code || 'Obra'}) — ${pay.description || proj.name || 'Prestação'}`,
        amount: Number(pay.amount) || 0,
        taxMode: 'receita',
        projectId: proj.code || proj.id || '',
        employeeId: '',
        notes: pay.method || 'Transferência Bancária',
      });
    });
  });

  return [...dbMovements, ...synthetic].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );
}

export function computeCompanyCashSummary(state = {}) {
  const openingBalance = Number(state.cashOpeningBalance) || 0;
  const movements = buildConsolidatedCashMovements(state);
  let totalInflows = 0;
  let totalOutflows = 0;
  let salariesOutflow = 0;
  let advancesOutflow = 0;
  let invoicesOutflow = 0;
  let otherOutflow = 0;

  movements.forEach((m) => {
    const val = Number(m.amount) || 0;
    if (m.type === 'entrada') {
      totalInflows += val;
    } else {
      totalOutflows += val;
      if (m.originType === 'recibo_vencimento' || m.category === 'Salários & Ordenados') {
        salariesOutflow += val;
      } else if (m.originType === 'adiantamento' || m.category === 'Adiantamento / Vale') {
        advancesOutflow += val;
      } else if (m.originType === 'fatura_obra' || m.category === 'Fatura de Obra / Materiais') {
        invoicesOutflow += val;
      } else {
        otherOutflow += val;
      }
    }
  });

  return {
    openingBalance: Number(openingBalance.toFixed(2)),
    totalInflows: Number(totalInflows.toFixed(2)),
    totalOutflows: Number(totalOutflows.toFixed(2)),
    salariesOutflow: Number(salariesOutflow.toFixed(2)),
    advancesOutflow: Number(advancesOutflow.toFixed(2)),
    invoicesOutflow: Number(invoicesOutflow.toFixed(2)),
    otherOutflow: Number(otherOutflow.toFixed(2)),
    currentBalance: Number((openingBalance + totalInflows - totalOutflows).toFixed(2)),
    movements,
  };
}
