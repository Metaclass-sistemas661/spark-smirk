-- ============================================================================
-- SPARK & SMIRK — SÁBADOS PAGOS, CAIXA DA EMPRESA & RELATÓRIOS AVANÇADOS
-- Pasta: supabase/02-recursos-humanos/11-sabados-caixa-relatorios.sql
-- Execute este ficheiro no SQL Editor do Supabase após 10-duodecimos-profissionais.sql.
-- ============================================================================

-- 1. Colunas de trabalho ao Sábado em rh.assiduidade
alter table rh.assiduidade
  add column if not exists sabado_extra_valor numeric(12, 2) not null default 0,
  add column if not exists sabado_tipo_pagamento text not null default 'por_fora';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'assiduidade_sabado_tipo_check'
      and conrelid = 'rh.assiduidade'::regclass
  ) then
    alter table rh.assiduidade
      add constraint assiduidade_sabado_tipo_check
      check (sabado_tipo_pagamento in ('por_fora', 'recibo_ss'));
  end if;
end $$;

-- 2. Colunas de resumo de Sábados em rh.recibos_vencimento
alter table rh.recibos_vencimento
  add column if not exists sabados_trabalhados integer not null default 0,
  add column if not exists sabados_valor_recibo numeric(12, 2) not null default 0,
  add column if not exists sabados_valor_por_fora numeric(12, 2) not null default 0;

-- 3. Configuração do Saldo Inicial / Abertura de Caixa (Schema: operacional)
create table if not exists operacional.caixa_config (
  id text primary key default 'principal',
  saldo_inicial numeric(14, 2) not null default 0,
  nota_saldo text,
  atualizado_por uuid references auth.users(id),
  atualizado_em timestamptz not null default now()
);

insert into operacional.caixa_config (id, saldo_inicial, nota_saldo)
values ('principal', 0, 'Saldo inicial de abertura da tesouraria Spark & Smirk')
on conflict (id) do nothing;

grant select, insert, update on table operacional.caixa_config to authenticated;
grant all on table operacional.caixa_config to service_role;

alter table operacional.caixa_config enable row level security;

drop policy if exists "RLS operacional.caixa_config ver" on operacional.caixa_config;
drop policy if exists "RLS operacional.caixa_config gerir" on operacional.caixa_config;

create policy "RLS operacional.caixa_config ver" on operacional.caixa_config
  for select to authenticated
  using (
    seguranca.utilizador_tem_permissao('dashboard', 'valores')
    or seguranca.utilizador_tem_permissao('op_obras', 'valores')
  );

create policy "RLS operacional.caixa_config gerir" on operacional.caixa_config
  for all to authenticated
  using (
    seguranca.utilizador_tem_permissao('op_obras', 'pagamentos')
    or seguranca.utilizador_tem_permissao('rh_recibos', 'emitir')
  )
  with check (
    seguranca.utilizador_tem_permissao('op_obras', 'pagamentos')
    or seguranca.utilizador_tem_permissao('rh_recibos', 'emitir')
  );

-- 4. Movimentos de Caixa da Empresa (Entradas & Saídas automáticas e manuais)
create table if not exists operacional.caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  codigo_movimento text not null unique,
  tipo text not null check (tipo in ('entrada', 'saida')),
  categoria text not null,
  origem_tipo text not null default 'manual'
    check (origem_tipo in ('recibo_vencimento', 'adiantamento', 'fatura_obra', 'recebimento_obra', 'manual')),
  origem_codigo text,
  data_movimento date not null default current_date,
  periodo text not null,
  descricao text not null,
  valor numeric(14, 2) not null check (valor >= 0),
  regime_fiscal text not null default 'geral',
  obra_codigo text,
  funcionario_codigo text,
  observacoes text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table operacional.caixa_movimentos is 'Livro de caixa empresarial Spark & Smirk: abate automático de pagamentos a funcionários, adiantamentos e faturas, e crédito automático de recebimentos de obras';

create index if not exists idx_caixa_movimentos_periodo on operacional.caixa_movimentos (periodo desc, data_movimento desc);
create index if not exists idx_caixa_movimentos_tipo on operacional.caixa_movimentos (tipo, categoria);
create unique index if not exists ux_caixa_movimentos_origem
  on operacional.caixa_movimentos (origem_tipo, origem_codigo)
  where origem_codigo is not null;

drop trigger if exists trg_caixa_movimentos_updated_at on operacional.caixa_movimentos;
create trigger trg_caixa_movimentos_updated_at
  before update on operacional.caixa_movimentos
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table operacional.caixa_movimentos to authenticated;
grant all on table operacional.caixa_movimentos to service_role;

alter table operacional.caixa_movimentos enable row level security;

drop policy if exists "RLS operacional.caixa_movimentos ver" on operacional.caixa_movimentos;
drop policy if exists "RLS operacional.caixa_movimentos gerir" on operacional.caixa_movimentos;

create policy "RLS operacional.caixa_movimentos ver" on operacional.caixa_movimentos
  for select to authenticated
  using (
    seguranca.utilizador_tem_permissao('dashboard', 'valores')
    or seguranca.utilizador_tem_permissao('op_obras', 'valores')
    or seguranca.utilizador_tem_permissao('rh_recibos', 'ver')
  );

create policy "RLS operacional.caixa_movimentos gerir" on operacional.caixa_movimentos
  for all to authenticated
  using (
    seguranca.utilizador_tem_permissao('op_obras', 'pagamentos')
    or seguranca.utilizador_tem_permissao('rh_recibos', 'emitir')
  )
  with check (
    seguranca.utilizador_tem_permissao('op_obras', 'pagamentos')
    or seguranca.utilizador_tem_permissao('rh_recibos', 'emitir')
  );

-- 5. Triggers automáticos para abater/creditar o Caixa da Empresa em tempo real
create or replace function operacional.sync_caixa_from_recibo()
returns trigger
language plpgsql
security definer
set search_path = operacional, rh, public
as $$
declare
  v_ref text;
  v_emp_code text;
  v_emp_name text;
  v_dt date;
  v_regime text;
