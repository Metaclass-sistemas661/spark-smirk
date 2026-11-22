-- ============================================================================
-- SPARK & SMIRK — PAGAMENTOS E FATURAÇÃO DE OBRAS (Schema: operacional)
-- Pasta: supabase/03-operacional/03-pagamentos-obras.sql
-- ============================================================================

create table if not exists operacional.pagamentos_obras (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references operacional.obras(id) on delete cascade,
  descricao_prestacao text not null,
  referencia_fatura text,
  data_vencimento date not null,
  data_pagamento date,
  valor numeric(14, 2) not null default 0,
  metodo_pagamento text default 'Transferência Bancária',
  estado text not null default 'Em Aberto'
    check (estado in ('Pago', 'Em Aberto', 'Atrasado')),
  notas text,
  registado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table operacional.pagamentos_obras is 'Controlo financeiro das obras: prestações pagas, datas de pagamento e valores em aberto';

create index if not exists idx_pagamentos_obra_estado
  on operacional.pagamentos_obras (obra_id, estado, data_vencimento);

create trigger trg_pagamentos_obras_updated_at
  before update on operacional.pagamentos_obras
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table operacional.pagamentos_obras to authenticated;
grant all on table operacional.pagamentos_obras to service_role;

alter table operacional.pagamentos_obras enable row level security;

create policy "Acesso autenticado a operacional.pagamentos_obras"
  on operacional.pagamentos_obras
  for all to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
