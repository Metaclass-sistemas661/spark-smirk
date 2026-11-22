-- ============================================================================
-- SPARK & SMIRK — REGISTOS DE AUDITORIA E SEGURANÇA (Schema: seguranca)
-- Pasta: supabase/01-seguranca/02-registos-auditoria.sql
-- ============================================================================

create table if not exists seguranca.registos_auditoria (
  id uuid primary key default gen_random_uuid(),
  utilizador_id uuid references auth.users(id) on delete set null,
  utilizador_email text,
  modulo text not null,       -- ex: 'login', 'rh.funcionarios', 'operacional.obras'
  acao text not null,         -- ex: 'CRIAR', 'EDITAR', 'ELIMINAR', 'ANEXAR_RECIBO'
  entidade_id text,
  detalhes jsonb default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

comment on table seguranca.registos_auditoria is 'Histórico imutável de ações críticas realizadas no sistema de gestão';

create index if not exists idx_auditoria_modulo_data
  on seguranca.registos_auditoria (modulo, criado_em desc);

grant select, insert on table seguranca.registos_auditoria to authenticated;
grant all on table seguranca.registos_auditoria to service_role;

alter table seguranca.registos_auditoria enable row level security;

create policy "Autenticados registam e consultam auditoria"
  on seguranca.registos_auditoria
  for select to authenticated
  using (auth.role() = 'authenticated');

create policy "Autenticados inserem logs de auditoria"
  on seguranca.registos_auditoria
  for insert to authenticated
  with check (auth.role() = 'authenticated');
