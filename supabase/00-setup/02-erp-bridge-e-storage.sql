-- ============================================================================
-- SPARK & SMIRK — CONEXÃO TOTAL RH & OPERACIONAL, RLS GRANULAR & STORAGE
-- Pasta: supabase/00-setup/02-erp-bridge-e-storage.sql
-- Execute este ficheiro no SQL Editor do Supabase após os schemas base.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSÃO DE COLUNAS PARA COMPATIBILIDADE INTEGRAL COM O SISTEMA INTERNO
-- ----------------------------------------------------------------------------
alter table rh.funcionarios
  add column if not exists cc text,
  add column if not exists morada text,
  add column if not exists duodecimos text default 'Não';

alter table rh.recibos_vencimento
  add column if not exists codigo_recibo text,
  add column if not exists ss_valor numeric(12, 2) not null default 0,
  add column if not exists irs_valor numeric(12, 2) not null default 0,
  add column if not exists outras_deducoes numeric(12, 2) not null default 0,
  add column if not exists notas text;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'recibos_vencimento_funcionario_id_ano_mes_key'
      and conrelid = 'rh.recibos_vencimento'::regclass
  ) then
    alter table rh.recibos_vencimento drop constraint recibos_vencimento_funcionario_id_ano_mes_key;
  end if;
end $$;

drop index if exists rh.idx_recibos_codigo_unique;
create unique index idx_recibos_codigo_unique
  on rh.recibos_vencimento (codigo_recibo);

alter table rh.recibos_anexados
  add column if not exists codigo_anexo text,
  add column if not exists codigo_recibo_ref text,
  add column if not exists tamanho_bytes bigint default 0;

drop index if exists rh.idx_anexados_codigo_unique;
create unique index idx_anexados_codigo_unique
  on rh.recibos_anexados (codigo_anexo);

alter table operacional.obras
  add column if not exists prioridade text default 'Normal',
  add column if not exists distrito text default 'Porto',
  add column if not exists morada text,
  add column if not exists cliente_telefone text,
  add column if not exists cliente_email text,
  add column if not exists responsavel_codigo text,
  add column if not exists equipa_ids jsonb not null default '[]'::jsonb,
  add column if not exists data_fim_real date,
  add column if not exists orcamento_config jsonb not null default '{"vatRate": 23, "contingencyPct": 5}'::jsonb;

alter table operacional.pagamentos_obras
  add column if not exists codigo_pagamento text;

drop index if exists operacional.idx_pagamentos_codigo_unique;
create unique index idx_pagamentos_codigo_unique
  on operacional.pagamentos_obras (codigo_pagamento);

-- ----------------------------------------------------------------------------
-- 2. BUCKET PRIVADO DE STORAGE PARA RECIBOS DE VENCIMENTO (PDF / IMAGENS)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recibos-vencimentos',
  'recibos-vencimentos',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

-- ----------------------------------------------------------------------------
-- 3. FUNÇÃO DE VERIFICAÇÃO GRANULAR PARA RLS (DEFESA EM PROFUNDIDADE)
-- ----------------------------------------------------------------------------
create or replace function seguranca.utilizador_tem_permissao(p_modulo text, p_acao text)
returns boolean
language sql
stable
security definer
set search_path = seguranca, public
as $$
  select exists (
    select 1
    from seguranca.perfis_utilizadores p
    where p.id = auth.uid()
      and p.ativo = true
      and coalesce((p.permissoes -> p_modulo ->> p_acao)::boolean, false) = true
  );
$$;

-- Atualiza políticas RLS de RH e Operacional para exigir permissão granular
drop policy if exists "Acesso autenticado a rh.funcionarios" on rh.funcionarios;
drop policy if exists "RLS rh.funcionarios ver" on rh.funcionarios;
drop policy if exists "RLS rh.funcionarios inserir" on rh.funcionarios;
drop policy if exists "RLS rh.funcionarios atualizar" on rh.funcionarios;
drop policy if exists "RLS rh.funcionarios excluir" on rh.funcionarios;

create policy "RLS rh.funcionarios ver" on rh.funcionarios
  for select to authenticated using (seguranca.utilizador_tem_permissao('rh_funcionarios', 'ver'));
create policy "RLS rh.funcionarios inserir" on rh.funcionarios
  for insert to authenticated with check (seguranca.utilizador_tem_permissao('rh_funcionarios', 'criar'));
