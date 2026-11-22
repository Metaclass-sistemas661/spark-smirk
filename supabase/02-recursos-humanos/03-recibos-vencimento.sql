-- ============================================================================
-- SPARK & SMIRK — PROCESSAMENTO DE RECIBOS DE VENCIMENTO (Schema: rh)
-- Pasta: supabase/02-recursos-humanos/03-recibos-vencimento.sql
-- ============================================================================

create table if not exists rh.recibos_vencimento (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references rh.funcionarios(id) on delete cascade,
  ano smallint not null check (ano between 2020 and 2100),
  mes smallint not null check (mes between 1 and 12),
  periodo text generated always as (
    ano::text || '-' || lpad(mes::text, 2, '0')
  ) stored,
  salario_base numeric(12, 2) not null default 0,
  subsidio_alimentacao numeric(12, 2) not null default 0,
  horas_extra_valor numeric(12, 2) not null default 0,
  premios numeric(12, 2) not null default 0,
  taxa_irs numeric(5, 2) not null default 0,
  taxa_ss numeric(5, 2) not null default 11.00,
  total_bruto numeric(12, 2) not null default 0,
  total_liquido numeric(12, 2) not null default 0,
  estado_pagamento text not null default 'Emitido'
    check (estado_pagamento in ('Rascunho', 'Emitido', 'Pago')),
  data_pagamento date,
  emitido_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (funcionario_id, ano, mes)
);

comment on table rh.recibos_vencimento is 'Cálculo e emissão de vencimentos mensais (IRS, Segurança Social e líquido)';

create index if not exists idx_recibos_periodo on rh.recibos_vencimento (ano desc, mes desc);

create trigger trg_recibos_updated_at
  before update on rh.recibos_vencimento
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table rh.recibos_vencimento to authenticated;
grant all on table rh.recibos_vencimento to service_role;

alter table rh.recibos_vencimento enable row level security;

create policy "Acesso autenticado a rh.recibos_vencimento"
  on rh.recibos_vencimento
  for all to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
