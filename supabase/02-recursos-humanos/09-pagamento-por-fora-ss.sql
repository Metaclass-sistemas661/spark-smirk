-- ============================================================================
-- SPARK & SMIRK — PAGAMENTO POR FORA DA SEGURANÇA SOCIAL & CONSOLIDAÇÃO RH
-- Pasta: supabase/02-recursos-humanos/09-pagamento-por-fora-ss.sql
-- Execute este ficheiro no SQL Editor do Supabase (após 08-candidaturas-recrutamento.sql).
-- ============================================================================

-- 1. Novas colunas em rh.funcionarios (suplemento por fora da Segurança Social)
alter table rh.funcionarios
  add column if not exists modalidade_por_fora text not null default 'mensal',
  add column if not exists valor_por_fora numeric(12, 2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_func_modalidade_por_fora'
      and conrelid = 'rh.funcionarios'::regclass
  ) then
    alter table rh.funcionarios
      add constraint chk_func_modalidade_por_fora
      check (modalidade_por_fora in ('mensal', 'diaria'));
  end if;
end $$;

-- 2. Nova coluna em rh.recibos_vencimento (registo histórico do valor pago por fora)
alter table rh.recibos_vencimento
  add column if not exists pagamento_por_fora numeric(12, 2) not null default 0;

-- 3. RPC de snapshot consolidada (RH completo + Contratos + Recibos + Operacional + Responsáveis)
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
    'technicalCertificates', v_technical_certificates
  );
end;
$$;

-- 4. Atualizar RPC spark_erp_upsert_employee com pagamento por fora da SS
create or replace function public.spark_erp_upsert_employee(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), 'FUNC-' || substring(gen_random_uuid()::text, 1, 8));
  v_rem text := case
    when p_payload->>'remunerationType' in ('diaria', 'hora', 'mensal') then p_payload->>'remunerationType'
    else 'mensal'
  end;
  v_off_type text := case
    when v_rem = 'mensal' then 'mensal'
    when p_payload->>'offPayrollType' in ('diaria', 'mensal') then p_payload->>'offPayrollType'
    else 'mensal'
  end;
  v_off_amount numeric := greatest(0, coalesce((p_payload->>'offPayrollAmount')::numeric, 0));
  v_row rh.funcionarios;
begin
  insert into rh.funcionarios (
    codigo_interno, nome_completo, cargo, departamento, nif, niss, cc,
    iban, email, telemovel, morada, tipo_contrato, data_admissao,
    modalidade_pagamento, salario_base, valor_diaria, valor_hora, percentagem_ss,
    subsidio_alimentacao, modalidade_por_fora, valor_por_fora,
    duodecimos, estado, observacoes, criado_por
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
    v_off_type,
    v_off_amount,
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
    modalidade_por_fora = excluded.modalidade_por_fora,
    valor_por_fora = excluded.valor_por_fora,
    duodecimos = excluded.duodecimos,
    estado = excluded.estado,
    observacoes = excluded.observacoes,
    atualizado_em = now()
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.codigo_interno,
    'dbId', v_row.id,
    'remunerationType', v_row.modalidade_pagamento,
    'offPayrollType', v_row.modalidade_por_fora,
    'offPayrollAmount', v_row.valor_por_fora
  );
end;
$$;

-- 5. Atualizar RPC spark_erp_upsert_payslip (sem ON CONFLICT frágil + pagamento por fora)
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
  v_bonus numeric := greatest(0, coalesce((p_payload->>'overtimeBonus')::numeric, 0));
  v_ss numeric := greatest(0, coalesce((p_payload->>'socialSecurity')::numeric, 0));
  v_irs numeric := greatest(0, coalesce((p_payload->>'irsRetention')::numeric, 0));
  v_other numeric := greatest(0, coalesce((p_payload->>'otherDeductions')::numeric, 0));
  v_off_payroll numeric := greatest(0, coalesce((p_payload->>'offPayroll')::numeric, 0));
  v_net numeric := greatest(0, coalesce((p_payload->>'netSalary')::numeric, 0));
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
    horas_extra_valor = v_bonus,
    ss_valor = v_ss,
    irs_valor = v_irs,
    outras_deducoes = v_other,
    pagamento_por_fora = v_off_payroll,
    total_bruto = v_base + v_meal + v_bonus,
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
      horas_extra_valor, ss_valor, irs_valor, outras_deducoes, pagamento_por_fora,
      total_bruto, total_liquido, estado_pagamento, data_pagamento, notas, emitido_por
    )
    values (
      v_code, v_emp_id, v_ano, v_mes, v_base, v_meal,
      v_bonus, v_ss, v_irs, v_other, v_off_payroll,
      v_base + v_meal + v_bonus, v_net,
      v_status,
      v_pay_date,
      v_notes,
      p_actor
    )
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', coalesce(v_row.codigo_recibo, v_row.id::text),
    'dbId', v_row.id,
    'offPayroll', coalesce(v_row.pagamento_por_fora, 0)
  );
end;
$$;
