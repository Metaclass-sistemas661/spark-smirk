-- ============================================================================
-- SPARK & SMIRK — CONTA DO UTILIZADOR, LOGIN POR USERNAME & ADMINSPARK
-- Pasta: supabase/01-seguranca/05-conta-configuracoes-e-adminspark.sql
-- Execute este ficheiro no SQL Editor do Supabase (após 04-recuperacao-palavra-passe.sql).
-- ============================================================================

create extension if not exists pgcrypto schema extensions;

alter table seguranca.perfis_utilizadores
  add column if not exists username text,
  add column if not exists nif text,
  add column if not exists morada text,
  add column if not exists email_recuperacao text;

create unique index if not exists idx_perfis_username_unique
  on seguranca.perfis_utilizadores (lower(trim(username)))
  where username is not null and trim(username) <> '';

create index if not exists idx_perfis_email_recuperacao
  on seguranca.perfis_utilizadores (lower(trim(email_recuperacao)))
  where email_recuperacao is not null and trim(email_recuperacao) <> '';

-- Atualizar spark_upsert_perfil para preservar/gravar username, nif, morada e email_recuperacao
create or replace function public.spark_upsert_perfil(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = seguranca, public
as $$
declare
  v_row seguranca.perfis_utilizadores;
begin
  insert into seguranca.perfis_utilizadores (
    id, username, nome_completo, email, email_recuperacao, cargo, departamento,
    telefone, nif, morada, nivel_acesso, permissoes, senha_provisoria,
    senha_alterada_em, ativo, ultimo_login_em, criado_por
  )
  values (
    (p_payload->>'id')::uuid,
    nullif(lower(trim(coalesce(p_payload->>'username', ''))), ''),
    coalesce(p_payload->>'nome_completo', 'Utilizador'),
    lower(trim(p_payload->>'email')),
    nullif(lower(trim(coalesce(p_payload->>'email_recuperacao', ''))), ''),
    coalesce(p_payload->>'cargo', 'Gestor Interno'),
    coalesce(p_payload->>'departamento', 'Geral'),
    nullif(p_payload->>'telefone', ''),
    nullif(p_payload->>'nif', ''),
    nullif(p_payload->>'morada', ''),
    coalesce(p_payload->>'nivel_acesso', 'operador'),
    coalesce(p_payload->'permissoes', '{}'::jsonb),
    coalesce((p_payload->>'senha_provisoria')::boolean, false),
    (p_payload->>'senha_alterada_em')::timestamptz,
    coalesce((p_payload->>'ativo')::boolean, true),
    (p_payload->>'ultimo_login_em')::timestamptz,
    nullif(p_payload->>'criado_por', '')::uuid
  )
  on conflict (id) do update set
    username = coalesce(nullif(lower(trim(coalesce(p_payload->>'username', ''))), ''), seguranca.perfis_utilizadores.username),
    nome_completo = excluded.nome_completo,
    email = excluded.email,
    email_recuperacao = case
      when p_payload ? 'email_recuperacao' then nullif(lower(trim(coalesce(p_payload->>'email_recuperacao', ''))), '')
      else seguranca.perfis_utilizadores.email_recuperacao
    end,
    cargo = excluded.cargo,
    departamento = excluded.departamento,
    telefone = excluded.telefone,
    nif = case when p_payload ? 'nif' then nullif(p_payload->>'nif', '') else seguranca.perfis_utilizadores.nif end,
    morada = case when p_payload ? 'morada' then nullif(p_payload->>'morada', '') else seguranca.perfis_utilizadores.morada end,
    nivel_acesso = excluded.nivel_acesso,
    permissoes = excluded.permissoes,
    senha_provisoria = coalesce((p_payload->>'senha_provisoria')::boolean, seguranca.perfis_utilizadores.senha_provisoria),
    senha_alterada_em = coalesce((p_payload->>'senha_alterada_em')::timestamptz, seguranca.perfis_utilizadores.senha_alterada_em),
    ativo = excluded.ativo,
    ultimo_login_em = coalesce((p_payload->>'ultimo_login_em')::timestamptz, seguranca.perfis_utilizadores.ultimo_login_em),
    atualizado_em = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- Resolver login por username (ex: adminspark) OU email (para backend service_role)
create or replace function public.spark_resolve_login_identifier(p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = seguranca, auth, public
as $$
declare
  v_ident text := lower(trim(coalesce(p_identifier, '')));
  v_perfil seguranca.perfis_utilizadores;
  v_auth_email text;
begin
  if v_ident = '' then
    return jsonb_build_object('found', false);
  end if;

  select p.*
    into v_perfil
  from seguranca.perfis_utilizadores p
  where lower(trim(coalesce(p.username, ''))) = v_ident
     or lower(trim(p.email)) = v_ident
     or lower(trim(coalesce(p.email_recuperacao, ''))) = v_ident
  order by
    case
      when lower(trim(coalesce(p.username, ''))) = v_ident then 1
      when lower(trim(p.email)) = v_ident then 2
      else 3
    end
  limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select u.email into v_auth_email from auth.users u where u.id = v_perfil.id limit 1;

  return jsonb_build_object(
    'found', true,
    'id', v_perfil.id,
    'username', v_perfil.username,
    'auth_email', lower(trim(coalesce(v_auth_email, v_perfil.email))),
    'email_recuperacao', v_perfil.email_recuperacao,
    'ativo', coalesce(v_perfil.ativo, true)
  );
end;
$$;

-- Atualizar dados cadastrais do próprio utilizador autenticado (sem alterar papel/permissões)
create or replace function public.spark_update_own_profile(
  p_user_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = seguranca, public
as $$
declare
  v_row seguranca.perfis_utilizadores;
  v_new_email text := nullif(lower(trim(coalesce(p_payload->>'email_recuperacao', ''))), '');
  v_sync_auth_email boolean := coalesce((p_payload->>'sync_primary_email')::boolean, false);
begin
  update seguranca.perfis_utilizadores
  set
    nome_completo = coalesce(nullif(trim(coalesce(p_payload->>'nome_completo', '')), ''), nome_completo),
    email = case
      when v_sync_auth_email and v_new_email is not null then v_new_email
      else email
    end,
    email_recuperacao = case
      when p_payload ? 'email_recuperacao' then v_new_email
      else email_recuperacao
    end,
    nif = case
      when p_payload ? 'nif' then nullif(regexp_replace(coalesce(p_payload->>'nif', ''), '\D', '', 'g'), '')
      else nif
    end,
    telefone = case
      when p_payload ? 'telefone' then nullif(trim(coalesce(p_payload->>'telefone', '')), '')
      else telefone
    end,
    morada = case
      when p_payload ? 'morada' then nullif(trim(coalesce(p_payload->>'morada', '')), '')
      else morada
    end,
    cargo = case
      when p_payload ? 'cargo' then coalesce(nullif(trim(coalesce(p_payload->>'cargo', '')), ''), cargo)
      else cargo
    end,
    departamento = case
      when p_payload ? 'departamento' then coalesce(nullif(trim(coalesce(p_payload->>'departamento', '')), ''), departamento)
      else departamento
    end,
    atualizado_em = now()
  where id = p_user_id
  returning * into v_row;

  insert into seguranca.registos_auditoria (
    utilizador_id,
    utilizador_email,
    modulo,
    acao,
    entidade_id,
    detalhes
  )
  values (
    p_user_id,
    coalesce(v_row.email_recuperacao, v_row.email),
    'seguranca.conta',
    'ATUALIZAR_PERFIL_PROPRIO',
    p_user_id::text,
    jsonb_build_object(
      'nome_completo', v_row.nome_completo,
      'email_recuperacao', v_row.email_recuperacao,
      'nif', v_row.nif,
      'telefone', v_row.telefone
    )
  );

  return to_jsonb(v_row);
end;
$$;

-- Atualizar spark_check_password_recovery para aceitar username (ex: adminspark) OU email de recuperação
create or replace function public.spark_check_password_recovery(
  p_email text,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = seguranca, auth, public
as $$
declare
  v_ident text := lower(trim(coalesce(p_email, '')));
  v_ip text := nullif(trim(coalesce(p_ip_hash, '')), '');
  v_last_req timestamptz;
  v_email_count integer := 0;
  v_ip_count integer := 0;
  v_wait integer := 0;
  v_perfil seguranca.perfis_utilizadores;
  v_has_perfil boolean := false;
  v_auth_email text;
  v_delivery_email text;
  v_is_placeholder boolean := false;
begin
  if v_ident = '' then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'INVALID_EMAIL',
      'retry_after_seconds', 0
    );
  end if;

  select *
    into v_perfil
  from seguranca.perfis_utilizadores p
  where lower(trim(coalesce(p.username, ''))) = v_ident
     or lower(trim(coalesce(p.email_recuperacao, ''))) = v_ident
     or lower(trim(p.email)) = v_ident
  order by
    case
      when lower(trim(coalesce(p.username, ''))) = v_ident then 1
      when lower(trim(coalesce(p.email_recuperacao, ''))) = v_ident then 2
      else 3
    end
  limit 1;

  v_has_perfil := found;

  if v_has_perfil then
    select u.email into v_auth_email from auth.users u where u.id = v_perfil.id limit 1;
    v_auth_email := lower(trim(coalesce(v_auth_email, v_perfil.email)));
    v_delivery_email := coalesce(nullif(lower(trim(coalesce(v_perfil.email_recuperacao, ''))), ''), v_auth_email);
    v_is_placeholder := (v_delivery_email = '' or v_delivery_email like '%@sistema.sparksmirk.internal');
  else
    v_delivery_email := v_ident;
    v_auth_email := v_ident;
    v_is_placeholder := false;
  end if;

  -- Cooldown de 60 segundos entre pedidos válidos
  select max(r.criado_em)
    into v_last_req
  from seguranca.recuperacao_senhas r
  where (lower(r.email) = v_ident or (v_delivery_email <> '' and lower(r.email) = v_delivery_email))
    and r.estado in ('solicitado', 'email_enviado')
    and r.criado_em > now() - interval '60 seconds';

  if v_last_req is not null then
    v_wait := greatest(1, ceil(extract(epoch from ((v_last_req + interval '60 seconds') - now())))::integer);
    return jsonb_build_object(
      'allowed', false,
      'reason', 'COOLDOWN_ACTIVE',
      'retry_after_seconds', v_wait
    );
  end if;

  -- Máximo de 5 pedidos por identificador em 15 minutos
  select count(*)::integer
    into v_email_count
  from seguranca.recuperacao_senhas r
  where (lower(r.email) = v_ident or (v_delivery_email <> '' and lower(r.email) = v_delivery_email))
    and r.estado in ('solicitado', 'email_enviado', 'ignorado')
    and r.criado_em > now() - interval '15 minutes';

  if v_email_count >= 5 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'RATE_LIMIT_EXCEEDED',
      'retry_after_seconds', 900
    );
  end if;

  -- Máximo de 10 pedidos por IP em 15 minutos
  if v_ip is not null then
    select count(*)::integer
      into v_ip_count
    from seguranca.recuperacao_senhas r
    where r.ip_hash = v_ip
      and r.estado in ('solicitado', 'email_enviado', 'ignorado')
      and r.criado_em > now() - interval '15 minutes';

    if v_ip_count >= 10 then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'RATE_LIMIT_EXCEEDED',
        'retry_after_seconds', 900
      );
    end if;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'reason', 'OK',
    'retry_after_seconds', 0,
    'user_exists', v_has_perfil,
    'user_active', case when v_has_perfil then coalesce(v_perfil.ativo, false) else false end,
    'utilizador_id', case when v_has_perfil then v_perfil.id else null end,
    'username', case when v_has_perfil then v_perfil.username else null end,
    'nome_completo', case when v_has_perfil then v_perfil.nome_completo else null end,
    'cargo', case when v_has_perfil then v_perfil.cargo else null end,
    'departamento', case when v_has_perfil then v_perfil.departamento else null end,
    'auth_email', v_auth_email,
    'delivery_email', v_delivery_email,
    'is_placeholder_only', v_is_placeholder
  );
