-- ============================================================================
-- SPARK & SMIRK — ORÇAMENTOS E RUBRICAS DE OBRA (Schema: operacional)
-- Pasta: supabase/03-operacional/02-orcamentos.sql
-- ============================================================================

create table if not exists operacional.orcamentos (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references operacional.obras(id) on delete cascade,
  codigo_orcamento text not null unique,
  titulo text not null,
  versao smallint not null default 1,
  estado text not null default 'Em Análise'
    check (estado in ('Rascunho', 'Em Análise', 'Aprovado', 'Rejeitado')),
  taxa_iva numeric(5, 2) not null default 23.00,
  margem_percent numeric(5, 2) not null default 0,
  validade_ate date,
  observacoes text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table operacional.orcamentos is 'Cabeçalho de orçamentos associados a cada obra';

create table if not exists operacional.orcamento_itens (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references operacional.orcamentos(id) on delete cascade,
  categoria text not null, -- ex: 'Mão de Obra', 'Materiais', 'Equipamentos', 'Subempreitada'
  descricao text not null,
  quantidade numeric(12, 2) not null default 1,
  unidade text not null default 'un',
  preco_unitario numeric(12, 2) not null default 0,
  total_linha numeric(14, 2) generated always as (quantidade * preco_unitario) stored,
  criado_em timestamptz not null default now()
);

comment on table operacional.orcamento_itens is 'Rubricas detalhadas e preços unitários de cada orçamento';

create index if not exists idx_orcamentos_obra on operacional.orcamentos (obra_id);
create index if not exists idx_orcamento_itens_orc on operacional.orcamento_itens (orcamento_id);

create trigger trg_orcamentos_updated_at
  before update on operacional.orcamentos
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table operacional.orcamentos to authenticated;
grant select, insert, update, delete on table operacional.orcamento_itens to authenticated;
grant all on table operacional.orcamentos, operacional.orcamento_itens to service_role;

alter table operacional.orcamentos enable row level security;
alter table operacional.orcamento_itens enable row level security;

create policy "Acesso autenticado a operacional.orcamentos"
  on operacional.orcamentos
  for all to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "Acesso autenticado a operacional.orcamento_itens"
  on operacional.orcamento_itens
  for all to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
