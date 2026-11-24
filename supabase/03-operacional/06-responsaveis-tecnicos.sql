-- ============================================================================
-- SPARK & SMIRK — RESPONSÁVEIS TÉCNICOS, ESPECIALIDADES & CERTIFICADOS PDF
-- Pasta: supabase/03-operacional/06-responsaveis-tecnicos.sql
-- Execute este ficheiro no SQL Editor do Supabase após 05-regime-obra-e-contratos.sql.
-- ============================================================================

-- 1. Tabela operacional.responsaveis_tecnicos
create table if not exists operacional.responsaveis_tecnicos (
  id uuid primary key default gen_random_uuid(),
  codigo_tecnico text not null unique,
  nome_completo text not null,
  titulo_profissional text not null default 'Responsável Técnico',
  ordem_entidade text,
  numero_cedula text,
  nif text,
  cc text,
  telemovel text,
  email text,
  especialidades jsonb not null default '[]'::jsonb,
  estado text not null default 'ativo'
    check (estado in ('ativo', 'inativo')),
  observacoes text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table operacional.responsaveis_tecnicos is 'Registo de responsáveis técnicos (engenharia civil, elétrica, trabalho em altura, segurança e fiscalização em Portugal)';

create index if not exists idx_resp_tec_estado on operacional.responsaveis_tecnicos (estado);
create index if not exists idx_resp_tec_codigo on operacional.responsaveis_tecnicos (codigo_tecnico);

drop trigger if exists trg_responsaveis_tecnicos_updated_at on operacional.responsaveis_tecnicos;
create trigger trg_responsaveis_tecnicos_updated_at
  before update on operacional.responsaveis_tecnicos
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table operacional.responsaveis_tecnicos to authenticated;
grant all on table operacional.responsaveis_tecnicos to service_role;

alter table operacional.responsaveis_tecnicos enable row level security;

drop policy if exists "RLS operacional.resp_tec ver" on operacional.responsaveis_tecnicos;
drop policy if exists "RLS operacional.resp_tec gerir" on operacional.responsaveis_tecnicos;

create policy "RLS operacional.resp_tec ver" on operacional.responsaveis_tecnicos
  for select to authenticated
  using (seguranca.utilizador_tem_permissao('op_obras', 'ver'));

create policy "RLS operacional.resp_tec gerir" on operacional.responsaveis_tecnicos
  for all to authenticated
  using (
    seguranca.utilizador_tem_permissao('op_obras', 'responsaveis')
    or seguranca.utilizador_tem_permissao('op_obras', 'editar')
  )
  with check (
    seguranca.utilizador_tem_permissao('op_obras', 'responsaveis')
    or seguranca.utilizador_tem_permissao('op_obras', 'criar')
    or seguranca.utilizador_tem_permissao('op_obras', 'editar')
  );

-- 2. Tabela operacional.responsaveis_certificados
create table if not exists operacional.responsaveis_certificados (
  id uuid primary key default gen_random_uuid(),
  codigo_certificado text not null unique,
  tecnico_id uuid not null references operacional.responsaveis_tecnicos(id) on delete cascade,
  tipo_certificado text not null,
  categoria text not null default 'Construção Civil',
  numero_certificado text,
  entidade_emissora text,
  data_emissao date,
  data_validade date,
  observacoes text,
  nome_ficheiro text,
  tipo_mime text,
  tamanho_bytes bigint not null default 0,
  caminho_storage text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table operacional.responsaveis_certificados is 'Certificados em PDF, cédulas, carteiras DGEG, CAP de segurança e habilitações de trabalho em altura dos responsáveis técnicos';

create index if not exists idx_resp_cert_tecnico on operacional.responsaveis_certificados (tecnico_id);
create index if not exists idx_resp_cert_validade on operacional.responsaveis_certificados (data_validade);

drop trigger if exists trg_responsaveis_certificados_updated_at on operacional.responsaveis_certificados;
create trigger trg_responsaveis_certificados_updated_at
  before update on operacional.responsaveis_certificados
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table operacional.responsaveis_certificados to authenticated;
grant all on table operacional.responsaveis_certificados to service_role;

alter table operacional.responsaveis_certificados enable row level security;

drop policy if exists "RLS operacional.resp_cert ver" on operacional.responsaveis_certificados;
drop policy if exists "RLS operacional.resp_cert gerir" on operacional.responsaveis_certificados;

create policy "RLS operacional.resp_cert ver" on operacional.responsaveis_certificados
  for select to authenticated
  using (seguranca.utilizador_tem_permissao('op_obras', 'ver'));

create policy "RLS operacional.resp_cert gerir" on operacional.responsaveis_certificados
  for all to authenticated
  using (
    seguranca.utilizador_tem_permissao('op_obras', 'responsaveis')
    or seguranca.utilizador_tem_permissao('op_obras', 'editar')
  )
  with check (
    seguranca.utilizador_tem_permissao('op_obras', 'responsaveis')
    or seguranca.utilizador_tem_permissao('op_obras', 'criar')
    or seguranca.utilizador_tem_permissao('op_obras', 'editar')
  );

-- 3. Bucket privado de Storage para certificados em PDF / imagem
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'certificados-tecnicos',
  'certificados-tecnicos',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

-- 4. Atualização da RPC de snapshot para incluir responsáveis técnicos e certificados
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

-- 5. RPCs transacionais de responsáveis técnicos e certificados
create or replace function public.spark_erp_upsert_technical_manager(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = operacional, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), nullif(p_payload->>'code', ''), 'TEC-' || substring(gen_random_uuid()::text, 1, 6));
  v_row operacional.responsaveis_tecnicos;
begin
  insert into operacional.responsaveis_tecnicos (
    codigo_tecnico, nome_completo, titulo_profissional, ordem_entidade,
    numero_cedula, nif, cc, telemovel, email, especialidades, estado, observacoes, criado_por
  )
  values (
    v_code,
    coalesce(nullif(trim(p_payload->>'name'), ''), 'Responsável Técnico'),
    coalesce(nullif(trim(p_payload->>'professionalTitle'), ''), 'Responsável Técnico'),
    nullif(trim(coalesce(p_payload->>'entityOrder', '')), ''),
    nullif(trim(coalesce(p_payload->>'licenseNumber', '')), ''),
    nullif(trim(coalesce(p_payload->>'nif', '')), ''),
    nullif(trim(coalesce(p_payload->>'cc', '')), ''),
    nullif(trim(coalesce(p_payload->>'phone', '')), ''),
    nullif(trim(coalesce(p_payload->>'email', '')), ''),
    coalesce(p_payload->'specialties', '[]'::jsonb),
    case when lower(coalesce(p_payload->>'status', 'ativo')) = 'inativo' then 'inativo' else 'ativo' end,
    nullif(trim(coalesce(p_payload->>'notes', '')), ''),
    p_actor
  )
  on conflict (codigo_tecnico) do update set
    nome_completo = excluded.nome_completo,
    titulo_profissional = excluded.titulo_profissional,
    ordem_entidade = excluded.ordem_entidade,
    numero_cedula = excluded.numero_cedula,
    nif = excluded.nif,
    cc = excluded.cc,
    telemovel = excluded.telemovel,
    email = excluded.email,
    especialidades = excluded.especialidades,
    estado = excluded.estado,
    observacoes = excluded.observacoes,
    atualizado_em = now()
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.codigo_tecnico,
    'dbId', v_row.id,
    'code', v_row.codigo_tecnico,
    'name', v_row.nome_completo,
    'professionalTitle', v_row.titulo_profissional,
    'entityOrder', coalesce(v_row.ordem_entidade, ''),
    'licenseNumber', coalesce(v_row.numero_cedula, ''),
    'nif', coalesce(v_row.nif, ''),
    'cc', coalesce(v_row.cc, ''),
    'phone', coalesce(v_row.telemovel, ''),
    'email', coalesce(v_row.email, ''),
    'specialties', coalesce(v_row.especialidades, '[]'::jsonb),
    'status', v_row.estado,
    'notes', coalesce(v_row.observacoes, ''),
    'createdAt', to_char(v_row.criado_em, 'YYYY-MM-DD')
  );
