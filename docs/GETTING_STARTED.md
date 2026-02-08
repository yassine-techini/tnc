# Guide de Démarrage - TNC Trading

Ce guide vous aidera à configurer votre environnement de développement et à comprendre le projet.

## Table des Matières

1. [Prérequis](#prérequis)
2. [Installation](#installation)
3. [Structure du Projet](#structure-du-projet)
4. [Configuration](#configuration)
5. [Développement](#développement)
6. [Tests](#tests)
7. [Conventions](#conventions)
8. [Ressources](#ressources)

---

## Prérequis

### Outils Requis

| Outil | Version | Installation |
|-------|---------|--------------|
| Node.js | >= 20.0.0 | [nodejs.org](https://nodejs.org/) |
| pnpm | >= 8.0.0 | `npm install -g pnpm` |
| Git | >= 2.40 | [git-scm.com](https://git-scm.com/) |
| VS Code | Latest | [code.visualstudio.com](https://code.visualstudio.com/) |

### Extensions VS Code Recommandées

```json
{
  "recommendations": [
    "biomejs.biome",
    "bradlc.vscode-tailwindcss",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "mikestead.dotenv",
    "prisma.prisma"
  ]
}
```

### Comptes Nécessaires (pour déploiement)

- [Cloudflare](https://cloudflare.com) - Workers, D1, KV, R2
- [Expo](https://expo.dev) - Build mobile

---

## Installation

### 1. Cloner le Repository

```bash
git clone https://github.com/tnc-trading/platform.git
cd platform
```

### 2. Installer les Dépendances

```bash
# Installer pnpm si nécessaire
npm install -g pnpm

# Installer toutes les dépendances
pnpm install
```

### 3. Configurer l'Environnement

```bash
# Copier les fichiers d'environnement
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/state-portal/.env.example apps/state-portal/.env.local
```

### 4. Configurer Wrangler (API)

```bash
# Se connecter à Cloudflare
npx wrangler login

# Créer la base de données D1 (première fois)
pnpm db:create

# Appliquer les migrations
pnpm db:migrate
```

### 5. Lancer le Développement

```bash
# Lancer tous les services
pnpm dev

# Ou individuellement
pnpm dev:api    # API sur http://localhost:8787
pnpm dev:web    # Web sur http://localhost:5173
pnpm dev:admin  # Admin sur http://localhost:5174
```

---

## Structure du Projet

```
tnc-trading/
│
├── apps/                        # Applications
│   ├── web/                     # App client (React + Vite)
│   │   ├── src/
│   │   │   ├── components/      # Composants React
│   │   │   ├── pages/           # Pages/Routes
│   │   │   ├── hooks/           # Custom hooks
│   │   │   ├── stores/          # Zustand stores
│   │   │   ├── lib/             # Utilitaires
│   │   │   └── api/             # Client API
│   │   └── package.json
│   │
│   ├── admin/                   # Back-office admin
│   ├── state-portal/            # Portail État
│   ├── mobile/                  # App mobile (Expo)
│   └── landing/                 # Page marketing
│
├── packages/                    # Packages partagés
│   ├── api/                     # Backend API
│   │   ├── src/
│   │   │   ├── routes/          # Endpoints API
│   │   │   ├── middleware/      # Auth, validation, etc.
│   │   │   ├── services/        # Logique métier
│   │   │   ├── durable-objects/ # État temps réel
│   │   │   ├── lib/             # Utilitaires
│   │   │   └── types/           # Types TypeScript
│   │   ├── migrations/          # Migrations D1
│   │   ├── test/                # Tests unitaires
│   │   └── wrangler.toml        # Config Cloudflare
│   │
│   ├── shared/                  # Types et utils partagés
│   │   ├── src/
│   │   │   ├── types/           # Types TypeScript
│   │   │   ├── validators/      # Schémas Zod
│   │   │   └── utils/           # Fonctions utilitaires
│   │   └── package.json
│   │
│   └── ui/                      # Composants UI partagés
│
├── docs/                        # Documentation
│   ├── ARCHITECTURE.md          # Architecture technique
│   ├── GETTING_STARTED.md       # Ce fichier
│   ├── API.md                   # Documentation API
│   ├── SECURITY.md              # Sécurité
│   └── deployment.md            # Déploiement
│
├── .github/                     # GitHub Actions (désactivé)
├── CLAUDE.md                    # Instructions Claude Code
├── package.json                 # Workspace root
├── pnpm-workspace.yaml          # Config pnpm
└── turbo.json                   # Config Turborepo
```

---

## Configuration

### Variables d'Environnement

#### Frontend (apps/web, admin, state-portal)

```bash
# .env.local
VITE_API_URL=http://localhost:8787
VITE_ENVIRONMENT=development
```

#### Backend (packages/api)

Les secrets sont configurés dans `wrangler.toml` ou via l'interface admin :

```toml
# wrangler.toml (développement)
[vars]
ENVIRONMENT = "development"
JWT_SECRET = "dev-secret-minimum-32-characters-long"
ENCRYPTION_KEY = "dev-encryption-key-32-chars-xx"
```

Pour la production, les clés API sont configurées via l'interface super admin dans la table `config`.

### Base de Données

#### Créer une migration

```bash
cd packages/api

# Créer un nouveau fichier de migration
touch migrations/XXXX_description.sql
```

#### Appliquer les migrations

```bash
# Local
pnpm db:migrate

# Production
pnpm db:migrate:prod
```

---

## Développement

### Commandes Principales

| Commande | Description |
|----------|-------------|
| `pnpm dev` | Lance tous les services |
| `pnpm build` | Build de production |
| `pnpm test` | Exécute les tests |
| `pnpm typecheck` | Vérification TypeScript |
| `pnpm lint` | Linting Biome |
| `pnpm format` | Formatage automatique |

### Workflow Typique

```bash
# 1. Créer une branche
git checkout -b feature/ma-feature

# 2. Développer avec hot-reload
pnpm dev

# 3. Vérifier le code
pnpm typecheck && pnpm lint

# 4. Tester
pnpm test

# 5. Commit
git add .
git commit -m "feat: description de la feature"

# 6. Push et PR
git push origin feature/ma-feature
```

### Ajouter un Endpoint API

1. **Créer la route** dans `packages/api/src/routes/`

```typescript
// packages/api/src/routes/example.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types/env';
import { authMiddleware } from '../middleware/auth';

const example = new Hono<AppEnv>();

// Schema de validation
const createSchema = z.object({
  name: z.string().min(1),
});

// Route protégée
example.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');

  // Logique métier...

  return c.json({
    success: true,
    data: { /* ... */ },
    requestId: crypto.randomUUID(),
  });
});

export const exampleRoutes = example;
```

2. **Enregistrer la route** dans `packages/api/src/index.ts`

```typescript
import { exampleRoutes } from './routes/example';

// ...

api.route('/example', exampleRoutes);
```

3. **Ajouter les tests** dans `packages/api/test/`

### Ajouter un Service

```typescript
// packages/api/src/services/example.service.ts
export class ExampleService {
  constructor(
    private db: D1Database,
    private cache: KVNamespace
  ) {}

  async doSomething(input: string): Promise<Result> {
    // 1. Vérifier le cache
    const cached = await this.cache.get(`example:${input}`);
    if (cached) return JSON.parse(cached);

    // 2. Requête DB
    const result = await this.db
      .prepare('SELECT * FROM examples WHERE name = ?')
      .bind(input)
      .first();

    // 3. Mettre en cache
    await this.cache.put(
      `example:${input}`,
      JSON.stringify(result),
      { expirationTtl: 300 }
    );

    return result;
  }
}
```

---

## Tests

### Structure des Tests

```
packages/api/
├── test/
│   ├── auth.service.test.ts
│   ├── market.service.test.ts
│   ├── wallet.service.test.ts
│   └── ...
└── src/
    ├── lib/
    │   └── rbac.test.ts       # Tests co-localisés
    └── middleware/
        └── rbac.test.ts
```

### Exécuter les Tests

```bash
# Tous les tests
pnpm test

# Tests d'un package spécifique
pnpm --filter @tnc-trading/api test

# Tests avec couverture
pnpm test:coverage

# Mode watch
pnpm --filter @tnc-trading/api test -- --watch
```

### Écrire un Test

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExampleService } from '../src/services/example.service';

describe('ExampleService', () => {
  let service: ExampleService;
  let mockDb: any;
  let mockCache: any;

  beforeEach(() => {
    mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    };
    mockCache = {
      get: vi.fn(),
      put: vi.fn(),
    };
    service = new ExampleService(mockDb, mockCache);
  });

  it('should return cached result if available', async () => {
    mockCache.get.mockResolvedValue('{"id": 1}');

    const result = await service.doSomething('test');

    expect(result).toEqual({ id: 1 });
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });
});
```

---

## Conventions

### Commits

Utiliser [Conventional Commits](https://www.conventionalcommits.org/) :

```
feat: ajoute la fonctionnalité X
fix: corrige le bug Y
docs: met à jour la documentation
refactor: restructure le code sans changer le comportement
test: ajoute des tests
chore: maintenance (deps, config, etc.)
```

### Branches

```
main              # Production
├── develop       # Développement
    ├── feature/  # Nouvelles fonctionnalités
    ├── bugfix/   # Corrections de bugs
    └── hotfix/   # Corrections urgentes
```

### Code Style

- **TypeScript** : Strict mode activé
- **Formatage** : Biome (auto-format on save)
- **Imports** : Absolus avec alias `@/`
- **Naming** :
  - camelCase pour variables/fonctions
  - PascalCase pour classes/composants
  - SCREAMING_SNAKE_CASE pour constantes

---

## Ressources

### Documentation Externe

- [HonoJS](https://hono.dev/) - Framework API
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [React](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Zustand](https://zustand-demo.pmnd.rs/)
- [React Query](https://tanstack.com/query)

### Documentation Interne

- [CLAUDE.md](../CLAUDE.md) - Instructions pour Claude Code
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Architecture technique
- [API.md](./API.md) - Documentation API
- [SECURITY.md](./SECURITY.md) - Pratiques de sécurité

### Contacts

- **Lead Dev** : contact@devfactory.io
- **Support** : support@tnc-trading.com
