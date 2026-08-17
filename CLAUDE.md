# CLAUDE.md - TNC Trading Platform

## 🎯 Vue d'ensemble du Projet

**TNC Trading** est une plateforme de tokenisation d'or souveraine pour le Burkina Faso, permettant aux citoyens d'investir dans l'or national via des tokens représentant 1 gramme d'or physique.

### Principe Fondamental
- 1 token = 1 gramme d'or physique
- L'or reste stocké par l'État partenaire
- Pas de blockchain (V1) - tokens comptables en base de données
- Finance éthique : pas de spéculation, pas d'effet de levier

## 🏗️ Architecture Technique

### Stack Technologique

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                  │
├─────────────────────────────────────────────────────────────────┤
│  Web App (React + Vite)        │  Mobile (React Native + Expo)  │
│  - PWA avec support offline    │  - iOS 14.0+ / Android 8.0+    │
│  - Tailwind CSS                │  - Biométrie native            │
│  - React Query + Zustand       │  - Push notifications          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API GATEWAY (Cloudflare)                      │
│  - Workers (HonoJS)  │  - KV Storage  │  - D1 Database          │
│  - R2 Storage        │  - Queues      │  - Durable Objects      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SERVICES EXTERNES                           │
├─────────────────────────────────────────────────────────────────┤
│  Prix Or: GoldAPI      │  KYC: Smile Identity  │  SMS: Twilio   │
│  Paiement: Orange Money, Moov Money, CinetPay                   │
└─────────────────────────────────────────────────────────────────┘
```

### Services Cloudflare Utilisés

| Service | Usage |
|---------|-------|
| **Workers** | API Backend avec HonoJS |
| **D1** | Base de données SQLite distribuée |
| **KV** | Cache (prix or, sessions, config) |
| **R2** | Stockage documents KYC, certificats |
| **Queues** | Jobs asynchrones (notifications, rapports) |
| **Durable Objects** | État temps réel (prix, transactions en cours) |
| **Pages** | Hébergement frontend web |
| **Access** | Authentification admin/État |

## 📁 Structure du Projet

```
tnc-trading/
├── apps/
│   ├── web/                    # React + Vite (PWA)
│   │   ├── src/
│   │   │   ├── components/     # Composants UI
│   │   │   ├── pages/          # Routes/Pages
│   │   │   ├── hooks/          # Custom hooks
│   │   │   ├── stores/         # Zustand stores
│   │   │   ├── lib/            # Utilitaires
│   │   │   └── api/            # Clients API
│   │   └── package.json
│   │
│   ├── mobile/                 # React Native + Expo
│   │   ├── src/
│   │   │   ├── screens/        # Écrans
│   │   │   ├── components/     # Composants
│   │   │   ├── navigation/     # React Navigation
│   │   │   ├── stores/         # Zustand (partagé)
│   │   │   └── services/       # Services natifs
│   │   └── app.json
│   │
│   ├── admin/                  # Back-office React
│   │   └── src/
│   │
│   └── state-portal/           # Portail État (read-only)
│       └── src/
│
├── packages/
│   ├── api/                    # HonoJS Workers
│   │   ├── src/
│   │   │   ├── routes/         # Endpoints API
│   │   │   ├── middleware/     # Auth, validation, etc.
│   │   │   ├── services/       # Business logic
│   │   │   ├── db/             # D1 schemas & queries
│   │   │   └── lib/            # Utilitaires
│   │   └── wrangler.toml
│   │
│   ├── shared/                 # Code partagé
│   │   ├── types/              # TypeScript types
│   │   ├── constants/          # Constantes métier
│   │   ├── validators/         # Zod schemas
│   │   └── utils/              # Fonctions utilitaires
│   │
│   └── ui/                     # Composants UI partagés
│       └── src/
│
├── specs/                      # Speckit specifications
│   ├── features/               # User stories par feature
│   ├── api/                    # OpenAPI specs
│   └── db/                     # Database schemas
│
├── scripts/                    # Scripts utilitaires
├── docs/                       # Documentation
├── CLAUDE.md                   # Ce fichier
└── package.json                # Workspace root
```

## 🔧 Commandes de Développement

```bash
# Installation des dépendances
pnpm install

