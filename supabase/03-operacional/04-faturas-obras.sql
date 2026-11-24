-- ============================================================================
-- SPARK & SMIRK — FATURAS DE COMPRA & MATERIAIS POR OBRA
-- Pasta: supabase/03-operacional/04-faturas-obras.sql
-- Execute este ficheiro no SQL Editor do Supabase.
-- ============================================================================

-- 1. Suporte opcional a Orçamento Geral / Plafond direto na Obra
alter table operacional.obras
  add column if not exists orcamento_geral_manual numeric(14, 2) not null default 0;

-- 2. Tabela operacional.faturas_obras (controlo de custos/materiais por obra)
create table if not exists operacional.faturas_obras (
  id uuid primary key default gen_random_uuid(),
  codigo_fatura text not null unique,
  obra_id uuid not null references operacional.obras(id) on delete cascade,
  numero_fatura text not null,
  fornecedor text not null,
  fornecedor_nif text,
  categoria text not null default 'Materiais de Construção',
  data_fatura date not null default current_date,
  valor numeric(14, 2) not null check (valor >= 0),
  observacoes text,
  nome_ficheiro text,
  tipo_mime text,
  tamanho_bytes bigint not null default 0,
  caminho_storage text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table operacional.faturas_obras is 'Registo de faturas de compra de materiais, subempreitadas e custos imputados a cada obra com anexo PDF';

create index if not exists idx_faturas_obras_obra on operacional.faturas_obras (obra_id);
create index if not exists idx_faturas_obras_data on operacional.faturas_obras (data_fatura desc);
create index if not exists idx_faturas_obras_codigo on operacional.faturas_obras (codigo_fatura);

drop trigger if exists trg_faturas_obras_updated_at on operacional.faturas_obras;
create trigger trg_faturas_obras_updated_at
  before update on operacional.faturas_obras
  for each row execute function seguranca.atualizar_timestamp();

grant select, insert, update, delete on table operacional.faturas_obras to authenticated;
grant all on table operacional.faturas_obras to service_role;

alter table operacional.faturas_obras enable row level security;

drop policy if exists "RLS operacional.faturas_obras ver" on operacional.faturas_obras;
drop policy if exists "RLS operacional.faturas_obras lancar" on operacional.faturas_obras;
drop policy if exists "RLS operacional.faturas_obras atualizar" on operacional.faturas_obras;
drop policy if exists "RLS operacional.faturas_obras excluir" on operacional.faturas_obras;

create policy "RLS operacional.faturas_obras ver" on operacional.faturas_obras
  for select to authenticated
  using (seguranca.utilizador_tem_permissao('op_obras', 'ver'));

create policy "RLS operacional.faturas_obras lancar" on operacional.faturas_obras
  for insert to authenticated
  with check (seguranca.utilizador_tem_permissao('op_obras', 'faturas'));

create policy "RLS operacional.faturas_obras atualizar" on operacional.faturas_obras
  for update to authenticated
  using (seguranca.utilizador_tem_permissao('op_obras', 'faturas'))
  with check (seguranca.utilizador_tem_permissao('op_obras', 'faturas'));

create policy "RLS operacional.faturas_obras excluir" on operacional.faturas_obras
  for delete to authenticated
  using (
    seguranca.utilizador_tem_permissao('op_obras', 'excluir')
    or seguranca.utilizador_tem_permissao('op_obras', 'faturas')
  );

-- 3. Bucket privado para PDFs/comprovativos das faturas de compra das obras
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'faturas-obras',
  'faturas-obras',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

-- 4. Atualização da RPC de snapshot para incluir faturas das obras e plafond geral
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
  end if;

  return jsonb_build_object(
    'employees', v_employees,
    'attendance', v_attendance,
    'payslips', v_payslips,
    'attachedReceipts', v_attachments,
    'projects', v_projects,
    'projectInvoices', v_project_invoices
  );
end;
$$;

-- 5. Atualização da RPC de upsert de obra para incluir orcamento_geral_manual
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
  v_manual_cap numeric := greatest(0, coalesce((p_payload->>'manualBudgetCap')::numeric, 0));
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_item jsonb;
  v_pay jsonb;
begin
  select coalesce(sum(coalesce((x->>'qty')::numeric, 0) * coalesce((x->>'unitPrice')::numeric, 0)), 0)
  into v_subtotal
  from jsonb_array_elements(v_items) x;

  v_total := round((v_subtotal * (1 + v_cont / 100.0)) * (1 + v_vat / 100.0), 2);
  if v_manual_cap > 0 and v_total = 0 then
    v_total := v_manual_cap;
  end if;

  insert into operacional.obras (
    codigo_obra, nome_obra, cliente_nome, cliente_nif, cliente_telefone, cliente_email,
    localizacao, morada, distrito, categoria, prioridade, estado,
    data_inicio, data_fim_prevista, data_fim_real, progresso_percent,
    responsavel_codigo, equipa_ids, valor_adjudicado, orcamento_geral_manual, orcamento_config, descricao, criado_por
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
    v_manual_cap,
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
    valor_adjudicado = case when p_payload ? 'budget' or p_payload ? 'manualBudgetCap' then excluded.valor_adjudicado else operacional.obras.valor_adjudicado end,
    orcamento_geral_manual = case when p_payload ? 'manualBudgetCap' then excluded.orcamento_geral_manual else operacional.obras.orcamento_geral_manual end,
    orcamento_config = case when p_payload ? 'budget' then excluded.orcamento_config else operacional.obras.orcamento_config end,
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

-- 6. RPCs transacionais de faturas de compra / materiais das obras
create or replace function public.spark_erp_upsert_invoice(p_payload jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = operacional, public
as $$
declare
  v_code text := coalesce(nullif(p_payload->>'id', ''), 'FAT-' || substring(gen_random_uuid()::text, 1, 8));
  v_proj_ref text := trim(coalesce(p_payload->>'projectId', ''));
  v_obra_id uuid;
  v_obra_code text;
  v_row operacional.faturas_obras;
begin
  select id, codigo_obra
  into v_obra_id, v_obra_code
  from operacional.obras
  where codigo_obra = v_proj_ref or id::text = v_proj_ref
  limit 1;

  if v_obra_id is null then
    raise exception 'Obra não encontrada (%)', v_proj_ref;
  end if;

  insert into operacional.faturas_obras (
    codigo_fatura, obra_id, numero_fatura, fornecedor, fornecedor_nif,
    categoria, data_fatura, valor, observacoes,
    nome_ficheiro, tipo_mime, tamanho_bytes, caminho_storage, criado_por
  )
  values (
    v_code,
    v_obra_id,
    coalesce(nullif(trim(p_payload->>'invoiceNumber'), ''), v_code),
    coalesce(nullif(trim(p_payload->>'supplier'), ''), 'Fornecedor'),
    nullif(trim(coalesce(p_payload->>'supplierNif', '')), ''),
    coalesce(nullif(trim(p_payload->>'category'), ''), 'Materiais de Construção'),
    coalesce(nullif(p_payload->>'invoiceDate', '')::date, current_date),
    greatest(0, coalesce((p_payload->>'amount')::numeric, 0)),
    nullif(trim(coalesce(p_payload->>'notes', '')), ''),
    nullif(trim(coalesce(p_payload->>'fileName', '')), ''),
    nullif(trim(coalesce(p_payload->>'fileType', '')), ''),
    greatest(0, coalesce((p_payload->>'fileSize')::bigint, 0)),
    nullif(trim(coalesce(p_payload->>'storagePath', '')), ''),
    p_actor
  )
  on conflict (codigo_fatura) do update set
    numero_fatura = excluded.numero_fatura,
    fornecedor = excluded.fornecedor,
    fornecedor_nif = excluded.fornecedor_nif,
    categoria = excluded.categoria,
    data_fatura = excluded.data_fatura,
    valor = excluded.valor,
    observacoes = excluded.observacoes,
    nome_ficheiro = coalesce(excluded.nome_ficheiro, operacional.faturas_obras.nome_ficheiro),
    tipo_mime = coalesce(excluded.tipo_mime, operacional.faturas_obras.tipo_mime),
    tamanho_bytes = case when excluded.tamanho_bytes > 0 then excluded.tamanho_bytes else operacional.faturas_obras.tamanho_bytes end,
    caminho_storage = coalesce(excluded.caminho_storage, operacional.faturas_obras.caminho_storage),
    atualizado_em = now()
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.codigo_fatura,
    'dbId', v_row.id,
    'projectId', v_obra_code,
    'invoiceNumber', v_row.numero_fatura,
    'supplier', v_row.fornecedor,
    'supplierNif', coalesce(v_row.fornecedor_nif, ''),
    'category', v_row.categoria,
    'invoiceDate', to_char(v_row.data_fatura, 'YYYY-MM-DD'),
    'amount', v_row.valor,
    'notes', coalesce(v_row.observacoes, ''),
    'fileName', coalesce(v_row.nome_ficheiro, ''),
    'fileType', coalesce(v_row.tipo_mime, ''),
    'fileSize', coalesce(v_row.tamanho_bytes, 0),
    'hasFile', (v_row.caminho_storage is not null and v_row.caminho_storage <> ''),
    'createdAt', to_char(v_row.criado_em, 'YYYY-MM-DD')
  );
end;
$$;

create or replace function public.spark_erp_get_invoice_file(p_code text)
returns jsonb
language sql
security definer
set search_path = operacional, public
as $$
  select jsonb_build_object(
    'id', fo.codigo_fatura,
    'fileName', coalesce(fo.nome_ficheiro, fo.codigo_fatura || '.pdf'),
    'fileType', coalesce(fo.tipo_mime, 'application/pdf'),
    'fileSize', coalesce(fo.tamanho_bytes, 0),
    'storagePath', fo.caminho_storage
  )
  from operacional.faturas_obras fo
  where fo.codigo_fatura = p_code or fo.id::text = p_code
  limit 1;
$$;

create or replace function public.spark_erp_delete_invoice(p_code text)
returns text
language plpgsql
security definer
set search_path = operacional, public
as $$
declare
  v_path text;
begin
  delete from operacional.faturas_obras
  where codigo_fatura = p_code or id::text = p_code
  returning caminho_storage into v_path;
  return v_path;
end;
$$;

-- Bloqueia acesso público/anónimo/autenticado às RPCs internas; apenas service_role
revoke all on function public.spark_erp_snapshot(boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.spark_erp_upsert_project(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_upsert_invoice(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_get_invoice_file(text) from public, anon, authenticated;
revoke all on function public.spark_erp_delete_invoice(text) from public, anon, authenticated;

grant execute on function public.spark_erp_snapshot(boolean, boolean, boolean) to service_role;
grant execute on function public.spark_erp_upsert_project(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_upsert_invoice(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_get_invoice_file(text) to service_role;
grant execute on function public.spark_erp_delete_invoice(text) to service_role;