begin
  if tg_op = 'DELETE' then
    v_ref := coalesce(old.codigo_recibo, old.id::text);
    delete from operacional.caixa_movimentos
    where origem_tipo = 'recibo_vencimento' and origem_codigo = v_ref;
    return old;
  end if;

  v_ref := coalesce(new.codigo_recibo, new.id::text);
  if lower(coalesce(new.estado_pagamento, '')) <> 'pago' or coalesce(new.total_liquido, 0) <= 0 then
    delete from operacional.caixa_movimentos
    where origem_tipo = 'recibo_vencimento' and origem_codigo = v_ref;
    return new;
  end if;

  select coalesce(f.codigo_interno, f.id::text), f.nome_completo
  into v_emp_code, v_emp_name
  from rh.funcionarios f
  where f.id = new.funcionario_id
  limit 1;

  v_dt := coalesce(new.data_pagamento, make_date(new.ano::int, greatest(1, least(12, new.mes::int)), 28));
  v_regime := case when coalesce(new.pagamento_por_fora, 0) > 0 then 'misto' else 'recibo_ss' end;

  insert into operacional.caixa_movimentos (
    codigo_movimento, tipo, categoria, origem_tipo, origem_codigo,
    data_movimento, periodo, descricao, valor, regime_fiscal,
    funcionario_codigo, observacoes, criado_por
  )
  values (
    'CX-REC-' || v_ref,
    'saida',
    'Salários & Ordenados',
    'recibo_vencimento',
    v_ref,
    v_dt,
    coalesce(new.periodo, to_char(v_dt, 'YYYY-MM')),
    'Pagamento de ordenado — ' || coalesce(v_emp_name, 'Colaborador') || ' (' || coalesce(new.periodo, '') || ')',
    new.total_liquido,
    v_regime,
    v_emp_code,
    coalesce(new.notas, 'Abate automático de recibo pago'),
    new.emitido_por
  )
  on conflict (origem_tipo, origem_codigo) where origem_codigo is not null do update set
    data_movimento = excluded.data_movimento,
    periodo = excluded.periodo,
    descricao = excluded.descricao,
    valor = excluded.valor,
    regime_fiscal = excluded.regime_fiscal,
    funcionario_codigo = excluded.funcionario_codigo,
    observacoes = excluded.observacoes,
    atualizado_em = now();

  return new;
end;
$$;

drop trigger if exists trg_caixa_sync_recibo on rh.recibos_vencimento;
create trigger trg_caixa_sync_recibo
  after insert or update or delete on rh.recibos_vencimento
  for each row execute function operacional.sync_caixa_from_recibo();

create or replace function operacional.sync_caixa_from_adiantamento()
returns trigger
language plpgsql
security definer
set search_path = operacional, rh, public
as $$
declare
  v_ref text;
  v_emp_code text;
  v_emp_name text;
begin
  if tg_op = 'DELETE' then
    v_ref := coalesce(old.codigo_adiantamento, old.id::text);
    delete from operacional.caixa_movimentos
    where origem_tipo = 'adiantamento' and origem_codigo = v_ref;
    return old;
  end if;

  v_ref := coalesce(new.codigo_adiantamento, new.id::text);
  select coalesce(f.codigo_interno, f.id::text), f.nome_completo
  into v_emp_code, v_emp_name
  from rh.funcionarios f
  where f.id = new.funcionario_id
  limit 1;

  insert into operacional.caixa_movimentos (
    codigo_movimento, tipo, categoria, origem_tipo, origem_codigo,
    data_movimento, periodo, descricao, valor, regime_fiscal,
    funcionario_codigo, observacoes, criado_por
  )
  values (
    'CX-ADT-' || v_ref,
    'saida',
    'Adiantamento / Vale',
    'adiantamento',
    v_ref,
    coalesce(new.data_adiantamento, current_date),
    coalesce(new.periodo, to_char(coalesce(new.data_adiantamento, current_date), 'YYYY-MM')),
    'Vale / Adiantamento — ' || coalesce(v_emp_name, 'Colaborador'),
    new.valor,
    'adiantamento',
    v_emp_code,
    coalesce(new.observacoes, 'Saída antecipada de ordenado'),
    new.criado_por
  )
  on conflict (origem_tipo, origem_codigo) where origem_codigo is not null do update set
    data_movimento = excluded.data_movimento,
    periodo = excluded.periodo,
    descricao = excluded.descricao,
    valor = excluded.valor,
    funcionario_codigo = excluded.funcionario_codigo,
    observacoes = excluded.observacoes,
    atualizado_em = now();

  return new;
end;
$$;

drop trigger if exists trg_caixa_sync_adiantamento on rh.adiantamentos;
create trigger trg_caixa_sync_adiantamento
  after insert or update or delete on rh.adiantamentos
  for each row execute function operacional.sync_caixa_from_adiantamento();

create or replace function operacional.sync_caixa_from_fatura()
returns trigger
language plpgsql
security definer
set search_path = operacional, public
as $$
declare
  v_ref text;
  v_proj_code text;
begin
  if tg_op = 'DELETE' then
    v_ref := coalesce(old.codigo_fatura, old.id::text);
    delete from operacional.caixa_movimentos
    where origem_tipo = 'fatura_obra' and origem_codigo = v_ref;
    return old;
  end if;

  v_ref := coalesce(new.codigo_fatura, new.id::text);
  select o.codigo_obra into v_proj_code
  from operacional.obras o
  where o.id = new.obra_id
  limit 1;

  insert into operacional.caixa_movimentos (
    codigo_movimento, tipo, categoria, origem_tipo, origem_codigo,
    data_movimento, periodo, descricao, valor, regime_fiscal,
    obra_codigo, observacoes, criado_por
  )
  values (
    'CX-FAT-' || v_ref,
    'saida',
    'Fatura de Obra / Materiais',
    'fatura_obra',
    v_ref,
    coalesce(new.data_fatura, current_date),
    to_char(coalesce(new.data_fatura, current_date), 'YYYY-MM'),
    'Fatura #' || coalesce(new.numero_fatura, v_ref) || ' — ' || coalesce(new.fornecedor, 'Fornecedor'),
    new.valor,
    'fatura',
    v_proj_code,
    coalesce(new.categoria, 'Materiais de Construção'),
    new.criado_por
  )
  on conflict (origem_tipo, origem_codigo) where origem_codigo is not null do update set
    data_movimento = excluded.data_movimento,
    periodo = excluded.periodo,
    descricao = excluded.descricao,
    valor = excluded.valor,
    obra_codigo = excluded.obra_codigo,
    observacoes = excluded.observacoes,
    atualizado_em = now();

  return new;
end;
$$;

drop trigger if exists trg_caixa_sync_fatura on operacional.faturas_obras;
create trigger trg_caixa_sync_fatura
  after insert or update or delete on operacional.faturas_obras
  for each row execute function operacional.sync_caixa_from_fatura();