# Développement
pnpm dev              # Lance tous les services
pnpm dev:web          # Web app uniquement
pnpm dev:mobile       # Mobile app (Expo)
pnpm dev:api          # API Workers (Wrangler)
pnpm dev:admin        # Back-office

# Tests
pnpm test             # Tous les tests
pnpm test:unit        # Tests unitaires
pnpm test:e2e         # Tests end-to-end

# Build
pnpm build            # Build de production
pnpm build:web        # Build web uniquement
pnpm build:mobile     # Build mobile (EAS)

# Déploiement Cloudflare
pnpm deploy:api       # Déploie les Workers
pnpm deploy:web       # Déploie sur Pages
pnpm deploy:all       # Déploie tout

# Base de données
pnpm db:migrate       # Applique les migrations D1
pnpm db:seed          # Seed data de test
pnpm db:studio        # Interface D1 Studio

# Génération
pnpm generate:types   # Génère types depuis D1
pnpm generate:api     # Génère client API depuis OpenAPI
```

## 📊 Modèle de Données Principal

### Entités Core

```typescript
// User - Utilisateur de la plateforme
interface User {
  id: string;                    // UUID
  email: string;                 // Unique
  phone: string;                 // Format international +226...
  passwordHash: string;          // Argon2id
  kycLevel: 'BASIC' | 'STANDARD' | 'VERIFIED';
  kycStatus: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  country: string;               // Code ISO (BF)
  createdAt: Date;
  updatedAt: Date;
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
}

// Wallet - Portefeuille utilisateur
interface Wallet {
  id: string;
  userId: string;
  tokenBalance: number;          // Solde en grammes (precision: 0.001)
  cashBalance: number;           // Solde XOF
  createdAt: Date;
  updatedAt: Date;
}

// Transaction - Opération financière
interface Transaction {
  id: string;
  userId: string;
  walletId: string;
  type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  tokenAmount?: number;          // Grammes d'or
  cashAmount: number;            // Montant XOF
  pricePerGram: number;          // Prix au moment de la transaction
  fees: number;                  // Frais prélevés
  paymentMethod?: string;        // orange_money, moov_money, card, bank
  paymentReference?: string;     // Référence externe
  createdAt: Date;
  completedAt?: Date;
}

// GoldStock - Stock d'or alloué
interface GoldStock {
  id: string;
  totalAllocated: number;        // Total alloué par l'État (grammes)
  tokensIssued: number;          // Tokens en circulation
  availableStock: number;        // Disponible à la vente
  lastAuditDate: Date;
  lastAuditResult: string;
  updatedAt: Date;
}

// GoldPrice - Historique des prix
interface GoldPrice {
  id: string;
  priceUsd: number;              // Prix LBMA USD/gramme
  priceXof: number;              // Prix converti XOF/gramme
  exchangeRate: number;          // Taux USD/XOF
  buyPrice: number;              // Prix d'achat avec spread
  sellPrice: number;             // Prix de vente avec spread
  source: string;                // Fournisseur du prix
  timestamp: Date;
}

// KycDocument - Documents KYC
interface KycDocument {
  id: string;
  userId: string;
  documentType: 'CNIB' | 'PASSPORT' | 'PERMIT' | 'CEDEAO';
  documentNumber?: string;
  frontImageUrl: string;         // R2 URL (chiffré)
  backImageUrl?: string;
  selfieUrl: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verificationResult?: object;   // Résultat du provider KYC
  rejectionReason?: string;
  expiryDate?: Date;
  createdAt: Date;
  verifiedAt?: Date;
}
```

## 🔐 Règles de Sécurité

### Authentication
- JWT avec refresh token rotation
- 2FA obligatoire pour transactions > seuil
- Session expirée après 30 min d'inactivité
- Blocage après 5 tentatives échouées (15 min)

### API Security
- Rate limiting: 100 req/min par IP, 1000 req/min par user
- CORS strict (domaines autorisés uniquement)
- Validation Zod sur tous les inputs
- Headers de sécurité (CSP, HSTS, X-Frame-Options)

### Data Protection
- Chiffrement AES-256 pour documents KYC
- Hachage Argon2id pour mots de passe
- Pas de données sensibles dans les logs
- Audit trail sur toutes les opérations admin

## 💰 Règles Métier Critiques

### Calcul des Prix
```typescript
// Prix d'achat (utilisateur achète des tokens)
buyPrice = lbmaPrice * exchangeRate * (1 + spreadBuy)
// Exemple: 85.50 USD * 615 * 1.02 = 53,634 XOF/g

