-- ============================================================================
-- SPARK & SMIRK — CORREÇÃO DEFINITIVA DE CONSTRAINTS E RECIBOS ANEXADOS (RH)
-- Pasta: supabase/02-recursos-humanos/07-fix-recibos-constraints.sql
-- Execute este ficheiro no SQL Editor do Supabase (após 06-contratos-funcionarios.sql).
-- ============================================================================

-- 1. Garantir colunas e remover constraint legado (1 recibo/mês) se ainda existir
alter table rh.recibos_vencimento
  add column if not exists codigo_recibo text,
  add column if not exists ss_valor numeric(12, 2) not null default 0,
  add column if not exists irs_valor numeric(12, 2) not null default 0,
  add column if not exists outras_deducoes numeric(12, 2) not null default 0,
  add column if not exists notas text;

alter table rh.recibos_anexados
  add column if not exists codigo_anexo text,
  add column if not exists codigo_recibo_ref text,
  add column if not exists tamanho_bytes bigint default 0;

alter table operacional.pagamentos_obras
  add column if not exists codigo_pagamento text;

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

-- 2. Substituir índices parciais (WHERE ... IS NOT NULL) por índices UNIQUE completos
--    (Em PostgreSQL, índices parciais falham com 42P10 em ON CONFLICT (col) sem predicado)
drop index if exists rh.idx_recibos_codigo_unique;
create unique index idx_recibos_codigo_unique
  on rh.recibos_vencimento (codigo_recibo);

drop index if exists rh.idx_anexados_codigo_unique;
create unique index idx_anexados_codigo_unique
  on rh.recibos_anexados (codigo_anexo);

drop index if exists operacional.idx_pagamentos_codigo_unique;
create unique index idx_pagamentos_codigo_unique
  on operacional.pagamentos_obras (codigo_pagamento);

-- 3. Tornar as RPCs de recibos e anexos 100% imunes a erros de ON CONFLICT
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
  v_base numeric := coalesce((p_payload->>'baseSalary')::numeric, 0);
  v_meal numeric := coalesce((p_payload->>'mealAllowanceTotal')::numeric, 0);
  v_bonus numeric := coalesce((p_payload->>'overtimeBonus')::numeric, 0);
  v_ss numeric := coalesce((p_payload->>'socialSecurity')::numeric, 0);
  v_irs numeric := coalesce((p_payload->>'irsRetention')::numeric, 0);
  v_other numeric := coalesce((p_payload->>'otherDeductions')::numeric, 0);
  v_net numeric := coalesce((p_payload->>'netSalary')::numeric, 0);
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
      horas_extra_valor, ss_valor, irs_valor, outras_deducoes,
      total_bruto, total_liquido, estado_pagamento, data_pagamento, notas, emitido_por
    )
    values (
      v_code, v_emp_id, v_ano, v_mes, v_base, v_meal,
      v_bonus, v_ss, v_irs, v_other,
      v_base + v_meal + v_bonus, v_net,
      v_status,
      v_pay_date,
      v_notes,
      p_actor
    )
    returning * into v_row;
  end if;

  return jsonb_build_object('id', coalesce(v_row.codigo_recibo, v_row.id::text), 'dbId', v_row.id);
end;
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
  v_file_name text := coalesce(nullif(p_payload->>'fileName', ''), 'recibo.pdf');
  v_file_type text := coalesce(nullif(p_payload->>'fileType', ''), 'application/pdf');
  v_storage_path text := p_payload->>'storagePath';
  v_size_label text := round(v_size_bytes / 1024.0)::text || ' KB';
  v_row rh.recibos_anexados;
begin
  select id into v_emp_id from rh.funcionarios where codigo_interno = v_emp_code or id::text = v_emp_code limit 1;
  if v_emp_id is null then
    raise exception 'Funcionário associado ao recibo não encontrado.';
  end if;

  if v_rec_code is not null then
    select id into v_rec_id from rh.recibos_vencimento where codigo_recibo = v_rec_code or id::text = v_rec_code limit 1;
  end if;

  update rh.recibos_anexados
  set
    codigo_anexo = coalesce(codigo_anexo, v_code),
    funcionario_id = v_emp_id,
    recibo_id = coalesce(v_rec_id, recibo_id),
    codigo_recibo_ref = coalesce(v_rec_code, codigo_recibo_ref),
    ano = v_ano,
    mes = v_mes,
    nome_ficheiro = v_file_name,
    tamanho_legivel = v_size_label,
    tamanho_bytes = v_size_bytes,
    tipo_mime = v_file_type,
    caminho_storage = v_storage_path
  where codigo_anexo = v_code or id::text = v_code
  returning * into v_row;

  if not found then
    insert into rh.recibos_anexados (
      codigo_anexo, funcionario_id, recibo_id, codigo_recibo_ref,
      ano, mes, nome_ficheiro, tamanho_legivel, tamanho_bytes,
      tipo_mime, caminho_storage, anexado_por
    )
    values (
      v_code, v_emp_id, v_rec_id, v_rec_code,
      v_ano, v_mes,
      v_file_name,
      v_size_label,
      v_size_bytes,
      v_file_type,
      v_storage_path,
      p_actor
    )
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', coalesce(v_row.codigo_anexo, v_row.id::text),
    'storagePath', v_row.caminho_storage
  );
end;
$$;

revoke all on function public.spark_erp_upsert_payslip(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.spark_erp_add_attachment(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.spark_erp_upsert_payslip(jsonb, uuid) to service_role;
grant execute on function public.spark_erp_add_attachment(jsonb, uuid) to service_role;
