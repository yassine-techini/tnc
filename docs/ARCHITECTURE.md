# Architecture Technique - TNC Trading

## Vue d'Ensemble

TNC Trading est une plateforme monorepo construite sur l'infrastructure edge de Cloudflare, offrant une latence minimale et une disponibilité mondiale.

## Principes Architecturaux

### 1. Edge-First
Tout le backend s'exécute sur Cloudflare Workers, à proximité des utilisateurs. Aucun serveur centralisé.

### 2. Serverless Natif
- Pas de gestion de serveurs
- Scaling automatique
- Facturation à l'usage

### 3. Type-Safety End-to-End
TypeScript strict du frontend au backend avec types partagés.

### 4. Security by Design
- Chiffrement des données sensibles
- Rate limiting par tier
- Validation Zod sur tous les inputs

---

## Stack Technique Détaillée

### Backend (packages/api)

```
┌─────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKERS                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   HonoJS     │  │  Middleware  │  │   Services   │       │
│  │   Router     │  │    Chain     │  │   (Business) │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                 │                 │                │
│         └─────────────────┴─────────────────┘                │
│                           │                                  │
│  ┌────────────────────────┴────────────────────────────┐    │
│  │                    BINDINGS                          │    │
│  ├──────────┬──────────┬──────────┬──────────┬─────────┤    │
│  │    D1    │    KV    │    R2    │  Queues  │   DO    │    │
│  │ Database │  Cache   │ Storage  │  Jobs    │ Realtime│    │
│  └──────────┴──────────┴──────────┴──────────┴─────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Cloudflare D1 (Base de Données)
- SQLite distribué globalement
- Réplication automatique
- Transactions ACID
- Migrations versionnées

#### Cloudflare KV (Cache)
- Cache distribué key-value
- TTL configurable
- Utilisé pour : sessions, prix or, config, rate limiting

#### Cloudflare R2 (Stockage)
- Compatible S3
- Stockage documents KYC (chiffrés)
- Certificats de propriété

#### Cloudflare Queues (Jobs Asynchrones)
- Notifications email/SMS
- Rapports périodiques
- Réconciliation paiements

#### Durable Objects (État Temps Réel)
- TransactionSession : Verrouillage transactions utilisateur
- AnalyticsHub : Métriques temps réel
- PriceCache : Prix or en temps réel

### Frontend (apps/web, admin, state-portal)

```
┌─────────────────────────────────────────────────────────────┐
│                      REACT APPLICATION                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │    Pages     │  │  Components  │  │    Hooks     │       │
│  │   (Routes)   │  │     (UI)     │  │   (Logic)    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                 │                 │                │
│  ┌──────┴─────────────────┴─────────────────┴──────┐        │
│  │                  STATE LAYER                      │        │
│  ├─────────────────────┬────────────────────────────┤        │
│  │      Zustand        │       React Query          │        │
│  │   (Client State)    │     (Server State)         │        │
│  └─────────────────────┴────────────────────────────┘        │
│                           │                                  │
│  ┌────────────────────────┴────────────────────────────┐    │
│  │                    API CLIENT                        │    │
│  │              (Fetch + Type Safety)                   │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Mobile (apps/mobile)

```
┌─────────────────────────────────────────────────────────────┐
│                    REACT NATIVE + EXPO                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Screens    │  │  Components  │  │  Navigation  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 NATIVE MODULES                         │   │
│  ├──────────┬──────────┬──────────┬──────────┬─────────┤   │
│  │ Biométrie│  Caméra  │  Push    │ Secure   │  SSL    │   │
│  │          │   KYC    │  Notif   │ Store    │ Pinning │   │
│  └──────────┴──────────┴──────────┴──────────┴─────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Flux de Données

### Authentification

```
┌────────┐     ┌─────────┐     ┌──────────┐     ┌────────┐
│ Client │────▶│   API   │────▶│  AuthSvc │────▶│   D1   │
└────────┘     └─────────┘     └──────────┘     └────────┘
    │               │                                │
    │  1. Login     │  2. Verify                    │
    │  email/pass   │  password                     │
    │               │  (Argon2id)                   │
    │               │                                │
    │  5. JWT       │  4. Generate                  │
    │◀──────────────│◀──JWT──────                   │
    │               │                                │
    │  6. Store     │  3. Check 2FA                 │
    │  SecureStore  │  if enabled                   │
    │               │                                │
```

### Transaction d'Achat

```
┌────────┐     ┌─────────┐     ┌──────────┐     ┌────────┐
│ Client │────▶│   API   │────▶│ MarketSvc│────▶│   D1   │
└────────┘     └─────────┘     └──────────┘     └────────┘
    │               │                │               │
    │  1. Quote     │                │               │
    │  request      │  2. Get price  │               │
    │               │────────────────▶               │
    │               │                │               │
    │  3. Quote     │◀───────────────│               │
    │◀──────────────│                │               │
    │               │                │               │
    │  4. Execute   │                │               │
    │  with quoteId │  5. Lock via   │               │
    │               │  Durable Object│               │
    │               │────────────────▶               │
    │               │                │               │
    │               │  6. Atomic     │               │
    │               │  stock update  │               │
    │               │────────────────────────────────▶
    │               │                │               │
    │               │  7. Update     │               │
    │               │  wallet        │               │
    │               │────────────────────────────────▶
    │               │                │               │
    │  8. Success   │                │               │
    │◀──────────────│                │               │
