const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrlSecret = defineSecret('SUPABASE_URL');
const supabaseAnonKeySecret = defineSecret('SUPABASE_ANON_KEY');
const supabaseServiceRoleSecret = defineSecret('SUPABASE_SERVICE_ROLE_KEY');

const ALLOWED_ORIGINS = new Set([
  'https://sparksmirk.pt',
  'https://www.sparksmirk.pt',
  'https://spark-smirk.web.app',
  'https://spark-smirk.firebaseapp.com',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:5000',
]);

const VALID_ROLES = new Set(['administrador', 'rh', 'operacional', 'operador']);

function applySecurityHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function isOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Same-origin or server-to-server requests without Origin header
  return ALLOWED_ORIGINS.has(origin);
}

function isRecoveryOnlyToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!Array.isArray(payload?.amr) || payload.amr.length === 0) return false;
    const methods = payload.amr
      .map((entry) => (typeof entry === 'string' ? entry : entry?.method || ''))
      .filter(Boolean);
    return methods.length > 0 && !methods.includes('password');
  } catch {
    return false;
  }
}

function getSafeRequestOrigin(req) {
  const origin = (req.headers.origin || '').trim();
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return origin;
  }
  return 'https://sparksmirk.pt';
}

function getClientIpHash(req) {
  const rawForwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const rawIp = rawForwarded || String(req.ip || '').trim();
  if (!rawIp) return '';
  return crypto.createHash('sha256').update(rawIp).digest('hex').slice(0, 32);
}

function escapeEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isOnConflictConstraintError(err) {
  const code = String(err?.code || '').trim();
  const raw = String(err?.message || '');
  return (
    code === '42P10' ||
    /no unique or exclusion constraint matching the on conflict specification/i.test(raw)
  );
}

function formatUserSafeError(err, fallbackMessage, contextTag = 'API_DB_ERROR') {
  const code = String(err?.code || '').trim();
  const raw = String(err?.message || '').trim();

  console.error(`[${contextTag}]`, {
    code: code || undefined,
    message: raw || undefined,
    details: err?.details || undefined,
    hint: err?.hint || undefined,
  });

  if (!raw) {
    return fallbackMessage;
  }

  // Bloqueia terminologia técnica SQL/PostgreSQL/PostgREST antes de avaliar mensagens
  const hasTechnicalSqlTerms =
    /\b(on conflict|exclusion constraint|unique constraint|foreign key|check constraint|violates|relation|column|schema|syntax error|pgrst|postgres|postgresql|supabase|rpc|tuple|null value in column)\b/i.test(
      raw
    );

  if (code === '23505' || /duplicate key|already exists|unique/i.test(raw)) {
    if (/nif/i.test(raw)) return 'Já existe um registo com este NIF na base de dados.';
    if (/email/i.test(raw)) return 'Este endereço de email já se encontra registado no sistema.';
    if (/username/i.test(raw)) return 'Este nome de utilizador já está em utilização.';
    if (/codigo_interno/i.test(raw)) return 'Já existe um registo com este código interno.';
    return 'Já existe um registo equivalente guardado na base de dados.';
  }

  if (code === '23503' || /foreign key/i.test(raw)) {
    return 'O registo associado não foi encontrado ou possui dependências ativas.';
  }

  if (code === '22P02' || /invalid input syntax/i.test(raw)) {
    return 'Um dos dados enviados apresenta formato inválido. Verifique datas, números ou valores.';
  }

  if (code === '23514' || /check constraint/i.test(raw)) {
    return 'Um dos valores fornecidos encontra-se fora das regras permitidas pelo sistema.';
  }

  if (isOnConflictConstraintError(err)) {
    return 'Não foi possível guardar por uma inconsistência técnica temporária na base de dados. Tente novamente.';
  }

  if (/already been registered|already exists/i.test(raw)) {
    return 'Já existe uma conta registada com este endereço de email.';
  }

  if (/password.*weak|at least \d+ characters/i.test(raw)) {
    return 'A palavra-passe não cumpre os requisitos mínimos de segurança.';
  }

  if (
    !hasTechnicalSqlTerms &&
    /^(Funcionário|Obra|Responsável técnico|Este endereço|Indique|Preencha|O NIF|A senha|A palavra-passe|Sem permissão|Apenas ficheiros|Não foi possível|Não pode|Já existe)/i.test(
      raw
    )
  ) {
    return raw.slice(0, 220);
  }

  return fallbackMessage;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveRhEmployeeUuid(supabaseAdmin, empCode) {
  const clean = String(empCode || '').trim();
  if (!clean) return null;

  const { data: byCode } = await supabaseAdmin
    .schema('rh')
    .from('funcionarios')
    .select('id')
    .eq('codigo_interno', clean)
    .limit(1)
    .maybeSingle();
  if (byCode?.id) return byCode.id;

  if (UUID_RE.test(clean)) {
    const { data: byId } = await supabaseAdmin
      .schema('rh')
      .from('funcionarios')
      .select('id')
      .eq('id', clean)
      .limit(1)
      .maybeSingle();
    if (byId?.id) return byId.id;
  }

  return null;
}

async function resolveRhPayslipUuid(supabaseAdmin, payCode) {
  const clean = String(payCode || '').trim();
  if (!clean) return null;

  const { data: byCode } = await supabaseAdmin
    .schema('rh')
    .from('recibos_vencimento')
    .select('id')
    .eq('codigo_recibo', clean)
    .limit(1)
    .maybeSingle();
  if (byCode?.id) return byCode.id;

  if (UUID_RE.test(clean)) {
    const { data: byId } = await supabaseAdmin
      .schema('rh')
      .from('recibos_vencimento')
      .select('id')
      .eq('id', clean)
      .limit(1)
      .maybeSingle();
    if (byId?.id) return byId.id;
  }

  return null;
}

async function addAttachmentFallback(supabaseAdmin, payload, actorId) {
  const code = String(payload?.id || `ATT-${Date.now()}`).trim();
  const empUuid = await resolveRhEmployeeUuid(supabaseAdmin, payload?.employeeId);
  if (!empUuid) {
    return { error: { message: 'Funcionário associado ao recibo não encontrado.' } };
  }

  const payslipCode = payload?.payslipId ? String(payload.payslipId).trim() : null;
  const recUuid = payslipCode ? await resolveRhPayslipUuid(supabaseAdmin, payslipCode) : null;

  const monthStr = String(payload?.month || new Date().toISOString().slice(0, 7));
  const [anoRaw, mesRaw] = monthStr.split('-');
  const ano = Number(anoRaw) || new Date().getFullYear();
  const mes = Math.min(12, Math.max(1, Number(mesRaw) || new Date().getMonth() + 1));
  const fileSize = Number(payload?.fileSize) || 0;
  const fileName = String(payload?.fileName || 'recibo.pdf');
  const fileType = String(payload?.fileType || 'application/pdf');
  const storagePath = String(payload?.storagePath || '');
  const sizeLabel = `${Math.round(fileSize / 1024)} KB`;

  const rhTable = supabaseAdmin.schema('rh').from('recibos_anexados');
  const { data: existing } = await rhTable
    .select('id, codigo_anexo')
    .eq('codigo_anexo', code)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { data: updated, error: updErr } = await rhTable
      .update({
        funcionario_id: empUuid,
        recibo_id: recUuid,
        codigo_recibo_ref: payslipCode,
        ano,
        mes,
        nome_ficheiro: fileName,
        tamanho_legivel: sizeLabel,
        tamanho_bytes: fileSize,
        tipo_mime: fileType,
        caminho_storage: storagePath,
      })
      .eq('id', existing.id)
      .select('id, codigo_anexo, caminho_storage')
      .single();
    if (updErr) return { error: updErr };
    return {
      data: {
        id: updated?.codigo_anexo || updated?.id || code,
        storagePath: updated?.caminho_storage || storagePath,
      },
    };
  }

  const { data: inserted, error: insErr } = await rhTable
    .insert({
      codigo_anexo: code,
      funcionario_id: empUuid,
      recibo_id: recUuid,
      codigo_recibo_ref: payslipCode,
      ano,
      mes,
      nome_ficheiro: fileName,
      tamanho_legivel: sizeLabel,
      tamanho_bytes: fileSize,
      tipo_mime: fileType,
      caminho_storage: storagePath,
      anexado_por: actorId || null,
    })
    .select('id, codigo_anexo, caminho_storage')
    .single();
  if (insErr) return { error: insErr };

  return {
    data: {
      id: inserted?.codigo_anexo || inserted?.id || code,
      storagePath: inserted?.caminho_storage || storagePath,
    },
  };
}

async function upsertPayslipFallback(supabaseAdmin, payload, actorId) {
  const code = String(payload?.id || `REC-${Date.now()}`).trim();
  const empUuid = await resolveRhEmployeeUuid(supabaseAdmin, payload?.employeeId);
  if (!empUuid) {
    return { error: { message: 'Funcionário associado ao recibo não encontrado.' } };
  }

  const monthStr = String(payload?.month || new Date().toISOString().slice(0, 7));
  const [anoRaw, mesRaw] = monthStr.split('-');
  const ano = Number(anoRaw) || new Date().getFullYear();
  const mes = Math.min(12, Math.max(1, Number(mesRaw) || new Date().getMonth() + 1));
  const baseSalary = Number(payload?.baseSalary) || 0;
  const mealAllowance = Number(payload?.mealAllowanceTotal) || 0;
  const twelfthVac = Math.max(0, Number(payload?.twelfthVacation) || 0);
  const twelfthXmas = Math.max(0, Number(payload?.twelfthChristmas) || 0);
  const overtimeBonus = Number(payload?.overtimeBonus) || 0;
  const ssVal = Number(payload?.socialSecurity) || 0;
  const irsVal = Number(payload?.irsRetention) || 0;
  const otherDed = Number(payload?.otherDeductions) || 0;
  const offPayrollVal = Math.max(0, Number(payload?.offPayroll) || 0);
  const netVal = Number(payload?.netSalary) || 0;
  const statusVal = String(payload?.status || 'pendente').toLowerCase() === 'pago' ? 'Pago' : 'Emitido';
  const payDate = payload?.paymentDate ? String(payload.paymentDate).trim() || null : null;
  const notes = payload?.notes ? String(payload.notes).trim() || null : null;

  const rhTable = supabaseAdmin.schema('rh').from('recibos_vencimento');
  const existingId = await resolveRhPayslipUuid(supabaseAdmin, code);

  const rowValues = {
    codigo_recibo: code,
    funcionario_id: empUuid,
    ano,
    mes,
    salario_base: baseSalary,
    subsidio_alimentacao: mealAllowance,
    duodecimo_ferias: twelfthVac,
    duodecimo_natal: twelfthXmas,
    horas_extra_valor: overtimeBonus,
    ss_valor: ssVal,
    irs_valor: irsVal,
    outras_deducoes: otherDed,
    pagamento_por_fora: offPayrollVal,
    total_bruto: baseSalary + mealAllowance + twelfthVac + twelfthXmas + overtimeBonus,
    total_liquido: netVal,
    estado_pagamento: statusVal,
    data_pagamento: payDate,
    notas: notes,
  };

  if (existingId) {
    let { data: updated, error: updErr } = await rhTable
      .update(rowValues)
      .eq('id', existingId)
      .select('id, codigo_recibo')
      .single();
    if (updErr && updErr.code === 'PGRST204') {
      const legacyValues = { ...rowValues };
      delete legacyValues.pagamento_por_fora;
      delete legacyValues.duodecimo_ferias;
      delete legacyValues.duodecimo_natal;
      ({ data: updated, error: updErr } = await rhTable
        .update(legacyValues)
        .eq('id', existingId)
        .select('id, codigo_recibo')
        .single());
    }
    if (updErr) return { error: updErr };
    return { data: { id: updated?.codigo_recibo || code, dbId: updated?.id || existingId } };
  }

  let { data: inserted, error: insErr } = await rhTable
    .insert({ ...rowValues, emitido_por: actorId || null })
    .select('id, codigo_recibo')
    .single();
  if (insErr && insErr.code === 'PGRST204') {
    const legacyValues = { ...rowValues, emitido_por: actorId || null };
    delete legacyValues.pagamento_por_fora;
    delete legacyValues.duodecimo_ferias;
    delete legacyValues.duodecimo_natal;
    ({ data: inserted, error: insErr } = await rhTable
      .insert(legacyValues)
      .select('id, codigo_recibo')
      .single());
  }
  if (insErr) return { error: insErr };
  return { data: { id: inserted?.codigo_recibo || code, dbId: inserted?.id } };
}

function mapCandidateDbRow(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    id: c.codigo_candidatura || c.id,
    dbId: c.id,
    fullName: c.nome_completo || '',
    email: c.email || '',
    phone: c.telefone || '',
    district: c.distrito || 'Porto',
    specialty: c.area_especialidade || '',
    experience: c.experiencia || '',
    availability: c.disponibilidade || 'Imediata',
    drivingLicense: c.carta_conducao || 'Não indicada',
    certifications: c.certificacoes || '',
    message: c.mensagem || '',
    cvFileName: c.cv_nome_ficheiro || '',
    cvFileType: c.cv_tipo_mime || '',
    cvFileSize: Number(c.cv_tamanho_bytes) || 0,
    cvStoragePath: c.cv_caminho_storage || '',
    status: c.estado || 'Nova',
    internalNotes: c.notas_internas || '',
    createdAt: c.criado_em ? String(c.criado_em).slice(0, 10) : '',
  };
}

async function loadCandidatesList(supabaseAdmin) {
  try {
    const { data, error } = await supabaseAdmin.rpc('spark_erp_list_candidates');
    if (!error && Array.isArray(data)) {
      return data;
    }
  } catch {
    // Fallback direto abaixo
  }
  try {
    const { data, error } = await supabaseAdmin
      .schema('rh')
      .from('candidaturas')
      .select('*')
      .order('criado_em', { ascending: false });
    if (!error && Array.isArray(data)) {
      return data.map(mapCandidateDbRow).filter(Boolean);
    }
  } catch {
    // Tabela ainda não criada
  }
  return [];
}

function formatLisbonTimestamp(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('pt-PT', {
      timeZone: 'Europe/Lisbon',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function buildSparkRecoveryEmailContent({
  nomeCompleto,
  cargo,
  departamento,
  email,
  actionUrl,
  originUrl,
}) {
  const safeName = escapeEmailHtml(nomeCompleto || 'Colaborador(a)');
  const safeRole = escapeEmailHtml([cargo, departamento].filter(Boolean).join(' · ') || 'Utilizador Interno');
  const safeEmail = escapeEmailHtml(email);
  const safeActionUrl = escapeEmailHtml(actionUrl);
  const safePortalHost = escapeEmailHtml(originUrl.replace(/^https?:\/\//i, ''));
  const safeWhen = escapeEmailHtml(formatLisbonTimestamp());

  const subject = 'Spark & Smirk — Redefinição Segura de Palavra-passe';

  const text = [
    'SPARK & SMIRK, LDA. — SISTEMA DE GESTÃO INTERNO',
    '',
    `Olá, ${nomeCompleto || 'Colaborador(a)'}.`,
    '',
    `Recebemos um pedido para redefinir a palavra-passe da sua conta corporativa (${email}) em ${originUrl}.`,
    `Data/hora do pedido (Lisboa): ${formatLisbonTimestamp()}`,
    '',
    'Para definir uma nova palavra-passe (ligação válida por 60 minutos), aceda ao link abaixo:',
    actionUrl,
    '',
    'Se não solicitou esta alteração, ignore este email em segurança. A sua palavra-passe atual permanece ativa.',
    '',
    'Spark & Smirk, Lda. · Engenharia, Construção Civil & Jardinagem · Portugal',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="pt-PT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeEmailHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0c1829;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Pedido personalizado de redefinição de palavra-passe para ${safeEmail} — Spark &amp; Smirk, Lda.
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:linear-gradient(180deg,#0c1829 0%,#10233d 100%);padding:36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.38);">
          <tr>
            <td style="background:linear-gradient(135deg,#0c1829 0%,#162b47 65%,#0c1829 100%);padding:30px 36px;border-bottom:4px solid #e8650a;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td valign="middle">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="padding-right:12px;" valign="middle">
                          <img src="https://sparksmirk.pt/logotipo.jpeg" alt="Spark &amp; Smirk, Lda." width="44" height="44" style="display:block;border-radius:10px;border:1px solid rgba(255,255,255,0.22);object-fit:cover;">
                        </td>
                        <td valign="middle">
                          <div style="font-size:19px;font-weight:900;letter-spacing:0.02em;color:#ffffff;line-height:1.1;">
                            SPARK<span style="color:#e8650a;">&amp;</span>SMIRK
                          </div>
                          <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#ff8534;margin-top:4px;">
                            Sistema de Gestão Interno
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" valign="middle">
                    <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:rgba(232,101,10,0.18);border:1px solid rgba(255,133,52,0.45);color:#ffb07a;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">
                      Acesso Seguro
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:34px 36px 28px 36px;">
              <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:800;color:#0c1829;line-height:1.25;">
                Olá, ${safeName}
              </h1>
              <p style="margin:0 0 16px 0;font-size:13px;font-weight:600;color:#e8650a;text-transform:uppercase;letter-spacing:0.06em;">
                ${safeRole}
              </p>
              <p style="margin:0 0 22px 0;font-size:15px;line-height:1.65;color:#374151;">
                Recebemos um pedido de redefinição de palavra-passe para a sua conta corporativa <strong style="color:#0c1829;">${safeEmail}</strong> no portal de gestão da <strong>Spark &amp; Smirk, Lda.</strong>
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #e8650a;border-radius:10px;margin-bottom:26px;">
                <tr>
                  <td style="padding:16px 18px;font-size:13.5px;line-height:1.65;color:#334155;">
                    <div style="font-weight:700;color:#0c1829;margin-bottom:6px;">Registo de Segurança do Pedido:</div>
                    <div>• Portal solicitante: <strong>${safePortalHost}</strong></div>
                    <div>• Data e hora (Lisboa): <strong>${safeWhen}</strong></div>
                    <div>• Validade: utilização única durante <strong>60 minutos</strong></div>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <a href="${safeActionUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 32px;background:linear-gradient(135deg,#e8650a 0%,#c24e00 100%);background-color:#e8650a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;border-radius:11px;box-shadow:0 10px 24px rgba(232,101,10,0.32);">
                      Definir Nova Palavra-passe
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:12.5px;line-height:1.6;color:#64748b;">
                Se o botão não funcionar, copie e cole este endereço no seu navegador:
              </p>
              <p style="margin:0 0 22px 0;padding:12px 14px;background-color:#f1f5f9;border-radius:8px;word-break:break-all;font-size:12px;color:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">
                ${safeActionUrl}
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:10px;">
                <tr>
                  <td style="padding:14px 16px;font-size:12.5px;line-height:1.55;color:#9a3412;">
                    <strong>Não foi você que solicitou?</strong> Ignore esta mensagem em segurança. A sua palavra-passe atual continua protegida e não será alterada.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;border-top:1px solid #e5e7eb;padding:22px 36px;text-align:center;">
              <div style="font-size:12.5px;font-weight:700;color:#0c1829;margin-bottom:4px;">
                Spark &amp; Smirk, Lda. · Engenharia, Construção Civil &amp; Jardinagem
              </div>
              <div style="font-size:11.5px;color:#64748b;line-height:1.6;">
                Portugal · <a href="https://sparksmirk.pt" style="color:#e8650a;text-decoration:none;font-weight:600;">sparksmirk.pt</a> · Mensagem automática de segurança
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

async function sendCustomRecoveryEmail({ toEmail, subject, html, text }) {
  const fromAddress = (process.env.SMTP_FROM || 'Spark & Smirk Segurança <no-reply@sparksmirk.pt>').trim();
  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();

  if (resendApiKey) {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toEmail],
        subject,
        html,
        text,
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`RESEND_FAILED:${resp.status}:${errBody}`);
    }
    return { sent: true, channel: 'resend_api' };
  }

  const smtpHost = (process.env.SMTP_HOST || '').trim();
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || smtpPort === 465;

  if (smtpHost && smtpUser && smtpPass) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
    });
    await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject,
      text,
      html,
    });
    return { sent: true, channel: 'smtp_personalizado' };
  }

  return { sent: false, channel: 'none' };
}

