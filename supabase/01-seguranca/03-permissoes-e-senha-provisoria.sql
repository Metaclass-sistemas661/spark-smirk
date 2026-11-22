-- ============================================================================
-- SPARK & SMIRK — MIGRAÇÃO: PERMISSÕES GRANULARES & SENHA PROVISÓRIA
-- Pasta: supabase/01-seguranca/03-permissoes-e-senha-provisoria.sql
-- Execute este ficheiro no SQL Editor do Supabase caso já tenha criado a tabela
-- seguranca.perfis_utilizadores anteriormente.
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
