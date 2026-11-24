/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — Catálogo de Perfis e Permissões Granulares
   ═══════════════════════════════════════════════════════════ */

export const PERMISSION_MODULES = [
  {
    key: 'dashboard',
    label: 'Dashboard Executivo',
    actions: [
      { key: 'ver', label: 'Visualizar Painel e Gráficos' },
      { key: 'valores', label: 'Visualizar Valores Financeiros e Saldos (€)' },
    ],
  },
  {
    key: 'rh_funcionarios',
    label: 'RH — Funcionários & Assiduidade',
    actions: [
      { key: 'ver', label: 'Visualizar Funcionários' },
      { key: 'criar', label: 'Adicionar Funcionário' },
      { key: 'editar', label: 'Editar Dados' },
      { key: 'excluir', label: 'Excluir Funcionário' },
      { key: 'assiduidade', label: 'Marcar Presenças & Faltas' },
      { key: 'ordenados', label: 'Visualizar Ordenados, Diárias e Valor/Hora (€)' },
      { key: 'pagamentos', label: 'Visualizar Valores a Pagar, Fecho do Mês e Vales (€)' },
    ],
  },
  {
    key: 'rh_recibos',
    label: 'RH — Recibos de Vencimento',
    actions: [
      { key: 'ver', label: 'Visualizar Recibos e Valores (€)' },
      { key: 'emitir', label: 'Emitir Processamentos' },
      { key: 'anexar', label: 'Anexar Documentos (PDF)' },
      { key: 'excluir', label: 'Excluir Recibos / Anexos' },
    ],
  },
  {
    key: 'op_obras',
    label: 'Operacional — Obras, Orçamentos & Pagamentos',
    actions: [
      { key: 'ver', label: 'Visualizar Obras' },
      { key: 'criar', label: 'Cadastrar Nova Obra' },
      { key: 'editar', label: 'Editar Obra & Progresso' },
      { key: 'excluir', label: 'Excluir Obra' },
      { key: 'valores', label: 'Visualizar Orçamentos, Faturas e Saldos (€)' },
      { key: 'orcamentos', label: 'Gerir Orçamentos' },
      { key: 'pagamentos', label: 'Registar Pagamentos' },
      { key: 'faturas', label: 'Lançar Faturas & Materiais' },
      { key: 'responsaveis', label: 'Gerir Responsáveis Técnicos & Certificados' },
    ],
  },
  {
    key: 'admin_utilizadores',
    label: 'Administração — Utilizadores & Acessos',
    actions: [
      { key: 'ver', label: 'Consultar Utilizadores' },
      { key: 'criar', label: 'Criar Utilizador' },
      { key: 'editar', label: 'Editar & Definir Permissões' },
      { key: 'excluir', label: 'Remover Utilizador' },
    ],
  },
];

export const FINANCIAL_PERMISSION_PAIRS = [
  ['dashboard', 'valores'],
  ['rh_funcionarios', 'ordenados'],
  ['rh_funcionarios', 'pagamentos'],
  ['rh_recibos', 'ver'],
  ['rh_recibos', 'emitir'],
  ['rh_recibos', 'anexar'],
  ['rh_recibos', 'excluir'],
  ['op_obras', 'valores'],
  ['op_obras', 'orcamentos'],
  ['op_obras', 'pagamentos'],
  ['op_obras', 'faturas'],
];

export const ROLE_LABELS = {
  administrador: 'Administrador',
  rh: 'Gestor RH',
  operacional: 'Gestor Operacional',
  operador: 'Operador / Consulta',
};

export function createRolePermissions(nivelAcesso = 'operador') {
  if (nivelAcesso === 'administrador') {
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

  if (nivelAcesso === 'rh') {
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

  if (nivelAcesso === 'operacional') {
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

export function normalizePermissions(rawPerms, nivelAcesso = 'operador') {
  const base = createRolePermissions(nivelAcesso);
  if (!rawPerms || typeof rawPerms !== 'object') return base;

  const normalized = {};
  for (const mod of PERMISSION_MODULES) {
    normalized[mod.key] = {};
    const sourceMod = rawPerms[mod.key] && typeof rawPerms[mod.key] === 'object' ? rawPerms[mod.key] : {};
    for (const act of mod.actions) {
      normalized[mod.key][act.key] =
        typeof sourceMod[act.key] === 'boolean' ? sourceMod[act.key] : Boolean(base[mod.key][act.key]);
    }
  }
  return normalized;
}

export function hasPermission(profile, moduleKey, actionKey = 'ver') {
  if (!profile) return false;
  const mod = profile.permissoes?.[moduleKey];
  if (!mod || typeof mod !== 'object') {
    return false;
  }
  return mod[actionKey] === true;
}

export function blockAllFinancialPermissions(perms = {}) {
  const next = {};
  for (const mod of PERMISSION_MODULES) {
    next[mod.key] = { ...(perms[mod.key] || {}) };
  }
  for (const [modKey, actKey] of FINANCIAL_PERMISSION_PAIRS) {
    if (!next[modKey]) next[modKey] = {};
    next[modKey][actKey] = false;
  }
  return next;
}

export function areAllFinancialValuesBlocked(perms = {}) {
  if (!perms || typeof perms !== 'object') return false;
  return FINANCIAL_PERMISSION_PAIRS.every(([modKey, actKey]) => perms[modKey]?.[actKey] !== true);
}

export function countGrantedPermissions(perms) {
  if (!perms || typeof perms !== 'object') return 0;
  let total = 0;
  for (const mod of PERMISSION_MODULES) {
    const modPerms = perms[mod.key] || {};
    for (const act of mod.actions) {
      if (modPerms[act.key] === true) total += 1;
    }
  }
  return total;
}