create or replace function operacional.sync_caixa_from_pagamento_obra()
returns trigger
language plpgsql
security definer
set search_path = operacional, public
as $$
declare
  v_ref text;
  v_proj_code text;
  v_proj_name text;
  v_dt date;
begin
  if tg_op = 'DELETE' then
    v_ref := coalesce(old.codigo_pagamento, old.id::text);
    delete from operacional.caixa_movimentos
    where origem_tipo = 'recebimento_obra' and origem_codigo = v_ref;
    return old;
  end if;

  v_ref := coalesce(new.codigo_pagamento, new.id::text);
  if lower(coalesce(new.estado, '')) <> 'pago' or coalesce(new.valor, 0) <= 0 then
    delete from operacional.caixa_movimentos
    where origem_tipo = 'recebimento_obra' and origem_codigo = v_ref;
    return new;
  end if;

  select o.codigo_obra, o.nome_obra
  into v_proj_code, v_proj_name
  from operacional.obras o
  where o.id = new.obra_id
  limit 1;

  v_dt := coalesce(new.data_pagamento, new.data_vencimento, current_date);

  insert into operacional.caixa_movimentos (
    codigo_movimento, tipo, categoria, origem_tipo, origem_codigo,
    data_movimento, periodo, descricao, valor, regime_fiscal,
    obra_codigo, observacoes, criado_por
  )
  values (
    'CX-PAG-' || v_ref,
    'entrada',
    'Recebimento de Obra',
    'recebimento_obra',
    v_ref,
    v_dt,
    to_char(v_dt, 'YYYY-MM'),
    'Recebimento (' || coalesce(v_proj_code, 'Obra') || ') — ' || coalesce(new.descricao_prestacao, v_proj_name, 'Prestação'),
    new.valor,
    'receita',
    v_proj_code,
    coalesce(new.metodo_pagamento, 'Transferência Bancária'),
    new.registado_por
  )
  on conflict (origem_tipo, origem_codigo) where origem_codigo is not null do update set
    data_movimento = excluded.data_movimento,
    periodo = excluded.periodo,
    descricao = excluded.descricao,
    valor = excluded.valor,
    obra_codigo = excluded.obra_codigo,
    observacoes = excluded.observacoes,
    atualizado_em = now();

  return new;
end;
$$;

drop trigger if exists trg_caixa_sync_pagamento_obra on operacional.pagamentos_obras;
create trigger trg_caixa_sync_pagamento_obra
  after insert or update or delete on operacional.pagamentos_obras
  for each row execute function operacional.sync_caixa_from_pagamento_obra();

-- 6. Sincronizar registos históricos existentes para operacional.caixa_movimentos
do $$
begin
  -- Recibos pagos já existentes
  insert into operacional.caixa_movimentos (
    codigo_movimento, tipo, categoria, origem_tipo, origem_codigo,
    data_movimento, periodo, descricao, valor, regime_fiscal,
    funcionario_codigo, observacoes, criado_por
  )
  select
    'CX-REC-' || coalesce(r.codigo_recibo, r.id::text),
    'saida',
    'Salários & Ordenados',
    'recibo_vencimento',
    coalesce(r.codigo_recibo, r.id::text),
    coalesce(r.data_pagamento, make_date(r.ano::int, greatest(1, least(12, r.mes::int)), 28)),
    coalesce(r.periodo, to_char(coalesce(r.data_pagamento, current_date), 'YYYY-MM')),
    'Pagamento de ordenado — ' || coalesce(f.nome_completo, 'Colaborador') || ' (' || coalesce(r.periodo, '') || ')',
    r.total_liquido,
    case when coalesce(r.pagamento_por_fora, 0) > 0 then 'misto' else 'recibo_ss' end,
    coalesce(f.codigo_interno, f.id::text),
    coalesce(r.notas, 'Abate automático de recibo pago'),
    r.emitido_por
  from rh.recibos_vencimento r
  join rh.funcionarios f on f.id = r.funcionario_id
  where lower(coalesce(r.estado_pagamento, '')) = 'pago'
    and coalesce(r.total_liquido, 0) > 0
  on conflict (origem_tipo, origem_codigo) where origem_codigo is not null do nothing;

  -- Adiantamentos já existentes
  insert into operacional.caixa_movimentos (
    codigo_movimento, tipo, categoria, origem_tipo, origem_codigo,
    data_movimento, periodo, descricao, valor, regime_fiscal,
    funcionario_codigo, observacoes, criado_por
  )
  select
    'CX-ADT-' || coalesce(ad.codigo_adiantamento, ad.id::text),
    'saida',
    'Adiantamento / Vale',
    'adiantamento',
    coalesce(ad.codigo_adiantamento, ad.id::text),
    coalesce(ad.data_adiantamento, current_date),
    coalesce(ad.periodo, to_char(coalesce(ad.data_adiantamento, current_date), 'YYYY-MM')),
    'Vale / Adiantamento — ' || coalesce(f.nome_completo, 'Colaborador'),
    ad.valor,
    'adiantamento',
    coalesce(f.codigo_interno, f.id::text),
    coalesce(ad.observacoes, 'Saída antecipada de ordenado'),
    ad.criado_por
  from rh.adiantamentos ad
  join rh.funcionarios f on f.id = ad.funcionario_id
  where coalesce(ad.valor, 0) > 0
  on conflict (origem_tipo, origem_codigo) where origem_codigo is not null do nothing;

  -- Faturas de obras já existentes
  insert into operacional.caixa_movimentos (
    codigo_movimento, tipo, categoria, origem_tipo, origem_codigo,
    data_movimento, periodo, descricao, valor, regime_fiscal,
    obra_codigo, observacoes, criado_por
  )
  select
    'CX-FAT-' || coalesce(fo.codigo_fatura, fo.id::text),
    'saida',
    'Fatura de Obra / Materiais',
    'fatura_obra',
    coalesce(fo.codigo_fatura, fo.id::text),
    coalesce(fo.data_fatura, current_date),
    to_char(coalesce(fo.data_fatura, current_date), 'YYYY-MM'),
    'Fatura #' || coalesce(fo.numero_fatura, fo.codigo_fatura) || ' — ' || coalesce(fo.fornecedor, 'Fornecedor'),
    fo.valor,
    'fatura',
    o.codigo_obra,
    coalesce(fo.categoria, 'Materiais de Construção'),
    fo.criado_por
  from operacional.faturas_obras fo
  join operacional.obras o on o.id = fo.obra_id
  where coalesce(fo.valor, 0) >= 0
  on conflict (origem_tipo, origem_codigo) where origem_codigo is not null do nothing;

  -- Recebimentos de obras já pagos
  insert into operacional.caixa_movimentos (
    codigo_movimento, tipo, categoria, origem_tipo, origem_codigo,
    data_movimento, periodo, descricao, valor, regime_fiscal,
    obra_codigo, observacoes, criado_por
  )
  select
    'CX-PAG-' || coalesce(pg.codigo_pagamento, pg.id::text),
    'entrada',
    'Recebimento de Obra',
    'recebimento_obra',
    coalesce(pg.codigo_pagamento, pg.id::text),
    coalesce(pg.data_pagamento, pg.data_vencimento, current_date),
    to_char(coalesce(pg.data_pagamento, pg.data_vencimento, current_date), 'YYYY-MM'),
    'Recebimento (' || coalesce(o.codigo_obra, 'Obra') || ') — ' || coalesce(pg.descricao_prestacao, o.nome_obra, 'Prestação'),
    pg.valor,
    'receita',
    o.codigo_obra,
    coalesce(pg.metodo_pagamento, 'Transferência Bancária'),
    pg.registado_por
  from operacional.pagamentos_obras pg
  join operacional.obras o on o.id = pg.obra_id
  where lower(coalesce(pg.estado, '')) = 'pago'
    and coalesce(pg.valor, 0) > 0
  on conflict (origem_tipo, origem_codigo) where origem_codigo is not null do nothing;
