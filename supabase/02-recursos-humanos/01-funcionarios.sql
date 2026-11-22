-- ============================================================================
-- SPARK & SMIRK — FUNCIONÁRIOS (Schema: rh)
-- Pasta: supabase/02-recursos-humanos/01-funcionarios.sql
-- ============================================================================

create table if not exists rh.funcionarios (
  id uuid primary key default gen_random_uuid(),
  codigo_interno text unique,
  nome_completo text not null,
  cargo text not null,
  departamento text not null,
  nif text unique,
  niss text,
  iban text,
  email text,
  telemovel text,
  tipo_contrato text not null default 'Sem Termo',
  data_admissao date,
  salario_base numeric(12, 2) not null default 0,
  subsidio_alimentacao numeric(12, 2) not null default 0,
  estado text not null default 'Ativo'
    check (estado in ('Ativo', 'Férias', 'Baixa Médica', 'Inativo')),
  observacoes text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table rh.funcionarios is 'Cadastro mestre de colaboradores da Spark & Smirk, Lda.';

create index if not exists idx_funcionarios_nome on rh.funcionarios (nome_completo);
create index if not exists idx_funcionarios_estado on rh.funcionarios (estado);

create trigger trg_funcionarios_updated_at
  before update on rh.funcionarios
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table rh.funcionarios to authenticated;
grant all on table rh.funcionarios to service_role;

alter table rh.funcionarios enable row level security;

create policy "Acesso autenticado a rh.funcionarios"
  on rh.funcionarios
  for all to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
