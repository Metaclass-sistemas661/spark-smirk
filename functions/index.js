const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrlSecret = defineSecret('SUPABASE_URL');
const supabaseAnonKeySecret = defineSecret('SUPABASE_ANON_KEY');
const supabaseServiceRoleSecret = defineSecret('SUPABASE_SERVICE_ROLE_KEY');

const ALLOWED_ORIGINS = new Set([
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

function defaultPermissionsForRole(role = 'operador') {
  if (role === 'administrador') {
    return {
      dashboard: { ver: true },
      rh_funcionarios: { ver: true, criar: true, editar: true, excluir: true, assiduidade: true },
      rh_recibos: { ver: true, emitir: true, anexar: true, excluir: true },
      op_obras: { ver: true, criar: true, editar: true, excluir: true, orcamentos: true, pagamentos: true },
      admin_utilizadores: { ver: true, criar: true, editar: true, excluir: true },
    };
  }
  if (role === 'rh') {
    return {
      dashboard: { ver: true },
      rh_funcionarios: { ver: true, criar: true, editar: true, excluir: false, assiduidade: true },
      rh_recibos: { ver: true, emitir: true, anexar: true, excluir: false },
      op_obras: { ver: false, criar: false, editar: false, excluir: false, orcamentos: false, pagamentos: false },
      admin_utilizadores: { ver: false, criar: false, editar: false, excluir: false },
    };
  }
  if (role === 'operacional') {
    return {
      dashboard: { ver: true },
      rh_funcionarios: { ver: true, criar: false, editar: false, excluir: false, assiduidade: true },
      rh_recibos: { ver: false, emitir: false, anexar: false, excluir: false },
      op_obras: { ver: true, criar: true, editar: true, excluir: false, orcamentos: true, pagamentos: true },
      admin_utilizadores: { ver: false, criar: false, editar: false, excluir: false },
    };
  }
  return {
    dashboard: { ver: true },
    rh_funcionarios: { ver: true, criar: false, editar: false, excluir: false, assiduidade: false },
    rh_recibos: { ver: false, emitir: false, anexar: false, excluir: false },
    op_obras: { ver: true, criar: false, editar: false, excluir: false, orcamentos: false, pagamentos: false },
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
    nivel_acesso: role,
    permissoes: normalizePermissions(permsSource, role),
    senha_provisoria: Boolean(dbRow?.senha_provisoria ?? appMeta.must_change_password),
    senha_alterada_em: dbRow?.senha_alterada_em || null,
    ativo: dbRow?.ativo !== undefined ? Boolean(dbRow.ativo) : appMeta.ativo !== false,
    ultimo_login_em: dbRow?.ultimo_login_em || authUser.last_sign_in_at || null,
    criado_em: dbRow?.criado_em || authUser.created_at || null,
  };
}

async function resolveCallerContext(req, supabaseAdmin) {
  const token = getBearerToken(req);
  if (!token) {
    return { errorStatus: 401, errorCode: 'MISSING_BEARER_TOKEN' };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { errorStatus: 401, errorCode: 'INVALID_TOKEN' };
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
          res.status(400).json({ error: 'AUTH_UPDATE_FAILED', message: authUpdateErr.message });
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
          res.status(500).json({ error: 'LIST_USERS_FAILED', message: listErr.message });
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
            message: createErr?.message || 'Não foi possível criar a conta de utilizador.',
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
              message: updateErr?.message || 'Não foi possível atualizar os dados do utilizador.',
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
            message: deleteErr.message,
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

    res.status(404).json({ error: 'ENDPOINT_NOT_FOUND' });
  }
);
