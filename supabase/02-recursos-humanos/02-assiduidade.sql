-- ============================================================================
-- SPARK & SMIRK — ASSIDUIDADE E PRESENÇAS (Schema: rh)
-- Pasta: supabase/02-recursos-humanos/02-assiduidade.sql
-- ============================================================================

create table if not exists rh.assiduidade (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references rh.funcionarios(id) on delete cascade,
  data_trabalho date not null,
  estado text not null
    check (estado in ('presente', 'falta_justificada', 'falta_injustificada', 'ferias', 'baixa')),
  horas_extra numeric(5, 2) not null default 0,
  observacoes text,
  registado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (funcionario_id, data_trabalho)
);

comment on table rh.assiduidade is 'Registo diário de presenças, faltas, férias e baixas para relatório mensal';

create index if not exists idx_assiduidade_data on rh.assiduidade (data_trabalho desc);
create index if not exists idx_assiduidade_func_data on rh.assiduidade (funcionario_id, data_trabalho);

create trigger trg_assiduidade_updated_at
  before update on rh.assiduidade
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table rh.assiduidade to authenticated;
grant all on table rh.assiduidade to service_role;

alter table rh.assiduidade enable row level security;

create policy "Acesso autenticado a rh.assiduidade"
  on rh.assiduidade
  for all to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