end;
$$;

revoke all on function public.spark_resolve_login_identifier(text) from public, anon, authenticated;
revoke all on function public.spark_update_own_profile(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.spark_check_password_recovery(text, text) from public, anon, authenticated;

grant execute on function public.spark_resolve_login_identifier(text) to service_role;
grant execute on function public.spark_update_own_profile(uuid, jsonb) to service_role;
grant execute on function public.spark_check_password_recovery(text, text) to service_role;

-- ============================================================================
-- SEED DIRETO DO ADMINISTRADOR DO GESTOR: adminspark / Adminspark123
-- Login: adminspark (sem precisar de email)
-- 1.º acesso: exige definição de nova palavra-passe definitiva
-- Email de recuperação: será preenchido na aba Configurações pelo gestor
-- ============================================================================
do $$
declare
  v_admin_id uuid;
  v_internal_email text := 'adminspark@sistema.sparksmirk.internal';
  v_full_perms jsonb := '{
    "dashboard": {"ver": true, "valores": true},
    "rh_funcionarios": {"ver": true, "criar": true, "editar": true, "excluir": true, "assiduidade": true, "ordenados": true, "pagamentos": true},
    "rh_recibos": {"ver": true, "emitir": true, "anexar": true, "excluir": true},
    "op_obras": {"ver": true, "criar": true, "editar": true, "excluir": true, "valores": true, "orcamentos": true, "pagamentos": true, "faturas": true, "responsaveis": true},
    "admin_utilizadores": {"ver": true, "criar": true, "editar": true, "excluir": true}
  }'::jsonb;
  v_app_meta jsonb;
  v_user_meta jsonb;