create policy "RLS rh.funcionarios atualizar" on rh.funcionarios
  for update to authenticated
  using (seguranca.utilizador_tem_permissao('rh_funcionarios', 'editar'))
  with check (seguranca.utilizador_tem_permissao('rh_funcionarios', 'editar'));
create policy "RLS rh.funcionarios excluir" on rh.funcionarios
  for delete to authenticated using (seguranca.utilizador_tem_permissao('rh_funcionarios', 'excluir'));

drop policy if exists "Acesso autenticado a rh.assiduidade" on rh.assiduidade;
drop policy if exists "RLS rh.assiduidade ver" on rh.assiduidade;
drop policy if exists "RLS rh.assiduidade gerir" on rh.assiduidade;

create policy "RLS rh.assiduidade ver" on rh.assiduidade
  for select to authenticated using (seguranca.utilizador_tem_permissao('rh_funcionarios', 'ver'));
create policy "RLS rh.assiduidade gerir" on rh.assiduidade
  for all to authenticated
  using (seguranca.utilizador_tem_permissao('rh_funcionarios', 'assiduidade'))
  with check (seguranca.utilizador_tem_permissao('rh_funcionarios', 'assiduidade'));

drop policy if exists "Acesso autenticado a rh.recibos_vencimento" on rh.recibos_vencimento;
drop policy if exists "RLS rh.recibos ver" on rh.recibos_vencimento;
drop policy if exists "RLS rh.recibos emitir" on rh.recibos_vencimento;
drop policy if exists "RLS rh.recibos atualizar" on rh.recibos_vencimento;
drop policy if exists "RLS rh.recibos excluir" on rh.recibos_vencimento;

create policy "RLS rh.recibos ver" on rh.recibos_vencimento
  for select to authenticated using (seguranca.utilizador_tem_permissao('rh_recibos', 'ver'));
create policy "RLS rh.recibos emitir" on rh.recibos_vencimento
  for insert to authenticated with check (seguranca.utilizador_tem_permissao('rh_recibos', 'emitir'));
create policy "RLS rh.recibos atualizar" on rh.recibos_vencimento
  for update to authenticated
  using (seguranca.utilizador_tem_permissao('rh_recibos', 'emitir'))
  with check (seguranca.utilizador_tem_permissao('rh_recibos', 'emitir'));
create policy "RLS rh.recibos excluir" on rh.recibos_vencimento
  for delete to authenticated using (seguranca.utilizador_tem_permissao('rh_recibos', 'excluir'));

drop policy if exists "Acesso autenticado a rh.recibos_anexados" on rh.recibos_anexados;
drop policy if exists "RLS rh.anexos ver" on rh.recibos_anexados;
drop policy if exists "RLS rh.anexos anexar" on rh.recibos_anexados;
drop policy if exists "RLS rh.anexos excluir" on rh.recibos_anexados;

create policy "RLS rh.anexos ver" on rh.recibos_anexados
  for select to authenticated using (seguranca.utilizador_tem_permissao('rh_recibos', 'ver'));
create policy "RLS rh.anexos anexar" on rh.recibos_anexados
  for insert to authenticated with check (seguranca.utilizador_tem_permissao('rh_recibos', 'anexar'));
create policy "RLS rh.anexos excluir" on rh.recibos_anexados
  for delete to authenticated using (seguranca.utilizador_tem_permissao('rh_recibos', 'excluir'));

drop policy if exists "Acesso autenticado a operacional.obras" on operacional.obras;
drop policy if exists "RLS operacional.obras ver" on operacional.obras;
drop policy if exists "RLS operacional.obras criar" on operacional.obras;
drop policy if exists "RLS operacional.obras editar" on operacional.obras;
drop policy if exists "RLS operacional.obras excluir" on operacional.obras;

create policy "RLS operacional.obras ver" on operacional.obras
  for select to authenticated using (seguranca.utilizador_tem_permissao('op_obras', 'ver'));
create policy "RLS operacional.obras criar" on operacional.obras
  for insert to authenticated with check (seguranca.utilizador_tem_permissao('op_obras', 'criar'));
create policy "RLS operacional.obras editar" on operacional.obras
  for update to authenticated
  using (seguranca.utilizador_tem_permissao('op_obras', 'editar'))
  with check (seguranca.utilizador_tem_permissao('op_obras', 'editar'));