function defaultPermissionsForRole(role = 'operador') {
  if (role === 'administrador') {
    return {
      dashboard: { ver: true, valores: true },
      rh_funcionarios: {
        ver: true,
        criar: true,
        editar: true,
        excluir: true,
        assiduidade: true,
        ordenados: true,
        pagamentos: true,
      },
      rh_recibos: { ver: true, emitir: true, anexar: true, excluir: true },
      op_obras: {
        ver: true,
        criar: true,
        editar: true,
        excluir: true,
        valores: true,
        orcamentos: true,
        pagamentos: true,
        faturas: true,
        responsaveis: true,
      },
      admin_utilizadores: { ver: true, criar: true, editar: true, excluir: true },
    };
  }
  if (role === 'rh') {
    return {
      dashboard: { ver: true, valores: true },
      rh_funcionarios: {
        ver: true,
        criar: true,
        editar: true,
        excluir: false,
        assiduidade: true,
        ordenados: true,
        pagamentos: true,
      },
      rh_recibos: { ver: true, emitir: true, anexar: true, excluir: false },
      op_obras: {
        ver: false,
        criar: false,
        editar: false,
        excluir: false,
        valores: false,
        orcamentos: false,
        pagamentos: false,
        faturas: false,
        responsaveis: false,
      },
      admin_utilizadores: { ver: false, criar: false, editar: false, excluir: false },
    };
  }
  if (role === 'operacional') {
    return {
      dashboard: { ver: true, valores: true },
      rh_funcionarios: {
        ver: true,
        criar: false,
        editar: false,
        excluir: false,
        assiduidade: true,
        ordenados: false,
        pagamentos: false,
      },
      rh_recibos: { ver: false, emitir: false, anexar: false, excluir: false },
      op_obras: {
        ver: true,
        criar: true,
        editar: true,
        excluir: false,
        valores: true,
        orcamentos: true,
        pagamentos: true,
        faturas: true,
        responsaveis: true,
      },
      admin_utilizadores: { ver: false, criar: false, editar: false, excluir: false },
    };
  }
  return {
    dashboard: { ver: true, valores: false },
    rh_funcionarios: {
      ver: true,
      criar: false,
      editar: false,
      excluir: false,
      assiduidade: false,
      ordenados: false,
      pagamentos: false,
    },
    rh_recibos: { ver: false, emitir: false, anexar: false, excluir: false },
    op_obras: {
      ver: true,
      criar: false,
      editar: false,
      excluir: false,
      valores: false,
      orcamentos: false,
      pagamentos: false,
      faturas: false,
      responsaveis: false,
    },
    admin_utilizadores: { ver: false, criar: false, editar: false, excluir: false },
  };
}

function normalizePermissions(rawPerms, role = 'operador') {
  const base = defaultPermissionsForRole(role);
  if (!rawPerms || typeof rawPerms !== 'object') return base;

  const result = {};
  for (const modKey of Object.keys(base)) {
    result[modKey] = {};
    const src = rawPerms[modKey] && typeof rawPerms[modKey] === 'object' ? rawPerms[modKey] : {};
    for (const actKey of Object.keys(base[modKey])) {
      result[modKey][actKey] =
        typeof src[actKey] === 'boolean' ? src[actKey] : base[modKey][actKey];
    }
  }
  return result;
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
}

function hasAdminUserAction(profile, actionKey) {
  if (!profile || profile.ativo === false) return false;
  const adminPerms = profile.permissoes?.admin_utilizadores;
  if (adminPerms && typeof adminPerms[actionKey] === 'boolean') {
    return adminPerms[actionKey] === true;
  }
  return profile.nivel_acesso === 'administrador';
}

function hasModuleAction(profile, moduleKey, actionKey = 'ver') {
  if (!profile || profile.ativo === false) return false;
  return profile.permissoes?.[moduleKey]?.[actionKey] === true;
}

function redactSnapshotForProfile(rawSnapshot, profile) {
  const snap = rawSnapshot && typeof rawSnapshot === 'object' ? { ...rawSnapshot } : {};
  const canSeeEmpSalary = hasModuleAction(profile, 'rh_funcionarios', 'ordenados');
  const canSeeEmpPayable = hasModuleAction(profile, 'rh_funcionarios', 'pagamentos');
  const canSeeRecibos = hasModuleAction(profile, 'rh_recibos', 'ver');
  const canSeeOpValues = hasModuleAction(profile, 'op_obras', 'valores');

  if (!canSeeEmpSalary && Array.isArray(snap.employees)) {
    snap.employees = snap.employees.map((emp) => ({
      ...emp,
      baseSalary: 0,
      dailyRate: 0,
      hourlyRate: 0,
      mealAllowance: 0,
      ssPercentage: 0,
      offPayrollType: 'mensal',
      offPayrollAmount: 0,
      twelfths: 'Não',
      twelfthsVacationManual: 0,
      twelfthsChristmasManual: 0,
      iban: '',
      _salaryRestricted: true,
    }));
  }

  if (!canSeeEmpPayable) {
    snap.employeeAdvances = [];
  }

  if (!canSeeRecibos) {
    snap.payslips = [];
    snap.attachedReceipts = [];
  }

  if (!canSeeOpValues) {
    if (Array.isArray(snap.projects)) {
      snap.projects = snap.projects.map((proj) => ({
        ...proj,
        manualBudgetCap: 0,
        dailyRatePerWorker: 0,
        budget: { vatRate: 0, contingencyPct: 0, items: [] },
        payments: [],
        _valuesRestricted: true,
      }));
    }
    if (Array.isArray(snap.projectInvoices)) {
      snap.projectInvoices = snap.projectInvoices.map((inv) => ({
        ...inv,
        amount: 0,
        _valuesRestricted: true,
      }));
    }
  }

  return snap;
}

async function fetchDbProfile(supabaseAdmin, userId) {
  try {
    const { data, error } = await supabaseAdmin
      .schema('seguranca')
      .from('perfis_utilizadores')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!error) {
      return { data, dbError: null };
    }
  } catch {
    // Fallback para bridge RPC abaixo
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('spark_get_perfil', { p_user_id: userId });
    if (error) {
      return { data: null, dbError: error.message };
    }
    return { data: data || null, dbError: null };
  } catch (err) {
    return { data: null, dbError: err.message };
  }
}

async function listDbProfiles(supabaseAdmin) {
  try {
    const { data, error } = await supabaseAdmin
      .schema('seguranca')
      .from('perfis_utilizadores')
      .select('*');

    if (!error) {
      return { rows: data || [], dbWarning: null };
    }
  } catch {
    // Fallback para bridge RPC abaixo
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('spark_list_perfis');
    if (error) {
      return { rows: [], dbWarning: error.message };
    }
    return { rows: Array.isArray(data) ? data : [], dbWarning: null };
  } catch (err) {
    return { rows: [], dbWarning: err.message };
  }
}

async function countDbProfiles(supabaseAdmin) {
  try {
    const countRes = await supabaseAdmin
      .schema('seguranca')
      .from('perfis_utilizadores')
      .select('id', { count: 'exact', head: true });
    if (!countRes.error) {
      return countRes.count || 0;
    }
  } catch {
    // Fallback para bridge RPC abaixo
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('spark_count_perfis');
    if (!error) return Number(data) || 0;
  } catch {
    // Ignore
  }
  return 0;
}

async function upsertDbProfile(supabaseAdmin, payload) {
  try {
    const { data, error } = await supabaseAdmin
      .schema('seguranca')
      .from('perfis_utilizadores')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .maybeSingle();

    if (!error) {
      return { data, synced: true, dbError: null };
    }
  } catch {
    // Fallback para bridge RPC abaixo
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('spark_upsert_perfil', { p_payload: payload });
    if (error) {
      return { data: null, synced: false, dbError: error.message };
    }
    return { data: data || payload, synced: true, dbError: null };
  } catch (err) {
    return { data: null, synced: false, dbError: err.message };
  }
}

async function touchDbLogin(supabaseAdmin, userId) {
  try {
    const { error } = await supabaseAdmin
      .schema('seguranca')
      .from('perfis_utilizadores')
      .update({ ultimo_login_em: new Date().toISOString() })
      .eq('id', userId);
    if (!error) return;
  } catch {
    // Fallback para bridge RPC abaixo
  }

  try {
    await supabaseAdmin.rpc('spark_touch_login', { p_user_id: userId });
  } catch {
    // Non-blocking
  }
}

async function deleteDbProfile(supabaseAdmin, userId) {
  try {
    const { error } = await supabaseAdmin
      .schema('seguranca')
      .from('perfis_utilizadores')
      .delete()
      .eq('id', userId);
    if (!error) return;
  } catch {
    // Fallback para bridge RPC abaixo
  }

  try {
    await supabaseAdmin.rpc('spark_delete_perfil', { p_user_id: userId });
  } catch {
    // Cascade on auth.users already removes DB row
  }
}

async function writeAuditLog(supabaseAdmin, entry) {
  const payload = {
    utilizador_id: entry.userId || null,
    utilizador_email: entry.userEmail || null,
    modulo: entry.modulo || 'seguranca.utilizadores',
    acao: entry.acao,
    entidade_id: entry.entidadeId || null,
    detalhes: entry.detalhes || {},
  };

  try {
    const { error } = await supabaseAdmin
      .schema('seguranca')
      .from('registos_auditoria')
      .insert(payload);
    if (!error) return;
  } catch {
    // Fallback para bridge RPC abaixo
  }

  try {
    await supabaseAdmin.rpc('spark_write_auditoria', { p_payload: payload });
  } catch {
    // Non-blocking audit log
  }
}

function buildEffectiveProfile(authUser, dbRow) {
  const appMeta = authUser?.app_metadata || {};
  const userMeta = authUser?.user_metadata || {};

  const role = VALID_ROLES.has(dbRow?.nivel_acesso)
    ? dbRow.nivel_acesso
    : VALID_ROLES.has(appMeta.nivel_acesso)
      ? appMeta.nivel_acesso
      : 'operador';

  const permsSource =
    dbRow?.permissoes && Object.keys(dbRow.permissoes).length > 0
      ? dbRow.permissoes
      : appMeta.permissoes;

  return {
    id: authUser.id,
    nome_completo:
      dbRow?.nome_completo ||
      userMeta.nome_completo ||
      authUser.email?.split('@')[0] ||
      'Utilizador',
    email: dbRow?.email || authUser.email,
    cargo: dbRow?.cargo || userMeta.cargo || 'Gestor Interno',
    departamento: dbRow?.departamento || userMeta.departamento || 'Geral',
    telefone: dbRow?.telefone || userMeta.telefone || '',
    username: dbRow?.username || appMeta.username || userMeta.username || '',
    email_recuperacao:
      dbRow?.email_recuperacao ||
      userMeta.email_recuperacao ||
      (authUser.email && !String(authUser.email).endsWith('@sistema.sparksmirk.internal')
        ? authUser.email
        : ''),
    is_placeholder_email: Boolean(
      !dbRow?.email_recuperacao &&
        String(dbRow?.email || authUser.email || '').endsWith('@sistema.sparksmirk.internal')
    ),
    nif: dbRow?.nif || userMeta.nif || '',
    morada: dbRow?.morada || userMeta.morada || '',
    nivel_acesso: role,
    permissoes: normalizePermissions(permsSource, role),
    senha_provisoria: Boolean(dbRow?.senha_provisoria ?? appMeta.must_change_password),
    senha_alterada_em: dbRow?.senha_alterada_em || null,
    ativo: dbRow?.ativo !== undefined ? Boolean(dbRow.ativo) : appMeta.ativo !== false,
    ultimo_login_em: dbRow?.ultimo_login_em || authUser.last_sign_in_at || null,
    criado_em: dbRow?.criado_em || authUser.created_at || null,
  };
}

async function resolveCallerContext(req, supabaseAdmin, options = {}) {
  const { allowRecoverySession = false } = options;
  const token = getBearerToken(req);
  if (!token) {
    return { errorStatus: 401, errorCode: 'MISSING_BEARER_TOKEN' };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { errorStatus: 401, errorCode: 'INVALID_TOKEN' };
  }

  if (!allowRecoverySession && isRecoveryOnlyToken(token)) {
    return { errorStatus: 403, errorCode: 'RECOVERY_PASSWORD_REQUIRED' };
  }

  const authUser = data.user;
  const { data: existingRow } = await fetchDbProfile(supabaseAdmin, authUser.id);
  let profile = buildEffectiveProfile(authUser, existingRow);

  // Bootstrap inicial: se ainda não existe perfil para este utilizador criado previamente
  if (!existingRow && !authUser.app_metadata?.nivel_acesso) {
    const count = await countDbProfiles(supabaseAdmin);

    const initialRole = !count || count === 0 ? 'administrador' : 'operador';
    const initialPerms = defaultPermissionsForRole(initialRole);

    const bootstrapRow = {
      id: authUser.id,
      nome_completo:
        authUser.user_metadata?.nome_completo ||
        authUser.email?.split('@')[0] ||
        'Administrador Geral',
      email: authUser.email,
      cargo: initialRole === 'administrador' ? 'Administrador Geral' : 'Operador Interno',
      departamento: 'Administração',
      nivel_acesso: initialRole,
      permissoes: initialPerms,
      senha_provisoria: false,
      ativo: true,
      ultimo_login_em: new Date().toISOString(),
    };

    try {
      await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        app_metadata: {
          ...(authUser.app_metadata || {}),
          nivel_acesso: initialRole,
          permissoes: initialPerms,
          must_change_password: false,
          ativo: true,
        },
      });
    } catch {
      // Ignore auth metadata update failure during bootstrap
    }

    const upserted = await upsertDbProfile(supabaseAdmin, bootstrapRow);
    profile = buildEffectiveProfile(authUser, upserted.data || bootstrapRow);
  }

  if (!profile.ativo) {
    return { errorStatus: 403, errorCode: 'ACCOUNT_DISABLED' };
  }

  return { authUser, profile, existingRow };
}

