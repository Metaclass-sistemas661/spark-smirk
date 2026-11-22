-- ============================================================================
-- SPARK & SMIRK — ANEXOS DE RECIBOS POR ANO E MÊS (Schema: rh)
-- Pasta: supabase/02-recursos-humanos/04-recibos-anexados.sql
-- ============================================================================

create table if not exists rh.recibos_anexados (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references rh.funcionarios(id) on delete cascade,
  recibo_id uuid references rh.recibos_vencimento(id) on delete set null,
  ano smallint not null check (ano between 2020 and 2100),
  mes smallint not null check (mes between 1 and 12),
  periodo text generated always as (
    ano::text || '-' || lpad(mes::text, 2, '0')
  ) stored,
  nome_ficheiro text not null,
  tamanho_legivel text,
  tipo_mime text,
  caminho_storage text,
  notas text,
  anexado_por uuid references auth.users(id),
  anexado_em timestamptz not null default now()
);

comment on table rh.recibos_anexados is 'Arquivo documental de recibos de vencimento anexados por funcionário, ano e mês';

create index if not exists idx_recibos_anexados_filtro
  on rh.recibos_anexados (funcionario_id, ano desc, mes desc);

grant select, insert, update, delete on table rh.recibos_anexados to authenticated;
grant all on table rh.recibos_anexados to service_role;

alter table rh.recibos_anexados enable row level security;

create policy "Acesso autenticado a rh.recibos_anexados"
  on rh.recibos_anexados
  for all to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