create policy "RLS operacional.obras excluir" on operacional.obras
  for delete to authenticated using (seguranca.utilizador_tem_permissao('op_obras', 'excluir'));

drop policy if exists "Acesso autenticado a operacional.orcamentos" on operacional.orcamentos;
drop policy if exists "Acesso autenticado a operacional.orcamento_itens" on operacional.orcamento_itens;
drop policy if exists "RLS operacional.orcamentos ver" on operacional.orcamentos;
drop policy if exists "RLS operacional.orcamentos gerir" on operacional.orcamentos;
drop policy if exists "RLS operacional.orcamento_itens ver" on operacional.orcamento_itens;
drop policy if exists "RLS operacional.orcamento_itens gerir" on operacional.orcamento_itens;

create policy "RLS operacional.orcamentos ver" on operacional.orcamentos
  for select to authenticated using (seguranca.utilizador_tem_permissao('op_obras', 'ver'));
create policy "RLS operacional.orcamentos gerir" on operacional.orcamentos
  for all to authenticated
  using (seguranca.utilizador_tem_permissao('op_obras', 'orcamentos'))
  with check (seguranca.utilizador_tem_permissao('op_obras', 'orcamentos'));

create policy "RLS operacional.orcamento_itens ver" on operacional.orcamento_itens
  for select to authenticated using (seguranca.utilizador_tem_permissao('op_obras', 'ver'));
create policy "RLS operacional.orcamento_itens gerir" on operacional.orcamento_itens
  for all to authenticated
  using (seguranca.utilizador_tem_permissao('op_obras', 'orcamentos'))
  with check (seguranca.utilizador_tem_permissao('op_obras', 'orcamentos'));

drop policy if exists "Acesso autenticado a operacional.pagamentos_obras" on operacional.pagamentos_obras;
drop policy if exists "RLS operacional.pagamentos ver" on operacional.pagamentos_obras;
drop policy if exists "RLS operacional.pagamentos gerir" on operacional.pagamentos_obras;

create policy "RLS operacional.pagamentos ver" on operacional.pagamentos_obras
  for select to authenticated using (seguranca.utilizador_tem_permissao('op_obras', 'ver'));
create policy "RLS operacional.pagamentos gerir" on operacional.pagamentos_obras
  for all to authenticated
  using (seguranca.utilizador_tem_permissao('op_obras', 'pagamentos'))
  with check (seguranca.utilizador_tem_permissao('op_obras', 'pagamentos'));

-- ----------------------------------------------------------------------------
-- 4. RPCs TRANSACIONAIS BRIDGE (EXECUTÁVEIS APENAS POR SERVICE_ROLE)
-- ----------------------------------------------------------------------------

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
  v_payslips jsonb := '[]'::jsonb;
  v_attachments jsonb := '[]'::jsonb;
  v_projects jsonb := '[]'::jsonb;
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
        'baseSalary', coalesce(f.salario_base, 0),
        'mealAllowance', coalesce(f.subsidio_alimentacao, 0),
        'twelfths', coalesce(f.duodecimos, 'Não'),
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
            'note', coalesce(a.observacoes, '')
          )
        ) as day_map
      from rh.assiduidade a
      join rh.funcionarios f on f.id = a.funcionario_id
      group by coalesce(f.codigo_interno, f.id::text)
    ) t;
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
        'overtimeBonus', coalesce(r.horas_extra_valor, 0) + coalesce(r.premios, 0),
        'socialSecurity', coalesce(r.ss_valor, 0),
        'irsRetention', coalesce(r.irs_valor, 0),
        'otherDeductions', coalesce(r.outras_deducoes, 0),
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
  end if;

  return jsonb_build_object(
    'employees', v_employees,
    'attendance', v_attendance,
    'payslips', v_payslips,
    'attachedReceipts', v_attachments,
    'projects', v_projects
  );
end;
$$;

create or replace function public.spark_erp_upsert_employee(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), 'FUNC-' || substring(gen_random_uuid()::text, 1, 6));
  v_row rh.funcionarios;
