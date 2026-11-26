-- ============================================================================
-- SPARK & SMIRK — RECRUTAMENTO & CANDIDATURAS ("TRABALHE CONNOSCO")
-- Pasta: supabase/02-recursos-humanos/08-candidaturas-recrutamento.sql
-- Execute este ficheiro no SQL Editor do Supabase (após 07-fix-recibos-constraints.sql).
-- ============================================================================

-- 1. Tabela de candidaturas espontâneas / recrutamento (Schema: rh)
create table if not exists rh.candidaturas (
  id uuid primary key default gen_random_uuid(),
  codigo_candidatura text not null unique,
  nome_completo text not null,
  email text not null,
  telefone text not null,
  distrito text not null default 'Porto',
  area_especialidade text not null,
  experiencia text not null default '1 a 3 anos',
  disponibilidade text not null default 'Imediata',
  carta_conducao text default 'Não indicada',
  certificacoes text,
  mensagem text,
  cv_nome_ficheiro text,
  cv_tipo_mime text,
  cv_tamanho_bytes bigint not null default 0,
  cv_caminho_storage text,
  estado text not null default 'Nova'
    check (estado in ('Nova', 'Em Análise', 'Entrevista', 'Contratado', 'Arquivada')),
  notas_internas text,
  avaliado_por uuid references auth.users(id),
  ip_hash text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table rh.candidaturas is 'Candidaturas submetidas através da página Trabalhe Connosco com currículo anexado';

create index if not exists idx_candidaturas_criado_em
  on rh.candidaturas (criado_em desc);

create index if not exists idx_candidaturas_estado
  on rh.candidaturas (estado);

create index if not exists idx_candidaturas_ip_hash
  on rh.candidaturas (ip_hash, criado_em desc);

drop trigger if exists trg_candidaturas_updated_at on rh.candidaturas;
create trigger trg_candidaturas_updated_at
  before update on rh.candidaturas
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table rh.candidaturas to authenticated;
grant all on table rh.candidaturas to service_role;

alter table rh.candidaturas enable row level security;

drop policy if exists "RLS rh.candidaturas ver" on rh.candidaturas;
drop policy if exists "RLS rh.candidaturas editar" on rh.candidaturas;
drop policy if exists "RLS rh.candidaturas excluir" on rh.candidaturas;

create policy "RLS rh.candidaturas ver"
  on rh.candidaturas
  for select to authenticated
  using (seguranca.utilizador_tem_permissao('rh_funcionarios', 'ver'));

create policy "RLS rh.candidaturas editar"
  on rh.candidaturas
  for update to authenticated
  using (
    seguranca.utilizador_tem_permissao('rh_funcionarios', 'editar')
    or seguranca.utilizador_tem_permissao('rh_funcionarios', 'criar')
  )
  with check (
    seguranca.utilizador_tem_permissao('rh_funcionarios', 'editar')
    or seguranca.utilizador_tem_permissao('rh_funcionarios', 'criar')
  );

create policy "RLS rh.candidaturas excluir"
  on rh.candidaturas
  for delete to authenticated
  using (seguranca.utilizador_tem_permissao('rh_funcionarios', 'excluir'));

-- 2. Bucket privado no Supabase Storage para currículos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'curriculos-candidatos',
  'curriculos-candidatos',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  ];

-- 3. RPCs para gestão segura de candidaturas (executadas via service_role na Cloud Function)
create or replace function public.spark_erp_create_candidate(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_code text := coalesce(
    nullif(trim(coalesce(p_payload->>'code', '')), ''),
    'CAN-' || upper(substring(gen_random_uuid()::text, 1, 8))
  );
  v_row rh.candidaturas;
begin
  insert into rh.candidaturas (
    codigo_candidatura,
    nome_completo,
    email,
    telefone,
    distrito,
    area_especialidade,
    experiencia,
    disponibilidade,
    carta_conducao,
    certificacoes,
    mensagem,
    cv_nome_ficheiro,
    cv_tipo_mime,
    cv_tamanho_bytes,
    cv_caminho_storage,
    estado,
    ip_hash
  )
  values (
    v_code,
    trim(coalesce(p_payload->>'fullName', '')),
    lower(trim(coalesce(p_payload->>'email', ''))),
    trim(coalesce(p_payload->>'phone', '')),
    coalesce(nullif(trim(coalesce(p_payload->>'district', '')), ''), 'Porto'),
    trim(coalesce(p_payload->>'specialty', 'Construção Civil')),
    coalesce(nullif(trim(coalesce(p_payload->>'experience', '')), ''), '1 a 3 anos'),
    coalesce(nullif(trim(coalesce(p_payload->>'availability', '')), ''), 'Imediata'),
    coalesce(nullif(trim(coalesce(p_payload->>'drivingLicense', '')), ''), 'Não indicada'),
    nullif(trim(coalesce(p_payload->>'certifications', '')), ''),
    nullif(trim(coalesce(p_payload->>'message', '')), ''),
    nullif(trim(coalesce(p_payload->>'cvFileName', '')), ''),
    nullif(trim(coalesce(p_payload->>'cvFileType', '')), ''),
    coalesce((p_payload->>'cvFileSize')::bigint, 0),
    nullif(trim(coalesce(p_payload->>'cvStoragePath', '')), ''),
    'Nova',
    nullif(trim(coalesce(p_payload->>'ipHash', '')), '')
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.codigo_candidatura,
    'dbId', v_row.id,
    'fullName', v_row.nome_completo,
    'email', v_row.email,
    'phone', v_row.telefone,
    'district', v_row.distrito,
    'specialty', v_row.area_especialidade,
    'experience', v_row.experiencia,
    'availability', v_row.disponibilidade,
    'drivingLicense', coalesce(v_row.carta_conducao, 'Não indicada'),
    'certifications', coalesce(v_row.certificacoes, ''),
    'message', coalesce(v_row.mensagem, ''),
    'cvFileName', coalesce(v_row.cv_nome_ficheiro, ''),
    'cvFileType', coalesce(v_row.cv_tipo_mime, ''),
    'cvFileSize', coalesce(v_row.cv_tamanho_bytes, 0),
    'cvStoragePath', coalesce(v_row.cv_caminho_storage, ''),
    'status', v_row.estado,
    'internalNotes', coalesce(v_row.notas_internas, ''),
    'createdAt', to_char(v_row.criado_em, 'YYYY-MM-DD')
  );
end;
$$;

create or replace function public.spark_erp_list_candidates()
returns jsonb
language sql
security definer
set search_path = rh, public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.codigo_candidatura,
      'dbId', c.id,
      'fullName', c.nome_completo,
      'email', c.email,
      'phone', c.telefone,
      'district', c.distrito,
      'specialty', c.area_especialidade,
      'experience', c.experiencia,
      'availability', c.disponibilidade,
      'drivingLicense', coalesce(c.carta_conducao, 'Não indicada'),
      'certifications', coalesce(c.certificacoes, ''),
      'message', coalesce(c.mensagem, ''),
      'cvFileName', coalesce(c.cv_nome_ficheiro, ''),
      'cvFileType', coalesce(c.cv_tipo_mime, ''),
      'cvFileSize', coalesce(c.cv_tamanho_bytes, 0),
      'cvStoragePath', coalesce(c.cv_caminho_storage, ''),
      'status', c.estado,
      'internalNotes', coalesce(c.notas_internas, ''),
      'createdAt', to_char(c.criado_em, 'YYYY-MM-DD')
    ) order by c.criado_em desc
  ), '[]'::jsonb)
  from rh.candidaturas c;
