-- ============================================================================
-- SPARK & SMIRK — CONTRATOS DE TRABALHO EM PDF (Schema: rh)
-- Pasta: supabase/02-recursos-humanos/06-contratos-funcionarios.sql
-- Execute este ficheiro no SQL Editor do Supabase após 05-remuneracao-e-adiantamentos.sql.
-- ============================================================================

-- 1. Tabela rh.funcionarios_contratos
create table if not exists rh.funcionarios_contratos (
  id uuid primary key default gen_random_uuid(),
  codigo_contrato text not null unique,
  funcionario_id uuid not null references rh.funcionarios(id) on delete cascade,
  titulo text not null default 'Contrato de Trabalho',
  tipo_contrato text not null default 'Sem Termo',
  data_inicio date not null default current_date,
  observacoes text,
  nome_ficheiro text,
  tipo_mime text,
  tamanho_bytes bigint not null default 0,
  caminho_storage text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table rh.funcionarios_contratos is 'Contratos de trabalho e adendas em PDF associados aos colaboradores';

create index if not exists idx_func_contratos_func on rh.funcionarios_contratos (funcionario_id);
create index if not exists idx_func_contratos_data on rh.funcionarios_contratos (data_inicio desc);

drop trigger if exists trg_funcionarios_contratos_updated_at on rh.funcionarios_contratos;
create trigger trg_funcionarios_contratos_updated_at
  before update on rh.funcionarios_contratos
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table rh.funcionarios_contratos to authenticated;
grant all on table rh.funcionarios_contratos to service_role;

alter table rh.funcionarios_contratos enable row level security;

drop policy if exists "RLS rh.contratos ver" on rh.funcionarios_contratos;
drop policy if exists "RLS rh.contratos criar" on rh.funcionarios_contratos;
drop policy if exists "RLS rh.contratos atualizar" on rh.funcionarios_contratos;
drop policy if exists "RLS rh.contratos excluir" on rh.funcionarios_contratos;

create policy "RLS rh.contratos ver" on rh.funcionarios_contratos
  for select to authenticated
  using (seguranca.utilizador_tem_permissao('rh_funcionarios', 'ver'));

create policy "RLS rh.contratos criar" on rh.funcionarios_contratos
  for insert to authenticated
  with check (
    seguranca.utilizador_tem_permissao('rh_funcionarios', 'criar')
    or seguranca.utilizador_tem_permissao('rh_funcionarios', 'editar')
  );

create policy "RLS rh.contratos atualizar" on rh.funcionarios_contratos
  for update to authenticated
  using (seguranca.utilizador_tem_permissao('rh_funcionarios', 'editar'))
  with check (seguranca.utilizador_tem_permissao('rh_funcionarios', 'editar'));

create policy "RLS rh.contratos excluir" on rh.funcionarios_contratos
  for delete to authenticated
  using (
    seguranca.utilizador_tem_permissao('rh_funcionarios', 'excluir')
    or seguranca.utilizador_tem_permissao('rh_funcionarios', 'editar')
  );

-- 2. Bucket privado de Storage para contratos de trabalho dos funcionários
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contratos-funcionarios',
  'contratos-funcionarios',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

-- 3. Atualização da RPC de snapshot (consolidada com employeeContracts)
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

-- 4. RPCs transacionais de contratos de funcionários e limpeza em cascata
drop function if exists public.spark_erp_delete_employee(text);

create or replace function public.spark_erp_delete_employee(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_id uuid;
  v_paths jsonb := '[]'::jsonb;
begin
  select id into v_id
  from rh.funcionarios
  where codigo_interno = p_code or id::text = p_code
  limit 1;

  if v_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(caminho_storage), '[]'::jsonb)
  into v_paths
  from rh.funcionarios_contratos
  where funcionario_id = v_id and caminho_storage is not null and caminho_storage <> '';

  delete from rh.funcionarios where id = v_id;
  return v_paths;
end;
$$;

create or replace function public.spark_erp_upsert_employee_contract(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), 'CTRF-' || substring(gen_random_uuid()::text, 1, 8));
  v_emp_ref text := trim(coalesce(p_payload->>'employeeId', ''));
  v_emp_id uuid;
  v_emp_code text;
  v_row rh.funcionarios_contratos;
