-- ============================================================================
-- SPARK & SMIRK — PERFIS DE UTILIZADORES INTERNOS (Schema: seguranca)
-- Pasta: supabase/01-seguranca/01-utilizadores-perfil.sql
-- ============================================================================

create table if not exists seguranca.perfis_utilizadores (
  id uuid primary key references auth.users(id) on delete cascade,
  nome_completo text not null,
  email text not null unique,
  cargo text default 'Gestor Interno',
  nivel_acesso text not null default 'operador'
    check (nivel_acesso in ('administrador', 'rh', 'operacional', 'operador')),
  ativo boolean not null default true,
  ultimo_login_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table seguranca.perfis_utilizadores is 'Perfis de acesso e funções dos utilizadores autenticados no sistema interno';

create trigger trg_perfis_updated_at
  before update on seguranca.perfis_utilizadores
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update on table seguranca.perfis_utilizadores to authenticated;
grant all on table seguranca.perfis_utilizadores to service_role;

alter table seguranca.perfis_utilizadores enable row level security;

create policy "Utilizador autenticado consulta perfis"
  on seguranca.perfis_utilizadores
  for select to authenticated
  using (auth.role() = 'authenticated');

create policy "Utilizador atualiza apenas o proprio perfil"
  on seguranca.perfis_utilizadores
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
