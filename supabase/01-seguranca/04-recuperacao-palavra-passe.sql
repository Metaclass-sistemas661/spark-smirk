-- ============================================================================
-- SPARK & SMIRK — RECUPERAÇÃO DE PALAVRA-PASSE E AUDITORIA (Schema: seguranca)
-- Pasta: supabase/01-seguranca/04-recuperacao-palavra-passe.sql
-- Execute este ficheiro no SQL Editor.
-- ============================================================================

create table if not exists seguranca.recuperacao_senhas (
  id uuid primary key default gen_random_uuid(),
  utilizador_id uuid references auth.users(id) on delete cascade,
  email text not null,
  nome_completo text,
  canal_envio text not null default 'auth_email'
    check (canal_envio in ('smtp_personalizado', 'resend_api', 'auth_email', 'bloqueado', 'ignorado')),
  origem_url text,
  ip_hash text,
  estado text not null default 'solicitado'
    check (estado in ('solicitado', 'email_enviado', 'concluido', 'expirado', 'bloqueado', 'ignorado', 'erro')),
  expira_em timestamptz not null default (now() + interval '60 minutes'),
  concluido_em timestamptz,
  detalhes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

comment on table seguranca.recuperacao_senhas is
  'Controlo de pedidos de recuperação de palavra-passe, limite de frequência (rate limit) e auditoria de redefinições';

create index if not exists idx_recuperacao_email_data
  on seguranca.recuperacao_senhas (lower(email), criado_em desc);

create index if not exists idx_recuperacao_ip_data
  on seguranca.recuperacao_senhas (ip_hash, criado_em desc);

create index if not exists idx_recuperacao_utilizador_estado
  on seguranca.recuperacao_senhas (utilizador_id, estado, criado_em desc);

revoke all on table seguranca.recuperacao_senhas from public, anon;
grant select on table seguranca.recuperacao_senhas to authenticated;
grant all on table seguranca.recuperacao_senhas to service_role;

alter table seguranca.recuperacao_senhas enable row level security;

drop policy if exists "Utilizador ou administrador consulta recuperacoes" on seguranca.recuperacao_senhas;
create policy "Utilizador ou administrador consulta recuperacoes"
  on seguranca.recuperacao_senhas
  for select to authenticated
  using (
    auth.uid() = utilizador_id
    or exists (
      select 1
      from seguranca.perfis_utilizadores p
      where p.id = auth.uid()
        and p.ativo = true
        and (
          p.nivel_acesso = 'administrador'
          or coalesce((p.permissoes->'admin_utilizadores'->>'ver')::boolean, false) = true
        )
    )
  );

-- ============================================================================
-- RPCs EXCLUSIVAS PARA SERVICE_ROLE (Backend Seguro)
-- ============================================================================

create or replace function public.spark_check_password_recovery(
  p_email text,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = seguranca, public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ip text := nullif(trim(coalesce(p_ip_hash, '')), '');
  v_last_req timestamptz;
  v_email_count integer := 0;
  v_ip_count integer := 0;
  v_wait integer := 0;
  v_perfil seguranca.perfis_utilizadores;
  v_has_perfil boolean := false;
begin
  if v_email = '' then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'INVALID_EMAIL',
      'retry_after_seconds', 0
    );
  end if;

  -- Cooldown de 60 segundos entre pedidos válidos para o mesmo email
  select max(r.criado_em)
    into v_last_req
  from seguranca.recuperacao_senhas r
  where lower(r.email) = v_email
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

  -- Máximo de 5 pedidos por email em 15 minutos
  select count(*)::integer
    into v_email_count
  from seguranca.recuperacao_senhas r
  where lower(r.email) = v_email
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

  select *
    into v_perfil
  from seguranca.perfis_utilizadores p
  where lower(trim(p.email)) = v_email
  limit 1;

  v_has_perfil := found;

  return jsonb_build_object(
    'allowed', true,
    'reason', 'OK',
    'retry_after_seconds', 0,
    'user_exists', v_has_perfil,
    'user_active', case when v_has_perfil then coalesce(v_perfil.ativo, false) else false end,
    'utilizador_id', case when v_has_perfil then v_perfil.id else null end,
    'nome_completo', case when v_has_perfil then v_perfil.nome_completo else null end,
    'cargo', case when v_has_perfil then v_perfil.cargo else null end,
    'departamento', case when v_has_perfil then v_perfil.departamento else null end
  );
end;
$$;

create or replace function public.spark_log_password_recovery(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = seguranca, public
as $$
declare
  v_id uuid;
  v_user_id uuid := nullif(trim(coalesce(p_payload->>'utilizador_id', '')), '')::uuid;
  v_email text := lower(trim(coalesce(p_payload->>'email', '')));
  v_canal text := coalesce(p_payload->>'canal_envio', 'auth_email');
  v_estado text := coalesce(p_payload->>'estado', 'solicitado');
begin
  insert into seguranca.recuperacao_senhas (
    utilizador_id,
    email,
    nome_completo,
    canal_envio,
    origem_url,
    ip_hash,
    estado,
    detalhes
  )
  values (
    v_user_id,
    v_email,
    nullif(trim(coalesce(p_payload->>'nome_completo', '')), ''),
    v_canal,
    nullif(trim(coalesce(p_payload->>'origem_url', '')), ''),
    nullif(trim(coalesce(p_payload->>'ip_hash', '')), ''),
    v_estado,
    coalesce(p_payload->'detalhes', '{}'::jsonb)
  )
  returning id into v_id;

  insert into seguranca.registos_auditoria (
    utilizador_id,
    utilizador_email,
    modulo,
    acao,
    entidade_id,
    detalhes
  )
  values (
    v_user_id,
    v_email,
    'seguranca.recuperacao',
    case
      when v_estado = 'bloqueado' then 'BLOQUEAR_RECUPERACAO_SENHA'
      else 'SOLICITAR_RECUPERACAO_SENHA'
    end,
    coalesce(v_id::text, v_email),
    jsonb_build_object(
      'canal_envio', v_canal,
      'estado', v_estado,
      'origem_url', nullif(trim(coalesce(p_payload->>'origem_url', '')), '')
    ) || coalesce(p_payload->'detalhes', '{}'::jsonb)
  );

  return jsonb_build_object('id', v_id, 'estado', v_estado);
end;
$$;

create or replace function public.spark_complete_password_recovery(
  p_user_id uuid,
  p_email text default null,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = seguranca, public
as $$
declare
  v_now timestamptz := now();
  v_updated integer := 0;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  update seguranca.recuperacao_senhas
  set estado = 'concluido',
      concluido_em = v_now,
      detalhes = coalesce(detalhes, '{}'::jsonb) || jsonb_build_object('concluido_em', v_now)
  where utilizador_id = p_user_id
    and estado in ('solicitado', 'email_enviado');

  get diagnostics v_updated = row_count;

  update seguranca.perfis_utilizadores
  set senha_provisoria = false,
      senha_alterada_em = v_now,
      atualizado_em = v_now
  where id = p_user_id;

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
    nullif(v_email, ''),
    'seguranca.recuperacao',
    'REDEFINIR_SENHA_EMAIL',
    p_user_id::text,
    jsonb_build_object(
      'pedidos_concluidos', v_updated,
      'ip_hash', nullif(trim(coalesce(p_ip_hash, '')), ''),
      'senha_alterada_em', v_now
    )
  );

  return jsonb_build_object(
    'ok', true,
    'pedidos_concluidos', v_updated,
    'senha_alterada_em', v_now
  );
end;
$$;

revoke all on function public.spark_check_password_recovery(text, text) from public, anon, authenticated;
revoke all on function public.spark_log_password_recovery(jsonb) from public, anon, authenticated;
revoke all on function public.spark_complete_password_recovery(uuid, text, text) from public, anon, authenticated;

grant execute on function public.spark_check_password_recovery(text, text) to service_role;
grant execute on function public.spark_log_password_recovery(jsonb) to service_role;
grant execute on function public.spark_complete_password_recovery(uuid, text, text) to service_role;
