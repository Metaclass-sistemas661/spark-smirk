/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK ERP — Gerador de Relatório PDF Personalizado
   Identidade visual Spark & Smirk (Navy + Orange + Logótipo)
   ═══════════════════════════════════════════════════════════ */

import { formatDatePT, todayISO } from './formatters.js';

function euro(val) {
  const num = Number(val) || 0;
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
  }).format(num);
}

let cachedLogoPromise = null;

function loadBrandLogoDataUrl() {
  if (cachedLogoPromise) return cachedLogoPromise;
  cachedLogoPromise = new Promise((resolve) => {
    try {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 128;
          canvas.height = img.naturalHeight || 128;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = '/logotipo.jpeg';
    } catch {
      resolve(null);
    }
  });
  return cachedLogoPromise;
}

export async function generateSparkReportPdf({
  title = 'Relatório Executivo Mensal & Tesouraria',
  periodLabel = '',
  filterSummary = 'Todos os colaboradores, obras e movimentos',
  operatorName = 'Gestão Interna',
  kpis = {},
  sections = {
    rh: true,
    cash: true,
    projects: true,
    advances: true,
  },
  rhRows = [],
  cashRows = [],
  invoiceRows = [],
  inflowRows = [],
  advanceRows = [],
  filename = `Spark-Smirk-Relatorio-${todayISO()}.pdf`,
} = {}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;
  const logoData = await loadBrandLogoDataUrl();

  const NAVY = [12, 24, 41];
  const NAVY_ALT = [20, 34, 54];
  const ORANGE = [232, 101, 10];
  const TEXT_DARK = [17, 24, 39];
  const TEXT_MUTED = [100, 116, 139];
  const BG_LIGHT = [248, 250, 252];
  const GREEN = [5, 150, 105];
  const RED = [220, 38, 38];

  // Header Banner (Página 1)
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, 38, 'F');
  doc.setFillColor(...ORANGE);
  doc.rect(0, 38, pageW, 1.8, 'F');

  if (logoData) {
    try {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, 7, 24, 24, 3, 3, 'F');
      doc.addImage(logoData, 'JPEG', margin + 1, 8, 22, 22);
    } catch {
      // fallback ignorado
    }
  }

  const titleX = logoData ? margin + 29 : margin;
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14.5);
  doc.text('SPARK & SMIRK, LDA.', titleX, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(226, 232, 240);
  doc.text('Engenharia, Construção Civil, Reabilitação e Espaços Verdes', titleX, 19.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(251, 146, 60);
  doc.text(String(title).slice(0, 72), titleX, 27);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(`Período: ${periodLabel || 'Global'} · Emitido em ${formatDatePT(todayISO())} por ${operatorName}`, titleX, 33);

  let cursorY = 46;

  // Filter Scope Strip
  doc.setFillColor(...BG_LIGHT);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, cursorY, contentW, 10, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...NAVY);
  doc.text('ÂMBITO & FILTROS APLICADOS:', margin + 3, cursorY + 4.2);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_MUTED);
  doc.text(String(filterSummary).slice(0, 125), margin + 3, cursorY + 8.2);
  cursorY += 14;

  // KPI Grid (3 columns x 2 rows)
  const kpiCards = [
    {
      label: 'SALDO ATUAL EM CAIXA',
      value: euro(kpis.cashBalance || 0),
      sub: `Inicial ${euro(kpis.openingBalance || 0)} + Entradas - Saídas`,
      color: (Number(kpis.cashBalance) || 0) >= 0 ? GREEN : RED,
    },
    {
      label: 'ENTRADAS NO PERÍODO',
      value: `+ ${euro(kpis.periodInflows || 0)}`,
      sub: `${kpis.inflowsCount || 0} recebimento(s) / aporte(s)`,
      color: GREEN,
    },
    {
      label: 'PAGAMENTOS A FUNCIONÁRIOS',
      value: `- ${euro(kpis.periodPayrollTotal || 0)}`,
      sub: `Líquido RH ${euro(kpis.periodSalaries || 0)} · Vales ${euro(kpis.periodAdvances || 0)}`,
      color: RED,
    },
    {
      label: 'TRABALHO AOS SÁBADOS',
      value: `${kpis.saturdayCount || 0} sáb. (${euro(kpis.saturdayTotal || 0)})`,
      sub: `Recibo SS: ${euro(kpis.saturdayReceiptTotal || 0)} · Por Fora: ${euro(kpis.saturdayOffTotal || 0)}`,
      color: ORANGE,
    },
    {
      label: 'SAÍDAS FATURAS / MATERIAIS',
      value: `- ${euro(kpis.periodInvoices || 0)}`,
      sub: `${kpis.invoicesCount || 0} fatura(s) registada(s)`,
      color: RED,
    },
    {
      label: 'BALANÇO LÍQUIDO DO PERÍODO',
      value: euro(kpis.periodNetResult || 0),
      sub: `Total Entradas - Todas as Saídas (${euro(kpis.periodOutflows || 0)})`,
      color: (Number(kpis.periodNetResult) || 0) >= 0 ? GREEN : RED,
    },
  ];

  const cardGap = 3.5;
  const cardW = (contentW - cardGap * 2) / 3;
  const cardH = 19;

  kpiCards.forEach((c, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = margin + col * (cardW + cardGap);
    const y = cursorY + row * (cardH + 3);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(220, 226, 234);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');

    doc.setFillColor(...c.color);
    doc.rect(x, y, 1.5, cardH, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(c.label, x + 3.8, y + 5.2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...c.color);
    doc.text(c.value, x + 3.8, y + 11.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(String(c.sub).slice(0, 44), x + 3.8, y + 16.5);
  });

  cursorY += cardH * 2 + 10;

  const ensureSpace = (minNeeded = 32) => {
    if (cursorY + minNeeded > pageH - 18) {
      doc.addPage();
      cursorY = 16;
    }
  };

  const drawSectionHeading = (secTitle, badgeText) => {
    ensureSpace(26);
    doc.setFillColor(...NAVY_ALT);
    doc.roundedRect(margin, cursorY, contentW, 7.5, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(secTitle, margin + 3.5, cursorY + 5);
    if (badgeText) {
      doc.setFontSize(7.5);
      doc.setTextColor(251, 146, 60);
      doc.text(badgeText, pageW - margin - 3.5, cursorY + 5, { align: 'right' });
    }
    cursorY += 9.5;
  };

  // Section 1: RH & Sábados
  if (sections.rh) {
    drawSectionHeading('1. RESUMO DE RECURSOS HUMANOS, SÁBADOS & PAGAMENTOS', `${rhRows.length} colaborador(es)`);
    if (rhRows.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(...TEXT_MUTED);
      doc.text('Sem colaboradores/registos para os filtros selecionados.', margin + 2, cursorY + 4);
      cursorY += 10;
    } else {
      const totals = rhRows.reduce(
        (acc, r) => {
          acc.satCount += Number(r.saturdayCount) || 0;
          acc.satVal += Number(r.saturdayTotal) || 0;
          acc.tw += Number(r.twelfthsTotal) || 0;
          acc.ss += Number(r.ssDeduction) || 0;
          acc.off += Number(r.offPayrollEarned) || 0;
          acc.adv += Number(r.advancesTotal) || 0;
          acc.net += Number(r.netToPay) || 0;
          return acc;
        },
        { satCount: 0, satVal: 0, tw: 0, ss: 0, off: 0, adv: 0, net: 0 }
      );

      autoTable(doc, {
        startY: cursorY,
        margin: { left: margin, right: margin },
        head: [[
          'Colaborador',
          'Modalidade',
          'Seg–Sex',
          'Sábados',
          'Base + Duod.',
          'Desc. SS',
          'Por Fora SS',
          'Vales',
          'Total Líquido',
        ]],
        body: rhRows.map((r) => [
          `${r.name}\n(${r.department || 'Geral'})`,
          r.remunerationLabel,
          `${r.weekdayPresent} d`,
          r.saturdayCount > 0 ? `${r.saturdayCount} sáb.\n${euro(r.saturdayTotal)}` : '0 sáb.',
          euro((Number(r.earnedBase) || 0) + (Number(r.saturdayReceiptTotal) || 0) + (Number(r.twelfthsTotal) || 0)),
          `- ${euro(r.ssDeduction)}`,
          euro(r.offPayrollEarned),
          r.advancesTotal > 0 ? `- ${euro(r.advancesTotal)}` : '€ 0,00',
          euro(r.netToPay),
        ]),
        foot: [[
          'TOTAIS RH',
          '',
          '',
          `${totals.satCount} sáb. (${euro(totals.satVal)})`,
          `Duod. ${euro(totals.tw)}`,
          `- ${euro(totals.ss)}`,
          euro(totals.off),
          `- ${euro(totals.adv)}`,
          euro(totals.net),
        ]],
        styles: { fontSize: 7.2, cellPadding: 2, textColor: TEXT_DARK, valign: 'middle' },
        headStyles: { fillColor: [241, 245, 249], textColor: NAVY, fontStyle: 'bold', lineWidth: 0.1 },
        footStyles: { fillColor: [255, 247, 237], textColor: NAVY, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [250, 251, 252] },
        columnStyles: {
          4: { halign: 'right' },
          5: { halign: 'right' },
          6: { halign: 'right' },
          7: { halign: 'right' },
          8: { halign: 'right', fontStyle: 'bold' },
        },
      });
      cursorY = doc.lastAutoTable.finalY + 8;
    }
  }

  // Section 2: Movimentos de Caixa (Abates & Entradas)
  if (sections.cash) {
    drawSectionHeading('2. EXTRATO DO CAIXA DA EMPRESA (ABATES & ENTRADAS)', `${cashRows.length} movimento(s)`);
    if (cashRows.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(...TEXT_MUTED);
      doc.text('Sem movimentos de caixa registados para os filtros selecionados.', margin + 2, cursorY + 4);
      cursorY += 10;
    } else {
      autoTable(doc, {
        startY: cursorY,
        margin: { left: margin, right: margin },
        head: [['Data', 'Categoria / Origem', 'Descrição', 'Regime', 'Tipo', 'Valor (€)']],
        body: cashRows.map((m) => [
          formatDatePT(m.date),
          m.category,
          String(m.description || '').slice(0, 62),
          m.taxModeLabel || m.taxMode || 'geral',
          m.type === 'entrada' ? 'Entrada (+)' : 'Saída (-)',
          `${m.type === 'entrada' ? '+' : '-'} ${euro(m.amount)}`,
        ]),
        styles: { fontSize: 7.3, cellPadding: 2, textColor: TEXT_DARK, valign: 'middle' },
        headStyles: { fillColor: [241, 245, 249], textColor: NAVY, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [250, 251, 252] },
        columnStyles: {
          5: { halign: 'right', fontStyle: 'bold' },
        },
        didParseCell(data) {
          if (data.section === 'body' && data.column.index === 5) {
            const raw = String(data.cell.raw || '');
            data.cell.styles.textColor = raw.startsWith('+') ? GREEN : RED;
          }
        },
      });
      cursorY = doc.lastAutoTable.finalY + 8;
    }
  }

  // Section 3: Faturas (Saídas) & Recebimentos de Obras (Entradas)
  if (sections.projects) {
    const combinedOps = [
      ...inflowRows.map((i) => ({
        date: i.date,
        kind: 'ENTRADA (Obra)',
        project: i.projectLabel,
        entity: i.clientName || 'Cliente',
        detail: i.description,
        amount: Number(i.amount) || 0,
        sign: '+',
      })),
      ...invoiceRows.map((inv) => ({
        date: inv.invoiceDate,
        kind: 'SAÍDA (Fatura)',
        project: inv.projectLabel,
        entity: inv.supplier,
        detail: `Fat. #${inv.invoiceNumber} · ${inv.category}`,
        amount: Number(inv.amount) || 0,
        sign: '-',
      })),
    ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    drawSectionHeading('3. FATURAS DE COMPRA & RECEBIMENTOS DE OBRAS', `${combinedOps.length} registo(s)`);
    if (combinedOps.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(...TEXT_MUTED);
      doc.text('Sem faturas ou recebimentos de obras nos filtros selecionados.', margin + 2, cursorY + 4);
      cursorY += 10;
    } else {
      autoTable(doc, {
        startY: cursorY,
        margin: { left: margin, right: margin },
        head: [['Data', 'Tipo', 'Obra', 'Entidade / Fornecedor', 'Detalhe / Fatura', 'Valor (€)']],
        body: combinedOps.map((r) => [
          formatDatePT(r.date),
          r.kind,
          String(r.project || '—').slice(0, 26),
          String(r.entity || '—').slice(0, 26),
          String(r.detail || '—').slice(0, 38),
          `${r.sign} ${euro(r.amount)}`,
        ]),
        styles: { fontSize: 7.3, cellPadding: 2, textColor: TEXT_DARK, valign: 'middle' },
        headStyles: { fillColor: [241, 245, 249], textColor: NAVY, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [250, 251, 252] },
        columnStyles: {
          5: { halign: 'right', fontStyle: 'bold' },
        },
        didParseCell(data) {
          if (data.section === 'body' && data.column.index === 5) {
            const raw = String(data.cell.raw || '');
            data.cell.styles.textColor = raw.startsWith('+') ? GREEN : RED;
          }
        },
      });
      cursorY = doc.lastAutoTable.finalY + 8;
    }
  }

  // Section 4: Adiantamentos / Vales
  if (sections.advances && advanceRows.length > 0) {
    drawSectionHeading('4. DETALHE DE ADIANTAMENTOS & VALES SALARIAIS', `${advanceRows.length} lançamento(s)`);
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      head: [['Data', 'Colaborador', 'Período', 'Observação / Motivo', 'Valor Abatido']],
      body: advanceRows.map((a) => [
        formatDatePT(a.date),
        a.employeeName,
        a.month,
        a.notes || 'Adiantamento de ordenado',
        `- ${euro(a.amount)}`,
      ]),
      styles: { fontSize: 7.4, cellPadding: 2, textColor: TEXT_DARK },
      headStyles: { fillColor: [241, 245, 249], textColor: NAVY, fontStyle: 'bold' },
      columnStyles: { 4: { halign: 'right', fontStyle: 'bold', textColor: RED } },
    });
  }

  // Footer across all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageH - 11, pageW - margin, pageH - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(
      'Spark & Smirk, Lda. · Relatório Confidencial de Gestão Interna · Sincronizado com Base de Dados',
      margin,
      pageH - 6.5
    );
    doc.text(`Página ${p} de ${totalPages}`, pageW - margin, pageH - 6.5, { align: 'right' });
  }

  doc.save(filename);
}