end $$;

-- 7. RPCs de Assiduidade com Sábado Pago
drop function if exists public.spark_erp_set_attendance(text, date, text, text, uuid, numeric);
drop function if exists public.spark_erp_mark_all_present(date, uuid);

create or replace function public.spark_erp_set_attendance(
  p_emp_code text,
  p_date date,
  p_status text,
  p_note text default '',
  p_actor uuid default null,
  p_hours numeric default 8,
  p_saturday_bonus numeric default 0,
  p_saturday_tax_mode text default 'por_fora'
)
returns void
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_emp_id uuid;
  v_db_status text;
  v_hours numeric := greatest(0, coalesce(p_hours, 8));
  v_sat_bonus numeric := greatest(0, coalesce(p_saturday_bonus, 0));
  v_sat_mode text := case when p_saturday_tax_mode = 'recibo_ss' then 'recibo_ss' else 'por_fora' end;
  v_is_sat boolean := (extract(dow from p_date) = 6);
begin
  select id into v_emp_id from rh.funcionarios where codigo_interno = p_emp_code or id::text = p_emp_code limit 1;
  if v_emp_id is null then
    raise exception 'Funcionário não encontrado: %', p_emp_code;
  end if;

  if p_status is null or trim(p_status) = '' then
    delete from rh.assiduidade where funcionario_id = v_emp_id and data_trabalho = p_date;
    return;
  end if;

  v_db_status := case upper(trim(p_status))
    when 'P' then 'presente'
    when 'FJ' then 'falta_justificada'
    when 'FI' then 'falta_injustificada'
    when 'FE' then 'ferias'
    when 'BM' then 'baixa'
    else 'presente'
  end;

  insert into rh.assiduidade (
    funcionario_id, data_trabalho, estado, horas_trabalhadas,
    sabado_extra_valor, sabado_tipo_pagamento, observacoes, registado_por
  )
  values (
    v_emp_id,
    p_date,
    v_db_status,
    case when v_db_status = 'presente' then v_hours else 0 end,
    case when v_db_status = 'presente' and v_is_sat then v_sat_bonus else 0 end,
    case when v_db_status = 'presente' and v_is_sat then v_sat_mode else 'por_fora' end,
    nullif(p_note, ''),
    p_actor
  )
  on conflict (funcionario_id, data_trabalho) do update set
    estado = excluded.estado,
    horas_trabalhadas = excluded.horas_trabalhadas,
    sabado_extra_valor = excluded.sabado_extra_valor,
    sabado_tipo_pagamento = excluded.sabado_tipo_pagamento,
    observacoes = excluded.observacoes,
    atualizado_em = now();
end;
$$;

create or replace function public.spark_erp_mark_all_present(
  p_date date,
  p_actor uuid default null,
  p_saturday_bonus numeric default 0,
  p_saturday_tax_mode text default 'por_fora'
)
returns void
language sql
security definer
set search_path = rh, public
as $$
  insert into rh.assiduidade (
    funcionario_id, data_trabalho, estado, horas_trabalhadas,
    sabado_extra_valor, sabado_tipo_pagamento, observacoes, registado_por
  )
  select
    f.id,
    p_date,
    'presente',
    8,
    case when extract(dow from p_date) = 6 then greatest(0, coalesce(p_saturday_bonus, 0)) else 0 end,
    case when extract(dow from p_date) = 6 and p_saturday_tax_mode = 'recibo_ss' then 'recibo_ss' else 'por_fora' end,
    null,
    p_actor
  from rh.funcionarios f
  where lower(f.estado) = 'ativo'
  on conflict (funcionario_id, data_trabalho) do nothing;
$$;

-- 8. RPC de Recibos atualizado com resumo de Sábados Trabalhados
create or replace function public.spark_erp_upsert_payslip(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), 'REC-' || substring(gen_random_uuid()::text, 1, 8));
  v_emp_code text := p_payload->>'employeeId';
  v_emp_id uuid;
  v_month text := coalesce(p_payload->>'month', to_char(now(), 'YYYY-MM'));
  v_ano smallint := split_part(v_month, '-', 1)::smallint;
  v_mes smallint := split_part(v_month, '-', 2)::smallint;
  v_base numeric := greatest(0, coalesce((p_payload->>'baseSalary')::numeric, 0));
  v_meal numeric := greatest(0, coalesce((p_payload->>'mealAllowanceTotal')::numeric, 0));
  v_twelfth_vac numeric := greatest(0, coalesce((p_payload->>'twelfthVacation')::numeric, 0));
  v_twelfth_xmas numeric := greatest(0, coalesce((p_payload->>'twelfthChristmas')::numeric, 0));
  v_sat_count integer := greatest(0, coalesce((p_payload->>'saturdayCount')::integer, 0));
  v_sat_rec numeric := greatest(0, coalesce((p_payload->>'saturdayReceiptTotal')::numeric, 0));
  v_sat_off numeric := greatest(0, coalesce((p_payload->>'saturdayOffTotal')::numeric, 0));
  v_bonus numeric := greatest(0, coalesce((p_payload->>'overtimeBonus')::numeric, 0));
  v_ss numeric := greatest(0, coalesce((p_payload->>'socialSecurity')::numeric, 0));
  v_irs numeric := greatest(0, coalesce((p_payload->>'irsRetention')::numeric, 0));
  v_other numeric := greatest(0, coalesce((p_payload->>'otherDeductions')::numeric, 0));
  v_off_payroll numeric := greatest(0, coalesce((p_payload->>'offPayroll')::numeric, 0));
  v_net numeric := greatest(0, coalesce((p_payload->>'netSalary')::numeric, 0));
  v_gross numeric := v_base + v_sat_rec + v_meal + v_twelfth_vac + v_twelfth_xmas + v_bonus;
  v_status text := case when lower(coalesce(p_payload->>'status', 'pendente')) = 'pago' then 'Pago' else 'Emitido' end;
  v_pay_date date := nullif(p_payload->>'paymentDate', '')::date;
  v_notes text := nullif(p_payload->>'notes', '');
  v_row rh.recibos_vencimento;