exports.api = onRequest(
  {
    region: 'europe-west1',
    secrets: [supabaseUrlSecret, supabaseAnonKeySecret, supabaseServiceRoleSecret],
    cors: false,
  },
  async (req, res) => {
    applySecurityHeaders(req, res);

    if (req.method === 'OPTIONS') {
      if (!isOriginAllowed(req)) {
        res.status(403).json({ error: 'FORBIDDEN_ORIGIN' });
        return;
      }
      res.status(204).send('');
      return;
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !isOriginAllowed(req)) {
      res.status(403).json({ error: 'FORBIDDEN_ORIGIN' });
      return;
    }

    const requestPath = (req.path || '/').replace(/\/+$/, '') || '/';
    const supabaseUrl = (supabaseUrlSecret.value() || '').trim();
    const supabaseAnonKey = (supabaseAnonKeySecret.value() || '').trim();
    const supabaseServiceRoleKey = (supabaseServiceRoleSecret.value() || '').trim();

    if (req.method === 'GET' && requestPath === '/api/auth/config') {
      if (!supabaseUrl || !supabaseAnonKey) {
        res.status(503).json({
          error: 'AUTH_SERVICE_UNAVAILABLE',
          message: 'Serviço de autenticação temporariamente indisponível.',
        });
        return;
      }

      res.status(200).json({ url: supabaseUrl, anonKey: supabaseAnonKey });
      return;
    }

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      res.status(503).json({
        authenticated: false,
        error: 'SUPABASE_ADMIN_SECRET_NOT_CONFIGURED',
      });
      return;
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // ── POST /api/public/careers (Formulário Trabalhe Connosco + Currículo) ───
    if (req.method === 'POST' && requestPath === '/api/public/careers') {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};

        // Honeypot anti-spam silencioso
        if (String(body.website || body.companyWebsite || '').trim()) {
          res.status(201).json({
            ok: true,
            code: `CAN-${Date.now().toString(36).toUpperCase()}`,
            message: 'Candidatura submetida com sucesso!',
          });
          return;
        }

        const fullName = String(body.fullName || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const phone = String(body.phone || '').trim();
        const district = String(body.district || 'Porto').trim();
        const specialty = String(body.specialty || '').trim();
        const experience = String(body.experience || '1 a 3 anos').trim();
        const availability = String(body.availability || 'Imediata').trim();
        const drivingLicense = String(body.drivingLicense || 'Não indicada').trim();
        const certifications = String(body.certifications || '').trim();
        const message = String(body.message || '').trim();
        const rgpdConsent = body.rgpdConsent === true;

        if (fullName.length < 2) {
          res.status(400).json({
            error: 'INVALID_NAME',
            message: 'Indique o seu nome completo (mínimo 2 caracteres).',
          });
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          res.status(400).json({
            error: 'INVALID_EMAIL',
            message: 'Introduza um endereço de email válido.',
          });
          return;
        }
        if (phone.replace(/\D/g, '').length < 9) {
          res.status(400).json({
            error: 'INVALID_PHONE',
            message: 'Introduza um número de telemóvel ou telefone válido.',
          });
          return;
        }
        if (!specialty) {
          res.status(400).json({
            error: 'MISSING_SPECIALTY',
            message: 'Selecione a área de especialidade ou função pretendida.',
          });
          return;
        }
        if (!rgpdConsent) {
          res.status(400).json({
            error: 'RGPD_REQUIRED',
            message: 'É necessário aceitar o tratamento de dados pessoais para fins de recrutamento.',
          });
          return;
        }

        const rawCvB64 = String(body.cvBase64 || '');
        if (!rawCvB64) {
          res.status(400).json({
            error: 'MISSING_CV',
            message: 'Anexe o seu currículo em PDF, Word (DOC/DOCX) ou imagem antes de submeter.',
          });
          return;
        }

        const cvBuffer = Buffer.from(rawCvB64, 'base64');
        if (cvBuffer.length === 0 || cvBuffer.length > 10 * 1024 * 1024) {
          res.status(400).json({
            error: 'INVALID_CV_SIZE',
            message: 'O currículo excede o limite máximo permitido de 10 MB.',
          });
          return;
        }

        const rawMime = String(body.cvFileType || 'application/pdf').toLowerCase();
        const allowedMimes = new Set([
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'image/png',
          'image/jpeg',
        ]);
        const safeFileExtOk = /\.(pdf|docx?|png|jpe?g)$/i.test(String(body.cvFileName || ''));
        if (!allowedMimes.has(rawMime) && !safeFileExtOk) {
          res.status(400).json({
            error: 'INVALID_CV_TYPE',
            message: 'Formato não suportado. Envie o currículo em PDF, DOC, DOCX, PNG ou JPG.',
          });
          return;
        }
        const effectiveMime = allowedMimes.has(rawMime) ? rawMime : 'application/pdf';

        const ipHash = getClientIpHash(req);
        if (ipHash) {
          try {
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const { count } = await supabaseAdmin
              .schema('rh')
              .from('candidaturas')
              .select('id', { count: 'exact', head: true })
              .eq('ip_hash', ipHash)
              .gte('criado_em', oneHourAgo);
            if ((count || 0) >= 6) {
              res.status(429).json({
                error: 'RATE_LIMITED',
                message: 'Foram enviadas várias candidaturas seguidas a partir desta ligação. Aguarde alguns minutos e tente novamente.',
              });
              return;
            }
          } catch {
            // Ignora rate limit se tabela ainda não existir
          }
        }

        const candCode = `CAN-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
        const originalName = String(body.cvFileName || 'curriculo.pdf');
        const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${candCode}/${safeName}`;

        const { error: uploadErr } = await supabaseAdmin.storage
          .from('curriculos-candidatos')
          .upload(storagePath, cvBuffer, { contentType: effectiveMime, upsert: true });

        if (uploadErr) {
          res.status(400).json({
            error: 'CV_UPLOAD_ERROR',
            message: formatUserSafeError(uploadErr, 'Não foi possível enviar o currículo neste momento. Tente novamente.', 'CAREERS_CV_UPLOAD_ERROR'),
          });
          return;
        }

        const dbPayload = {
          code: candCode,
          fullName,
          email,
          phone,
          district,
          specialty,
          experience,
          availability,
          drivingLicense,
          certifications,
          message,
          cvFileName: originalName,
          cvFileType: effectiveMime,
          cvFileSize: cvBuffer.length,
          cvStoragePath: storagePath,
          ipHash,
        };

        let savedRow = null;
        let dbErr = null;
        try {
          const rpcRes = await supabaseAdmin.rpc('spark_erp_create_candidate', {
            p_payload: dbPayload,
          });
          savedRow = rpcRes.data;
          dbErr = rpcRes.error;
        } catch (err) {
          dbErr = err;
        }

        if (dbErr) {
          try {
            const { data: insRow, error: insErr } = await supabaseAdmin
              .schema('rh')
              .from('candidaturas')
              .insert({
                codigo_candidatura: candCode,
                nome_completo: fullName,
                email,
                telefone: phone,
                distrito: district || 'Porto',
                area_especialidade: specialty,
                experiencia: experience || '1 a 3 anos',
                disponibilidade: availability || 'Imediata',
                carta_conducao: drivingLicense || 'Não indicada',
                certificacoes: certifications || null,
                mensagem: message || null,
                cv_nome_ficheiro: originalName,
                cv_tipo_mime: effectiveMime,
                cv_tamanho_bytes: cvBuffer.length,
                cv_caminho_storage: storagePath,
                estado: 'Nova',
                ip_hash: ipHash || null,
              })
              .select('*')
              .single();
            if (!insErr && insRow) {
              savedRow = mapCandidateDbRow(insRow);
              dbErr = null;
            }
          } catch {
            // Mantém dbErr original
          }
        }

        if (dbErr || !savedRow) {
          await supabaseAdmin.storage.from('curriculos-candidatos').remove([storagePath]).catch(() => {});
          res.status(500).json({
            error: 'CAREERS_SAVE_ERROR',
            message: formatUserSafeError(
              dbErr,
              'Não foi possível registar a sua candidatura neste momento. Tente novamente ou contacte-nos por telefone.',
              'CAREERS_SAVE_ERROR'
            ),
          });
          return;
        }

        res.status(201).json({
          ok: true,
          code: savedRow.id || candCode,
          message:
            'Candidatura submetida com sucesso! A nossa equipa de Recursos Humanos irá analisar o seu perfil e entrar em contacto brevemente.',
        });
        return;
      } catch (err) {
        console.error('[CAREERS_SUBMIT_ERROR]', err);
        res.status(500).json({
          error: 'CAREERS_INTERNAL_ERROR',
          message: 'Ocorreu um erro inesperado ao submeter a candidatura. Tente novamente dentro de instantes.',
        });
        return;
      }
    }

    // ── POST /api/auth/login (Utilizador ou Email + Senha) ───────────────────
    if (req.method === 'POST' && requestPath === '/api/auth/login') {
      try {
        if (!supabaseAnonKey) {
          res.status(503).json({
            error: 'AUTH_SERVICE_UNAVAILABLE',
            message: 'Serviço de autenticação temporariamente indisponível.',
          });
          return;
        }

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const rawIdentifier = String(body.identifier || body.username || body.email || '')
          .trim()
          .toLowerCase();
        const password = String(body.password || '');

        if (!rawIdentifier || !password) {
          res.status(400).json({
            error: 'MISSING_CREDENTIALS',
            message: 'Preencha o nome de utilizador (ou email) e a palavra-passe.',
          });
          return;
        }

        let resolvedAuthEmail = rawIdentifier.includes('@') ? rawIdentifier : '';

        try {
          const { data: resolved, error: resolveErr } = await supabaseAdmin.rpc(
            'spark_resolve_login_identifier',
            { p_identifier: rawIdentifier }
          );
          if (!resolveErr && resolved?.found) {
            if (resolved.ativo === false) {
              res.status(403).json({
                error: 'ACCOUNT_DISABLED',
                message: 'A sua conta encontra-se desativada ou bloqueada. Contacte a administração.',
              });
              return;
            }
            if (resolved.auth_email) {
              resolvedAuthEmail = String(resolved.auth_email).trim().toLowerCase();
            }
          }
        } catch {
          // Fallback abaixo caso a migração 05 ainda não tenha sido aplicada
        }

        if (!resolvedAuthEmail && !rawIdentifier.includes('@')) {
          const { rows } = await listDbProfiles(supabaseAdmin);
          const matched = (rows || []).find(
            (r) => String(r?.username || '').trim().toLowerCase() === rawIdentifier
          );
          if (matched?.email) {
            resolvedAuthEmail = String(matched.email).trim().toLowerCase();
          }
        }

        if (!resolvedAuthEmail) {
          res.status(401).json({
            error: 'INVALID_CREDENTIALS',
            message: 'Utilizador ou palavra-passe inválidos. Verifique as suas credenciais e tente novamente.',
          });
          return;
        }

        const supabasePublic = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: loginData, error: loginErr } = await supabasePublic.auth.signInWithPassword({
          email: resolvedAuthEmail,
          password,
        });

        if (loginErr || !loginData?.session || !loginData?.user) {
          const msgLower = String(loginErr?.message || '').toLowerCase();
          if (msgLower.includes('too many requests') || msgLower.includes('rate limit')) {
            res.status(429).json({
              error: 'RATE_LIMITED',
              message: 'Demasiadas tentativas seguidas. Aguarde alguns instantes antes de tentar novamente.',
            });
            return;
          }
          res.status(401).json({
            error: 'INVALID_CREDENTIALS',
            message: 'Utilizador ou palavra-passe inválidos. Verifique as suas credenciais e tente novamente.',
          });
          return;
        }

        const { data: existingRow } = await fetchDbProfile(supabaseAdmin, loginData.user.id);
        const profile = buildEffectiveProfile(loginData.user, existingRow);

        if (!profile.ativo) {
          res.status(403).json({
            error: 'ACCOUNT_DISABLED',
            message: 'A sua conta encontra-se desativada ou bloqueada.',
          });
          return;
        }

        await touchDbLogin(supabaseAdmin, loginData.user.id);

        res.status(200).json({
          authenticated: true,
          session: loginData.session,
          user: loginData.user,
          profile,
        });
        return;
      } catch (err) {
        console.error('Erro no login do sistema:', err);
        res.status(500).json({
          error: 'LOGIN_INTERNAL_ERROR',
          message: 'Não foi possível validar o acesso neste momento.',
        });
        return;
      }
    }

    // ── POST /api/auth/verify ────────────────────────────────────────────────
    if (req.method === 'POST' && requestPath === '/api/auth/verify') {
      try {
        const ctx = await resolveCallerContext(req, supabaseAdmin);
        if (ctx.errorStatus) {
          res.status(ctx.errorStatus).json({ authenticated: false, error: ctx.errorCode });
          return;
        }

        await touchDbLogin(supabaseAdmin, ctx.authUser.id);

        res.status(200).json({
          authenticated: true,
          user: {
            id: ctx.authUser.id,
            email: ctx.authUser.email,
            role: ctx.authUser.role,
            app_metadata: ctx.authUser.app_metadata,
          },
          profile: ctx.profile,
        });
        return;
      } catch (err) {
        console.error('Erro na verificação de token Supabase:', err);
        res.status(500).json({ authenticated: false, error: 'VERIFICATION_INTERNAL_ERROR' });
        return;
      }
    }

    // ── POST /api/auth/forgot-password ───────────────────────────────────────
    if (req.method === 'POST' && requestPath === '/api/auth/forgot-password') {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const identifier = String(body.identifier || body.email || '').trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const usernameRegex = /^[a-zA-Z0-9._-]{3,64}$/;
        if (!identifier || (!emailRegex.test(identifier) && !usernameRegex.test(identifier))) {
          res.status(400).json({
            error: 'INVALID_IDENTIFIER',
            message: 'Introduza um email válido ou o seu nome de utilizador (ex.: adminspark).',
          });
          return;
        }

        const safeOrigin = getSafeRequestOrigin(req);
        const ipHash = getClientIpHash(req);
        const redirectTo = `${safeOrigin}/login/`;

        let checkResult = null;
        try {
          const { data: rpcCheck, error: rpcErr } = await supabaseAdmin.rpc(
            'spark_check_password_recovery',
            { p_email: identifier, p_ip_hash: ipHash || null }
          );
          if (!rpcErr && rpcCheck && typeof rpcCheck === 'object') {
            checkResult = rpcCheck;
          }
        } catch {
          // Fallback caso a migração SQL 04/05 ainda não tenha sido aplicada
        }

        if (!checkResult) {
          const { rows } = await listDbProfiles(supabaseAdmin);
          const matched = (rows || []).find(
            (r) =>
              String(r?.username || '').trim().toLowerCase() === identifier ||
              String(r?.email_recuperacao || '').trim().toLowerCase() === identifier ||
              String(r?.email || '').trim().toLowerCase() === identifier
          );
          const fallbackAuthEmail = matched?.email ? String(matched.email).trim().toLowerCase() : identifier;
          const fallbackDelivery = matched?.email_recuperacao
            ? String(matched.email_recuperacao).trim().toLowerCase()
            : fallbackAuthEmail;
          checkResult = {
            allowed: true,
            reason: 'OK',
            retry_after_seconds: 0,
            user_exists: Boolean(matched),
            user_active: matched ? matched.ativo !== false : false,
            utilizador_id: matched?.id || null,
            nome_completo: matched?.nome_completo || null,
            cargo: matched?.cargo || null,
            departamento: matched?.departamento || null,
            auth_email: fallbackAuthEmail,
            delivery_email: fallbackDelivery,
            is_placeholder_only: fallbackDelivery.endsWith('@sistema.sparksmirk.internal'),
          };
        }

        if (!checkResult.allowed) {
          const retryAfter = Number(checkResult.retry_after_seconds || 60);
          try {
            await supabaseAdmin.rpc('spark_log_password_recovery', {
              p_payload: {
                email: checkResult.delivery_email || identifier,
                canal_envio: 'bloqueado',
                origem_url: safeOrigin,
                ip_hash: ipHash,
                estado: 'bloqueado',
                detalhes: { reason: checkResult.reason, retry_after_seconds: retryAfter },
              },
            });
          } catch {
            // Non-blocking audit
          }

          res.status(429).json({
            error: checkResult.reason || 'RATE_LIMIT_EXCEEDED',
            retryAfterSeconds: retryAfter,
            message:
              checkResult.reason === 'COOLDOWN_ACTIVE'
                ? `Aguarde ${retryAfter} segundos antes de solicitar um novo link.`
                : 'Demasiados pedidos de recuperação seguidos. Aguarde alguns minutos antes de tentar novamente.',
          });
          return;
        }

        const targetDeliveryEmail = String(checkResult.delivery_email || identifier).trim().toLowerCase();
        const authAccountEmail = String(checkResult.auth_email || targetDeliveryEmail).trim().toLowerCase();

        if (!checkResult.user_exists || !checkResult.user_active || checkResult.is_placeholder_only) {
          try {
            await supabaseAdmin.rpc('spark_log_password_recovery', {
              p_payload: {
                utilizador_id: checkResult.utilizador_id || null,
                email: targetDeliveryEmail || identifier,
                nome_completo: checkResult.nome_completo || null,
                canal_envio: 'ignorado',
                origem_url: safeOrigin,
                ip_hash: ipHash,
                estado: 'ignorado',
                detalhes: {
                  user_exists: Boolean(checkResult.user_exists),
                  user_active: Boolean(checkResult.user_active),
                  placeholder_only: Boolean(checkResult.is_placeholder_only),
                },
              },
            });
          } catch {
            // Non-blocking audit
          }

          if (checkResult.user_exists && checkResult.is_placeholder_only) {
            res.status(400).json({
              error: 'RECOVERY_EMAIL_NOT_CONFIGURED',
              message:
                'Este utilizador ainda não registou um email de recuperação na aba Configurações. Contacte o administrador para redefinir o acesso.',
            });
            return;
          }

          res.status(200).json({
            ok: true,
            message:
              'Se a conta estiver registada, ativa e com email configurado, enviaremos em instantes as instruções personalizadas de recuperação.',
          });
          return;
        }

        let deliveryChannel = 'auth_email';
        let deliveredCustom = false;

        const hasCustomTransport = Boolean(
          (process.env.RESEND_API_KEY || '').trim() ||
            ((process.env.SMTP_HOST || '').trim() &&
              (process.env.SMTP_USER || '').trim() &&
              (process.env.SMTP_PASS || '').trim())
        );

        if (hasCustomTransport) {
          try {
            const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
              type: 'recovery',
              email: authAccountEmail,
              options: { redirectTo },
            });
            const hashedToken = linkData?.properties?.hashed_token;
            if (!linkErr && hashedToken) {
              const actionUrl = `${safeOrigin}/login/?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;
              const mail = buildSparkRecoveryEmailContent({
                nomeCompleto: checkResult.nome_completo,
                cargo: checkResult.cargo,
                departamento: checkResult.departamento,
                email: targetDeliveryEmail,
                actionUrl,
                originUrl: safeOrigin,
              });
              const sentRes = await sendCustomRecoveryEmail({
                toEmail: targetDeliveryEmail,
                subject: mail.subject,
                html: mail.html,
                text: mail.text,
              });
              if (sentRes.sent) {
                deliveredCustom = true;
                deliveryChannel = sentRes.channel;
              }
            }
          } catch (customMailErr) {
            console.warn('Falha no envio SMTP/API personalizado, a tentar canal principal:', customMailErr?.message || customMailErr);
          }
        }

        if (!deliveredCustom) {
          if (!supabaseAnonKey) {
            res.status(503).json({
              error: 'RECOVERY_SERVICE_UNAVAILABLE',
              message: 'Serviço de recuperação temporariamente indisponível.',
            });
            return;
          }

          // Caso auth_email ainda difira do email_recuperacao configurado, sincroniza primeiro
          if (targetDeliveryEmail && targetDeliveryEmail !== authAccountEmail && checkResult.utilizador_id) {
            await supabaseAdmin.auth.admin
              .updateUserById(checkResult.utilizador_id, {
                email: targetDeliveryEmail,
                email_confirm: true,
              })
              .catch(() => {});
          }

          const supabasePublic = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          });
          const { error: resetErr } = await supabasePublic.auth.resetPasswordForEmail(
            targetDeliveryEmail,
            { redirectTo }
          );

          if (resetErr) {
            const errMsgLower = String(resetErr.message || '').toLowerCase();
            try {
              await supabaseAdmin.rpc('spark_log_password_recovery', {
                p_payload: {
                  utilizador_id: checkResult.utilizador_id || null,
                  email: targetDeliveryEmail,
                  nome_completo: checkResult.nome_completo || null,
                  canal_envio: 'auth_email',
                  origem_url: safeOrigin,
                  ip_hash: ipHash,
                  estado: 'erro',
                  detalhes: { error: resetErr.message },
                },
              });
            } catch {
              // Non-blocking audit
            }

            if (errMsgLower.includes('rate limit') || errMsgLower.includes('security purposes')) {
              res.status(429).json({
                error: 'PROVIDER_RATE_LIMIT',
                message: 'Por motivos de segurança, aguarde alguns instantes antes de solicitar outro email de recuperação.',
              });
              return;
            }

            res.status(500).json({
              error: 'RECOVERY_SEND_FAILED',
              message: 'Não foi possível enviar o email de recuperação neste momento. Tente novamente dentro de instantes.',
            });
            return;
          }
        }

        try {
          await supabaseAdmin.rpc('spark_log_password_recovery', {
            p_payload: {
              utilizador_id: checkResult.utilizador_id || null,
              email: targetDeliveryEmail,
              nome_completo: checkResult.nome_completo || null,
              canal_envio: deliveryChannel,
              origem_url: safeOrigin,
              ip_hash: ipHash,
              estado: 'email_enviado',
              detalhes: { redirectTo, identifier },
            },
          });
        } catch {
          await writeAuditLog(supabaseAdmin, {
            userId: checkResult.utilizador_id || null,
            userEmail: targetDeliveryEmail,
            modulo: 'seguranca.recuperacao',
            acao: 'SOLICITAR_RECUPERACAO_SENHA',
            entidadeId: checkResult.utilizador_id || targetDeliveryEmail,
            detalhes: { canal_envio: deliveryChannel, origem_url: safeOrigin, identifier },
          });
        }

        res.status(200).json({
          ok: true,
          deliveryChannel,
          message:
            'Enviámos as instruções personalizadas de recuperação para o email registado na sua conta. Verifique também a pasta de spam ou correio não solicitado.',
        });
        return;
      } catch (err) {
        console.error('Erro no pedido de recuperação de palavra-passe:', err);
        res.status(500).json({
          error: 'FORGOT_PASSWORD_ERROR',
          message: 'Erro interno ao processar o pedido de recuperação.',
        });
        return;
      }
    }

    // ── POST /api/auth/complete-password-recovery ────────────────────────────
    if (req.method === 'POST' && requestPath === '/api/auth/complete-password-recovery') {
      try {
        const ctx = await resolveCallerContext(req, supabaseAdmin, {
          allowRecoverySession: true,
        });
        if (ctx.errorStatus) {
          res.status(ctx.errorStatus).json({ error: ctx.errorCode });
          return;
        }

        const nowIso = new Date().toISOString();
        const ipHash = getClientIpHash(req);

        await supabaseAdmin.auth.admin.updateUserById(ctx.authUser.id, {
          app_metadata: {
            ...(ctx.authUser.app_metadata || {}),
            must_change_password: false,
          },
        });

        let dbSynced = false;
        try {
          const { error: completeErr } = await supabaseAdmin.rpc(
            'spark_complete_password_recovery',
            {
              p_user_id: ctx.authUser.id,
              p_email: ctx.authUser.email || ctx.profile.email,
              p_ip_hash: ipHash || null,
            }
          );
          dbSynced = !completeErr;
        } catch {
          dbSynced = false;
        }

        if (!dbSynced) {
          const sync = await upsertDbProfile(supabaseAdmin, {
            id: ctx.authUser.id,
            nome_completo: ctx.profile.nome_completo,
            email: ctx.profile.email,
            cargo: ctx.profile.cargo,
            departamento: ctx.profile.departamento,
            telefone: ctx.profile.telefone,
            nivel_acesso: ctx.profile.nivel_acesso,
            permissoes: ctx.profile.permissoes,
            ativo: ctx.profile.ativo,
            senha_provisoria: false,
            senha_alterada_em: nowIso,
            ultimo_login_em: nowIso,
          });
          dbSynced = sync.synced;

          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'seguranca.recuperacao',
            acao: 'REDEFINIR_SENHA_EMAIL',
            entidadeId: ctx.authUser.id,
            detalhes: { senha_alterada_em: nowIso, ip_hash: ipHash },
          });
        }

        res.status(200).json({
          ok: true,
          dbSynced,
          message: 'Palavra-passe redefinida e registada com segurança.',
        });
        return;
      } catch (err) {
        console.error('Erro ao registar conclusão da recuperação de palavra-passe:', err);
        res.status(500).json({ error: 'COMPLETE_PASSWORD_RECOVERY_ERROR' });
        return;
      }
    }

    // ── POST /api/auth/complete-password-change ──────────────────────────────
    if (req.method === 'POST' && requestPath === '/api/auth/complete-password-change') {
      try {
        const ctx = await resolveCallerContext(req, supabaseAdmin);
        if (ctx.errorStatus) {
          res.status(ctx.errorStatus).json({ error: ctx.errorCode });
          return;
        }

        const nowIso = new Date().toISOString();
        const { error: authUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(
          ctx.authUser.id,
          {
            app_metadata: {
              ...(ctx.authUser.app_metadata || {}),
              must_change_password: false,
            },
          }
        );

        if (authUpdateErr) {
          res.status(400).json({
            error: 'AUTH_UPDATE_FAILED',
            message: formatUserSafeError(
              authUpdateErr,
              'Não foi possível atualizar a palavra-passe. Tente novamente.',
              'AUTH_UPDATE_FAILED'
            ),
          });
          return;
        }

        const sync = await upsertDbProfile(supabaseAdmin, {
          id: ctx.authUser.id,
          nome_completo: ctx.profile.nome_completo,
          email: ctx.profile.email,
          cargo: ctx.profile.cargo,
          departamento: ctx.profile.departamento,
          telefone: ctx.profile.telefone,
          nivel_acesso: ctx.profile.nivel_acesso,
          permissoes: ctx.profile.permissoes,
          ativo: ctx.profile.ativo,
          senha_provisoria: false,
          senha_alterada_em: nowIso,
          ultimo_login_em: nowIso,
        });

        await writeAuditLog(supabaseAdmin, {
          userId: ctx.authUser.id,
          userEmail: ctx.authUser.email,
          acao: 'ATUALIZAR_SENHA_PROVISORIA',
          entidadeId: ctx.authUser.id,
          detalhes: { senha_alterada_em: nowIso },
        });

        res.status(200).json({
          ok: true,
          dbSynced: sync.synced,
          profile: { ...ctx.profile, senha_provisoria: false, senha_alterada_em: nowIso },
        });
        return;
      } catch (err) {
        console.error('Erro ao concluir alteração de senha provisória:', err);
        res.status(500).json({ error: 'COMPLETE_PASSWORD_CHANGE_ERROR' });
        return;
      }
    }

    // ── PUT /api/account/profile (Aba Configurações — Próprio Utilizador) ────
    if (req.method === 'PUT' && requestPath === '/api/account/profile') {
      try {
        const ctx = await resolveCallerContext(req, supabaseAdmin);
        if (ctx.errorStatus) {
          res.status(ctx.errorStatus).json({ error: ctx.errorCode });
          return;
        }

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const nomeCompleto = String(body.nome_completo ?? ctx.profile.nome_completo).trim();
        const emailRecuperacao = String(body.email_recuperacao ?? ctx.profile.email_recuperacao ?? '')
          .trim()
          .toLowerCase();
        const cleanNif = String(body.nif ?? ctx.profile.nif ?? '').replace(/\D/g, '');
        const telefone = String(body.telefone ?? ctx.profile.telefone ?? '').trim();
        const morada = String(body.morada ?? ctx.profile.morada ?? '').trim();
        const cargo = String(body.cargo ?? ctx.profile.cargo ?? 'Gestor Interno').trim();
        const departamento = String(body.departamento ?? ctx.profile.departamento ?? 'Geral').trim();

        if (!nomeCompleto || nomeCompleto.length < 2) {
          res.status(400).json({
            error: 'INVALID_NAME',
            message: 'Introduza o seu nome completo.',
          });
          return;
        }

        if (emailRecuperacao) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(emailRecuperacao) || emailRecuperacao.endsWith('@sistema.sparksmirk.internal')) {
            res.status(400).json({
              error: 'INVALID_RECOVERY_EMAIL',
              message: 'Introduza um endereço de email válido para contacto e recuperação de palavra-passe.',
            });
            return;
          }
        }

        if (cleanNif) {
          let invalidNif = cleanNif.length !== 9 || !/^[1235689]/.test(cleanNif);
          if (!invalidNif) {
            let sum = 0;
            for (let i = 0; i < 8; i += 1) sum += Number(cleanNif[i]) * (9 - i);
            const rem = sum % 11;
            const checkDigit = rem < 2 ? 0 : 11 - rem;
            invalidNif = checkDigit !== Number(cleanNif[8]);
          }
          if (invalidNif) {
            res.status(400).json({
              error: 'INVALID_NIF',
              message: 'O NIF introduzido é inválido. Verifique os 9 dígitos.',
            });
            return;
          }
        }

        const currentAuthEmail = String(ctx.authUser.email || '').trim().toLowerCase();
        let shouldSyncAuthEmail = false;

        if (emailRecuperacao && emailRecuperacao !== currentAuthEmail) {
          const { rows: allRows } = await listDbProfiles(supabaseAdmin);
          const conflict = (allRows || []).find(
            (r) =>
              r.id !== ctx.authUser.id &&
              (String(r.email || '').trim().toLowerCase() === emailRecuperacao ||
                String(r.email_recuperacao || '').trim().toLowerCase() === emailRecuperacao)
          );
          if (conflict) {
            res.status(400).json({
              error: 'EMAIL_ALREADY_IN_USE',
              message: 'Este endereço de email já está associado a outra conta do sistema.',
            });
            return;
          }

          const { error: authEmailErr } = await supabaseAdmin.auth.admin.updateUserById(
            ctx.authUser.id,
            {
              email: emailRecuperacao,
              email_confirm: true,
              user_metadata: {
                ...(ctx.authUser.user_metadata || {}),
                nome_completo: nomeCompleto,
                email_recuperacao: emailRecuperacao,
                telefone,
                nif: cleanNif,
                morada,
                cargo,
                departamento,
              },
            }
          );

          if (authEmailErr) {
            res.status(400).json({
              error: 'AUTH_EMAIL_UPDATE_FAILED',
              message: formatUserSafeError(
                authEmailErr,
                'Não foi possível associar o novo email à conta.',
                'AUTH_EMAIL_UPDATE_FAILED'
              ),
            });
            return;
          }
          shouldSyncAuthEmail = true;
        } else {
          await supabaseAdmin.auth.admin
            .updateUserById(ctx.authUser.id, {
              user_metadata: {
                ...(ctx.authUser.user_metadata || {}),
                nome_completo: nomeCompleto,
                email_recuperacao: emailRecuperacao || null,
                telefone,
                nif: cleanNif,
                morada,
                cargo,
                departamento,
              },
            })
            .catch(() => {});
        }

        let updatedRow = null;
        try {
          const { data: rpcRow, error: rpcErr } = await supabaseAdmin.rpc(
            'spark_update_own_profile',
            {
              p_user_id: ctx.authUser.id,
              p_payload: {
                nome_completo: nomeCompleto,
                email_recuperacao: emailRecuperacao || null,
                sync_primary_email: shouldSyncAuthEmail,
                nif: cleanNif || null,
                telefone: telefone || null,
                morada: morada || null,
                cargo,
                departamento,
              },
            }
          );
          if (!rpcErr && rpcRow) {
            updatedRow = rpcRow;
          }
        } catch {
          // Fallback caso migração 05 ainda não tenha sido executada
        }

        if (!updatedRow) {
          const fallbackSync = await upsertDbProfile(supabaseAdmin, {
            id: ctx.authUser.id,
            username: ctx.profile.username || null,
            nome_completo: nomeCompleto,
            email: shouldSyncAuthEmail ? emailRecuperacao : ctx.profile.email,
            email_recuperacao: emailRecuperacao || null,
            cargo,
            departamento,
            telefone,
            nif: cleanNif || null,
            morada: morada || null,
            nivel_acesso: ctx.profile.nivel_acesso,
            permissoes: ctx.profile.permissoes,
            ativo: ctx.profile.ativo,
          });
          updatedRow = fallbackSync.data;
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: emailRecuperacao || ctx.authUser.email,
            modulo: 'seguranca.conta',
            acao: 'ATUALIZAR_PERFIL_PROPRIO',
            entidadeId: ctx.authUser.id,
            detalhes: { nome_completo: nomeCompleto, email_recuperacao: emailRecuperacao, nif: cleanNif },
          });
        }

        const freshAuth = await supabaseAdmin.auth.admin.getUserById(ctx.authUser.id);
        const freshProfile = buildEffectiveProfile(
          freshAuth?.data?.user || ctx.authUser,
          updatedRow
        );

        res.status(200).json({
          ok: true,
          profile: freshProfile,
          emailSynced: shouldSyncAuthEmail,
          message: 'Dados do seu cadastro atualizados e guardados com segurança.',
        });
        return;
      } catch (err) {
        console.error('Erro ao atualizar cadastro próprio:', err);
        res.status(500).json({
          error: 'PROFILE_UPDATE_ERROR',
          message: 'Não foi possível guardar os dados do cadastro.',
        });
        return;
      }
    }

    // ── GET /api/admin/users ─────────────────────────────────────────────────
    if (req.method === 'GET' && requestPath === '/api/admin/users') {
      try {
        const ctx = await resolveCallerContext(req, supabaseAdmin);
        if (ctx.errorStatus) {
          res.status(ctx.errorStatus).json({ error: ctx.errorCode });
          return;
        }

        if (!hasAdminUserAction(ctx.profile, 'ver')) {
          res.status(403).json({
            error: 'FORBIDDEN',
            message: 'Não tem permissão para consultar utilizadores.',
          });
          return;
        }

        const { data: authList, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });

        if (listErr) {
          res.status(500).json({
            error: 'LIST_USERS_FAILED',
            message: formatUserSafeError(listErr, 'Não foi possível carregar a lista de utilizadores.', 'LIST_USERS_FAILED'),
          });
          return;
        }

        const { rows: dbProfiles, dbWarning } = await listDbProfiles(supabaseAdmin);

        const dbMap = new Map(dbProfiles.map((r) => [r.id, r]));
        const users = (authList?.users || []).map((authUser) => {
          const row = dbMap.get(authUser.id);
          return buildEffectiveProfile(authUser, row);
        });

        res.status(200).json({ users, dbSynced: !dbWarning, dbWarning });
        return;
      } catch (err) {
        console.error('Erro ao listar utilizadores:', err);
        res.status(500).json({ error: 'ADMIN_LIST_ERROR' });
        return;
      }
    }

    // ── POST /api/admin/users ────────────────────────────────────────────────
    if (req.method === 'POST' && requestPath === '/api/admin/users') {
      try {
        const ctx = await resolveCallerContext(req, supabaseAdmin);
        if (ctx.errorStatus) {
          res.status(ctx.errorStatus).json({ error: ctx.errorCode });
          return;
        }

        if (!hasAdminUserAction(ctx.profile, 'criar')) {
          res.status(403).json({
            error: 'FORBIDDEN',
            message: 'Não tem permissão para criar utilizadores.',
          });
          return;
        }

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const nomeCompleto = String(body.nome_completo || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const cargo = String(body.cargo || 'Colaborador Interno').trim();
        const departamento = String(body.departamento || 'Geral').trim();
        const telefone = String(body.telefone || '').trim();
        const nivelAcesso = VALID_ROLES.has(body.nivel_acesso) ? body.nivel_acesso : 'operador';
        const provisionalPassword = String(body.provisionalPassword || '');
        const requireChange = body.senha_provisoria !== false;
        const permissoes = normalizePermissions(body.permissoes, nivelAcesso);

        if (!nomeCompleto || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'Indique um nome completo e email corporativo válido.',
          });
          return;
        }

        if (provisionalPassword.length < 8) {
          res.status(400).json({
            error: 'WEAK_PASSWORD',
            message: 'A palavra-passe provisória deve ter pelo menos 8 caracteres.',
          });
          return;
        }

        const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: provisionalPassword,
          email_confirm: true,
          user_metadata: {
            nome_completo: nomeCompleto,
            cargo,
            departamento,
            telefone,
          },
          app_metadata: {
            nivel_acesso: nivelAcesso,
            permissoes,
            must_change_password: requireChange,
            ativo: true,
          },
        });

        if (createErr || !created?.user) {
          res.status(400).json({
            error: 'CREATE_USER_FAILED',
            message: formatUserSafeError(createErr, 'Não foi possível criar a conta de utilizador.', 'CREATE_USER_FAILED'),
          });
          return;
        }

        const dbPayload = {
          id: created.user.id,
          nome_completo: nomeCompleto,
          email,
          cargo,
          departamento,
          telefone,
          nivel_acesso: nivelAcesso,
          permissoes,
          senha_provisoria: requireChange,
          ativo: true,
          criado_por: ctx.authUser.id,
        };

        const sync = await upsertDbProfile(supabaseAdmin, dbPayload);

        await writeAuditLog(supabaseAdmin, {
          userId: ctx.authUser.id,
          userEmail: ctx.authUser.email,
          acao: 'CRIAR_UTILIZADOR',
          entidadeId: created.user.id,
          detalhes: { email, nivel_acesso: nivelAcesso, senha_provisoria: requireChange },
        });

        res.status(201).json({
          user: buildEffectiveProfile(created.user, sync.data || dbPayload),
          dbSynced: sync.synced,
          dbWarning: sync.dbError,
        });
        return;
      } catch (err) {
        console.error('Erro ao criar utilizador:', err);
        res.status(500).json({ error: 'ADMIN_CREATE_ERROR' });
        return;
      }
    }

    // ── PUT / DELETE /api/admin/users/:id ────────────────────────────────────
    const userIdMatch = requestPath.match(/^\/api\/admin\/users\/([0-9a-fA-F-]+)$/);
    if (userIdMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
      const targetUserId = userIdMatch[1];

      try {
        const ctx = await resolveCallerContext(req, supabaseAdmin);
        if (ctx.errorStatus) {
          res.status(ctx.errorStatus).json({ error: ctx.errorCode });
          return;
        }

        if (req.method === 'PUT') {
          if (!hasAdminUserAction(ctx.profile, 'editar')) {
            res.status(403).json({
              error: 'FORBIDDEN',
              message: 'Não tem permissão para editar utilizadores.',
            });
            return;
          }

          const { data: targetData, error: targetErr } =
            await supabaseAdmin.auth.admin.getUserById(targetUserId);
          if (targetErr || !targetData?.user) {
            res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Utilizador não encontrado.' });
            return;
          }

          const existingAuth = targetData.user;
          const { data: existingDb } = await fetchDbProfile(supabaseAdmin, targetUserId);
          const currentEffective = buildEffectiveProfile(existingAuth, existingDb);

          const body = req.body && typeof req.body === 'object' ? req.body : {};
          const nomeCompleto = String(body.nome_completo ?? currentEffective.nome_completo).trim();
          const email = String(body.email ?? currentEffective.email).trim().toLowerCase();
          const cargo = String(body.cargo ?? currentEffective.cargo).trim();
          const departamento = String(body.departamento ?? currentEffective.departamento).trim();
          const telefone = String(body.telefone ?? currentEffective.telefone).trim();
          const nivelAcesso = VALID_ROLES.has(body.nivel_acesso)
            ? body.nivel_acesso
            : currentEffective.nivel_acesso;
          const ativo = typeof body.ativo === 'boolean' ? body.ativo : currentEffective.ativo;
          const permissoes = body.permissoes
            ? normalizePermissions(body.permissoes, nivelAcesso)
            : normalizePermissions(currentEffective.permissoes, nivelAcesso);

          if (targetUserId === ctx.authUser.id && (!ativo || nivelAcesso !== 'administrador')) {
            res.status(400).json({
              error: 'CANNOT_LOCK_SELF',
              message: 'Não pode desativar ou remover o perfil de administrador da sua própria conta.',
            });
            return;
          }

          if (
            targetUserId === ctx.authUser.id &&
            (!permissoes.admin_utilizadores?.ver || !permissoes.admin_utilizadores?.editar)
          ) {
            res.status(400).json({
              error: 'CANNOT_LOCK_SELF_ADMIN_TAB',
              message: 'Por segurança, não pode remover da sua própria conta o acesso à gestão de utilizadores.',
            });
            return;
          }

          const newProvisionalPassword = String(body.provisionalPassword || '').trim();
          if (newProvisionalPassword && newProvisionalPassword.length < 8) {
            res.status(400).json({
              error: 'WEAK_PASSWORD',
              message: 'A nova senha provisória deve ter pelo menos 8 caracteres.',
            });
            return;
          }

          const mustChangePassword = newProvisionalPassword
            ? body.senha_provisoria !== false
            : typeof body.senha_provisoria === 'boolean'
              ? body.senha_provisoria
              : currentEffective.senha_provisoria;

          const authUpdates = {
            email,
            user_metadata: {
              ...(existingAuth.user_metadata || {}),
              nome_completo: nomeCompleto,
              cargo,
              departamento,
              telefone,
            },
            app_metadata: {
              ...(existingAuth.app_metadata || {}),
              nivel_acesso: nivelAcesso,
              permissoes,
              must_change_password: mustChangePassword,
              ativo,
            },
            ban_duration: ativo ? 'none' : '876000h',
          };

          if (newProvisionalPassword) {
            authUpdates.password = newProvisionalPassword;
          }

          const { data: updatedAuth, error: updateErr } =
            await supabaseAdmin.auth.admin.updateUserById(targetUserId, authUpdates);

          if (updateErr || !updatedAuth?.user) {
            res.status(400).json({
              error: 'UPDATE_USER_FAILED',
              message: formatUserSafeError(
                updateErr,
                'Não foi possível atualizar os dados do utilizador.',
                'UPDATE_USER_FAILED'
              ),
            });
            return;
          }

          const dbPayload = {
            id: targetUserId,
            nome_completo: nomeCompleto,
            email,
            cargo,
            departamento,
            telefone,
            nivel_acesso: nivelAcesso,
            permissoes,
            senha_provisoria: mustChangePassword,
            ativo,
          };

          const sync = await upsertDbProfile(supabaseAdmin, dbPayload);

          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            acao: 'EDITAR_UTILIZADOR',
            entidadeId: targetUserId,
            detalhes: {
              email,
              nivel_acesso: nivelAcesso,
              ativo,
              redefiniu_senha_provisoria: Boolean(newProvisionalPassword),
            },
          });

          res.status(200).json({
            user: buildEffectiveProfile(updatedAuth.user, sync.data || dbPayload),
            dbSynced: sync.synced,
            dbWarning: sync.dbError,
          });
          return;
        }

        // DELETE
        if (!hasAdminUserAction(ctx.profile, 'excluir')) {
          res.status(403).json({
            error: 'FORBIDDEN',
            message: 'Não tem permissão para remover utilizadores.',
          });
          return;
        }

        if (targetUserId === ctx.authUser.id) {
          res.status(400).json({
            error: 'CANNOT_DELETE_SELF',
            message: 'Não é possível remover o utilizador atualmente autenticado.',
          });
          return;
        }

        const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
        if (deleteErr) {
          res.status(400).json({
            error: 'SUPABASE_DELETE_FAILED',
            message: formatUserSafeError(deleteErr, 'Não foi possível remover o utilizador.', 'SUPABASE_DELETE_FAILED'),
          });
          return;
        }

        await deleteDbProfile(supabaseAdmin, targetUserId);

        await writeAuditLog(supabaseAdmin, {
          userId: ctx.authUser.id,
          userEmail: ctx.authUser.email,
          acao: 'REMOVER_UTILIZADOR',
          entidadeId: targetUserId,
        });

        res.status(200).json({ ok: true, id: targetUserId });
        return;
      } catch (err) {
        console.error('Erro na gestão de utilizador:', err);
        res.status(500).json({ error: 'ADMIN_USER_OPERATION_ERROR' });
        return;
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MÓDULOS ERP (RH + RECIBOS + ANEXOS STORAGE + OPERACIONAL) — LIVE POSTGRES
    // ═══════════════════════════════════════════════════════════════════════════
    if (requestPath.startsWith('/api/erp')) {
      try {
        const ctx = await resolveCallerContext(req, supabaseAdmin);
        if (ctx.errorStatus) {
          res.status(ctx.errorStatus).json({ error: ctx.errorCode });
          return;
        }

        const canRhVer = hasModuleAction(ctx.profile, 'rh_funcionarios', 'ver');
        const canIncludeRh =
          canRhVer ||
          hasModuleAction(ctx.profile, 'rh_funcionarios', 'ordenados') ||
          hasModuleAction(ctx.profile, 'rh_funcionarios', 'pagamentos');
        const canRecibosVer = hasModuleAction(ctx.profile, 'rh_recibos', 'ver');
        const canOpVer = hasModuleAction(ctx.profile, 'op_obras', 'ver');

        // ── GET /api/erp/bootstrap ───────────────────────────────────────────
        if (req.method === 'GET' && requestPath === '/api/erp/bootstrap') {
          const { data: snapshot, error: snapErr } = await supabaseAdmin.rpc('spark_erp_snapshot', {
            p_include_rh: canIncludeRh,
            p_include_payslips: canRecibosVer,
            p_include_projects: canOpVer,
          });

          if (snapErr) {
            res.status(500).json({
              error: 'ERP_DB_READ_ERROR',
              message: 'Não foi possível carregar os registos da base de dados.',
            });
            return;
          }

          const candidates = canRhVer ? await loadCandidatesList(supabaseAdmin) : [];

          const safePayload = redactSnapshotForProfile(
            {
              ...(snapshot || {
                employees: [],
                attendance: {},
                employeeAdvances: [],
                employeeContracts: [],
                payslips: [],
                attachedReceipts: [],
                projects: [],
                projectInvoices: [],
                projectContracts: [],
                technicalManagers: [],
                technicalCertificates: [],
              }),
              candidates,
            },
            ctx.profile
          );
          res.status(200).json(safePayload);
          return;
        }

        // ── FUNCIONÁRIOS (POST / PUT / DELETE) ───────────────────────────────
        if (req.method === 'POST' && requestPath === '/api/erp/employees') {
          if (!hasModuleAction(ctx.profile, 'rh_funcionarios', 'criar')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para adicionar funcionários.' });
            return;
          }
          const rawEmp = req.body && typeof req.body === 'object' ? { ...req.body } : {};
          if (!hasModuleAction(ctx.profile, 'rh_funcionarios', 'ordenados')) {
            rawEmp.baseSalary = 0;
            rawEmp.dailyRate = 0;
            rawEmp.hourlyRate = 0;
            rawEmp.mealAllowance = 0;
            rawEmp.ssPercentage = 11;
            rawEmp.offPayrollType = 'mensal';
            rawEmp.offPayrollAmount = 0;
            rawEmp.twelfths = 'Não';
            rawEmp.twelfthsVacationManual = 0;
            rawEmp.twelfthsChristmasManual = 0;
          } else {
            rawEmp.offPayrollType =
              rawEmp.remunerationType === 'mensal'
                ? 'mensal'
                : rawEmp.offPayrollType === 'diaria'
                  ? 'diaria'
                  : 'mensal';
            rawEmp.offPayrollAmount = Math.max(0, Number(rawEmp.offPayrollAmount) || 0);
            rawEmp.twelfthsVacationManual =
              rawEmp.twelfths === 'personalizado' ? Math.max(0, Number(rawEmp.twelfthsVacationManual) || 0) : 0;
            rawEmp.twelfthsChristmasManual =
              rawEmp.twelfths === 'personalizado' ? Math.max(0, Number(rawEmp.twelfthsChristmasManual) || 0) : 0;
          }
          const { data, error } = await supabaseAdmin.rpc('spark_erp_upsert_employee', {
            p_payload: rawEmp,
            p_actor: ctx.authUser.id,
          });
          if (error) {
            res.status(400).json({
              error: 'EMPLOYEE_SAVE_ERROR',
              message: formatUserSafeError(error, 'Não foi possível guardar os dados do funcionário.', 'EMPLOYEE_SAVE_ERROR'),
            });
            return;
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'rh.funcionarios',
            acao: 'CRIAR_FUNCIONARIO',
            entidadeId: data?.id,
          });
          res.status(201).json(
            hasModuleAction(ctx.profile, 'rh_funcionarios', 'ordenados')
              ? data
              : {
                  ...(data || {}),
                  baseSalary: 0,
                  dailyRate: 0,
                  hourlyRate: 0,
                  mealAllowance: 0,
                  ssPercentage: 0,
                  offPayrollType: 'mensal',
                  offPayrollAmount: 0,
                  twelfths: 'Não',
                  twelfthsVacationManual: 0,
                  twelfthsChristmasManual: 0,
                  iban: '',
                  _salaryRestricted: true,
                }
          );
          return;
        }

        const empMatch = requestPath.match(/^\/api\/erp\/employees\/([^/]+)$/);
        if (empMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
          const empCode = decodeURIComponent(empMatch[1]);
          if (req.method === 'PUT') {
            const canEditCadastro = hasModuleAction(ctx.profile, 'rh_funcionarios', 'editar');
            const canEditSalary = hasModuleAction(ctx.profile, 'rh_funcionarios', 'ordenados');
            if (!canEditCadastro && !canEditSalary) {
              res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para editar dados ou condições salariais de funcionários.' });
              return;
            }
            let empPayload = { ...(req.body || {}), id: empCode };
            if (!canEditSalary || !canEditCadastro) {
              const { data: rhSnap } = await supabaseAdmin.rpc('spark_erp_snapshot', {
                p_include_rh: true,
                p_include_payslips: false,
                p_include_projects: false,
              });
              const existingEmp = (rhSnap?.employees || []).find((e) => e.id === empCode);
              if (existingEmp) {
                if (!canEditCadastro) {
                  empPayload = {
                    ...empPayload,
                    name: existingEmp.name,
                    role: existingEmp.role,
                    department: existingEmp.department,
                    nif: existingEmp.nif || '',
                    niss: existingEmp.niss || '',
                    cc: existingEmp.cc || '',
                    phone: existingEmp.phone || '',
                    email: existingEmp.email || '',
                    address: existingEmp.address || '',
                    contractType: existingEmp.contractType || 'Sem Termo',
                    admissionDate: existingEmp.admissionDate || '',
                    status: existingEmp.status || 'ativo',
                    notes: existingEmp.notes || '',
                  };
                }
                if (!canEditSalary) {
                  empPayload = {
                    ...empPayload,
                    remunerationType: existingEmp.remunerationType || 'mensal',
                    baseSalary: existingEmp.baseSalary ?? 0,
                    dailyRate: existingEmp.dailyRate ?? 0,
                    hourlyRate: existingEmp.hourlyRate ?? 0,
                    ssPercentage: existingEmp.ssPercentage ?? 11,
                    mealAllowance: existingEmp.mealAllowance ?? 0,
                    offPayrollType: existingEmp.offPayrollType || 'mensal',
                    offPayrollAmount: existingEmp.offPayrollAmount ?? 0,
                    iban: existingEmp.iban || '',
                    twelfths: existingEmp.twelfths || 'Não',
                    twelfthsVacationManual: existingEmp.twelfthsVacationManual ?? 0,
                    twelfthsChristmasManual: existingEmp.twelfthsChristmasManual ?? 0,
                  };
                }
              }
            }
            if (canEditSalary) {
              empPayload.offPayrollType =
                empPayload.remunerationType === 'mensal'
                  ? 'mensal'
                  : empPayload.offPayrollType === 'diaria'
                    ? 'diaria'
                    : 'mensal';
              empPayload.offPayrollAmount = Math.max(0, Number(empPayload.offPayrollAmount) || 0);
              empPayload.twelfthsVacationManual =
                empPayload.twelfths === 'personalizado'
                  ? Math.max(0, Number(empPayload.twelfthsVacationManual) || 0)
                  : 0;
              empPayload.twelfthsChristmasManual =
                empPayload.twelfths === 'personalizado'
                  ? Math.max(0, Number(empPayload.twelfthsChristmasManual) || 0)
                  : 0;
            }
            const { data, error } = await supabaseAdmin.rpc('spark_erp_upsert_employee', {
              p_payload: empPayload,
              p_actor: ctx.authUser.id,
            });
            if (error) {
              res.status(400).json({
                error: 'EMPLOYEE_UPDATE_ERROR',
                message: formatUserSafeError(error, 'Não foi possível atualizar os dados do funcionário.', 'EMPLOYEE_UPDATE_ERROR'),
              });
              return;
            }
            await writeAuditLog(supabaseAdmin, {
              userId: ctx.authUser.id,
              userEmail: ctx.authUser.email,
              modulo: 'rh.funcionarios',
              acao: 'EDITAR_FUNCIONARIO',
              entidadeId: empCode,
            });
            res.status(200).json(
              canEditSalary
                ? data
                : {
                    ...(data || {}),
                    baseSalary: 0,
                    dailyRate: 0,
                    hourlyRate: 0,
                    mealAllowance: 0,
                    ssPercentage: 0,
                    offPayrollType: 'mensal',
                    offPayrollAmount: 0,
                    twelfths: 'Não',
                    twelfthsVacationManual: 0,
                    twelfthsChristmasManual: 0,
                    iban: '',
                    _salaryRestricted: true,
                  }
            );
            return;
          }

          if (!hasModuleAction(ctx.profile, 'rh_funcionarios', 'excluir')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para excluir funcionários.' });
            return;
          }
          const { data: contractPaths, error } = await supabaseAdmin.rpc('spark_erp_delete_employee', { p_code: empCode });
          if (error) {
            res.status(400).json({
              error: 'EMPLOYEE_DELETE_ERROR',
              message: formatUserSafeError(error, 'Não foi possível excluir o funcionário.', 'EMPLOYEE_DELETE_ERROR'),
            });
            return;
          }
          if (Array.isArray(contractPaths) && contractPaths.length > 0) {
            await supabaseAdmin.storage.from('contratos-funcionarios').remove(contractPaths).catch(() => {});
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'rh.funcionarios',
            acao: 'EXCLUIR_FUNCIONARIO',
            entidadeId: empCode,
          });
          res.status(200).json({ ok: true });
          return;
        }

        // ── ASSIDUIDADE (PUT /api/erp/attendance) ────────────────────────────
        if (req.method === 'PUT' && requestPath === '/api/erp/attendance') {
          if (!hasModuleAction(ctx.profile, 'rh_funcionarios', 'assiduidade')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para registar assiduidade.' });
            return;
          }
          const body = req.body && typeof req.body === 'object' ? req.body : {};
          if (body.action === 'mark_all_present') {
            const { error } = await supabaseAdmin.rpc('spark_erp_mark_all_present', {
              p_date: body.dateISO,
              p_actor: ctx.authUser.id,
            });
            if (error) {
              res.status(400).json({
                error: 'ATTENDANCE_BATCH_ERROR',
                message: formatUserSafeError(error, 'Não foi possível registar as presenças em lote.', 'ATTENDANCE_BATCH_ERROR'),
              });
              return;
            }
          } else {
            const { error } = await supabaseAdmin.rpc('spark_erp_set_attendance', {
              p_emp_code: body.employeeId,
              p_date: body.dateISO,
              p_status: body.status || '',
              p_note: body.note || '',
              p_actor: ctx.authUser.id,
              p_hours: body.hours !== undefined ? Number(body.hours) : 8,
            });
            if (error) {
              res.status(400).json({
                error: 'ATTENDANCE_SAVE_ERROR',
                message: formatUserSafeError(error, 'Não foi possível guardar o registo de assiduidade.', 'ATTENDANCE_SAVE_ERROR'),
              });
              return;
            }
          }
          res.status(200).json({ ok: true });
          return;
        }

        // ── ADIANTAMENTOS DE ORDENADO (POST / DELETE) ────────────────────────
        if (req.method === 'POST' && requestPath === '/api/erp/employee-advances') {
          const canAdvance = hasModuleAction(ctx.profile, 'rh_funcionarios', 'pagamentos');
          if (!canAdvance) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para consultar ou registar adiantamentos salariais.' });
            return;
          }
          const body = req.body && typeof req.body === 'object' ? req.body : {};
          const empId = String(body.employeeId || '').trim();
          const amount = Number(body.amount);
          if (!empId || Number.isNaN(amount) || amount <= 0) {
            res.status(400).json({
              error: 'INVALID_ADVANCE_PAYLOAD',
              message: 'Indique o funcionário e um valor de adiantamento superior a € 0,00.',
            });
            return;
          }
          const { data, error } = await supabaseAdmin.rpc('spark_erp_add_advance', {
            p_payload: body,
            p_actor: ctx.authUser.id,
          });
          if (error) {
            res.status(400).json({
              error: 'ADVANCE_SAVE_ERROR',
              message: formatUserSafeError(error, 'Não foi possível registar o adiantamento salarial.', 'ADVANCE_SAVE_ERROR'),
            });
            return;
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'rh.adiantamentos',
            acao: 'ADIANTAMENTO_ORDENADO',
            entidadeId: data?.id || empId,
            detalhes: { employeeId: empId, month: body.month, amount },
          });
          res.status(201).json(data);
          return;
        }

        const advMatch = requestPath.match(/^\/api\/erp\/employee-advances\/([^/]+)$/);
        if (advMatch && req.method === 'DELETE') {
          const canDelAdv = hasModuleAction(ctx.profile, 'rh_funcionarios', 'pagamentos');
          if (!canDelAdv) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para remover adiantamentos.' });
            return;
          }
          const advCode = decodeURIComponent(advMatch[1]);
          const { error } = await supabaseAdmin.rpc('spark_erp_delete_advance', { p_code: advCode });
          if (error) {
            res.status(400).json({
              error: 'ADVANCE_DELETE_ERROR',
              message: formatUserSafeError(error, 'Não foi possível remover o adiantamento salarial.', 'ADVANCE_DELETE_ERROR'),
            });
            return;
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'rh.adiantamentos',
            acao: 'EXCLUIR_ADIANTAMENTO',
            entidadeId: advCode,
          });
          res.status(200).json({ ok: true });
          return;
        }

        // ── CONTRATOS DE TRABALHO EM PDF (rh.funcionarios_contratos) ────────
        if (req.method === 'POST' && requestPath === '/api/erp/employee-contracts') {
          const canManageEmpContract =
            hasModuleAction(ctx.profile, 'rh_funcionarios', 'criar') ||
            hasModuleAction(ctx.profile, 'rh_funcionarios', 'editar');
          if (!canManageEmpContract) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para anexar contratos de funcionários.' });
            return;
          }
          const body = req.body && typeof req.body === 'object' ? req.body : {};
          const employeeId = String(body.employeeId || '').trim();
          const title = String(body.title || 'Contrato de Trabalho').trim();
          if (!employeeId) {
            res.status(400).json({ error: 'MISSING_EMPLOYEE', message: 'Indique o funcionário associado ao contrato.' });
            return;
          }

          const ctrCode = String(body.id || `CTRF-${Date.now()}`);
          let storagePath = null;
          let uploadedBucketPath = null;
          let fileName = null;
          let mime = null;
          let fileSize = 0;

          const rawB64 = String(body.fileBase64 || '');
          if (rawB64) {
            const fileBuffer = Buffer.from(rawB64, 'base64');
            if (fileBuffer.length > 10 * 1024 * 1024) {
              res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'O PDF/ficheiro do contrato excede o limite de 10 MB.' });
              return;
            }
            mime = String(body.fileType || 'application/pdf');
            const allowedMime = mime === 'application/pdf' || mime.startsWith('image/');
            if (!allowedMime) {
              res.status(400).json({ error: 'INVALID_MIME', message: 'Apenas ficheiros PDF ou imagem são permitidos.' });
              return;
            }

            const safeEmp = employeeId.replace(/[^a-zA-Z0-9._-]/g, '_');
            const safeName = String(body.fileName || `${ctrCode}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
            storagePath = `${safeEmp}/${ctrCode}_${safeName}`;
            fileName = String(body.fileName || safeName);
            fileSize = fileBuffer.length;

            const { error: uploadErr } = await supabaseAdmin.storage
              .from('contratos-funcionarios')
              .upload(storagePath, fileBuffer, { contentType: mime, upsert: true });

            if (uploadErr) {
              res.status(400).json({
                error: 'STORAGE_UPLOAD_ERROR',
                message: formatUserSafeError(uploadErr, 'Não foi possível guardar o ficheiro selecionado.', 'STORAGE_UPLOAD_ERROR'),
              });
              return;
            }
            uploadedBucketPath = storagePath;
          }

          const { data: metaRow, error: dbErr } = await supabaseAdmin.rpc('spark_erp_upsert_employee_contract', {
            p_payload: {
              id: ctrCode,
              employeeId,
              title,
              contractType: body.contractType || 'Sem Termo',
              contractDate: body.contractDate || null,
              notes: body.notes || '',
              fileName,
              fileType: mime,
              fileSize,
              storagePath,
            },
            p_actor: ctx.authUser.id,
          });

          if (dbErr) {
            if (uploadedBucketPath) {
              await supabaseAdmin.storage.from('contratos-funcionarios').remove([uploadedBucketPath]).catch(() => {});
            }
            res.status(400).json({
              error: 'EMP_CONTRACT_SAVE_ERROR',
              message: formatUserSafeError(dbErr, 'Não foi possível guardar os dados do contrato.', 'EMP_CONTRACT_SAVE_ERROR'),
            });
            return;
          }

          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'rh.contratos',
            acao: 'ANEXAR_CONTRATO_FUNCIONARIO',
            entidadeId: metaRow?.id || ctrCode,
            detalhes: { employeeId, title, hasFile: Boolean(storagePath) },
          });

          res.status(201).json(metaRow);
          return;
        }

        const empCtrFileMatch = requestPath.match(/^\/api\/erp\/employee-contracts\/([^/]+)\/file$/);
        if (empCtrFileMatch && req.method === 'GET') {
          if (!canRhVer) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para visualizar contratos de funcionários.' });
            return;
          }
          const ctrCode = decodeURIComponent(empCtrFileMatch[1]);
          const { data: meta, error: metaErr } = await supabaseAdmin.rpc('spark_erp_get_employee_contract_file', {
            p_code: ctrCode,
          });
          if (metaErr || !meta?.storagePath) {
            res.status(404).json({ error: 'CONTRACT_FILE_NOT_FOUND', message: 'PDF do contrato não encontrado.' });
            return;
          }
          const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
            .from('contratos-funcionarios')
            .download(meta.storagePath);
          if (dlErr || !fileBlob) {
            res.status(404).json({ error: 'STORAGE_READ_ERROR', message: 'Não foi possível transferir o contrato.' });
            return;
          }
          const arrayBuf = await fileBlob.arrayBuffer();
          res.status(200).json({
            id: meta.id,
            name: meta.fileName,
            type: meta.fileType,
            size: meta.fileSize || arrayBuf.byteLength,
            base64: Buffer.from(arrayBuf).toString('base64'),
          });
          return;
        }

        const empCtrMatch = requestPath.match(/^\/api\/erp\/employee-contracts\/([^/]+)$/);
        if (empCtrMatch && req.method === 'DELETE') {
          const canDeleteEmpCtr =
            hasModuleAction(ctx.profile, 'rh_funcionarios', 'excluir') ||
            hasModuleAction(ctx.profile, 'rh_funcionarios', 'editar');
          if (!canDeleteEmpCtr) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para remover contratos de funcionários.' });
            return;
          }
          const ctrCode = decodeURIComponent(empCtrMatch[1]);
          const { data: removedPath, error: delErr } = await supabaseAdmin.rpc('spark_erp_delete_employee_contract', {
            p_code: ctrCode,
          });
          if (delErr) {
            res.status(400).json({
              error: 'EMP_CONTRACT_DELETE_ERROR',
              message: formatUserSafeError(delErr, 'Não foi possível remover o contrato do funcionário.', 'EMP_CONTRACT_DELETE_ERROR'),
            });
            return;
          }
          if (removedPath) {
            await supabaseAdmin.storage.from('contratos-funcionarios').remove([removedPath]).catch(() => {});
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'rh.contratos',
            acao: 'EXCLUIR_CONTRATO_FUNCIONARIO',
            entidadeId: ctrCode,
          });
          res.status(200).json({ ok: true });
          return;
        }

        // ── RECIBOS DE VENCIMENTO (POST / PUT / DELETE) ──────────────────────
        if (req.method === 'POST' && requestPath === '/api/erp/payslips') {
          if (!hasModuleAction(ctx.profile, 'rh_recibos', 'emitir')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para emitir vencimentos.' });
            return;
          }
          let { data, error } = await supabaseAdmin.rpc('spark_erp_upsert_payslip', {
            p_payload: req.body || {},
            p_actor: ctx.authUser.id,
          });
          if (error && isOnConflictConstraintError(error)) {
            const fb = await upsertPayslipFallback(supabaseAdmin, req.body || {}, ctx.authUser.id);
            data = fb.data;
            error = fb.error;
          }
          if (error) {
            res.status(400).json({
              error: 'PAYSLIP_SAVE_ERROR',
              message: formatUserSafeError(error, 'Não foi possível registar o vencimento na base de dados.', 'PAYSLIP_SAVE_ERROR'),
            });
            return;
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'rh.recibos',
            acao: 'EMITIR_VENCIMENTO',
            entidadeId: data?.id,
          });
          res.status(201).json(data);
          return;
        }

        const payMatch = requestPath.match(/^\/api\/erp\/payslips\/([^/]+)$/);
        if (payMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
          const payCode = decodeURIComponent(payMatch[1]);
          if (req.method === 'PUT') {
            if (!hasModuleAction(ctx.profile, 'rh_recibos', 'emitir')) {
              res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para editar vencimentos.' });
              return;
            }
            let { data, error } = await supabaseAdmin.rpc('spark_erp_upsert_payslip', {
              p_payload: { ...(req.body || {}), id: payCode },
              p_actor: ctx.authUser.id,
            });
            if (error && isOnConflictConstraintError(error)) {
              const fb = await upsertPayslipFallback(
                supabaseAdmin,
                { ...(req.body || {}), id: payCode },
                ctx.authUser.id
              );
              data = fb.data;
              error = fb.error;
            }
            if (error) {
              res.status(400).json({
                error: 'PAYSLIP_UPDATE_ERROR',
                message: formatUserSafeError(error, 'Não foi possível atualizar o vencimento na base de dados.', 'PAYSLIP_UPDATE_ERROR'),
              });
              return;
            }
            res.status(200).json(data);
            return;
          }

          if (!hasModuleAction(ctx.profile, 'rh_recibos', 'excluir')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para excluir vencimentos.' });
            return;
          }
          const { error } = await supabaseAdmin.rpc('spark_erp_delete_payslip', { p_code: payCode });
          if (error) {
            res.status(400).json({
              error: 'PAYSLIP_DELETE_ERROR',
              message: formatUserSafeError(error, 'Não foi possível eliminar o vencimento da base de dados.', 'PAYSLIP_DELETE_ERROR'),
            });
            return;
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'rh.recibos',
            acao: 'EXCLUIR_VENCIMENTO',
            entidadeId: payCode,
          });
          res.status(200).json({ ok: true });
          return;
        }

        // ── ANEXOS DE RECIBOS (Storage Privado + rh.recibos_anexados) ────────
        if (req.method === 'POST' && requestPath === '/api/erp/attachments') {
          if (!hasModuleAction(ctx.profile, 'rh_recibos', 'anexar')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para anexar recibos.' });
            return;
          }
          const body = req.body && typeof req.body === 'object' ? req.body : {};
          const rawB64 = String(body.fileBase64 || '');
          if (!rawB64) {
            res.status(400).json({ error: 'MISSING_FILE_DATA', message: 'Ficheiro em falta.' });
            return;
          }

          const fileBuffer = Buffer.from(rawB64, 'base64');
          if (fileBuffer.length > 10 * 1024 * 1024) {
            res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'O ficheiro excede o limite de 10 MB.' });
            return;
          }

          const mime = String(body.fileType || 'application/pdf');
          const allowedMime = mime === 'application/pdf' || mime.startsWith('image/');
          if (!allowedMime) {
            res.status(400).json({ error: 'INVALID_MIME', message: 'Apenas ficheiros PDF ou imagem são permitidos.' });
            return;
          }

          const safeName = String(body.fileName || 'recibo.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
          const fileCode = String(body.id || `ATT-${Date.now()}`);
          const storagePath = `${body.employeeId}/${body.month}/${fileCode}_${safeName}`;

          const { error: uploadErr } = await supabaseAdmin.storage
            .from('recibos-vencimentos')
            .upload(storagePath, fileBuffer, { contentType: mime, upsert: true });

          if (uploadErr) {
            res.status(400).json({
              error: 'STORAGE_UPLOAD_ERROR',
              message: formatUserSafeError(uploadErr, 'Não foi possível enviar o ficheiro selecionado.', 'ATTACHMENT_UPLOAD_ERROR'),
            });
            return;
          }

          const attachmentPayload = {
            id: fileCode,
            employeeId: body.employeeId,
            month: body.month,
            payslipId: body.payslipId || null,
            fileName: body.fileName || safeName,
            fileType: mime,
            fileSize: fileBuffer.length,
            storagePath,
          };

          let { data: metaRow, error: dbErr } = await supabaseAdmin.rpc('spark_erp_add_attachment', {
            p_payload: attachmentPayload,
            p_actor: ctx.authUser.id,
          });

          if (dbErr && isOnConflictConstraintError(dbErr)) {
            const fb = await addAttachmentFallback(supabaseAdmin, attachmentPayload, ctx.authUser.id);
            metaRow = fb.data;
            dbErr = fb.error;
          }

          if (dbErr) {
            await supabaseAdmin.storage.from('recibos-vencimentos').remove([storagePath]).catch(() => {});
            res.status(400).json({
              error: 'ATTACHMENT_META_ERROR',
              message: formatUserSafeError(dbErr, 'Não foi possível anexar o recibo na base de dados.', 'ATTACHMENT_META_ERROR'),
            });
            return;
          }

          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'rh.recibos',
            acao: 'ANEXAR_RECIBO',
            entidadeId: fileCode,
            detalhes: { employeeId: body.employeeId, month: body.month, fileName: body.fileName },
          });

          res.status(201).json(metaRow);
          return;
        }

        const attMatch = requestPath.match(/^\/api\/erp\/attachments\/([^/]+)$/);
        if (attMatch && (req.method === 'GET' || req.method === 'DELETE')) {
          const attCode = decodeURIComponent(attMatch[1]);
          if (req.method === 'GET') {
            if (!canRecibosVer) {
              res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para visualizar recibos.' });
              return;
            }
            const { data: meta, error: metaErr } = await supabaseAdmin.rpc('spark_erp_get_attachment', {
              p_code: attCode,
            });
            if (metaErr || !meta?.storagePath) {
              res.status(404).json({ error: 'ATTACHMENT_NOT_FOUND', message: 'Ficheiro não encontrado.' });
              return;
            }
            const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
              .from('recibos-vencimentos')
              .download(meta.storagePath);
            if (dlErr || !fileBlob) {
              res.status(404).json({ error: 'STORAGE_READ_ERROR', message: 'Não foi possível transferir o ficheiro.' });
              return;
            }
            const arrayBuf = await fileBlob.arrayBuffer();
            res.status(200).json({
              id: meta.id,
              name: meta.fileName,
              type: meta.fileType,
              size: meta.fileSize || arrayBuf.byteLength,
              base64: Buffer.from(arrayBuf).toString('base64'),
            });
            return;
          }

          if (!hasModuleAction(ctx.profile, 'rh_recibos', 'excluir')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para remover anexos.' });
            return;
          }
          const { data: removedPath, error: delErr } = await supabaseAdmin.rpc('spark_erp_delete_attachment', {
            p_code: attCode,
          });
          if (delErr) {
            res.status(400).json({
              error: 'ATTACHMENT_DELETE_ERROR',
              message: formatUserSafeError(delErr, 'Não foi possível remover o ficheiro anexo.', 'ATTACHMENT_DELETE_ERROR'),
            });
            return;
          }
          if (removedPath) {
            await supabaseAdmin.storage.from('recibos-vencimentos').remove([removedPath]).catch(() => {});
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'rh.recibos',
            acao: 'REMOVER_ANEXO',
            entidadeId: attCode,
          });
          res.status(200).json({ ok: true });
          return;
        }

        // ── OBRAS, ORÇAMENTOS & PAGAMENTOS (POST / PUT / DELETE) ─────────────
        if (req.method === 'POST' && requestPath === '/api/erp/projects') {
          if (!hasModuleAction(ctx.profile, 'op_obras', 'criar')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para cadastrar obras.' });
            return;
          }
          const { data, error } = await supabaseAdmin.rpc('spark_erp_upsert_project', {
            p_payload: req.body || {},
            p_actor: ctx.authUser.id,
          });
          if (error) {
            res.status(400).json({
              error: 'PROJECT_CREATE_ERROR',
              message: formatUserSafeError(error, 'Não foi possível criar a obra na base de dados.', 'PROJECT_CREATE_ERROR'),
            });
            return;
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'operacional.obras',
            acao: 'CRIAR_OBRA',
            entidadeId: data?.id,
          });
          res.status(201).json(data);
          return;
        }

        const projMatch = requestPath.match(/^\/api\/erp\/projects\/([^/]+)$/);
        if (projMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
          const projCode = decodeURIComponent(projMatch[1]);
          if (req.method === 'PUT') {
            let body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
            const keys = Object.keys(body);
            const paymentsOnly = keys.length === 1 && keys[0] === 'payments';
            const canSeeOpValues = hasModuleAction(ctx.profile, 'op_obras', 'valores');
            const allowed = paymentsOnly
              ? canSeeOpValues &&
                (hasModuleAction(ctx.profile, 'op_obras', 'pagamentos') ||
                  hasModuleAction(ctx.profile, 'op_obras', 'editar'))
              : hasModuleAction(ctx.profile, 'op_obras', 'editar');

            if (!allowed) {
              res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para atualizar esta obra.' });
              return;
            }
            if (!canSeeOpValues) {
              const { data: opSnap } = await supabaseAdmin.rpc('spark_erp_snapshot', {
                p_include_rh: false,
                p_include_payslips: false,
                p_include_projects: true,
              });
              const existingProj = (opSnap?.projects || []).find(
                (p) => p.id === projCode || p.code === projCode
              );
              if (existingProj) {
                body = {
                  ...body,
                  manualBudgetCap: existingProj.manualBudgetCap ?? 0,
                  dailyRatePerWorker: existingProj.dailyRatePerWorker ?? 0,
                  budget: existingProj.budget || { vatRate: 23, contingencyPct: 0, items: [] },
                  payments: existingProj.payments || [],
                };
              }
            }
            const { data, error } = await supabaseAdmin.rpc('spark_erp_upsert_project', {
              p_payload: { ...body, code: body.code || projCode, id: projCode },
              p_actor: ctx.authUser.id,
            });
            if (error) {
              res.status(400).json({
                error: 'PROJECT_UPDATE_ERROR',
                message: formatUserSafeError(error, 'Não foi possível atualizar a obra na base de dados.', 'PROJECT_UPDATE_ERROR'),
              });
              return;
            }
            await writeAuditLog(supabaseAdmin, {
              userId: ctx.authUser.id,
              userEmail: ctx.authUser.email,
              modulo: 'operacional.obras',
              acao: paymentsOnly ? 'ATUALIZAR_PAGAMENTOS_OBRA' : 'EDITAR_OBRA',
              entidadeId: projCode,
            });
            res.status(200).json(
              canSeeOpValues
                ? data
                : { ...(data || {}), manualBudgetCap: 0, dailyRatePerWorker: 0, budget: { vatRate: 0, contingencyPct: 0, items: [] }, payments: [], _valuesRestricted: true }
            );
            return;
          }

          if (!hasModuleAction(ctx.profile, 'op_obras', 'excluir')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para excluir obras.' });
            return;
          }
          const { error } = await supabaseAdmin.rpc('spark_erp_delete_project', { p_code: projCode });
          if (error) {
            res.status(400).json({
              error: 'PROJECT_DELETE_ERROR',
              message: formatUserSafeError(error, 'Não foi possível excluir a obra da base de dados.', 'PROJECT_DELETE_ERROR'),
            });
            return;
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'operacional.obras',
            acao: 'EXCLUIR_OBRA',
            entidadeId: projCode,
          });
          res.status(200).json({ ok: true });
          return;
        }

        // ── FATURAS DE COMPRA & MATERIAIS POR OBRA ────────────────────────────
        if (req.method === 'POST' && requestPath === '/api/erp/project-invoices') {
          if (!hasModuleAction(ctx.profile, 'op_obras', 'faturas')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para lançar faturas de obra.' });
            return;
          }

          const body = req.body && typeof req.body === 'object' ? req.body : {};
          const projectId = String(body.projectId || '').trim();
          const supplier = String(body.supplier || '').trim();
          const invoiceNumber = String(body.invoiceNumber || '').trim();
          const amount = Number(body.amount);

          if (!projectId || !supplier || !invoiceNumber || Number.isNaN(amount) || amount < 0) {
            res.status(400).json({
              error: 'INVALID_INVOICE_PAYLOAD',
              message: 'Preencha obra, fornecedor, número da fatura e valor válido.',
            });
            return;
          }

          const invCode = String(body.id || `FAT-${Date.now()}`);
          let storagePath = null;
          let uploadedBucketPath = null;
          let fileName = null;
          let mime = null;
          let fileSize = 0;

          const rawB64 = String(body.fileBase64 || '');
          if (rawB64) {
            const fileBuffer = Buffer.from(rawB64, 'base64');
            if (fileBuffer.length > 10 * 1024 * 1024) {
              res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'O PDF/ficheiro excede o limite de 10 MB.' });
              return;
            }
            mime = String(body.fileType || 'application/pdf');
            const allowedMime = mime === 'application/pdf' || mime.startsWith('image/');
            if (!allowedMime) {
              res.status(400).json({ error: 'INVALID_MIME', message: 'Apenas ficheiros PDF ou imagem são permitidos.' });
              return;
            }

            const safeProj = projectId.replace(/[^a-zA-Z0-9._-]/g, '_');
            const safeName = String(body.fileName || `${invoiceNumber}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
            storagePath = `${safeProj}/${invCode}_${safeName}`;
            fileName = String(body.fileName || safeName);
            fileSize = fileBuffer.length;

            const { error: uploadErr } = await supabaseAdmin.storage
              .from('faturas-obras')
              .upload(storagePath, fileBuffer, { contentType: mime, upsert: true });

            if (uploadErr) {
              res.status(400).json({
                error: 'STORAGE_UPLOAD_ERROR',
                message: formatUserSafeError(uploadErr, 'Não foi possível guardar o ficheiro selecionado.', 'STORAGE_UPLOAD_ERROR'),
              });
              return;
            }
            uploadedBucketPath = storagePath;
          }

          const { data: metaRow, error: dbErr } = await supabaseAdmin.rpc('spark_erp_upsert_invoice', {
            p_payload: {
              id: invCode,
              projectId,
              invoiceNumber,
              supplier,
              supplierNif: body.supplierNif || '',
              category: body.category || 'Materiais de Construção',
              invoiceDate: body.invoiceDate || null,
              amount,
              notes: body.notes || '',
              fileName,
              fileType: mime,
              fileSize,
              storagePath,
            },
            p_actor: ctx.authUser.id,
          });

          if (dbErr) {
            if (uploadedBucketPath) {
              await supabaseAdmin.storage.from('faturas-obras').remove([uploadedBucketPath]).catch(() => {});
            }
            res.status(400).json({
              error: 'INVOICE_SAVE_ERROR',
              message: formatUserSafeError(dbErr, 'Não foi possível registar a fatura da obra.', 'INVOICE_SAVE_ERROR'),
            });
            return;
          }

          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'operacional.faturas_obras',
            acao: 'LANCAR_FATURA_OBRA',
            entidadeId: metaRow?.id || invCode,
            detalhes: {
              projectId,
              invoiceNumber,
              supplier,
              amount,
              hasFile: Boolean(storagePath),
            },
          });

          res.status(201).json(metaRow);
          return;
        }

        const invFileMatch = requestPath.match(/^\/api\/erp\/project-invoices\/([^/]+)\/file$/);
        if (invFileMatch && req.method === 'GET') {
          if (!canOpVer || !hasModuleAction(ctx.profile, 'op_obras', 'valores')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para visualizar valores ou faturas de obras.' });
            return;
          }
          const invCode = decodeURIComponent(invFileMatch[1]);
          const { data: meta, error: metaErr } = await supabaseAdmin.rpc('spark_erp_get_invoice_file', {
            p_code: invCode,
          });
          if (metaErr || !meta?.storagePath) {
            res.status(404).json({ error: 'INVOICE_FILE_NOT_FOUND', message: 'PDF da fatura não encontrado.' });
            return;
          }
          const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
            .from('faturas-obras')
            .download(meta.storagePath);
          if (dlErr || !fileBlob) {
            res.status(404).json({ error: 'STORAGE_READ_ERROR', message: 'Não foi possível transferir o ficheiro da fatura.' });
            return;
          }
          const arrayBuf = await fileBlob.arrayBuffer();
          res.status(200).json({
            id: meta.id,
            name: meta.fileName,
            type: meta.fileType,
            size: meta.fileSize || arrayBuf.byteLength,
            base64: Buffer.from(arrayBuf).toString('base64'),
          });
          return;
        }

        const invMatch = requestPath.match(/^\/api\/erp\/project-invoices\/([^/]+)$/);
        if (invMatch && req.method === 'DELETE') {
          const canDeleteInv =
            hasModuleAction(ctx.profile, 'op_obras', 'excluir') ||
            hasModuleAction(ctx.profile, 'op_obras', 'faturas');
          if (!canDeleteInv) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para remover faturas da obra.' });
            return;
          }
          const invCode = decodeURIComponent(invMatch[1]);
          const { data: removedPath, error: delErr } = await supabaseAdmin.rpc('spark_erp_delete_invoice', {
            p_code: invCode,
          });
          if (delErr) {
            res.status(400).json({
              error: 'INVOICE_DELETE_ERROR',
              message: formatUserSafeError(delErr, 'Não foi possível remover a fatura da obra.', 'INVOICE_DELETE_ERROR'),
            });
            return;
          }
          if (removedPath) {
            await supabaseAdmin.storage.from('faturas-obras').remove([removedPath]).catch(() => {});
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'operacional.faturas_obras',
            acao: 'EXCLUIR_FATURA_OBRA',
            entidadeId: invCode,
          });
          res.status(200).json({ ok: true });
          return;
        }

        // ── CONTRATOS DA OBRA (PDF / Storage Privado) ─────────────────────────
        if (req.method === 'POST' && requestPath === '/api/erp/project-contracts') {
          const canManageContract =
            hasModuleAction(ctx.profile, 'op_obras', 'criar') ||
            hasModuleAction(ctx.profile, 'op_obras', 'editar');
          if (!canManageContract) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para anexar contratos de obra.' });
            return;
          }

          const body = req.body && typeof req.body === 'object' ? req.body : {};
          const projectId = String(body.projectId || '').trim();
          const title = String(body.title || '').trim();
          if (!projectId || !title) {
            res.status(400).json({
              error: 'INVALID_CONTRACT_PAYLOAD',
              message: 'Indique a obra e o título do contrato.',
            });
            return;
          }

          const ctrCode = String(body.id || `CTR-${Date.now()}`);
          let storagePath = null;
          let uploadedBucketPath = null;
          let fileName = null;
          let mime = null;
          let fileSize = 0;

          const rawB64 = String(body.fileBase64 || '');
          if (rawB64) {
            const fileBuffer = Buffer.from(rawB64, 'base64');
            if (fileBuffer.length > 10 * 1024 * 1024) {
              res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'O ficheiro do contrato excede o limite de 10 MB.' });
              return;
            }
            mime = String(body.fileType || 'application/pdf');
            const allowedMime = mime === 'application/pdf' || mime.startsWith('image/');
            if (!allowedMime) {
              res.status(400).json({ error: 'INVALID_MIME', message: 'Apenas ficheiros PDF ou imagem são permitidos.' });
              return;
            }

            const safeProj = projectId.replace(/[^a-zA-Z0-9._-]/g, '_');
            const safeName = String(body.fileName || `${ctrCode}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
            storagePath = `${safeProj}/${ctrCode}_${safeName}`;
            fileName = String(body.fileName || safeName);
            fileSize = fileBuffer.length;

            const { error: uploadErr } = await supabaseAdmin.storage
              .from('contratos-obras')
              .upload(storagePath, fileBuffer, { contentType: mime, upsert: true });

            if (uploadErr) {
              res.status(400).json({
                error: 'STORAGE_UPLOAD_ERROR',
                message: formatUserSafeError(uploadErr, 'Não foi possível guardar o ficheiro selecionado.', 'STORAGE_UPLOAD_ERROR'),
              });
              return;
            }
            uploadedBucketPath = storagePath;
          }

          const { data: metaRow, error: dbErr } = await supabaseAdmin.rpc('spark_erp_upsert_contract', {
            p_payload: {
              id: ctrCode,
              projectId,
              title,
              contractNumber: body.contractNumber || '',
              contractDate: body.contractDate || null,
              notes: body.notes || '',
              fileName,
              fileType: mime,
              fileSize,
              storagePath,
            },
            p_actor: ctx.authUser.id,
          });

          if (dbErr) {
            if (uploadedBucketPath) {
              await supabaseAdmin.storage.from('contratos-obras').remove([uploadedBucketPath]).catch(() => {});
            }
            res.status(400).json({
              error: 'CONTRACT_SAVE_ERROR',
              message: formatUserSafeError(dbErr, 'Não foi possível guardar o contrato da obra.', 'CONTRACT_SAVE_ERROR'),
            });
            return;
          }

          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'operacional.contratos_obras',
            acao: 'ANEXAR_CONTRATO_OBRA',
            entidadeId: metaRow?.id || ctrCode,
            detalhes: { projectId, title, hasFile: Boolean(storagePath) },
          });

          res.status(201).json(metaRow);
          return;
        }

        const ctrFileMatch = requestPath.match(/^\/api\/erp\/project-contracts\/([^/]+)\/file$/);
        if (ctrFileMatch && req.method === 'GET') {
          if (!canOpVer) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para visualizar contratos.' });
            return;
          }
          const ctrCode = decodeURIComponent(ctrFileMatch[1]);
          const { data: meta, error: metaErr } = await supabaseAdmin.rpc('spark_erp_get_contract_file', {
            p_code: ctrCode,
          });
          if (metaErr || !meta?.storagePath) {
            res.status(404).json({ error: 'CONTRACT_FILE_NOT_FOUND', message: 'PDF do contrato não encontrado.' });
            return;
          }
          const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
            .from('contratos-obras')
            .download(meta.storagePath);
          if (dlErr || !fileBlob) {
            res.status(404).json({ error: 'STORAGE_READ_ERROR', message: 'Não foi possível transferir o contrato.' });
            return;
          }
          const arrayBuf = await fileBlob.arrayBuffer();
          res.status(200).json({
            id: meta.id,
            name: meta.fileName,
            type: meta.fileType,
            size: meta.fileSize || arrayBuf.byteLength,
            base64: Buffer.from(arrayBuf).toString('base64'),
          });
          return;
        }

        const ctrMatch = requestPath.match(/^\/api\/erp\/project-contracts\/([^/]+)$/);
        if (ctrMatch && req.method === 'DELETE') {
          const canDeleteCtr =
            hasModuleAction(ctx.profile, 'op_obras', 'excluir') ||
            hasModuleAction(ctx.profile, 'op_obras', 'editar');
          if (!canDeleteCtr) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para remover contratos da obra.' });
            return;
          }
          const ctrCode = decodeURIComponent(ctrMatch[1]);
          const { data: removedPath, error: delErr } = await supabaseAdmin.rpc('spark_erp_delete_contract', {
            p_code: ctrCode,
          });
          if (delErr) {
            res.status(400).json({
              error: 'CONTRACT_DELETE_ERROR',
              message: formatUserSafeError(delErr, 'Não foi possível remover o contrato da obra.', 'CONTRACT_DELETE_ERROR'),
            });
            return;
          }
          if (removedPath) {
            await supabaseAdmin.storage.from('contratos-obras').remove([removedPath]).catch(() => {});
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'operacional.contratos_obras',
            acao: 'EXCLUIR_CONTRATO_OBRA',
            entidadeId: ctrCode,
          });
          res.status(200).json({ ok: true });
          return;
        }

        // ── RESPONSÁVEIS TÉCNICOS & CERTIFICADOS PDF ─────────────────────────
        const canManageResp =
          hasModuleAction(ctx.profile, 'op_obras', 'responsaveis') ||
          hasModuleAction(ctx.profile, 'op_obras', 'editar') ||
          hasModuleAction(ctx.profile, 'op_obras', 'criar');

        if (req.method === 'POST' && requestPath === '/api/erp/technical-managers') {
          if (!canManageResp) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para cadastrar responsáveis técnicos.' });
            return;
          }
          const { data, error } = await supabaseAdmin.rpc('spark_erp_upsert_technical_manager', {
            p_payload: req.body || {},
            p_actor: ctx.authUser.id,
          });
          if (error) {
            res.status(400).json({
              error: 'TECH_MANAGER_SAVE_ERROR',
              message: formatUserSafeError(error, 'Não foi possível cadastrar o responsável técnico.', 'TECH_MANAGER_SAVE_ERROR'),
            });
            return;
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'operacional.responsaveis_tecnicos',
            acao: 'CRIAR_RESPONSAVEL_TECNICO',
            entidadeId: data?.id,
            detalhes: { name: data?.name, professionalTitle: data?.professionalTitle },
          });
          res.status(201).json(data);
          return;
        }

        const techMatch = requestPath.match(/^\/api\/erp\/technical-managers\/([^/]+)$/);
        if (techMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
          const techCode = decodeURIComponent(techMatch[1]);
          if (req.method === 'PUT') {
            if (!canManageResp) {
              res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para editar responsáveis técnicos.' });
              return;
            }
            const { data, error } = await supabaseAdmin.rpc('spark_erp_upsert_technical_manager', {
              p_payload: { ...(req.body || {}), id: techCode, code: techCode },
              p_actor: ctx.authUser.id,
            });
            if (error) {
              res.status(400).json({
                error: 'TECH_MANAGER_UPDATE_ERROR',
                message: formatUserSafeError(error, 'Não foi possível atualizar o responsável técnico.', 'TECH_MANAGER_UPDATE_ERROR'),
              });
              return;
            }
            await writeAuditLog(supabaseAdmin, {
              userId: ctx.authUser.id,
              userEmail: ctx.authUser.email,
              modulo: 'operacional.responsaveis_tecnicos',
              acao: 'EDITAR_RESPONSAVEL_TECNICO',
              entidadeId: techCode,
            });
            res.status(200).json(data);
            return;
          }

          if (!hasModuleAction(ctx.profile, 'op_obras', 'excluir') && !hasModuleAction(ctx.profile, 'op_obras', 'responsaveis')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para eliminar responsáveis técnicos.' });
            return;
          }
          const { data: certPaths, error: delErr } = await supabaseAdmin.rpc('spark_erp_delete_technical_manager', {
            p_code: techCode,
          });
          if (delErr) {
            res.status(400).json({
              error: 'TECH_MANAGER_DELETE_ERROR',
              message: formatUserSafeError(delErr, 'Não foi possível remover o responsável técnico.', 'TECH_MANAGER_DELETE_ERROR'),
            });
            return;
          }
          if (Array.isArray(certPaths) && certPaths.length > 0) {
            await supabaseAdmin.storage.from('certificados-tecnicos').remove(certPaths).catch(() => {});
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'operacional.responsaveis_tecnicos',
            acao: 'EXCLUIR_RESPONSAVEL_TECNICO',
            entidadeId: techCode,
          });
          res.status(200).json({ ok: true });
          return;
        }

        if (req.method === 'POST' && requestPath === '/api/erp/technical-certificates') {
          if (!canManageResp) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para anexar certificados técnicos.' });
            return;
          }
          const body = req.body && typeof req.body === 'object' ? req.body : {};
          const managerId = String(body.managerId || '').trim();
          const certificateType = String(body.certificateType || '').trim();
          if (!managerId || !certificateType) {
            res.status(400).json({
              error: 'INVALID_CERTIFICATE_PAYLOAD',
              message: 'Indique o responsável técnico e o tipo de certificado.',
            });
            return;
          }

          const certCode = String(body.id || `CERT-${Date.now()}`);
          let storagePath = null;
          let uploadedBucketPath = null;
          let fileName = null;
          let mime = null;
          let fileSize = 0;

          const rawB64 = String(body.fileBase64 || '');
          if (rawB64) {
            const fileBuffer = Buffer.from(rawB64, 'base64');
            if (fileBuffer.length > 10 * 1024 * 1024) {
              res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'O PDF/ficheiro excede o limite de 10 MB.' });
              return;
            }
            mime = String(body.fileType || 'application/pdf');
            const allowedMime = mime === 'application/pdf' || mime.startsWith('image/');
            if (!allowedMime) {
              res.status(400).json({ error: 'INVALID_MIME', message: 'Apenas ficheiros PDF ou imagem são permitidos.' });
              return;
            }

            const safeMgr = managerId.replace(/[^a-zA-Z0-9._-]/g, '_');
            const safeName = String(body.fileName || `${certCode}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
            storagePath = `${safeMgr}/${certCode}_${safeName}`;
            fileName = String(body.fileName || safeName);
            fileSize = fileBuffer.length;

            const { error: uploadErr } = await supabaseAdmin.storage
              .from('certificados-tecnicos')
              .upload(storagePath, fileBuffer, { contentType: mime, upsert: true });

            if (uploadErr) {
              res.status(400).json({
                error: 'STORAGE_UPLOAD_ERROR',
                message: formatUserSafeError(uploadErr, 'Não foi possível guardar o ficheiro selecionado.', 'STORAGE_UPLOAD_ERROR'),
              });
              return;
            }
            uploadedBucketPath = storagePath;
          }

          const { data: metaRow, error: dbErr } = await supabaseAdmin.rpc('spark_erp_upsert_technical_certificate', {
            p_payload: {
              id: certCode,
              managerId,
              certificateType,
              category: body.category || 'Construção Civil',
              certificateNumber: body.certificateNumber || '',
              issuer: body.issuer || '',
              issueDate: body.issueDate || null,
              expiryDate: body.expiryDate || null,
              notes: body.notes || '',
              fileName,
              fileType: mime,
              fileSize,
              storagePath,
            },
            p_actor: ctx.authUser.id,
          });

          if (dbErr) {
            if (uploadedBucketPath) {
              await supabaseAdmin.storage.from('certificados-tecnicos').remove([uploadedBucketPath]).catch(() => {});
            }
            res.status(400).json({
              error: 'CERTIFICATE_SAVE_ERROR',
              message: formatUserSafeError(dbErr, 'Não foi possível guardar o certificado técnico.', 'CERTIFICATE_SAVE_ERROR'),
            });
            return;
          }

          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'operacional.responsaveis_certificados',
            acao: 'ANEXAR_CERTIFICADO_TECNICO',
            entidadeId: metaRow?.id || certCode,
            detalhes: { managerId, certificateType, hasFile: Boolean(storagePath) },
          });

          res.status(201).json(metaRow);
          return;
        }

        const certFileMatch = requestPath.match(/^\/api\/erp\/technical-certificates\/([^/]+)\/file$/);
        if (certFileMatch && req.method === 'GET') {
          if (!canOpVer) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para visualizar certificados técnicos.' });
            return;
          }
          const certCode = decodeURIComponent(certFileMatch[1]);
          const { data: meta, error: metaErr } = await supabaseAdmin.rpc('spark_erp_get_technical_certificate_file', {
            p_code: certCode,
          });
          if (metaErr || !meta?.storagePath) {
            res.status(404).json({ error: 'CERT_FILE_NOT_FOUND', message: 'PDF do certificado não encontrado.' });
            return;
          }
          const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
            .from('certificados-tecnicos')
            .download(meta.storagePath);
          if (dlErr || !fileBlob) {
            res.status(404).json({ error: 'STORAGE_READ_ERROR', message: 'Não foi possível transferir o certificado.' });
            return;
          }
          const arrayBuf = await fileBlob.arrayBuffer();
          res.status(200).json({
            id: meta.id,
            name: meta.fileName,
            type: meta.fileType,
            size: meta.fileSize || arrayBuf.byteLength,
            base64: Buffer.from(arrayBuf).toString('base64'),
          });
          return;
        }

        const certMatch = requestPath.match(/^\/api\/erp\/technical-certificates\/([^/]+)$/);
        if (certMatch && req.method === 'DELETE') {
          if (!canManageResp && !hasModuleAction(ctx.profile, 'op_obras', 'excluir')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para remover certificados técnicos.' });
            return;
          }
          const certCode = decodeURIComponent(certMatch[1]);
          const { data: removedPath, error: delErr } = await supabaseAdmin.rpc('spark_erp_delete_technical_certificate', {
            p_code: certCode,
          });
          if (delErr) {
            res.status(400).json({
              error: 'CERT_DELETE_ERROR',
              message: formatUserSafeError(delErr, 'Não foi possível remover o certificado técnico.', 'CERT_DELETE_ERROR'),
            });
            return;
          }
          if (removedPath) {
            await supabaseAdmin.storage.from('certificados-tecnicos').remove([removedPath]).catch(() => {});
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'operacional.responsaveis_certificados',
            acao: 'EXCLUIR_CERTIFICADO_TECNICO',
            entidadeId: certCode,
          });
          res.status(200).json({ ok: true });
          return;
        }

        // ── CANDIDATURAS & CURRÍCULOS ("TRABALHE CONNOSCO") ─────────────────
        if (req.method === 'GET' && requestPath === '/api/erp/candidates') {
          if (!canRhVer) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para consultar candidaturas.' });
            return;
          }
          const candidates = await loadCandidatesList(supabaseAdmin);
          res.status(200).json({ candidates });
          return;
        }

        const candCvMatch = requestPath.match(/^\/api\/erp\/candidates\/([^/]+)\/cv$/);
        if (candCvMatch && req.method === 'GET') {
          if (!canRhVer) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para visualizar currículos.' });
            return;
          }
          const candCode = decodeURIComponent(candCvMatch[1]);
          let meta = null;
          try {
            const rpcRes = await supabaseAdmin.rpc('spark_erp_get_candidate_cv', { p_code: candCode });
            if (!rpcRes.error && rpcRes.data) meta = rpcRes.data;
          } catch {
            // Fallback direto
          }
          if (!meta) {
            const { data: directRow } = await supabaseAdmin
              .schema('rh')
              .from('candidaturas')
              .select('codigo_candidatura, cv_nome_ficheiro, cv_tipo_mime, cv_tamanho_bytes, cv_caminho_storage')
              .eq('codigo_candidatura', candCode)
              .limit(1)
              .maybeSingle();
            if (directRow) {
              meta = {
                id: directRow.codigo_candidatura,
                fileName: directRow.cv_nome_ficheiro,
                fileType: directRow.cv_tipo_mime || 'application/pdf',
                fileSize: Number(directRow.cv_tamanho_bytes) || 0,
                storagePath: directRow.cv_caminho_storage,
              };
            }
          }

          if (!meta?.storagePath) {
            res.status(404).json({ error: 'CV_NOT_FOUND', message: 'Currículo anexado não encontrado.' });
            return;
          }
          const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
            .from('curriculos-candidatos')
            .download(meta.storagePath);
          if (dlErr || !fileBlob) {
            res.status(404).json({ error: 'STORAGE_READ_ERROR', message: 'Não foi possível transferir o currículo.' });
            return;
          }
          const arrayBuf = await fileBlob.arrayBuffer();
          res.status(200).json({
            id: meta.id,
            name: meta.fileName,
            type: meta.fileType,
            size: meta.fileSize || arrayBuf.byteLength,
            base64: Buffer.from(arrayBuf).toString('base64'),
          });
          return;
        }

        const candMatch = requestPath.match(/^\/api\/erp\/candidates\/([^/]+)$/);
        if (candMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
          const candCode = decodeURIComponent(candMatch[1]);
          if (req.method === 'PUT') {
            const canEditCand =
              hasModuleAction(ctx.profile, 'rh_funcionarios', 'editar') ||
              hasModuleAction(ctx.profile, 'rh_funcionarios', 'criar');
            if (!canEditCand) {
              res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para atualizar o estado da candidatura.' });
              return;
            }
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const validStatuses = new Set(['Nova', 'Em Análise', 'Entrevista', 'Contratado', 'Arquivada']);
            const nextStatus = validStatuses.has(body.status) ? body.status : null;
            const nextNotes = body.internalNotes !== undefined ? String(body.internalNotes || '') : null;

            let updated = null;
            let updErr = null;
            try {
              const rpcRes = await supabaseAdmin.rpc('spark_erp_update_candidate', {
                p_code: candCode,
                p_status: nextStatus,
                p_notes: nextNotes,
                p_actor: ctx.authUser.id,
              });
              updated = rpcRes.data;
              updErr = rpcRes.error;
            } catch (err) {
              updErr = err;
            }

            if (updErr && !updated) {
              try {
                const { data: row, error: qErr } = await supabaseAdmin
                  .schema('rh')
                  .from('candidaturas')
                  .update({
                    ...(nextStatus ? { estado: nextStatus } : {}),
                    ...(nextNotes !== null ? { notas_internas: nextNotes } : {}),
                    avaliado_por: ctx.authUser.id,
                  })
                  .eq('codigo_candidatura', candCode)
                  .select('*')
                  .single();
                if (!qErr && row) {
                  updated = mapCandidateDbRow(row);
                  updErr = null;
                }
              } catch {
                // Mantém erro original
              }
            }

            if (updErr || !updated) {
              res.status(400).json({
                error: 'CANDIDATE_UPDATE_ERROR',
                message: formatUserSafeError(updErr, 'Não foi possível atualizar a candidatura.', 'CANDIDATE_UPDATE_ERROR'),
              });
              return;
            }

            await writeAuditLog(supabaseAdmin, {
              userId: ctx.authUser.id,
              userEmail: ctx.authUser.email,
              modulo: 'rh.candidaturas',
              acao: 'ATUALIZAR_CANDIDATURA',
              entidadeId: candCode,
              detalhes: { status: updated.status },
            });
            res.status(200).json(updated);
            return;
          }

          if (!hasModuleAction(ctx.profile, 'rh_funcionarios', 'excluir')) {
            res.status(403).json({ error: 'FORBIDDEN', message: 'Sem permissão para remover candidaturas.' });
            return;
          }
          let removedPath = null;
          let delErr = null;
          try {
            const rpcRes = await supabaseAdmin.rpc('spark_erp_delete_candidate', { p_code: candCode });
            removedPath = rpcRes.data;
            delErr = rpcRes.error;
          } catch (err) {
            delErr = err;
          }

          if (delErr) {
            try {
              const { data: deleted, error: dErr } = await supabaseAdmin
                .schema('rh')
                .from('candidaturas')
                .delete()
                .eq('codigo_candidatura', candCode)
                .select('cv_caminho_storage')
                .maybeSingle();
              if (!dErr) {
                removedPath = deleted?.cv_caminho_storage || null;
                delErr = null;
              }
            } catch {
              // Mantém erro original
            }
          }

          if (delErr) {
            res.status(400).json({
              error: 'CANDIDATE_DELETE_ERROR',
              message: formatUserSafeError(delErr, 'Não foi possível remover a candidatura.', 'CANDIDATE_DELETE_ERROR'),
            });
            return;
          }

          if (removedPath) {
            await supabaseAdmin.storage.from('curriculos-candidatos').remove([removedPath]).catch(() => {});
          }
          await writeAuditLog(supabaseAdmin, {
            userId: ctx.authUser.id,
            userEmail: ctx.authUser.email,
            modulo: 'rh.candidaturas',
            acao: 'EXCLUIR_CANDIDATURA',
            entidadeId: candCode,
          });
          res.status(200).json({ ok: true });
          return;
        }
      } catch (err) {
        console.error('Erro na operação ERP:', err);
        res.status(500).json({ error: 'ERP_INTERNAL_ERROR', message: 'Erro interno ao processar operação na base de dados.' });
        return;
      }
    }

    res.status(404).json({ error: 'ENDPOINT_NOT_FOUND' });
  }
);