begin
  select id, codigo_interno
  into v_emp_id, v_emp_code
  from rh.funcionarios
  where codigo_interno = v_emp_ref or id::text = v_emp_ref
  limit 1;

  if v_emp_id is null then
    raise exception 'Funcionário não encontrado (%)', v_emp_ref;
  end if;

  insert into rh.funcionarios_contratos (
    codigo_contrato, funcionario_id, titulo, tipo_contrato, data_inicio, observacoes,
    nome_ficheiro, tipo_mime, tamanho_bytes, caminho_storage, criado_por
  )
  values (
    v_code,
    v_emp_id,
    coalesce(nullif(trim(p_payload->>'title'), ''), 'Contrato de Trabalho'),
    coalesce(nullif(trim(p_payload->>'contractType'), ''), 'Sem Termo'),
    coalesce(nullif(p_payload->>'contractDate', '')::date, current_date),
    nullif(trim(coalesce(p_payload->>'notes', '')), ''),
    nullif(trim(coalesce(p_payload->>'fileName', '')), ''),
    nullif(trim(coalesce(p_payload->>'fileType', '')), ''),
    greatest(0, coalesce((p_payload->>'fileSize')::bigint, 0)),
    nullif(trim(coalesce(p_payload->>'storagePath', '')), ''),
    p_actor
  )
  on conflict (codigo_contrato) do update set
    titulo = excluded.titulo,
    tipo_contrato = excluded.tipo_contrato,
    data_inicio = excluded.data_inicio,
    observacoes = excluded.observacoes,
    nome_ficheiro = coalesce(excluded.nome_ficheiro, rh.funcionarios_contratos.nome_ficheiro),
    tipo_mime = coalesce(excluded.tipo_mime, rh.funcionarios_contratos.tipo_mime),
    tamanho_bytes = case when excluded.tamanho_bytes > 0 then excluded.tamanho_bytes else rh.funcionarios_contratos.tamanho_bytes end,
    caminho_storage = coalesce(excluded.caminho_storage, rh.funcionarios_contratos.caminho_storage),
    atualizado_em = now()
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.codigo_contrato,
    'dbId', v_row.id,
    'employeeId', v_emp_code,
    'title', v_row.titulo,
    'contractType', v_row.tipo_contrato,
    'contractDate', to_char(v_row.data_inicio, 'YYYY-MM-DD'),
    'notes', coalesce(v_row.observacoes, ''),
    'fileName', coalesce(v_row.nome_ficheiro, ''),
    'fileType', coalesce(v_row.tipo_mime, ''),
    'fileSize', coalesce(v_row.tamanho_bytes, 0),
    'hasFile', (v_row.caminho_storage is not null and v_row.caminho_storage <> ''),
    'createdAt', to_char(v_row.criado_em, 'YYYY-MM-DD')
  );
end;
$$;

create or replace function public.spark_erp_get_employee_contract_file(p_code text)
returns jsonb
language sql
security definer
set search_path = rh, public
as $$
  select jsonb_build_object(
    'id', fc.codigo_contrato,
    'fileName', coalesce(fc.nome_ficheiro, fc.codigo_contrato || '.pdf'),
    'fileType', coalesce(fc.tipo_mime, 'application/pdf'),
    'fileSize', coalesce(fc.tamanho_bytes, 0),
    'storagePath', fc.caminho_storage
  )
  from rh.funcionarios_contratos fc
  where fc.codigo_contrato = p_code or fc.id::text = p_code
  limit 1;
$$;

create or replace function public.spark_erp_delete_employee_contract(p_code text)
returns text
language plpgsql
security definer
set search_path = rh, public
as $$
declare
  v_path text;
begin
  delete from rh.funcionarios_contratos
  where codigo_contrato = p_code or id::text = p_code
  returning caminho_storage into v_path;
  return v_path;
end;
$$;

-- Acesso estritamente reservado ao backend autenticado (service_role)
revoke all on function public.spark_erp_snapshot(boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_employee(text) from public, anon, authenticated;
revoke all on function public.spark_erp_upsert_employee_contract(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_get_employee_contract_file(text) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_employee_contract(text) from public, anon, authenticated;

grant execute on function public.spark_erp_snapshot(boolean, boolean, boolean) to service_role;
grant execute on function public.spark_erp_delete_employee(text) to service_role;
grant execute on function public.spark_erp_upsert_employee_contract(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_get_employee_contract_file(text) to service_role;
grant execute on function public.spark_erp_delete_employee_contract(text) to service_role;
