-- ============================================================================
-- SPARK & SMIRK — MODALIDADE REMUNERAÇÃO (MENSAL/DIÁRIA/HORA), SS % E ADIANTAMENTOS
-- Pasta: supabase/02-recursos-humanos/05-remuneracao-e-adiantamentos.sql
-- Execute este ficheiro no SQL Editor do Supabase após 06-responsaveis-tecnicos.sql.
-- ============================================================================

-- 1. Colunas de modalidade de remuneração e SS% em rh.funcionarios
alter table rh.funcionarios
  add column if not exists modalidade_pagamento text not null default 'mensal',
  add column if not exists valor_diaria numeric(12, 2) not null default 0,
  add column if not exists valor_hora numeric(12, 2) not null default 0,
  add column if not exists percentagem_ss numeric(5, 2) not null default 11;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'funcionarios_modalidade_check'
      and conrelid = 'rh.funcionarios'::regclass
  ) then
    alter table rh.funcionarios
      add constraint funcionarios_modalidade_check
      check (modalidade_pagamento in ('mensal', 'diaria', 'hora'));
  end if;
end $$;

-- 2. Horas trabalhadas por dia em rh.assiduidade (para modalidade por hora)
alter table rh.assiduidade
  add column if not exists horas_trabalhadas numeric(5, 2) not null default 8;

-- 3. Tabela rh.adiantamentos (valores antecipados retirados do ordenado)
create table if not exists rh.adiantamentos (
  id uuid primary key default gen_random_uuid(),
  codigo_adiantamento text not null unique,
  funcionario_id uuid not null references rh.funcionarios(id) on delete cascade,
  periodo text not null,
  data_adiantamento date not null default current_date,
  valor numeric(12, 2) not null check (valor > 0),
  observacoes text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table rh.adiantamentos is 'Registo de valores antecipados (vales) retirados pelos funcionários para abate no fecho salarial';

create index if not exists idx_adiantamentos_func_periodo on rh.adiantamentos (funcionario_id, periodo);
create index if not exists idx_adiantamentos_data on rh.adiantamentos (data_adiantamento desc);

drop trigger if exists trg_adiantamentos_updated_at on rh.adiantamentos;
create trigger trg_adiantamentos_updated_at
  before update on rh.adiantamentos
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table rh.adiantamentos to authenticated;
grant all on table rh.adiantamentos to service_role;

alter table rh.adiantamentos enable row level security;

drop policy if exists "RLS rh.adiantamentos ver" on rh.adiantamentos;
drop policy if exists "RLS rh.adiantamentos gerir" on rh.adiantamentos;

create policy "RLS rh.adiantamentos ver" on rh.adiantamentos
  for select to authenticated
  using (seguranca.utilizador_tem_permissao('rh_funcionarios', 'ver'));

create policy "RLS rh.adiantamentos gerir" on rh.adiantamentos
  for all to authenticated
  using (
    seguranca.utilizador_tem_permissao('rh_funcionarios', 'editar')
    or seguranca.utilizador_tem_permissao('rh_funcionarios', 'assiduidade')
  )
  with check (
    seguranca.utilizador_tem_permissao('rh_funcionarios', 'editar')
    or seguranca.utilizador_tem_permissao('rh_funcionarios', 'assiduidade')
  );

-- 4. Atualizar spark_erp_snapshot para incluir remuneração, horas e adiantamentos
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
  v_payslips jsonb := '[]'::jsonb;
  v_attachments jsonb := '[]'::jsonb;
  v_projects jsonb := '[]'::jsonb;
  v_project_invoices jsonb := '[]'::jsonb;
  v_project_contracts jsonb := '[]'::jsonb;
  v_technical_managers jsonb := '[]'::jsonb;
  v_technical_certificates jsonb := '[]'::jsonb;
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
            'hours', coalesce(a.horas_trabalhadas, 8),
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

  return jsonb_build_object(
    'employees', v_employees,
    'attendance', v_attendance,
    'employeeAdvances', v_advances,
    'payslips', v_payslips,
    'attachedReceipts', v_attachments,
    'projects', v_projects,
    'projectInvoices', v_project_invoices,
    'projectContracts', v_project_contracts,
    'technicalManagers', v_technical_managers,
    'technicalCertificates', v_technical_certificates
  );
end;
$$;

-- 5. Atualizar upsert de funcionário e assiduidade com horas e modalidade
create or replace function public.spark_erp_upsert_employee(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), 'FUNC-' || substring(gen_random_uuid()::text, 1, 6));
  v_rem text := case
    when p_payload->>'remunerationType' in ('diaria', 'hora', 'mensal') then p_payload->>'remunerationType'
    else 'mensal'
  end;
  v_row rh.funcionarios;