// Prix de vente (utilisateur vend ses tokens)
sellPrice = lbmaPrice * exchangeRate * (1 - spreadSell)
// Exemple: 85.50 USD * 615 * 0.98 = 51,530 XOF/g

// Spreads configurables (défaut: 2%)
const SPREAD_BUY = 0.02;
const SPREAD_SELL = 0.02;
```

### Limites par Niveau KYC
```typescript
const KYC_LIMITS = {
  BASIC: {
    dailyBuy: 0,           // Consultation uniquement
    monthlyBuy: 0,
    canSell: false,
    dailyWithdraw: 0
  },
  STANDARD: {
    dailyBuy: 100,         // 100g/jour
    monthlyBuy: 500,       // 500g/mois
    canSell: true,
    dailyWithdraw: 500_000 // 500,000 XOF/jour
  },
  VERIFIED: {
    dailyBuy: 1000,        // 1000g/jour
    monthlyBuy: 5000,      // 5000g/mois
    canSell: true,
    dailyWithdraw: 5_000_000 // 5,000,000 XOF/jour
  }
};
```

### Règle Fondamentale du Stock
```typescript
// INVARIANT: Tokens émis <= Or physique alloué
assert(goldStock.tokensIssued <= goldStock.totalAllocated);

// Vérification avant chaque achat
function canPurchase(quantity: number): boolean {
  return goldStock.availableStock >= quantity;
}
```

## 📱 Spécifications Mobile (React Native)

### Fonctionnalités Natives
- **Biométrie**: Face ID / Touch ID via `expo-local-authentication`
- **Caméra KYC**: `expo-camera` avec guides de cadrage
- **Push Notifications**: `expo-notifications` + FCM/APNs
- **Stockage sécurisé**: `expo-secure-store` pour tokens

### Navigation (React Navigation)
```
TabNavigator
├── HomeStack
│   ├── Home (Dashboard)
│   └── Notifications
├── MarketStack
│   ├── Market (Prix + Achat/Vente)
│   ├── BuyConfirm
│   └── SellConfirm
├── WalletStack
│   ├── Wallet (Solde + Historique)
│   ├── Withdraw
│   └── Certificate
└── ProfileStack
    ├── Profile
    ├── KYC
    ├── Security (2FA)
    └── Settings