end;
$$;

create or replace function public.spark_erp_delete_technical_manager(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = operacional, public
as $$
declare
  v_id uuid;
  v_paths jsonb := '[]'::jsonb;
begin
  select id into v_id
  from operacional.responsaveis_tecnicos
  where codigo_tecnico = p_code or id::text = p_code
  limit 1;

  if v_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(caminho_storage), '[]'::jsonb)
  into v_paths
  from operacional.responsaveis_certificados
  where tecnico_id = v_id and caminho_storage is not null and caminho_storage <> '';

  delete from operacional.responsaveis_tecnicos where id = v_id;
  return v_paths;
end;
$$;

create or replace function public.spark_erp_upsert_technical_certificate(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = operacional, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), 'CERT-' || substring(gen_random_uuid()::text, 1, 8));
  v_mgr_ref text := trim(coalesce(p_payload->>'managerId', ''));
  v_mgr_id uuid;
  v_mgr_code text;
  v_row operacional.responsaveis_certificados;
begin
  select id, codigo_tecnico
  into v_mgr_id, v_mgr_code
  from operacional.responsaveis_tecnicos
  where codigo_tecnico = v_mgr_ref or id::text = v_mgr_ref
  limit 1;

  if v_mgr_id is null then
    raise exception 'Responsável técnico não encontrado (%)', v_mgr_ref;
  end if;

  insert into operacional.responsaveis_certificados (
    codigo_certificado, tecnico_id, tipo_certificado, categoria,
    numero_certificado, entidade_emissora, data_emissao, data_validade,
    observacoes, nome_ficheiro, tipo_mime, tamanho_bytes, caminho_storage, criado_por
  )
  values (
    v_code,
    v_mgr_id,
    coalesce(nullif(trim(p_payload->>'certificateType'), ''), 'Certificado Profissional'),
    coalesce(nullif(trim(p_payload->>'category'), ''), 'Construção Civil'),
    nullif(trim(coalesce(p_payload->>'certificateNumber', '')), ''),
    nullif(trim(coalesce(p_payload->>'issuer', '')), ''),
    nullif(p_payload->>'issueDate', '')::date,
    nullif(p_payload->>'expiryDate', '')::date,
    nullif(trim(coalesce(p_payload->>'notes', '')), ''),
    nullif(trim(coalesce(p_payload->>'fileName', '')), ''),
    nullif(trim(coalesce(p_payload->>'fileType', '')), ''),
    greatest(0, coalesce((p_payload->>'fileSize')::bigint, 0)),
    nullif(trim(coalesce(p_payload->>'storagePath', '')), ''),
    p_actor
  )
  on conflict (codigo_certificado) do update set
    tipo_certificado = excluded.tipo_certificado,
    categoria = excluded.categoria,
    numero_certificado = excluded.numero_certificado,
    entidade_emissora = excluded.entidade_emissora,
    data_emissao = excluded.data_emissao,
    data_validade = excluded.data_validade,
    observacoes = excluded.observacoes,
    nome_ficheiro = coalesce(excluded.nome_ficheiro, operacional.responsaveis_certificados.nome_ficheiro),
    tipo_mime = coalesce(excluded.tipo_mime, operacional.responsaveis_certificados.tipo_mime),
    tamanho_bytes = case when excluded.tamanho_bytes > 0 then excluded.tamanho_bytes else operacional.responsaveis_certificados.tamanho_bytes end,
    caminho_storage = coalesce(excluded.caminho_storage, operacional.responsaveis_certificados.caminho_storage),
    atualizado_em = now()
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.codigo_certificado,
    'dbId', v_row.id,
    'managerId', v_mgr_code,
    'certificateType', v_row.tipo_certificado,
    'category', v_row.categoria,
    'certificateNumber', coalesce(v_row.numero_certificado, ''),
    'issuer', coalesce(v_row.entidade_emissora, ''),
    'issueDate', coalesce(to_char(v_row.data_emissao, 'YYYY-MM-DD'), ''),
    'expiryDate', coalesce(to_char(v_row.data_validade, 'YYYY-MM-DD'), ''),
    'notes', coalesce(v_row.observacoes, ''),
    'fileName', coalesce(v_row.nome_ficheiro, ''),
    'fileType', coalesce(v_row.tipo_mime, ''),
    'fileSize', coalesce(v_row.tamanho_bytes, 0),
    'hasFile', (v_row.caminho_storage is not null and v_row.caminho_storage <> ''),
    'createdAt', to_char(v_row.criado_em, 'YYYY-MM-DD')
  );