begin
  select p.id into v_admin_id
  from seguranca.perfis_utilizadores p
  where lower(trim(coalesce(p.username, ''))) = 'adminspark'
     or lower(trim(p.email)) = v_internal_email
  limit 1;

  if v_admin_id is null then
    select u.id into v_admin_id
    from auth.users u
    where lower(trim(u.email)) = v_internal_email
    limit 1;
  end if;

  v_app_meta := jsonb_build_object(
    'provider', 'email',
    'providers', jsonb_build_array('email'),
    'nivel_acesso', 'administrador',
    'permissoes', v_full_perms,
    'must_change_password', true,
    'ativo', true,
    'username', 'adminspark'
  );

  v_user_meta := jsonb_build_object(
    'nome_completo', 'Administrador Geral',
    'cargo', 'Direção / Administrador Geral',
    'departamento', 'Administração',
    'username', 'adminspark'
  );

  if v_admin_id is null then
    v_admin_id := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      last_sign_in_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_admin_id,
      'authenticated',
      'authenticated',
      v_internal_email,
      extensions.crypt('Adminspark123', extensions.gen_salt('bf')),
      now(),
      null,
      v_app_meta,
      v_user_meta,
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      v_admin_id,
      v_admin_id::text,
      jsonb_build_object(
        'sub', v_admin_id::text,
        'email', v_internal_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      null,
      now(),
      now()
    );
  end if;

  insert into seguranca.perfis_utilizadores (
    id,
    username,
    nome_completo,
    email,
    email_recuperacao,
    cargo,
    departamento,
    nivel_acesso,
    permissoes,
    senha_provisoria,
    ativo
  )
  values (
    v_admin_id,
    'adminspark',
    'Administrador Geral',
    v_internal_email,
    null,
    'Direção / Administrador Geral',
    'Administração',
    'administrador',
    v_full_perms,
    true,
    true
  )
  on conflict (id) do update set
    username = coalesce(seguranca.perfis_utilizadores.username, 'adminspark'),
    nivel_acesso = 'administrador',
    permissoes = v_full_perms,
    ativo = true,
    atualizado_em = now();
end $$;
