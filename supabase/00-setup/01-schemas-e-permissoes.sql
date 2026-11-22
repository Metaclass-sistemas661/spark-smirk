-- ============================================================================
-- SPARK & SMIRK — SETUP DE SCHEMAS E PERMISSÕES BASE
-- Pasta: supabase/00-setup/01-schemas-e-permissoes.sql
-- Execute este ficheiro PRIMEIRO no SQL Editor do Supabase.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. CRIAÇÃO DE SCHEMAS SEPARADOS POR ÁREA DE NEGÓCIO
-- ----------------------------------------------------------------------------
create schema if not exists seguranca;
create schema if not exists rh;
create schema if not exists operacional;

comment on schema seguranca is 'Segurança, perfis de operadores internos e auditoria do sistema';
comment on schema rh is 'Recursos Humanos: funcionários, assiduidade e recibos de vencimento';
comment on schema operacional is 'Operacional: obras, orçamentos e pagamentos';

-- ----------------------------------------------------------------------------
-- 2. BLOQUEIO DE ACESSO ANÓNIMO E PERMISSÕES PARA UTILIZADORES AUTENTICADOS
-- ----------------------------------------------------------------------------
revoke all on schema seguranca from public, anon;
revoke all on schema rh from public, anon;
revoke all on schema operacional from public, anon;

grant usage on schema seguranca to authenticated, service_role;
grant usage on schema rh to authenticated, service_role;
grant usage on schema operacional to authenticated, service_role;

-- Privilégios padrão para futuras tabelas/sequências criadas nestes schemas
alter default privileges in schema seguranca
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema rh
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema operacional
  grant select, insert, update, delete on tables to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. FUNÇÃO AUXILIAR GLOBAL PARA ATUALIZAÇÃO AUTOMÁTICA DE updated_at
-- ----------------------------------------------------------------------------
create or replace function seguranca.atualizar_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;