end;
$$;

create or replace function public.spark_erp_get_technical_certificate_file(p_code text)
returns jsonb
language sql
security definer
set search_path = operacional, public
as $$
  select jsonb_build_object(
    'id', rc.codigo_certificado,
    'fileName', coalesce(rc.nome_ficheiro, rc.codigo_certificado || '.pdf'),
    'fileType', coalesce(rc.tipo_mime, 'application/pdf'),
    'fileSize', coalesce(rc.tamanho_bytes, 0),
    'storagePath', rc.caminho_storage
  )
  from operacional.responsaveis_certificados rc
  where rc.codigo_certificado = p_code or rc.id::text = p_code
  limit 1;
$$;

create or replace function public.spark_erp_delete_technical_certificate(p_code text)
returns text
language plpgsql
security definer
set search_path = operacional, public
as $$
declare
  v_path text;
begin
  delete from operacional.responsaveis_certificados
  where codigo_certificado = p_code or id::text = p_code
  returning caminho_storage into v_path;
  return v_path;
end;
$$;

-- Acesso estritamente reservado ao backend autenticado (service_role)
revoke all on function public.spark_erp_snapshot(boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.spark_erp_upsert_technical_manager(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_technical_manager(text) from public, anon, authenticated;
revoke all on function public.spark_erp_upsert_technical_certificate(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_get_technical_certificate_file(text) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_technical_certificate(text) from public, anon, authenticated;

grant execute on function public.spark_erp_snapshot(boolean, boolean, boolean) to service_role;
grant execute on function public.spark_erp_upsert_technical_manager(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_delete_technical_manager(text) to service_role;
grant execute on function public.spark_erp_upsert_technical_certificate(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_get_technical_certificate_file(text) to service_role;
grant execute on function public.spark_erp_delete_technical_certificate(text) to service_role;
