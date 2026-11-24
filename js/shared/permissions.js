/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — Catálogo de Perfis e Permissões Granulares
   ═══════════════════════════════════════════════════════════ */

export const PERMISSION_MODULES = [
  {
    key: 'dashboard',
    label: 'Dashboard Executivo',
    actions: [{ key: 'ver', label: 'Visualizar Indicadores e Gráficos' }],
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
    ],
  },
  {
    key: 'rh_recibos',
    label: 'RH — Recibos de Vencimento',
    actions: [
      { key: 'ver', label: 'Visualizar Recibos' },
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
      { key: 'orcamentos', label: 'Gerir Orçamentos' },
      { key: 'pagamentos', label: 'Registar Pagamentos' },
      { key: 'faturas', label: 'Lançar Faturas & Materiais' },
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

export const ROLE_LABELS = {
  administrador: 'Administrador',
  rh: 'Gestor RH',
  operacional: 'Gestor Operacional',
  operador: 'Operador / Consulta',
};

export function createRolePermissions(nivelAcesso = 'operador') {
  if (nivelAcesso === 'administrador') {
    return {
      dashboard: { ver: true },
      rh_funcionarios: { ver: true, criar: true, editar: true, excluir: true, assiduidade: true },
      rh_recibos: { ver: true, emitir: true, anexar: true, excluir: true },
      op_obras: { ver: true, criar: true, editar: true, excluir: true, orcamentos: true, pagamentos: true, faturas: true },
      admin_utilizadores: { ver: true, criar: true, editar: true, excluir: true },
    };
  }

  if (nivelAcesso === 'rh') {
    return {
      dashboard: { ver: true },
      rh_funcionarios: { ver: true, criar: true, editar: true, excluir: false, assiduidade: true },
      rh_recibos: { ver: true, emitir: true, anexar: true, excluir: false },
      op_obras: { ver: false, criar: false, editar: false, excluir: false, orcamentos: false, pagamentos: false, faturas: false },
      admin_utilizadores: { ver: false, criar: false, editar: false, excluir: false },
    };
  }

  if (nivelAcesso === 'operacional') {
    return {
      dashboard: { ver: true },
      rh_funcionarios: { ver: true, criar: false, editar: false, excluir: false, assiduidade: true },
      rh_recibos: { ver: false, emitir: false, anexar: false, excluir: false },
      op_obras: { ver: true, criar: true, editar: true, excluir: false, orcamentos: true, pagamentos: true, faturas: true },
      admin_utilizadores: { ver: false, criar: false, editar: false, excluir: false },
    };
  }

  return {
    dashboard: { ver: true },
    rh_funcionarios: { ver: true, criar: false, editar: false, excluir: false, assiduidade: false },
    rh_recibos: { ver: false, emitir: false, anexar: false, excluir: false },
    op_obras: { ver: true, criar: false, editar: false, excluir: false, orcamentos: false, pagamentos: false, faturas: false },
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