```

---

## Modèle de Données

### Entités Principales

```sql
-- Utilisateurs
users
├── id (UUID)
├── email (unique)
├── phone (unique)
├── password_hash (Argon2id)
├── kyc_level (BASIC|STANDARD|VERIFIED)
├── kyc_status (PENDING|SUBMITTED|APPROVED|REJECTED|EXPIRED)
├── two_factor_enabled
└── created_at, updated_at

-- Portefeuilles
wallets
├── id (UUID)
├── user_id (FK)
├── token_balance (grammes, précision 0.001)
├── cash_balance (XOF)
└── created_at, updated_at

-- Transactions
transactions
├── id (UUID)
├── user_id (FK)
├── wallet_id (FK)
├── type (BUY|SELL|DEPOSIT|WITHDRAWAL|FEE)
├── status (PENDING|PROCESSING|COMPLETED|FAILED|CANCELLED)
├── token_amount
├── cash_amount
├── price_per_gram
├── fees
├── payment_method
└── created_at, completed_at

-- Stock d'Or
gold_stock
├── id
├── total_allocated (grammes alloués par l'État)
├── tokens_issued (tokens en circulation)
├── available_stock (disponible à la vente)
└── last_audit_date
```

### Invariant Fondamental

```
tokens_issued <= total_allocated
```

Le système ne peut JAMAIS émettre plus de tokens qu'il n'y a d'or physique alloué.

---

## Sécurité

### Authentification
- JWT avec rotation de refresh token
- 2FA obligatoire pour transactions > seuil
- Verrouillage après 5 tentatives (15 min)

### Autorisation (RBAC)
6 rôles avec permissions granulaires :
- `super_admin` : Tous les droits
- `admin` : Gestion utilisateurs/KYC
- `operator` : Opérations quotidiennes
- `support` : Lecture seule support
- `auditor` : Accès rapports/audit
- `state` : Portail État (lecture)

### Rate Limiting (par tier)
| Tier | Limite | Endpoints |
|------|--------|-----------|
| General | 100 req/min | Tous |
| Auth | 20 req/min | Login, Register |
| Trading | 10 req/min | Buy, Sell |
| Admin Auth | 5 req/min | Admin Login |
| Admin | 30 req/min | Admin API |

### Chiffrement
- Mots de passe : Argon2id
- Documents KYC : AES-256-GCM
- Communications : TLS 1.3

---

## Patterns Utilisés

### 1. Service Layer Pattern
Logique métier encapsulée dans des services :
```typescript
// packages/api/src/services/
├── auth.service.ts
├── market.service.ts
├── wallet.service.ts
├── kyc.service.ts
├── payment.service.ts
└── ...
```

### 2. Repository Pattern (via D1)
Accès données via prepared statements :
```typescript
const user = await db
  .prepare('SELECT * FROM users WHERE id = ?')
  .bind(userId)
  .first();
```

### 3. Middleware Chain (HonoJS)
```typescript
app.use('/api/*', rateLimiter);
app.use('/api/*', corsMiddleware);
app.use('/api/v1/*', authMiddleware);
```

### 4. Event-Driven (Queues)
```typescript
// Envoi asynchrone
await queue.send({
  type: 'SEND_EMAIL',
  payload: { to, subject, body }
});
```

### 5. Optimistic Locking (Transactions)
```typescript
// Mise à jour atomique avec condition
const result = await db.prepare(`
  UPDATE wallets
  SET cash_balance = cash_balance - ?
  WHERE id = ? AND cash_balance >= ?
`).bind(amount, walletId, amount).run();

if (result.meta.changes === 0) {
  throw new Error('Insufficient balance');
}
```

---

## Décisions Architecturales (ADR)

Voir [docs/adr/](./adr/) pour les Architecture Decision Records détaillés.

| ADR | Décision |
|-----|----------|
| 001 | Choix de Cloudflare Workers vs AWS Lambda |
| 002 | Utilisation de HonoJS vs Express |
| 003 | D1 vs PlanetScale pour la base de données |
| 004 | Pas de blockchain en V1 |
| 005 | Monorepo avec pnpm workspaces |
| 006 | React Native + Expo vs Flutter |

---

## Monitoring & Observabilité

### Métriques
- Cloudflare Analytics (natif)
- Analytics Engine (custom metrics)
- Durable Objects pour temps réel

### Logs
- `console.log` → Cloudflare Logs
- Archivage R2 pour logs structurés
- Recherche via admin UI

### Alertes
- Règles configurables dans admin
- Notifications email/SMS
- Intégration webhook possible

---

## Évolutions Futures (V2+)

1. **Blockchain** : Tokens sur blockchain (Stellar/Polygon)
2. **Multi-pays** : Extension à d'autres pays africains
3. **API Publique** : SDK pour partenaires
4. **Machine Learning** : Détection fraude avancée