begin
  insert into rh.funcionarios (
    codigo_interno, nome_completo, cargo, departamento, nif, niss, cc,
    iban, email, telemovel, morada, tipo_contrato, data_admissao,
    salario_base, subsidio_alimentacao, duodecimos, estado, observacoes, criado_por
  )
  values (
    v_code,
    coalesce(p_payload->>'name', 'Colaborador'),
    coalesce(p_payload->>'role', 'Colaborador'),
    coalesce(p_payload->>'department', 'Geral'),
    nullif(trim(coalesce(p_payload->>'nif', '')), ''),
    nullif(trim(coalesce(p_payload->>'niss', '')), ''),
    nullif(trim(coalesce(p_payload->>'cc', '')), ''),
    nullif(trim(coalesce(p_payload->>'iban', '')), ''),
    nullif(trim(coalesce(p_payload->>'email', '')), ''),
    nullif(trim(coalesce(p_payload->>'phone', '')), ''),
    nullif(trim(coalesce(p_payload->>'address', '')), ''),
    coalesce(p_payload->>'contractType', 'Sem Termo'),
    nullif(p_payload->>'admissionDate', '')::date,
    coalesce((p_payload->>'baseSalary')::numeric, 0),
    coalesce((p_payload->>'mealAllowance')::numeric, 0),
    coalesce(p_payload->>'twelfths', 'Não'),
    case when lower(coalesce(p_payload->>'status', 'ativo')) = 'inativo' then 'Inativo' else 'Ativo' end,
    nullif(p_payload->>'notes', ''),
    p_actor
  )
  on conflict (codigo_interno) do update set
    nome_completo = excluded.nome_completo,
    cargo = excluded.cargo,
    departamento = excluded.departamento,
    nif = excluded.nif,
    niss = excluded.niss,
    cc = excluded.cc,
    iban = excluded.iban,
    email = excluded.email,
    telemovel = excluded.telemovel,
    morada = excluded.morada,
    tipo_contrato = excluded.tipo_contrato,
    data_admissao = excluded.data_admissao,
    salario_base = excluded.salario_base,
    subsidio_alimentacao = excluded.subsidio_alimentacao,
    duodecimos = excluded.duodecimos,
    estado = excluded.estado,
    observacoes = excluded.observacoes,
    atualizado_em = now()
  returning * into v_row;

  return jsonb_build_object('id', v_row.codigo_interno, 'dbId', v_row.id);
end;
$$;

create or replace function public.spark_erp_delete_employee(p_code text)
returns void
language sql
security definer
set search_path = rh, public
as $$
  delete from rh.funcionarios where codigo_interno = p_code or id::text = p_code;
$$;

create or replace function public.spark_erp_set_attendance(
  p_emp_code text,
  p_date date,
  p_status text,
  p_note text default '',
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_emp_id uuid;
  v_db_status text;
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

  insert into rh.assiduidade (funcionario_id, data_trabalho, estado, observacoes, registado_por)
  values (v_emp_id, p_date, v_db_status, nullif(p_note, ''), p_actor)
  on conflict (funcionario_id, data_trabalho) do update set
    estado = excluded.estado,
    observacoes = excluded.observacoes,
    atualizado_em = now();
end;
$$;

create or replace function public.spark_erp_mark_all_present(p_date date, p_actor uuid default null)
returns void
language sql
security definer
set search_path = rh, public
as $$
  insert into rh.assiduidade (funcionario_id, data_trabalho, estado, observacoes, registado_por)
  select f.id, p_date, 'presente', null, p_actor
  from rh.funcionarios f
  where lower(f.estado) = 'ativo'
  on conflict (funcionario_id, data_trabalho) do nothing;
$$;

create or replace function public.spark_erp_upsert_payslip(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), 'REC-' || substring(gen_random_uuid()::text, 1, 6));
  v_emp_code text := p_payload->>'employeeId';
  v_emp_id uuid;
  v_month text := coalesce(p_payload->>'month', to_char(now(), 'YYYY-MM'));
  v_ano smallint := split_part(v_month, '-', 1)::smallint;
  v_mes smallint := split_part(v_month, '-', 2)::smallint;
  v_base numeric := coalesce((p_payload->>'baseSalary')::numeric, 0);
  v_meal numeric := coalesce((p_payload->>'mealAllowanceTotal')::numeric, 0);
  v_bonus numeric := coalesce((p_payload->>'overtimeBonus')::numeric, 0);
  v_ss numeric := coalesce((p_payload->>'socialSecurity')::numeric, 0);
  v_irs numeric := coalesce((p_payload->>'irsRetention')::numeric, 0);
  v_other numeric := coalesce((p_payload->>'otherDeductions')::numeric, 0);
  v_net numeric := coalesce((p_payload->>'netSalary')::numeric, 0);
  v_row rh.recibos_vencimento;
