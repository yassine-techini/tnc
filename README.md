# 🪙 TNC Trading - Plateforme de Tokenisation d'Or

> **Plateforme d'investissement souveraine permettant aux citoyens du Burkina Faso d'investir dans l'or national via des tokens représentant 1 gramme d'or physique.**

[![License](https://img.shields.io/badge/License-Proprietary-red.svg)]()
[![Version](https://img.shields.io/badge/Version-1.0.0-blue.svg)]()
[![Status](https://img.shields.io/badge/Status-Development-yellow.svg)]()

## 📋 Table des Matières

- [Vision du Projet](#-vision-du-projet)
- [Architecture](#-architecture)
- [Stack Technologique](#-stack-technologique)
- [Démarrage Rapide](#-démarrage-rapide)
- [Structure du Projet](#-structure-du-projet)
- [Développement](#-développement)
- [Déploiement](#-déploiement)
- [Documentation](#-documentation)

## 🎯 Vision du Projet

TNC Trading transforme la relation entre les citoyens et les ressources naturelles de leur pays :

- **1 Token = 1 Gramme d'Or** physique stocké au Burkina Faso
- **Accessibilité** : Investissement dès 1 gramme via smartphone
- **Souveraineté** : L'or reste sur le territoire national
- **Finance Éthique** : Pas de spéculation, pas d'effet de levier
- **Transparence** : Proof of Reserve mensuel audité

### Parties Prenantes

| Acteur | Bénéfices |
|--------|-----------|
| 🧑‍🤝‍🧑 Citoyens | Épargne sécurisée, protection contre l'inflation |
| 🏛️ État | Valorisation des ressources, inclusion financière |
| 🌍 Diaspora | Investissement patriotique, lien avec le pays |
| 💼 TNC Trading | Modèle économique viable via le spread |

## 🏗 Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                          CLIENTS                                    │
├──────────────────┬──────────────────┬───────────────────────────────┤
│   Web App (PWA)  │  Mobile (Expo)   │   Admin / État Portal         │
│   React + Vite   │  React Native    │   React + Tailwind            │
└────────────────────────────────────────────────────────────────────┘
                              │ HTTPS
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE EDGE                                  │
├────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐              │
│  │ Workers  │  │   KV    │  │   D1    │  │    R2    │              │
│  │ (HonoJS) │  │ (Cache) │  │ (SQLite)│  │ (Storage)│              │
│  └──────────┘  └─────────┘  └─────────┘  └──────────┘              │
│  ┌──────────┐  ┌─────────────────────┐  ┌──────────┐               │
│  │  Queues  │  │  Durable Objects    │  │  Access  │               │
│  │  (Jobs)  │  │  (Realtime State)   │  │  (Auth)  │               │
│  └──────────┘  └─────────────────────┘  └──────────┘               │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                    SERVICES EXTERNES                                │
├──────────────────┬──────────────────┬───────────────────────────────┤
│  💰 Paiements    │  🔐 KYC          │  📊 Prix Or                   │
│  Orange Money    │  Smile Identity  │  GoldAPI.io                   │
│  Moov Money      │                  │                               │
│  CinetPay        │                  │                               │
└────────────────────────────────────────────────────────────────────┘
```

## 🛠 Stack Technologique

### Frontend
| Technologie | Usage |
|-------------|-------|
| **React 18** | UI Library |
| **Vite** | Build tool |
| **Tailwind CSS** | Styling |
| **Zustand** | State management |
| **TanStack Query** | Data fetching |
| **React Hook Form + Zod** | Forms & validation |

### Mobile
| Technologie | Usage |
|-------------|-------|
| **React Native** | Cross-platform mobile |
| **Expo SDK 50+** | Development platform |
| **React Navigation 6** | Navigation |
| **Expo Secure Store** | Secure storage |

### Backend
| Technologie | Usage |
|-------------|-------|
| **Cloudflare Workers** | Serverless compute |
| **HonoJS** | Web framework |
| **Cloudflare D1** | SQLite database |
| **Cloudflare KV** | Key-value cache |
| **Cloudflare R2** | Object storage |
| **Cloudflare Queues** | Async jobs |

### Outils
| Technologie | Usage |
|-------------|-------|
| **TypeScript** | Type safety |
| **pnpm** | Package manager |
| **Turborepo** | Monorepo build |
| **Biome** | Linting & formatting |
| **Vitest** | Unit testing |
| **Playwright** | E2E testing |

## 🚀 Démarrage Rapide

### Prérequis

- Node.js 20+
- pnpm 8+
- Wrangler CLI
- Compte Cloudflare (avec Workers, D1, KV, R2)
- Expo CLI (pour mobile)

### Installation

```bash
# Cloner le repository
git clone https://github.com/tnc-trading/platform.git
cd platform

# Installer les dépendances
pnpm install

# Configurer les variables d'environnement
cp .env.example .env.local
# Éditer .env.local avec vos clés API

# Créer la base de données D1
pnpm db:create

# Appliquer les migrations
pnpm db:migrate

# Lancer le développement
pnpm dev
```

### Variables d'Environnement

```bash
# .env.local

# Cloudflare
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token

# API Prix Or
GOLD_API_KEY=your_goldapi_key

# KYC Provider
SMILE_IDENTITY_API_KEY=your_smile_key
SMILE_IDENTITY_PARTNER_ID=your_partner_id

# Paiements
ORANGE_MONEY_API_KEY=your_orange_key
MOOV_MONEY_API_KEY=your_moov_key
CINETPAY_API_KEY=your_cinetpay_key
CINETPAY_SITE_ID=your_site_id

# Notifications
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
RESEND_API_KEY=your_resend_key

# Security
JWT_SECRET=your_jwt_secret_min_32_chars
ENCRYPTION_KEY=your_encryption_key_32_chars
```

## 📁 Structure du Projet

```
tnc-trading/
├── apps/
│   ├── web/                 # Application web (PWA)
│   ├── mobile/              # Application mobile (Expo)
│   ├── admin/               # Back-office administrateur
│   └── state-portal/        # Portail État (lecture seule)
│
├── packages/
│   ├── api/                 # API Backend (Cloudflare Workers)
│   ├── shared/              # Types, validateurs, utilitaires
│   └── ui/                  # Composants UI partagés
│
├── specs/                   # Spécifications Speckit
│   ├── features/            # User stories par feature
│   ├── api/                 # OpenAPI specifications
│   └── db/                  # Database schemas
│
├── docs/                    # Documentation
├── scripts/                 # Scripts utilitaires
├── CLAUDE.md               # Instructions Claude Code
├── speckit.yaml            # Configuration Speckit
└── package.json            # Workspace root
```

## 💻 Développement

### Commandes Principales

```bash
# Développement
pnpm dev              # Tout lancer
pnpm dev:web          # Web uniquement
pnpm dev:mobile       # Mobile uniquement
pnpm dev:api          # API uniquement

# Tests
pnpm test             # Tous les tests
pnpm test:unit        # Tests unitaires
pnpm test:e2e         # Tests E2E

# Build
pnpm build            # Build production
pnpm typecheck        # Vérification TypeScript
pnpm lint             # Linting

# Base de données
pnpm db:migrate       # Appliquer migrations
pnpm db:seed          # Données de test
pnpm db:studio        # Interface D1
```

### Workflow Git

```bash
main          # Production
├── staging   # Pre-production
└── develop   # Development
    └── feature/xxx  # Features en cours
```

### Conventions de Code

- **Commits** : Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)
- **Branches** : `feature/`, `bugfix/`, `hotfix/`
- **TypeScript** : Strict mode activé
- **Formatting** : Biome (auto-format on save)

## 🚢 Déploiement

### Cloudflare Pages (Frontend)

```bash
# Build et déploiement
pnpm deploy:web

# Configuration dans wrangler.toml
[site]
bucket = "./apps/web/dist"
```

### Cloudflare Workers (API)

```bash
# Déploiement staging
pnpm deploy:api:staging

# Déploiement production
pnpm deploy:api:prod
```

### Mobile (EAS Build)

```bash
# Build iOS
eas build --platform ios

# Build Android
eas build --platform android

# Submit to stores
eas submit
```

## 📚 Documentation

- [CLAUDE.md](./CLAUDE.md) - Instructions pour Claude Code
- [specs/](./specs/) - Spécifications Speckit complètes
- [docs/api/](./docs/api/) - Documentation API (OpenAPI)
- [docs/architecture/](./docs/architecture/) - Architecture Decision Records

## 🔒 Sécurité

Ce projet traite des données financières sensibles. Merci de :

- Ne jamais commiter de secrets ou clés API
- Signaler toute vulnérabilité via security@tnc-trading.com
- Suivre les guidelines OWASP

## 📄 Licence

Propriétaire - TNC Trading © 2026

---

**Développé avec ❤️ par [DevFactory](https://devfactory.io)**
