# Estrutura Modular da Base de Dados — Spark & Smirk (Supabase)

Os scripts SQL estão separados por **schemas PostgreSQL distintos** e organizados em pastas individuais, cada uma responsável por um domínio específico do sistema (evitando misturar tudo num único ficheiro ou apenas no schema `public`).

## Estrutura de Schemas e Pastas

### `00-setup/` — Schemas Base e Permissões
- [`01-schemas-e-permissoes.sql`](./00-setup/01-schemas-e-permissoes.sql) — Cria os schemas `seguranca`, `rh` e `operacional`, bloqueia acesso anónimo (`anon`) e define a função partilhada `seguranca.atualizar_timestamp()`.
- [`02-erp-bridge-e-storage.sql`](./00-setup/02-erp-bridge-e-storage.sql) — Cria o bucket privado `recibos-vencimentos`, endurece políticas RLS granulares por módulo/ação e disponibiliza RPCs transacionais de sincronização para RH e Operacional.

### `01-seguranca/` — Schema `seguranca`
- [`01-utilizadores-perfil.sql`](./01-seguranca/01-utilizadores-perfil.sql) — Tabela `seguranca.perfis_utilizadores` (papéis, permissões granulares JSONB, controlo de senha provisória e ligação a `auth.users`).
- [`02-registos-auditoria.sql`](./01-seguranca/02-registos-auditoria.sql) — Tabela `seguranca.registos_auditoria` (histórico de alterações e acessos).
- [`03-permissoes-e-senha-provisoria.sql`](./01-seguranca/03-permissoes-e-senha-provisoria.sql) — Migração incremental para atualizar `perfis_utilizadores` sem apagar dados existentes.

### `02-recursos-humanos/` — Schema `rh`
- [`01-funcionarios.sql`](./02-recursos-humanos/01-funcionarios.sql) — Tabela `rh.funcionarios` (dados cadastrais, NIF, NISS, IBAN, contrato e salário base).
- [`02-assiduidade.sql`](./02-recursos-humanos/02-assiduidade.sql) — Tabela `rh.assiduidade` (presenças diárias, faltas justificadas/injustificadas, férias e baixas).
- [`03-recibos-vencimento.sql`](./02-recursos-humanos/03-recibos-vencimento.sql) — Tabela `rh.recibos_vencimento` (cálculo mensal de vencimentos, IRS, Segurança Social e líquido).
- [`04-recibos-anexados.sql`](./02-recursos-humanos/04-recibos-anexados.sql) — Tabela `rh.recibos_anexados` (histórico de recibos anexados filtrados por funcionário, ano e mês).

### `03-operacional/` — Schema `operacional`
- [`01-obras.sql`](./03-operacional/01-obras.sql) — Tabela `operacional.obras` (obras em andamento, a iniciar e concluídas).
- [`02-orcamentos.sql`](./03-operacional/02-orcamentos.sql) — Tabelas `operacional.orcamentos` e `operacional.orcamento_itens` (orçamentos e rubricas unitárias).
- [`03-pagamentos-obras.sql`](./03-operacional/03-pagamentos-obras.sql) — Tabela `operacional.pagamentos_obras` (prestações, faturas, datas de vencimento/pagamento e valores em aberto).
- [`04-faturas-obras.sql`](./03-operacional/04-faturas-obras.sql) — Tabela `operacional.faturas_obras`, bucket privado `faturas-obras`, plafond geral da obra e RPCs de cálculo em tempo real de materiais/faturas lançadas.
- [`05-regime-obra-e-contratos.sql`](./03-operacional/05-regime-obra-e-contratos.sql) — Regime de custos (`materiais_funcionarios` / `somente_funcionarios`), valor diário por funcionário, tabela `operacional.contratos_obras` e bucket privado `contratos-obras`.

## Ordem de Execução no SQL Editor do Supabase

Execute exatamente pela numeração das pastas e ficheiros:
1. `00-setup/01-schemas-e-permissoes.sql`
2. `01-seguranca/01-utilizadores-perfil.sql`
3. `01-seguranca/02-registos-auditoria.sql`
4. `02-recursos-humanos/01-funcionarios.sql`
5. `02-recursos-humanos/02-assiduidade.sql`
6. `02-recursos-humanos/03-recibos-vencimento.sql`
7. `02-recursos-humanos/04-recibos-anexados.sql`
8. `03-operacional/01-obras.sql`
9. `03-operacional/02-orcamentos.sql`
10. `03-operacional/03-pagamentos-obras.sql`
11. `03-operacional/04-faturas-obras.sql`
12. `03-operacional/05-regime-obra-e-contratos.sql`

## Expor os Schemas na API do Supabase

Como as tabelas estão organizadas fora de `public` (nos schemas `seguranca`, `rh` e `operacional`), no painel do Supabase vá a:
**Project Settings → Data API (ou API) → Exposed schemas** e adicione:
`public, seguranca, rh, operacional`