begin
  select id into v_emp_id from rh.funcionarios where codigo_interno = v_emp_code or id::text = v_emp_code limit 1;
  if v_emp_id is null then
    raise exception 'Funcionário associado ao recibo não encontrado: %', v_emp_code;
  end if;

  insert into rh.recibos_vencimento (
    codigo_recibo, funcionario_id, ano, mes, salario_base, subsidio_alimentacao,
    horas_extra_valor, ss_valor, irs_valor, outras_deducoes,
    total_bruto, total_liquido, estado_pagamento, data_pagamento, notas, emitido_por
  )
  values (
    v_code, v_emp_id, v_ano, v_mes, v_base, v_meal,
    v_bonus, v_ss, v_irs, v_other,
    v_base + v_meal + v_bonus, v_net,
    case when lower(coalesce(p_payload->>'status', 'pendente')) = 'pago' then 'Pago' else 'Emitido' end,
    nullif(p_payload->>'paymentDate', '')::date,
    nullif(p_payload->>'notes', ''),
    p_actor
  )
  on conflict (codigo_recibo) do update set
    funcionario_id = excluded.funcionario_id,
    ano = excluded.ano,
    mes = excluded.mes,
    salario_base = excluded.salario_base,
    subsidio_alimentacao = excluded.subsidio_alimentacao,
    horas_extra_valor = excluded.horas_extra_valor,
    ss_valor = excluded.ss_valor,
    irs_valor = excluded.irs_valor,
    outras_deducoes = excluded.outras_deducoes,
    total_bruto = excluded.total_bruto,
    total_liquido = excluded.total_liquido,
    estado_pagamento = excluded.estado_pagamento,
    data_pagamento = excluded.data_pagamento,
    notas = excluded.notas,
    atualizado_em = now()
  returning * into v_row;

  return jsonb_build_object('id', v_row.codigo_recibo, 'dbId', v_row.id);
end;
$$;

create or replace function public.spark_erp_delete_payslip(p_code text)
returns void
language sql
security definer
set search_path = rh, public
as $$
  delete from rh.recibos_vencimento where codigo_recibo = p_code or id::text = p_code;
$$;

create or replace function public.spark_erp_add_attachment(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), 'ATT-' || substring(gen_random_uuid()::text, 1, 8));
  v_emp_code text := p_payload->>'employeeId';
  v_emp_id uuid;
  v_rec_code text := nullif(p_payload->>'payslipId', '');
  v_rec_id uuid;
  v_month text := coalesce(p_payload->>'month', to_char(now(), 'YYYY-MM'));
  v_ano smallint := split_part(v_month, '-', 1)::smallint;
  v_mes smallint := split_part(v_month, '-', 2)::smallint;
  v_size_bytes bigint := coalesce((p_payload->>'fileSize')::bigint, 0);
  v_row rh.recibos_anexados;
begin
  select id into v_emp_id from rh.funcionarios where codigo_interno = v_emp_code or id::text = v_emp_code limit 1;
  if v_emp_id is null then
    raise exception 'Funcionário do anexo não encontrado: %', v_emp_code;
  end if;

  if v_rec_code is not null then
    select id into v_rec_id from rh.recibos_vencimento where codigo_recibo = v_rec_code or id::text = v_rec_code limit 1;
  end if;

  insert into rh.recibos_anexados (
    codigo_anexo, funcionario_id, recibo_id, codigo_recibo_ref,
    ano, mes, nome_ficheiro, tamanho_legivel, tamanho_bytes,
    tipo_mime, caminho_storage, anexado_por
  )
  values (
    v_code, v_emp_id, v_rec_id, v_rec_code,
    v_ano, v_mes,
    coalesce(p_payload->>'fileName', 'recibo.pdf'),
    round(v_size_bytes / 1024.0)::text || ' KB',
    v_size_bytes,
    coalesce(p_payload->>'fileType', 'application/pdf'),
    p_payload->>'storagePath',
    p_actor
  )
  on conflict (codigo_anexo) do update set
    nome_ficheiro = excluded.nome_ficheiro,
    tamanho_legivel = excluded.tamanho_legivel,
    tamanho_bytes = excluded.tamanho_bytes,
    tipo_mime = excluded.tipo_mime,
    caminho_storage = excluded.caminho_storage
  returning * into v_row;

  return jsonb_build_object('id', v_row.codigo_anexo, 'storagePath', v_row.caminho_storage);