$$;

create or replace function public.spark_erp_update_candidate(
  p_code text,
  p_status text,
  p_notes text,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_row rh.candidaturas;
begin
  update rh.candidaturas
  set
    estado = coalesce(nullif(trim(coalesce(p_status, '')), ''), estado),
    notas_internas = p_notes,
    avaliado_por = coalesce(p_actor, avaliado_por),
    atualizado_em = now()
  where codigo_candidatura = p_code or id::text = p_code
  returning * into v_row;

  if not found then
    raise exception 'Candidatura não encontrada.';
  end if;

  return jsonb_build_object(
    'id', v_row.codigo_candidatura,
    'dbId', v_row.id,
    'fullName', v_row.nome_completo,
    'email', v_row.email,
    'phone', v_row.telefone,
    'district', v_row.distrito,
    'specialty', v_row.area_especialidade,
    'experience', v_row.experiencia,
    'availability', v_row.disponibilidade,
    'drivingLicense', coalesce(v_row.carta_conducao, 'Não indicada'),
    'certifications', coalesce(v_row.certificacoes, ''),
    'message', coalesce(v_row.mensagem, ''),
    'cvFileName', coalesce(v_row.cv_nome_ficheiro, ''),
    'cvFileType', coalesce(v_row.cv_tipo_mime, ''),
    'cvFileSize', coalesce(v_row.cv_tamanho_bytes, 0),
    'cvStoragePath', coalesce(v_row.cv_caminho_storage, ''),
    'status', v_row.estado,
    'internalNotes', coalesce(v_row.notas_internas, ''),
    'createdAt', to_char(v_row.criado_em, 'YYYY-MM-DD')
  );
end;
$$;

create or replace function public.spark_erp_get_candidate_cv(p_code text)
returns jsonb
language sql
security definer
set search_path = rh, public
as $$
  select jsonb_build_object(
    'id', c.codigo_candidatura,
    'fileName', coalesce(c.cv_nome_ficheiro, c.codigo_candidatura || '.pdf'),
    'fileType', coalesce(c.cv_tipo_mime, 'application/pdf'),
    'fileSize', coalesce(c.cv_tamanho_bytes, 0),
    'storagePath', c.cv_caminho_storage
  )
  from rh.candidaturas c
  where c.codigo_candidatura = p_code or c.id::text = p_code
  limit 1;
$$;

create or replace function public.spark_erp_delete_candidate(p_code text)
returns text
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_path text;
begin
  delete from rh.candidaturas
  where codigo_candidatura = p_code or id::text = p_code
  returning cv_caminho_storage into v_path;
  return v_path;
end;
$$;

revoke all on function public.spark_erp_create_candidate(jsonb) from public, anon, authenticated;
revoke all on function public.spark_erp_list_candidates() from public, anon, authenticated;
revoke all on function public.spark_erp_update_candidate(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_get_candidate_cv(text) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_candidate(text) from public, anon, authenticated;

grant execute on function public.spark_erp_create_candidate(jsonb) to service_role;
grant execute on function public.spark_erp_list_candidates() to service_role;
grant execute on function public.spark_erp_update_candidate(text, text, text, uuid) to service_role;
grant execute on function public.spark_erp_get_candidate_cv(text) to service_role;
grant execute on function public.spark_erp_delete_candidate(text) to service_role;
