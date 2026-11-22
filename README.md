# 🏗️ Spark & Smirk — Landing Page

> **Engenharia, Construção Civil e Jardinagem** | Portugal

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite)
![GSAP](https://img.shields.io/badge/GSAP-3.12-88CE02?logo=greensock)
![Firebase](https://img.shields.io/badge/Firebase-Hosting-FFCA28?logo=firebase)

---

## 🚀 Quick Start

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor de desenvolvimento
npm run dev

# A aplicação abre automaticamente em http://localhost:3000
```

---

## 📦 Scripts Disponíveis

### Desenvolvimento
| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Servidor de desenvolvimento com hot reload |
| `npm run preview` | Preview do build de produção local |

### Build
| Comando | Descrição |
|---------|-----------|
| `npm run build` | Build de produção otimizado |
| `npm run build:prod` | Build completo com lint |
| `npm run clean` | Limpar pasta dist |

### Qualidade de Código
| Comando | Descrição |
|---------|-----------|
| `npm run lint` | Lint CSS + JS |
| `npm run lint:css` | Lint apenas CSS |
| `npm run lint:js` | Lint apenas JS |
| `npm run format` | Formatar código com Prettier |

### Firebase Deploy
| Comando | Descrição |
|---------|-----------|
| `npm run firebase:login` | Login no Firebase |
| `npm run firebase:init` | Inicializar projeto Firebase |
| `npm run deploy` | **Build + Deploy para produção** |
| `npm run deploy:preview` | Deploy para URL de preview (expira em 7 dias) |

---

## 🔥 Deploy no Firebase

### Primeira vez? Siga estes passos:

```bash
# 1. Instalar dependências
npm install

# 2. Fazer login no Firebase (abre o browser)
npm run firebase:login

# 3. Criar projeto no Firebase Console (se ainda não tiver)
# Acesse: https://console.firebase.google.com/
# Crie um novo projeto chamado "spark-smirk" (ou outro nome)

# 4. Atualizar o .firebaserc com o nome do seu projeto
# Edite o arquivo .firebaserc e substitua "spark-smirk" pelo ID do seu projeto

# 5. Deploy! 🚀
npm run deploy
```

### Deploys subsequentes:

```bash
# Deploy direto para produção
npm run deploy

# Ou deploy para preview (gera URL temporária)
npm run deploy:preview
```

### Após o deploy, seu site estará em:
- **Produção:** `https://seu-projeto.web.app`
- **Preview:** `https://seu-projeto--preview-xxxxx.web.app`

---

## 🛠️ Tech Stack

### Core
- **HTML5** — Semântico e acessível
- **CSS3** — Custom Properties, Grid, Flexbox
- **JavaScript ES6+** — Modules

### Bibliotecas
- **[GSAP 3.12](https://greensock.com/gsap/)** — Animações profissionais
- **[ScrollTrigger](https://greensock.com/scrolltrigger/)** — Animações baseadas em scroll
- **[Lenis](https://lenis.studiofreight.com/)** — Smooth scroll premium

### Build Tools
- **[Vite 5](https://vitejs.dev/)** — Build tool ultrarrápido
- **[PostCSS](https://postcss.org/)** — Processamento CSS
- **[Autoprefixer](https://autoprefixer.github.io/)** — Vendor prefixes automáticos
- **[cssnano](https://cssnano.co/)** — Minificação CSS
- **[Terser](https://terser.org/)** — Minificação JS

### Hosting
- **[Firebase Hosting](https://firebase.google.com/docs/hosting)** — CDN global, SSL gratuito

### Qualidade de Código
- **[ESLint](https://eslint.org/)** — Linting JavaScript
- **[Stylelint](https://stylelint.io/)** — Linting CSS
- **[Prettier](https://prettier.io/)** — Formatação de código

---

## 📁 Estrutura do Projeto

```
spark-smirk/
├── assets/
│   ├── fonts/          # Fontes locais
│   ├── images/         # Imagens e fotos
│   └── svg/            # Ícones SVG
├── css/
│   ├── base/           # Reset, variáveis
│   ├── layouts/        # Layouts de seções
│   ├── components/     # Estilos por componente
│   ├── animations/     # Classes de animação
│   └── main.css        # Ponto de entrada CSS
├── js/
│   ├── core/           # Smooth scroll, animações
│   ├── components/     # Componentes JS
│   └── main.js         # Ponto de entrada JS
├── dist/               # Build de produção (gerado)
├── index.html          # Página principal
├── vite.config.js      # Configuração Vite
├── firebase.json       # Configuração Firebase Hosting
├── .firebaserc         # Projeto Firebase
├── package.json        # Dependências
└── README.md           # Documentação
```

---

## 🎨 Design System

### Cores
```css
--color-primary: #E8650A;     /* Laranja — Energia */
--color-secondary: #0C1829;   /* Azul Petróleo — Profissional */
--color-accent: #D4A03C;      /* Dourado — Destaque */
```

### Tipografia
- **Headings:** Montserrat (600-900)
- **Body:** Inter (400-600)

---

## 📱 Responsividade

- **Desktop:** 1200px+
- **Laptop:** 1024px
- **Tablet:** 768px
- **Mobile:** 640px
- **Small Mobile:** 480px

---

## 🔧 Configuração de Ambiente

### Requisitos
- Node.js >= 18.0.0
- npm >= 9.0.0
- Conta no Firebase (gratuita)

### Variáveis de Ambiente (opcional)
Crie um arquivo `.env.local`:
```env
VITE_APP_TITLE=Spark & Smirk
VITE_WHATSAPP_NUMBER=351965834197
```

---

## 📦 Build de Produção

```bash
# Build otimizado
npm run build

# O output vai para a pasta /dist com:
# ✓ HTML minificado
# ✓ CSS minificado + autoprefixed
# ✓ JS minificado + tree-shaking
# ✓ Assets otimizados
# ✓ Compressão Gzip + Brotli
# ✓ Vendor chunks separados (GSAP, Lenis)
```

---

## 🌐 Domínio Personalizado (Firebase)

Após o primeiro deploy, configure seu domínio:

1. Acesse [Firebase Console](https://console.firebase.google.com/)
2. Selecione seu projeto → Hosting → Adicionar domínio personalizado
3. Siga as instruções para verificar o DNS
4. Firebase gera SSL automático (gratuito)

---

## 📞 Contacto

- **Email:** info.sparksmirk@gmail.com
- **Tel:** (+351) 965 834 197
- **Tel:** (+351) 926 323 726
- **Tel:** (+351) 935 692 377

---

## 📄 Licença

MIT © 2025 Spark & Smirk, Lda.