end;
$$;

create or replace function public.spark_erp_get_attachment(p_code text)
returns jsonb
language sql
security definer
set search_path = rh, public
as $$
  select jsonb_build_object(
    'id', coalesce(codigo_anexo, id::text),
    'fileName', nome_ficheiro,
    'fileType', coalesce(tipo_mime, 'application/pdf'),
    'fileSize', coalesce(tamanho_bytes, 0),
    'storagePath', caminho_storage
  )
  from rh.recibos_anexados
  where codigo_anexo = p_code or id::text = p_code
  limit 1;
$$;

create or replace function public.spark_erp_delete_attachment(p_code text)
returns text
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_path text;
begin
  delete from rh.recibos_anexados
  where codigo_anexo = p_code or id::text = p_code
  returning caminho_storage into v_path;
  return v_path;
end;
$$;

create or replace function public.spark_erp_upsert_project(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = operacional, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'code', ''), nullif(p_payload->>'id', ''), 'OB-' || substring(gen_random_uuid()::text, 1, 6));
  v_obra_id uuid;
  v_orc_id uuid;
  v_budget jsonb := coalesce(p_payload->'budget', '{"vatRate":23,"contingencyPct":5,"items":[]}'::jsonb);
  v_items jsonb := coalesce(v_budget->'items', '[]'::jsonb);
  v_payments jsonb := coalesce(p_payload->'payments', '[]'::jsonb);
  v_vat numeric := coalesce((v_budget->>'vatRate')::numeric, 23);
  v_cont numeric := coalesce((v_budget->>'contingencyPct')::numeric, 5);
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_item jsonb;
  v_pay jsonb;
