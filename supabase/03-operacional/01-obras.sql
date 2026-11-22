-- ============================================================================
-- SPARK & SMIRK — OBRAS E PROJETOS (Schema: operacional)
-- Pasta: supabase/03-operacional/01-obras.sql
-- ============================================================================

create table if not exists operacional.obras (
  id uuid primary key default gen_random_uuid(),
  codigo_obra text not null unique,
  nome_obra text not null,
  cliente_nome text not null,
  cliente_nif text,
  localizacao text,
  categoria text not null default 'Construção Civil',
  estado text not null
    check (estado in ('em_andamento', 'a_iniciar', 'concluida')),
  data_inicio date,
  data_fim_prevista date,
  progresso_percent integer not null default 0 check (progresso_percent between 0 and 100),
  responsavel_obra text,
  valor_adjudicado numeric(14, 2) not null default 0,
  descricao text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table operacional.obras is 'Gestão de obras em andamento, obras a iniciar e obras concluídas';

create index if not exists idx_obras_estado on operacional.obras (estado);
create index if not exists idx_obras_cliente on operacional.obras (cliente_nome);

create trigger trg_obras_updated_at
  before update on operacional.obras
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table operacional.obras to authenticated;
grant all on table operacional.obras to service_role;

alter table operacional.obras enable row level security;

create policy "Acesso autenticado a operacional.obras"
  on operacional.obras
  for all to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