begin
  insert into rh.funcionarios (
    codigo_interno, nome_completo, cargo, departamento, nif, niss, cc,
    iban, email, telemovel, morada, tipo_contrato, data_admissao,
    modalidade_pagamento, salario_base, valor_diaria, valor_hora, percentagem_ss,
    subsidio_alimentacao, duodecimos, estado, observacoes, criado_por
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
    v_rem,
    greatest(0, coalesce((p_payload->>'baseSalary')::numeric, 0)),
    greatest(0, coalesce((p_payload->>'dailyRate')::numeric, 0)),
    greatest(0, coalesce((p_payload->>'hourlyRate')::numeric, 0)),
    least(100, greatest(0, coalesce((p_payload->>'ssPercentage')::numeric, 11))),
    greatest(0, coalesce((p_payload->>'mealAllowance')::numeric, 0)),
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
    modalidade_pagamento = excluded.modalidade_pagamento,
    salario_base = excluded.salario_base,
    valor_diaria = excluded.valor_diaria,
    valor_hora = excluded.valor_hora,
    percentagem_ss = excluded.percentagem_ss,
    subsidio_alimentacao = excluded.subsidio_alimentacao,
    duodecimos = excluded.duodecimos,
    estado = excluded.estado,
    observacoes = excluded.observacoes,
    atualizado_em = now()
  returning * into v_row;

  return jsonb_build_object('id', v_row.codigo_interno, 'dbId', v_row.id);
end;
$$;

create or replace function public.spark_erp_set_attendance(
  p_emp_code text,
  p_date date,
  p_status text,
  p_note text default '',
  p_actor uuid default null,
  p_hours numeric default 8
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

  insert into rh.assiduidade (funcionario_id, data_trabalho, estado, horas_trabalhadas, observacoes, registado_por)
  values (v_emp_id, p_date, v_db_status, case when v_db_status = 'presente' then v_hours else 0 end, nullif(p_note, ''), p_actor)
  on conflict (funcionario_id, data_trabalho) do update set
    estado = excluded.estado,
    horas_trabalhadas = excluded.horas_trabalhadas,
    observacoes = excluded.observacoes,
    atualizado_em = now();
end;
$$;

-- 6. RPCs de adiantamentos salariais (vales)
create or replace function public.spark_erp_add_advance(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), 'ADT-' || substring(gen_random_uuid()::text, 1, 8));
  v_emp_ref text := trim(coalesce(p_payload->>'employeeId', ''));
  v_emp_id uuid;
  v_emp_code text;
  v_date date := coalesce(nullif(p_payload->>'date', '')::date, current_date);
  v_month text := coalesce(nullif(trim(p_payload->>'month'), ''), to_char(v_date, 'YYYY-MM'));
  v_row rh.adiantamentos;
begin
  select id, codigo_interno
  into v_emp_id, v_emp_code
  from rh.funcionarios
  where codigo_interno = v_emp_ref or id::text = v_emp_ref
  limit 1;

  if v_emp_id is null then
    raise exception 'Funcionário não encontrado: %', v_emp_ref;
  end if;

  insert into rh.adiantamentos (
    codigo_adiantamento, funcionario_id, periodo, data_adiantamento, valor, observacoes, criado_por
  )
  values (
    v_code,
    v_emp_id,
    v_month,
    v_date,
    greatest(0.01, coalesce((p_payload->>'amount')::numeric, 0)),
    nullif(trim(coalesce(p_payload->>'notes', '')), ''),
    p_actor
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.codigo_adiantamento,
    'dbId', v_row.id,
    'employeeId', v_emp_code,
    'month', v_row.periodo,
    'date', to_char(v_row.data_adiantamento, 'YYYY-MM-DD'),
    'amount', v_row.valor,
    'notes', coalesce(v_row.observacoes, ''),
    'createdAt', to_char(v_row.criado_em, 'YYYY-MM-DD')
  );
end;
$$;

create or replace function public.spark_erp_delete_advance(p_code text)
returns void
language sql
security definer
set search_path = rh, public
as $$
  delete from rh.adiantamentos where codigo_adiantamento = p_code or id::text = p_code;
$$;

-- Acesso estritamente reservado ao backend autenticado (service_role)
revoke all on function public.spark_erp_snapshot(boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.spark_erp_upsert_employee(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_set_attendance(text, date, text, text, uuid, numeric) from public, anon, authenticated;
revoke all on function public.spark_erp_add_advance(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_advance(text) from public, anon, authenticated;

grant execute on function public.spark_erp_snapshot(boolean, boolean, boolean) to service_role;
grant execute on function public.spark_erp_upsert_employee(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_set_attendance(text, date, text, text, uuid, numeric) to service_role;
grant execute on function public.spark_erp_add_advance(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_delete_advance(text) to service_role;