begin
  select coalesce(sum(coalesce((x->>'qty')::numeric, 0) * coalesce((x->>'unitPrice')::numeric, 0)), 0)
  into v_subtotal
  from jsonb_array_elements(v_items) x;

  v_total := round((v_subtotal * (1 + v_cont / 100.0)) * (1 + v_vat / 100.0), 2);

  insert into operacional.obras (
    codigo_obra, nome_obra, cliente_nome, cliente_nif, cliente_telefone, cliente_email,
    localizacao, morada, distrito, categoria, prioridade, estado,
    data_inicio, data_fim_prevista, data_fim_real, progresso_percent,
    responsavel_codigo, equipa_ids, valor_adjudicado, orcamento_config, descricao, criado_por
  )
  values (
    v_code,
    coalesce(p_payload->>'name', 'Nova Obra'),
    coalesce(p_payload->>'clientName', 'Cliente'),
    nullif(p_payload->>'clientNif', ''),
    nullif(p_payload->>'clientPhone', ''),
    nullif(p_payload->>'clientEmail', ''),
    coalesce(p_payload->>'district', 'Porto'),
    nullif(p_payload->>'address', ''),
    coalesce(p_payload->>'district', 'Porto'),
    coalesce(p_payload->>'type', 'Construção Civil'),
    coalesce(p_payload->>'priority', 'Normal'),
    coalesce(p_payload->>'status', 'em_andamento'),
    nullif(p_payload->>'startDate', '')::date,
    nullif(p_payload->>'expectedEndDate', '')::date,
    nullif(p_payload->>'actualEndDate', '')::date,
    coalesce((p_payload->>'progress')::integer, 0),
    nullif(p_payload->>'managerId', ''),
    coalesce(p_payload->'teamIds', '[]'::jsonb),
    v_total,
    jsonb_build_object('vatRate', v_vat, 'contingencyPct', v_cont),
    nullif(p_payload->>'description', ''),
    p_actor
  )
  on conflict (codigo_obra) do update set
    nome_obra = excluded.nome_obra,
    cliente_nome = excluded.cliente_nome,
    cliente_nif = excluded.cliente_nif,
    cliente_telefone = excluded.cliente_telefone,
    cliente_email = excluded.cliente_email,
    localizacao = excluded.localizacao,
    morada = excluded.morada,
    distrito = excluded.distrito,
    categoria = excluded.categoria,
    prioridade = excluded.prioridade,
    estado = excluded.estado,
    data_inicio = excluded.data_inicio,
    data_fim_prevista = excluded.data_fim_prevista,
    data_fim_real = excluded.data_fim_real,
    progresso_percent = excluded.progresso_percent,
    responsavel_codigo = excluded.responsavel_codigo,
    equipa_ids = excluded.equipa_ids,
    valor_adjudicado = excluded.valor_adjudicado,
    orcamento_config = excluded.orcamento_config,
    descricao = excluded.descricao,
    atualizado_em = now()
  returning id into v_obra_id;

  if p_payload ? 'budget' then
    insert into operacional.orcamentos (
      obra_id, codigo_orcamento, titulo, estado, taxa_iva, margem_percent, criado_por
    )
    values (
      v_obra_id, 'ORC-' || v_code, 'Orçamento ' || coalesce(p_payload->>'name', v_code),
      'Aprovado', v_vat, v_cont, p_actor
    )
    on conflict (codigo_orcamento) do update set
      titulo = excluded.titulo,
      taxa_iva = excluded.taxa_iva,
      margem_percent = excluded.margem_percent,
      atualizado_em = now()
    returning id into v_orc_id;

    delete from operacional.orcamento_itens where orcamento_id = v_orc_id;
    for v_item in select * from jsonb_array_elements(v_items) loop
      insert into operacional.orcamento_itens (orcamento_id, categoria, descricao, quantidade, unidade, preco_unitario)
      values (
        v_orc_id,
        coalesce(v_item->>'category', 'Geral'),
        coalesce(v_item->>'description', ''),
        coalesce((v_item->>'qty')::numeric, 1),
        coalesce(v_item->>'unit', 'vg'),
        coalesce((v_item->>'unitPrice')::numeric, 0)
      );
    end loop;
  end if;

  if p_payload ? 'payments' then
    delete from operacional.pagamentos_obras where obra_id = v_obra_id;
    for v_pay in select * from jsonb_array_elements(v_payments) loop
      insert into operacional.pagamentos_obras (
        obra_id, codigo_pagamento, descricao_prestacao, referencia_fatura,
        data_vencimento, data_pagamento, valor, metodo_pagamento, estado, registado_por
      )
      values (
        v_obra_id,
        coalesce(nullif(v_pay->>'id', ''), 'PAG-' || substring(gen_random_uuid()::text, 1, 6)),
        coalesce(v_pay->>'description', 'Prestação'),
        nullif(v_pay->>'invoiceRef', ''),
        coalesce(nullif(v_pay->>'dueDate', '')::date, current_date),
        nullif(v_pay->>'paidDate', '')::date,
        coalesce((v_pay->>'amount')::numeric, 0),
        coalesce(v_pay->>'method', 'Transferência Bancária'),
        case when lower(coalesce(v_pay->>'status', 'em_aberto')) = 'pago' then 'Pago' else 'Em Aberto' end,
        p_actor
      );
    end loop;
  end if;

  return jsonb_build_object('id', v_code, 'dbId', v_obra_id);
end;
$$;

create or replace function public.spark_erp_delete_project(p_code text)
returns void
language sql
security definer
set search_path = operacional, public
as $$
  delete from operacional.obras where codigo_obra = p_code or id::text = p_code;
$$;

-- Bloqueia acesso público/anónimo/autenticado às RPCs internas; apenas service_role
revoke all on function public.spark_erp_snapshot(boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.spark_erp_upsert_employee(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_employee(text) from public, anon, authenticated;
revoke all on function public.spark_erp_set_attendance(text, date, text, text, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_mark_all_present(date, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_upsert_payslip(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_payslip(text) from public, anon, authenticated;
revoke all on function public.spark_erp_add_attachment(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_get_attachment(text) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_attachment(text) from public, anon, authenticated;
revoke all on function public.spark_erp_upsert_project(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_project(text) from public, anon, authenticated;

grant execute on function public.spark_erp_snapshot(boolean, boolean, boolean) to service_role;
grant execute on function public.spark_erp_upsert_employee(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_delete_employee(text) to service_role;
grant execute on function public.spark_erp_set_attendance(text, date, text, text, uuid) to service_role;
grant execute on function public.spark_erp_mark_all_present(date, uuid) to service_role;
grant execute on function public.spark_erp_upsert_payslip(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_delete_payslip(text) to service_role;
grant execute on function public.spark_erp_add_attachment(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_get_attachment(text) to service_role;
grant execute on function public.spark_erp_delete_attachment(text) to service_role;
grant execute on function public.spark_erp_upsert_project(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_delete_project(text) to service_role;
