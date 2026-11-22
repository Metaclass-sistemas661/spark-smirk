-- ============================================================================
-- SPARK & SMIRK — MIGRAÇÃO: PERMISSÕES GRANULARES, SENHA PROVISÓRIA E BRIDGE DB
-- Pasta: supabase/01-seguranca/03-permissoes-e-senha-provisoria.sql
-- Execute este ficheiro no SQL Editor do Supabase.
-- ============================================================================

alter table seguranca.perfis_utilizadores
  add column if not exists departamento text default 'Geral',
  add column if not exists telefone text,
  add column if not exists permissoes jsonb not null default '{}'::jsonb,
  add column if not exists senha_provisoria boolean not null default false,
  add column if not exists senha_alterada_em timestamptz,
  add column if not exists criado_por uuid references auth.users(id) on delete set null;

create index if not exists idx_perfis_nivel_ativo
  on seguranca.perfis_utilizadores (nivel_acesso, ativo);

grant select, insert, update, delete on table seguranca.perfis_utilizadores to authenticated;
grant all on table seguranca.perfis_utilizadores to service_role;

-- ============================================================================
-- BRIDGE RPC EXCLUSIVO PARA SERVICE_ROLE (permite comunicação garantida com o
-- schema seguranca mesmo que o schema não esteja exposto na API pública)
-- ============================================================================

create or replace function public.spark_count_perfis()
returns integer
language sql
security definer
set search_path = seguranca, public
as $$
  select count(*)::integer from seguranca.perfis_utilizadores;
$$;

create or replace function public.spark_get_perfil(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = seguranca, public
as $$
  select to_jsonb(p) from seguranca.perfis_utilizadores p where p.id = p_user_id limit 1;
$$;

create or replace function public.spark_list_perfis()
returns jsonb
language sql
security definer
set search_path = seguranca, public
as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.criado_em desc), '[]'::jsonb)
  from seguranca.perfis_utilizadores p;
$$;

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
    id, nome_completo, email, cargo, departamento, telefone,
    nivel_acesso, permissoes, senha_provisoria, senha_alterada_em,
    ativo, ultimo_login_em, criado_por
  )
  values (
    (p_payload->>'id')::uuid,
    coalesce(p_payload->>'nome_completo', 'Utilizador'),
    lower(trim(p_payload->>'email')),
    coalesce(p_payload->>'cargo', 'Gestor Interno'),
    coalesce(p_payload->>'departamento', 'Geral'),
    nullif(p_payload->>'telefone', ''),
    coalesce(p_payload->>'nivel_acesso', 'operador'),
    coalesce(p_payload->'permissoes', '{}'::jsonb),
    coalesce((p_payload->>'senha_provisoria')::boolean, false),
    (p_payload->>'senha_alterada_em')::timestamptz,
    coalesce((p_payload->>'ativo')::boolean, true),
    (p_payload->>'ultimo_login_em')::timestamptz,
    nullif(p_payload->>'criado_por', '')::uuid
  )
  on conflict (id) do update set
    nome_completo = excluded.nome_completo,
    email = excluded.email,
    cargo = excluded.cargo,
    departamento = excluded.departamento,
    telefone = excluded.telefone,
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

create or replace function public.spark_touch_login(p_user_id uuid)
returns void
language sql
security definer
set search_path = seguranca, public
as $$
  update seguranca.perfis_utilizadores
  set ultimo_login_em = now()
  where id = p_user_id;
$$;

create or replace function public.spark_delete_perfil(p_user_id uuid)
returns void
language sql
security definer
set search_path = seguranca, public
as $$
  delete from seguranca.perfis_utilizadores where id = p_user_id;
$$;

create or replace function public.spark_write_auditoria(p_payload jsonb)
returns void
language sql
security definer
set search_path = seguranca, public
as $$
  insert into seguranca.registos_auditoria (
    utilizador_id, utilizador_email, modulo, acao, entidade_id, detalhes
  )
  values (
    nullif(p_payload->>'utilizador_id', '')::uuid,
    p_payload->>'utilizador_email',
    coalesce(p_payload->>'modulo', 'seguranca.utilizadores'),
    p_payload->>'acao',
    p_payload->>'entidade_id',
    coalesce(p_payload->'detalhes', '{}'::jsonb)
  );
$$;

-- Bloquear execução pública e anónima; permitir APENAS service_role (backend)
revoke all on function public.spark_count_perfis() from public, anon, authenticated;
revoke all on function public.spark_get_perfil(uuid) from public, anon, authenticated;
revoke all on function public.spark_list_perfis() from public, anon, authenticated;
revoke all on function public.spark_upsert_perfil(jsonb) from public, anon, authenticated;
revoke all on function public.spark_touch_login(uuid) from public, anon, authenticated;
revoke all on function public.spark_delete_perfil(uuid) from public, anon, authenticated;
revoke all on function public.spark_write_auditoria(jsonb) from public, anon, authenticated;

grant execute on function public.spark_count_perfis() to service_role;
grant execute on function public.spark_get_perfil(uuid) to service_role;
grant execute on function public.spark_list_perfis() to service_role;
grant execute on function public.spark_upsert_perfil(jsonb) to service_role;
grant execute on function public.spark_touch_login(uuid) to service_role;
grant execute on function public.spark_delete_perfil(uuid) to service_role;
grant execute on function public.spark_write_auditoria(jsonb) to service_role;