begin
  select id into v_emp_id from rh.funcionarios where codigo_interno = v_emp_code or id::text = v_emp_code limit 1;
  if v_emp_id is null then
    raise exception 'Funcionário associado ao recibo não encontrado.';
  end if;

  update rh.recibos_vencimento
  set
    codigo_recibo = coalesce(codigo_recibo, v_code),
    funcionario_id = v_emp_id,
    ano = v_ano,
    mes = v_mes,
    salario_base = v_base,
    subsidio_alimentacao = v_meal,
    duodecimo_ferias = v_twelfth_vac,
    duodecimo_natal = v_twelfth_xmas,
    sabados_trabalhados = v_sat_count,
    sabados_valor_recibo = v_sat_rec,
    sabados_valor_por_fora = v_sat_off,
    horas_extra_valor = v_bonus,
    ss_valor = v_ss,
    irs_valor = v_irs,
    outras_deducoes = v_other,
    pagamento_por_fora = v_off_payroll,
    total_bruto = v_gross,
    total_liquido = v_net,
    estado_pagamento = v_status,
    data_pagamento = v_pay_date,
    notas = v_notes,
    atualizado_em = now()
  where codigo_recibo = v_code or id::text = v_code
  returning * into v_row;

  if not found then
    insert into rh.recibos_vencimento (
      codigo_recibo, funcionario_id, ano, mes, salario_base, subsidio_alimentacao,
      duodecimo_ferias, duodecimo_natal, sabados_trabalhados, sabados_valor_recibo, sabados_valor_por_fora,
      horas_extra_valor, ss_valor, irs_valor, outras_deducoes, pagamento_por_fora,
      total_bruto, total_liquido, estado_pagamento, data_pagamento, notas, emitido_por
    )
    values (
      v_code, v_emp_id, v_ano, v_mes, v_base, v_meal,
      v_twelfth_vac, v_twelfth_xmas, v_sat_count, v_sat_rec, v_sat_off,
      v_bonus, v_ss, v_irs, v_other, v_off_payroll,
      v_gross, v_net, v_status, v_pay_date, v_notes, p_actor
    )
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', coalesce(v_row.codigo_recibo, v_row.id::text),
    'dbId', v_row.id,
    'saturdayCount', coalesce(v_row.sabados_trabalhados, 0),
    'saturdayReceiptTotal', coalesce(v_row.sabados_valor_recibo, 0),
    'saturdayOffTotal', coalesce(v_row.sabados_valor_por_fora, 0),
    'twelfthVacation', coalesce(v_row.duodecimo_ferias, 0),
    'twelfthChristmas', coalesce(v_row.duodecimo_natal, 0),
    'offPayroll', coalesce(v_row.pagamento_por_fora, 0)
  );
end;
$$;

-- 9. RPCs de Caixa Empresarial (movimentos manuais e saldo inicial)
create or replace function public.spark_erp_upsert_cash_movement(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = operacional, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), 'CX-MAN-' || substring(gen_random_uuid()::text, 1, 8));
  v_tipo text := case when lower(coalesce(p_payload->>'type', 'saida')) = 'entrada' then 'entrada' else 'saida' end;
  v_date date := coalesce(nullif(p_payload->>'date', '')::date, current_date);
  v_period text := coalesce(nullif(trim(p_payload->>'month'), ''), to_char(v_date, 'YYYY-MM'));
  v_row operacional.caixa_movimentos;
begin
  insert into operacional.caixa_movimentos (
    codigo_movimento, tipo, categoria, origem_tipo, origem_codigo,
    data_movimento, periodo, descricao, valor, regime_fiscal,
    obra_codigo, funcionario_codigo, observacoes, criado_por
  )
  values (
    v_code,
    v_tipo,
    coalesce(nullif(trim(p_payload->>'category'), ''), case when v_tipo = 'entrada' then 'Outras Entradas' else 'Outras Despesas' end),
    'manual',
    null,
    v_date,
    v_period,
    coalesce(nullif(trim(p_payload->>'description'), ''), 'Movimento de Caixa'),
    greatest(0, coalesce((p_payload->>'amount')::numeric, 0)),
    coalesce(nullif(trim(p_payload->>'taxMode'), ''), 'geral'),
    nullif(trim(coalesce(p_payload->>'projectId', '')), ''),
    nullif(trim(coalesce(p_payload->>'employeeId', '')), ''),
    nullif(trim(coalesce(p_payload->>'notes', '')), ''),
    p_actor
  )
  on conflict (codigo_movimento) do update set
    tipo = excluded.tipo,
    categoria = excluded.categoria,
    data_movimento = excluded.data_movimento,
    periodo = excluded.periodo,
    descricao = excluded.descricao,
    valor = excluded.valor,
    regime_fiscal = excluded.regime_fiscal,
    obra_codigo = excluded.obra_codigo,
    funcionario_codigo = excluded.funcionario_codigo,
    observacoes = excluded.observacoes,
    atualizado_em = now()
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.codigo_movimento,
    'dbId', v_row.id,
    'type', v_row.tipo,
    'category', v_row.categoria,
    'originType', v_row.origem_tipo,
    'originCode', coalesce(v_row.origem_codigo, ''),
    'date', to_char(v_row.data_movimento, 'YYYY-MM-DD'),
    'month', v_row.periodo,
    'description', v_row.descricao,
    'amount', v_row.valor,
    'taxMode', v_row.regime_fiscal,
    'projectId', coalesce(v_row.obra_codigo, ''),
    'employeeId', coalesce(v_row.funcionario_codigo, ''),
    'notes', coalesce(v_row.observacoes, '')
  );
