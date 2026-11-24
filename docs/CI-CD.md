# Arquitetura CI/CD — GitHub → Firebase (`spark-smirk`)

Este documento descreve o pipeline automatizado de Integração Contínua e Entrega Contínua (**CI/CD**) entre o repositório GitHub (`https://github.com/Metaclass-sistemas661/spark-smirk.git`) e o projeto Firebase **`spark-smirk`**.

---

## 1. Fluxo do Pipeline (`.github/workflows/ci-cd.yml`)

```
[Pull Request → main]
   └─► quality-and-build ──► deploy-preview (Canal temporário Firebase Hosting, 7 dias)

[Push na branch main  ou  Execução Manual]
   └─► quality-and-build ──► deploy-production (Hosting + Cloud Functions v2 + Smoke Tests)
```

### Etapas e Proteções Implementadas

1. **Bloqueio Anti-Fuga de Segredos:** garante que nenhum ficheiro `.env` privado está versionado no Git e verifica após o build que a string `service_role` nunca aparece na pasta pública `dist/`.
2. **Quality Gate (`npm run lint:ci`):** valida CSS de gestão/login com Stylelint, JavaScript com ESLint e a sintaxe de `functions/index.js`.
3. **Build Verificado (Vite MPA):** compila e valida a presença dos três entrypoints (`dist/index.html`, `dist/login/index.html`, `dist/gestao/index.html`) e passa o artefacto imutável ao job de deploy.
4. **Preview Automático em Pull Requests:** cada PR gera um URL de pré-visualização efémero no Firebase Hosting sem afetar produção.
5. **Deploy Unificado em Produção (`functions,hosting`):** publica Hosting + Cloud Function v2 `api` (`europe-west1`) utilizando a Service Account Google Cloud e sem expor credenciais no cliente.
6. **Smoke Tests Pós-Deploy:** testa em produção (`https://sparksmirk.pt` e `https://www.sparksmirk.pt`):
   - HTTP `200` em `/`, `/login/` e `/gestao/`
   - HTTP `200` em `/api/auth/config` com JSON válido
   - HTTP `401` em `POST /api/auth/verify` sem token Bearer (com `Origin: https://sparksmirk.pt` e `https://www.sparksmirk.pt`, confirmando CORS autorizado e barreira ativa)

---

## 2. Configuração Única Obrigatória no GitHub

### A. Secret Obrigatório (`Settings → Secrets and variables → Actions → Repository secrets`)

Crie o secret **`FIREBASE_SERVICE_ACCOUNT_SPARK_SMIRK`** contendo o JSON completo da **Service Account** do projeto Google Cloud / Firebase `spark-smirk` com permissões para Hosting, Cloud Functions, Artifact Registry, Cloud Build e Secret Manager (`Firebase Admin`, `Cloud Functions Admin`, `Service Account User`, `Artifact Registry Admin`, `Firebase Hosting Admin`).

> **Nota:** Para criar ou obter uma chave JSON de Service Account no Google Cloud / Firebase:
> **Firebase Console → Project Settings → Service accounts → Generate new private key** (ou Google Cloud IAM → Service Accounts).

### B. Variáveis Opcionais (`Settings → Secrets and variables → Actions → Variables`)

Em produção, as credenciais do Supabase (`url` e `anonKey`) já vêm automaticamente em runtime do **Firebase Secret Manager** (`/api/auth/config`). Caso deseje também embutir a configuração pública da Firebase Web App no build Vite, defina as seguintes *Variables* (não são segredos):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

### C. Environment `production` (`Settings → Environments`)

Recomenda-se criar o ambiente **`production`** e opcionalmente ativar **Required reviewers** para exigir aprovação humana antes de aplicar alterações em produção.

---

## 3. Workflows e Ficheiros Complementares

- [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml) — Pipeline principal de CI/CD.
- [`.github/workflows/security-audit.yml`](../.github/workflows/security-audit.yml) — Auditoria semanal de vulnerabilidades (`npm audit --audit-level=high`).
- [`.github/dependabot.yml`](../.github/dependabot.yml) — Atualizações automáticas semanais para npm raiz, `functions/` e GitHub Actions.
- [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md) — Checklist padrão para Pull Requests.