```

## 🌐 Endpoints API Principaux

### Auth
```
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/auth/verify-email
POST /api/v1/auth/verify-phone
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
POST /api/v1/auth/2fa/setup
POST /api/v1/auth/2fa/verify
```

### Users & KYC
```
GET    /api/v1/users/me
PATCH  /api/v1/users/me
POST   /api/v1/users/me/kyc
GET    /api/v1/users/me/kyc/status
POST   /api/v1/users/me/kyc/documents
```

### Market & Trading
```
GET    /api/v1/market/price              # Prix actuel
GET    /api/v1/market/price/history      # Historique prix
POST   /api/v1/market/quote              # Obtenir un devis
POST   /api/v1/market/buy                # Achat de tokens
POST   /api/v1/market/sell               # Vente de tokens
```

### Wallet
```
GET    /api/v1/wallet                    # Solde et infos wallet
GET    /api/v1/wallet/transactions       # Historique transactions
POST   /api/v1/wallet/withdraw           # Demande de retrait
GET    /api/v1/wallet/certificate        # Générer certificat PDF
```

### Admin (mot de passe + TOTP obligatoire, jeton lié au portail, liste d'IP)
```
GET    /api/v1/admin/dashboard           # KPIs
GET    /api/v1/admin/users               # Liste utilisateurs
GET    /api/v1/admin/users/:id           # Détail utilisateur
PATCH  /api/v1/admin/users/:id/kyc       # Valider/Rejeter KYC
GET    /api/v1/admin/transactions        # Toutes les transactions
GET    /api/v1/admin/stock               # État du stock
POST   /api/v1/admin/stock/adjust        # Ajuster le stock
GET    /api/v1/admin/withdrawals         # Retraits en attente
PATCH  /api/v1/admin/withdrawals/:id     # Approuver/Rejeter retrait
GET    /api/v1/admin/reports/por         # Proof of Reserve
```

### État (Read-only — même authentification que l'admin, portail distinct)
```
GET    /api/v1/state/dashboard           # Vue d'ensemble
GET    /api/v1/state/stock               # État du stock
GET    /api/v1/state/reports/por         # Proof of Reserve
GET    /api/v1/state/reports/monthly     # Rapport mensuel
```

## 🚨 Gestion des Erreurs

### Format Standard
```typescript
interface ApiError {
  success: false;
  error: {
    code: string;          // Ex: "INSUFFICIENT_STOCK"
    message: string;       // Message user-friendly
    details?: object;      // Détails techniques (dev only)
  };
  requestId: string;       // Pour le support
}
```

### Codes d'Erreur Métier
```typescript
const ERROR_CODES = {
  // Auth
  'AUTH_INVALID_CREDENTIALS': 'Email ou mot de passe incorrect',
  'AUTH_ACCOUNT_LOCKED': 'Compte temporairement bloqué',
  'AUTH_2FA_REQUIRED': 'Code 2FA requis',
  'AUTH_2FA_INVALID': 'Code 2FA invalide',
  
  // KYC
  'KYC_LEVEL_INSUFFICIENT': 'Niveau KYC insuffisant pour cette opération',
  'KYC_DOCUMENT_INVALID': 'Document non reconnu ou illisible',
  'KYC_VERIFICATION_PENDING': 'Vérification en cours',
  
  // Trading
  'TRADING_INSUFFICIENT_STOCK': 'Stock insuffisant',
  'TRADING_INSUFFICIENT_BALANCE': 'Solde insuffisant',
  'TRADING_LIMIT_EXCEEDED': 'Limite journalière/mensuelle dépassée',
  'TRADING_PRICE_EXPIRED': 'Prix expiré, veuillez réessayer',
  
  // Payment
  'PAYMENT_FAILED': 'Paiement échoué',
  'PAYMENT_PROVIDER_ERROR': 'Erreur du fournisseur de paiement',
  
  // Withdrawal
  'WITHDRAWAL_LIMIT_EXCEEDED': 'Limite de retrait dépassée',
  'WITHDRAWAL_PENDING': 'Un retrait est déjà en cours',
};
```

## 🧪 Stratégie de Tests

### Tests Unitaires
- Services métier avec mocks
- Validators Zod
- Fonctions utilitaires

### Tests d'Intégration
- Routes API avec Miniflare
- Workflows complets (achat, vente, KYC)

### Tests E2E
- Web: Playwright
- Mobile: Detox ou Maestro
- Parcours critiques: inscription → KYC → achat → vente → retrait

## 📋 Checklist Avant Déploiement

- [ ] Variables d'environnement configurées
- [ ] Migrations D1 appliquées
- [ ] Certificats SSL actifs
- [ ] Webhooks paiement configurés
- [ ] Clés API (GoldAPI, Smile Identity, Orange Money) actives
- [ ] Liste d'IP renseignée pour admin/état (`admin_ip_allowlist`, `state_ip_allowlist`)
- [ ] Monitoring et alertes configurés
- [ ] Sauvegarde vérifiée : `database_backup` au vert dans le diagnostic (cron `0 7 * * *`, ADR 010)
- [ ] Tests E2E passés
- [ ] Pentest réalisé (avant go-live)

## 🔗 Ressources

- [Speckit Specs](./specs/)
- [API Documentation](./docs/api/)
- [Architecture Decision Records](./docs/adr/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [HonoJS Docs](https://hono.dev/)
- [React Native Expo](https://docs.expo.dev/)