end;
$$;

create or replace function public.spark_erp_delete_cash_movement(p_code text)
returns void
language sql
security definer
set search_path = operacional, public
as $$
  delete from operacional.caixa_movimentos
  where (codigo_movimento = p_code or id::text = p_code)
    and origem_tipo = 'manual';
$$;

create or replace function public.spark_erp_set_cash_opening(
  p_saldo numeric,
  p_nota text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = operacional, public
as $$
declare
  v_row operacional.caixa_config;
begin
  insert into operacional.caixa_config (id, saldo_inicial, nota_saldo, atualizado_por, atualizado_em)
  values ('principal', coalesce(p_saldo, 0), nullif(trim(coalesce(p_nota, '')), ''), p_actor, now())
  on conflict (id) do update set
    saldo_inicial = excluded.saldo_inicial,
    nota_saldo = coalesce(excluded.nota_saldo, operacional.caixa_config.nota_saldo),
    atualizado_por = excluded.atualizado_por,
    atualizado_em = now()
  returning * into v_row;

  return jsonb_build_object(
    'openingBalance', coalesce(v_row.saldo_inicial, 0),
    'openingNote', coalesce(v_row.nota_saldo, '')
  );
end;
$$;

-- 10. Snapshot consolidada final com Sábados + Livro de Caixa da Empresa
create or replace function public.spark_erp_snapshot(
  p_include_rh boolean default false,
  p_include_payslips boolean default false,
  p_include_projects boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = rh, operacional, seguranca, public
as $$
declare
  v_employees jsonb := '[]'::jsonb;
  v_attendance jsonb := '{}'::jsonb;
  v_advances jsonb := '[]'::jsonb;
  v_employee_contracts jsonb := '[]'::jsonb;
  v_payslips jsonb := '[]'::jsonb;
  v_attachments jsonb := '[]'::jsonb;
  v_projects jsonb := '[]'::jsonb;
  v_project_invoices jsonb := '[]'::jsonb;
  v_project_contracts jsonb := '[]'::jsonb;
  v_technical_managers jsonb := '[]'::jsonb;
  v_technical_certificates jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_cash_opening numeric := 0;
  v_cash_note text := '';
begin
  if p_include_rh then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', coalesce(f.codigo_interno, f.id::text),
        'dbId', f.id,
        'name', f.nome_completo,
        'role', f.cargo,
        'department', f.departamento,
        'nif', coalesce(f.nif, ''),
        'niss', coalesce(f.niss, ''),
        'cc', coalesce(f.cc, ''),
        'phone', coalesce(f.telemovel, ''),
        'email', coalesce(f.email, ''),
        'address', coalesce(f.morada, ''),
        'iban', coalesce(f.iban, ''),
        'contractType', coalesce(f.tipo_contrato, 'Sem Termo'),
        'admissionDate', coalesce(to_char(f.data_admissao, 'YYYY-MM-DD'), ''),
        'remunerationType', coalesce(f.modalidade_pagamento, 'mensal'),
        'baseSalary', coalesce(f.salario_base, 0),
        'dailyRate', coalesce(f.valor_diaria, 0),
        'hourlyRate', coalesce(f.valor_hora, 0),
        'ssPercentage', coalesce(f.percentagem_ss, 11),
        'mealAllowance', coalesce(f.subsidio_alimentacao, 0),
        'offPayrollType', case
          when coalesce(f.modalidade_pagamento, 'mensal') = 'mensal' then 'mensal'
          when coalesce(f.modalidade_por_fora, 'mensal') = 'diaria' then 'diaria'
          else 'mensal'
        end,
        'offPayrollAmount', coalesce(f.valor_por_fora, 0),
        'twelfths', coalesce(f.duodecimos, 'Não'),
        'twelfthsVacationManual', coalesce(f.duodecimo_ferias_manual, 0),
        'twelfthsChristmasManual', coalesce(f.duodecimo_natal_manual, 0),
        'status', case when lower(f.estado) = 'inativo' then 'inativo' else 'ativo' end,
        'notes', coalesce(f.observacoes, '')
      ) order by f.criado_em desc
    ), '[]'::jsonb)
    into v_employees
    from rh.funcionarios f;

    select coalesce(jsonb_object_agg(emp_key, day_map), '{}'::jsonb)
    into v_attendance
    from (
      select
        coalesce(f.codigo_interno, f.id::text) as emp_key,
        jsonb_object_agg(
          to_char(a.data_trabalho, 'YYYY-MM-DD'),
          jsonb_build_object(
            'status', case a.estado
              when 'presente' then 'P'
              when 'falta_justificada' then 'FJ'
              when 'falta_injustificada' then 'FI'
              when 'ferias' then 'FE'
              when 'baixa' then 'BM'
              else 'P'
            end,
            'hours', coalesce(a.horas_trabalhadas, 8),
            'saturdayBonus', coalesce(a.sabado_extra_valor, 0),
            'saturdayTaxMode', coalesce(a.sabado_tipo_pagamento, 'por_fora'),
            'note', coalesce(a.observacoes, '')
          )
        ) as day_map
      from rh.assiduidade a
      join rh.funcionarios f on f.id = a.funcionario_id
      group by coalesce(f.codigo_interno, f.id::text)
    ) t;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ad.codigo_adiantamento,
        'dbId', ad.id,
        'employeeId', coalesce(f.codigo_interno, f.id::text),
        'month', ad.periodo,
        'date', to_char(ad.data_adiantamento, 'YYYY-MM-DD'),
        'amount', coalesce(ad.valor, 0),
        'notes', coalesce(ad.observacoes, ''),
        'createdAt', to_char(ad.criado_em, 'YYYY-MM-DD')
      ) order by ad.data_adiantamento desc, ad.criado_em desc
    ), '[]'::jsonb)
    into v_advances
    from rh.adiantamentos ad
    join rh.funcionarios f on f.id = ad.funcionario_id;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', fc.codigo_contrato,
        'dbId', fc.id,
        'employeeId', coalesce(f.codigo_interno, f.id::text),
        'title', fc.titulo,
        'contractType', fc.tipo_contrato,
        'contractDate', coalesce(to_char(fc.data_inicio, 'YYYY-MM-DD'), ''),
        'notes', coalesce(fc.observacoes, ''),
        'fileName', coalesce(fc.nome_ficheiro, ''),
        'fileType', coalesce(fc.tipo_mime, ''),
        'fileSize', coalesce(fc.tamanho_bytes, 0),
        'hasFile', (fc.caminho_storage is not null and fc.caminho_storage <> ''),
        'createdAt', to_char(fc.criado_em, 'YYYY-MM-DD')
      ) order by fc.data_inicio desc, fc.criado_em desc
    ), '[]'::jsonb)
    into v_employee_contracts
    from rh.funcionarios_contratos fc
    join rh.funcionarios f on f.id = fc.funcionario_id;
  end if;

  if p_include_payslips then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', coalesce(r.codigo_recibo, r.id::text),
        'dbId', r.id,
        'employeeId', coalesce(f.codigo_interno, f.id::text),
        'month', r.periodo,
        'baseSalary', coalesce(r.salario_base, 0),
        'mealAllowanceTotal', coalesce(r.subsidio_alimentacao, 0),
        'twelfthVacation', coalesce(r.duodecimo_ferias, 0),
        'twelfthChristmas', coalesce(r.duodecimo_natal, 0),
        'saturdayCount', coalesce(r.sabados_trabalhados, 0),
        'saturdayReceiptTotal', coalesce(r.sabados_valor_recibo, 0),
        'saturdayOffTotal', coalesce(r.sabados_valor_por_fora, 0),
        'overtimeBonus', coalesce(r.horas_extra_valor, 0) + coalesce(r.premios, 0),
        'socialSecurity', coalesce(r.ss_valor, 0),
        'irsRetention', coalesce(r.irs_valor, 0),
        'otherDeductions', coalesce(r.outras_deducoes, 0),
        'offPayroll', coalesce(r.pagamento_por_fora, 0),
        'netSalary', coalesce(r.total_liquido, 0),
        'paymentDate', coalesce(to_char(r.data_pagamento, 'YYYY-MM-DD'), ''),
        'status', case when lower(r.estado_pagamento) = 'pago' then 'pago' else 'pendente' end,
        'attachment', null,
        'notes', coalesce(r.notas, '')
      ) order by r.ano desc, r.mes desc, r.criado_em desc
    ), '[]'::jsonb)
    into v_payslips
    from rh.recibos_vencimento r
    join rh.funcionarios f on f.id = r.funcionario_id;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', coalesce(ra.codigo_anexo, ra.id::text),
        'dbId', ra.id,
        'employeeId', coalesce(f.codigo_interno, f.id::text),
        'month', ra.periodo,
        'payslipId', ra.codigo_recibo_ref,
        'fileName', ra.nome_ficheiro,
        'fileType', coalesce(ra.tipo_mime, 'application/pdf'),
        'fileSize', coalesce(ra.tamanho_bytes, 0),
        'storagePath', ra.caminho_storage,
        'uploadedAt', to_char(ra.anexado_em, 'YYYY-MM-DD')
      ) order by ra.anexado_em desc
    ), '[]'::jsonb)
    into v_attachments
    from rh.recibos_anexados ra
    join rh.funcionarios f on f.id = ra.funcionario_id;
  end if;

  if p_include_projects then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', o.codigo_obra,
        'dbId', o.id,
        'code', o.codigo_obra,
        'name', o.nome_obra,
        'type', coalesce(o.categoria, 'Construção Civil'),
        'status', o.estado,
        'priority', coalesce(o.prioridade, 'Normal'),
        'district', coalesce(o.distrito, 'Porto'),
        'address', coalesce(o.morada, ''),
        'clientName', o.cliente_nome,
        'clientNif', coalesce(o.cliente_nif, ''),
        'clientPhone', coalesce(o.cliente_telefone, ''),
        'clientEmail', coalesce(o.cliente_email, ''),
        'managerId', coalesce(o.responsavel_codigo, ''),
        'teamIds', coalesce(o.equipa_ids, '[]'::jsonb),
        'startDate', coalesce(to_char(o.data_inicio, 'YYYY-MM-DD'), ''),
        'expectedEndDate', coalesce(to_char(o.data_fim_prevista, 'YYYY-MM-DD'), ''),
        'actualEndDate', coalesce(to_char(o.data_fim_real, 'YYYY-MM-DD'), ''),
        'progress', coalesce(o.progresso_percent, 0),
        'manualBudgetCap', coalesce(o.orcamento_geral_manual, 0),
        'costRegime', coalesce(o.regime_custos, 'materiais_funcionarios'),
        'dailyRatePerWorker', coalesce(o.valor_diaria_funcionario, 0),
        'description', coalesce(o.descricao, ''),
        'budget', jsonb_build_object(
          'vatRate', coalesce((o.orcamento_config->>'vatRate')::numeric, 23),
          'contingencyPct', coalesce((o.orcamento_config->>'contingencyPct')::numeric, 5),
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'description', oi.descricao,
                'category', oi.categoria,
                'unit', oi.unidade,
                'qty', oi.quantidade,
                'unitPrice', oi.preco_unitario
              ) order by oi.criado_em asc
            )
            from operacional.orcamentos oc
            join operacional.orcamento_itens oi on oi.orcamento_id = oc.id
            where oc.obra_id = o.id
          ), '[]'::jsonb)
        ),
        'payments', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', coalesce(pg.codigo_pagamento, pg.id::text),
              'description', pg.descricao_prestacao,
              'dueDate', coalesce(to_char(pg.data_vencimento, 'YYYY-MM-DD'), ''),
              'paidDate', coalesce(to_char(pg.data_pagamento, 'YYYY-MM-DD'), ''),
              'amount', coalesce(pg.valor, 0),
              'method', coalesce(pg.metodo_pagamento, 'Transferência Bancária'),
              'status', case when lower(pg.estado) = 'pago' then 'pago' else 'em_aberto' end,
              'invoiceRef', coalesce(pg.referencia_fatura, '')
            ) order by pg.data_vencimento asc, pg.criado_em asc
          )
          from operacional.pagamentos_obras pg
          where pg.obra_id = o.id
        ), '[]'::jsonb)
      ) order by o.criado_em desc
    ), '[]'::jsonb)
    into v_projects
    from operacional.obras o;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', fo.codigo_fatura,
        'dbId', fo.id,
        'projectId', o.codigo_obra,
        'invoiceNumber', fo.numero_fatura,
        'supplier', fo.fornecedor,
        'supplierNif', coalesce(fo.fornecedor_nif, ''),
        'category', fo.categoria,
        'invoiceDate', coalesce(to_char(fo.data_fatura, 'YYYY-MM-DD'), ''),
        'amount', coalesce(fo.valor, 0),
        'notes', coalesce(fo.observacoes, ''),
        'fileName', coalesce(fo.nome_ficheiro, ''),
        'fileType', coalesce(fo.tipo_mime, ''),
        'fileSize', coalesce(fo.tamanho_bytes, 0),
        'hasFile', (fo.caminho_storage is not null and fo.caminho_storage <> ''),
        'createdAt', to_char(fo.criado_em, 'YYYY-MM-DD')
      ) order by fo.data_fatura desc, fo.criado_em desc
    ), '[]'::jsonb)
    into v_project_invoices
    from operacional.faturas_obras fo
    join operacional.obras o on o.id = fo.obra_id;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', co.codigo_contrato,
        'dbId', co.id,
        'projectId', o.codigo_obra,
        'title', co.titulo,
        'contractNumber', coalesce(co.numero_contrato, ''),
        'contractDate', coalesce(to_char(co.data_contrato, 'YYYY-MM-DD'), ''),
        'notes', coalesce(co.observacoes, ''),
        'fileName', coalesce(co.nome_ficheiro, ''),
        'fileType', coalesce(co.tipo_mime, ''),
        'fileSize', coalesce(co.tamanho_bytes, 0),
        'hasFile', (co.caminho_storage is not null and co.caminho_storage <> ''),
        'createdAt', to_char(co.criado_em, 'YYYY-MM-DD')
      ) order by co.data_contrato desc, co.criado_em desc
    ), '[]'::jsonb)
    into v_project_contracts
    from operacional.contratos_obras co
    join operacional.obras o on o.id = co.obra_id;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', rt.codigo_tecnico,
        'dbId', rt.id,
        'code', rt.codigo_tecnico,
        'name', rt.nome_completo,
        'professionalTitle', rt.titulo_profissional,
        'entityOrder', coalesce(rt.ordem_entidade, ''),
        'licenseNumber', coalesce(rt.numero_cedula, ''),
        'nif', coalesce(rt.nif, ''),
        'cc', coalesce(rt.cc, ''),
        'phone', coalesce(rt.telemovel, ''),
        'email', coalesce(rt.email, ''),
        'specialties', coalesce(rt.especialidades, '[]'::jsonb),
        'status', case when lower(rt.estado) = 'inativo' then 'inativo' else 'ativo' end,
        'notes', coalesce(rt.observacoes, ''),
        'createdAt', to_char(rt.criado_em, 'YYYY-MM-DD')
      ) order by rt.criado_em desc
    ), '[]'::jsonb)
    into v_technical_managers
    from operacional.responsaveis_tecnicos rt;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', rc.codigo_certificado,
        'dbId', rc.id,
        'managerId', rt.codigo_tecnico,
        'certificateType', rc.tipo_certificado,
        'category', rc.categoria,
        'certificateNumber', coalesce(rc.numero_certificado, ''),
        'issuer', coalesce(rc.entidade_emissora, ''),
        'issueDate', coalesce(to_char(rc.data_emissao, 'YYYY-MM-DD'), ''),
        'expiryDate', coalesce(to_char(rc.data_validade, 'YYYY-MM-DD'), ''),
        'notes', coalesce(rc.observacoes, ''),
        'fileName', coalesce(rc.nome_ficheiro, ''),
        'fileType', coalesce(rc.tipo_mime, ''),
        'fileSize', coalesce(rc.tamanho_bytes, 0),
        'hasFile', (rc.caminho_storage is not null and rc.caminho_storage <> ''),
        'createdAt', to_char(rc.criado_em, 'YYYY-MM-DD')
      ) order by rc.criado_em desc
    ), '[]'::jsonb)
    into v_technical_certificates
    from operacional.responsaveis_certificados rc
    join operacional.responsaveis_tecnicos rt on rt.id = rc.tecnico_id;
  end if;

  if p_include_payslips or p_include_projects then
    select coalesce(saldo_inicial, 0), coalesce(nota_saldo, '')
    into v_cash_opening, v_cash_note
    from operacional.caixa_config
    where id = 'principal'
    limit 1;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', cm.codigo_movimento,
        'dbId', cm.id,
        'type', cm.tipo,
        'category', cm.categoria,
        'originType', cm.origem_tipo,
        'originCode', coalesce(cm.origem_codigo, ''),
        'date', to_char(cm.data_movimento, 'YYYY-MM-DD'),
        'month', cm.periodo,
        'description', cm.descricao,
        'amount', coalesce(cm.valor, 0),
        'taxMode', coalesce(cm.regime_fiscal, 'geral'),
        'projectId', coalesce(cm.obra_codigo, ''),
        'employeeId', coalesce(cm.funcionario_codigo, ''),
        'notes', coalesce(cm.observacoes, '')
      ) order by cm.data_movimento desc, cm.criado_em desc
    ), '[]'::jsonb)
    into v_cash_movements
    from operacional.caixa_movimentos cm;
  end if;

  return jsonb_build_object(
    'employees', v_employees,
    'attendance', v_attendance,
    'employeeAdvances', v_advances,
    'employeeContracts', v_employee_contracts,
    'payslips', v_payslips,
    'attachedReceipts', v_attachments,
    'projects', v_projects,
    'projectInvoices', v_project_invoices,
    'projectContracts', v_project_contracts,
    'technicalManagers', v_technical_managers,
    'technicalCertificates', v_technical_certificates,
    'cashMovements', v_cash_movements,
    'cashOpeningBalance', coalesce(v_cash_opening, 0),
    'cashOpeningNote', coalesce(v_cash_note, '')
  );
end;
$$;

-- Permissões estritas de execução para RPCs
revoke all on function public.spark_erp_set_attendance(text, date, text, text, uuid, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.spark_erp_mark_all_present(date, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.spark_erp_upsert_payslip(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_upsert_cash_movement(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_cash_movement(text) from public, anon, authenticated;
revoke all on function public.spark_erp_set_cash_opening(numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_snapshot(boolean, boolean, boolean) from public, anon, authenticated;

grant execute on function public.spark_erp_set_attendance(text, date, text, text, uuid, numeric, numeric, text) to service_role;
grant execute on function public.spark_erp_mark_all_present(date, uuid, numeric, text) to service_role;
grant execute on function public.spark_erp_upsert_payslip(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_upsert_cash_movement(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_delete_cash_movement(text) to service_role;
grant execute on function public.spark_erp_set_cash_opening(numeric, text, uuid) to service_role;
grant execute on function public.spark_erp_snapshot(boolean, boolean, boolean) to service_role;
