# Documentation API - TNC Trading

Base URL : `https://bf-api.tnc.trading/api/v1`

## Table des Matières

1. [Authentification](#authentification)
2. [Format des Réponses](#format-des-réponses)
3. [Codes d'Erreur](#codes-derreur)
4. [Endpoints](#endpoints)
   - [Auth](#auth)
   - [Users](#users)
   - [Market](#market)
   - [Wallet](#wallet)
   - [Admin](#admin)
   - [State](#state)

---

## Authentification

L'API utilise JWT (JSON Web Tokens) pour l'authentification.

### Headers Requis

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

### Obtenir un Token

```http
POST /auth/login
```

```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "totpCode": "123456"  // Si 2FA activé
}
```

**Réponse :**

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 900,
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "kycLevel": "VERIFIED"
    }
  }
}
```

### Rafraîchir un Token

```http
POST /auth/refresh
```

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

---

## Format des Réponses

### Succès

```json
{
  "success": true,
  "data": { /* ... */ },
  "requestId": "uuid"
}
```

### Erreur

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Message lisible par l'utilisateur",
    "details": { /* optionnel */ }
  },
  "requestId": "uuid"
}
```

---

## Codes d'Erreur

### Authentification

| Code | HTTP | Description |
|------|------|-------------|
| `AUTH_INVALID_CREDENTIALS` | 401 | Email ou mot de passe incorrect |
| `AUTH_ACCOUNT_LOCKED` | 403 | Compte temporairement bloqué |
| `AUTH_2FA_REQUIRED` | 403 | Code 2FA requis |
| `AUTH_2FA_INVALID` | 401 | Code 2FA invalide |
| `AUTH_TOKEN_EXPIRED` | 401 | Token expiré |

### KYC

| Code | HTTP | Description |
|------|------|-------------|
| `KYC_LEVEL_INSUFFICIENT` | 403 | Niveau KYC insuffisant |
| `KYC_DOCUMENT_INVALID` | 400 | Document non valide |
| `KYC_VERIFICATION_PENDING` | 400 | Vérification en cours |
| `KYC_DOCUMENT_EXPIRED` | 403 | Document expiré |

### Trading

| Code | HTTP | Description |
|------|------|-------------|
| `TRADING_INSUFFICIENT_STOCK` | 400 | Stock insuffisant |
| `TRADING_INSUFFICIENT_BALANCE` | 400 | Solde insuffisant |
| `TRADING_LIMIT_EXCEEDED` | 400 | Limite dépassée |
| `TRADING_PRICE_EXPIRED` | 400 | Devis expiré |

### Système

| Code | HTTP | Description |
|------|------|-------------|
| `RATE_LIMIT_EXCEEDED` | 429 | Trop de requêtes |
| `INTERNAL_ERROR` | 500 | Erreur serveur |
| `SERVICE_UNAVAILABLE` | 503 | Service indisponible |

---

## Endpoints

### Auth

#### Inscription

```http
POST /auth/register
```

```json
{
  "email": "user@example.com",
  "phone": "+22670000000",
  "password": "SecureP@ss123",
  "country": "BF"
}
```

#### Connexion

```http
POST /auth/login
```

```json
{
  "email": "user@example.com",
  "password": "SecureP@ss123",
  "totpCode": "123456"
}
```

#### Déconnexion

```http
POST /auth/logout
Authorization: Bearer <token>
```

#### Mot de passe oublié

```http
POST /auth/forgot-password
```

```json
{
  "email": "user@example.com"
}
```

#### Réinitialiser mot de passe

```http
POST /auth/reset-password
```

```json
{
  "token": "reset-token-from-email",
  "newPassword": "NewSecureP@ss123"
}
```

#### Configuration 2FA

```http
POST /auth/2fa/setup
Authorization: Bearer <token>
```

**Réponse :**

```json
{
  "success": true,
  "data": {
    "secret": "JBSWY3DPEHPK3PXP",
    "qrCodeUrl": "otpauth://totp/TNC:user@example.com?secret=..."
  }
}
```

#### Vérification 2FA

```http
POST /auth/2fa/verify
Authorization: Bearer <token>
```

```json
{
  "code": "123456"
}
```

---

### Users

#### Profil utilisateur

```http
GET /users/me
Authorization: Bearer <token>
```

**Réponse :**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "phone": "+22670000000",
    "country": "BF",
    "kycLevel": "VERIFIED",
    "kycStatus": "APPROVED",
    "twoFactorEnabled": true,
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### Mettre à jour le profil

```http
PATCH /users/me
Authorization: Bearer <token>
```

```json
{
  "phone": "+22671111111"
}
```

#### Statut KYC

```http
GET /users/me/kyc/status
Authorization: Bearer <token>
```

**Réponse :**

```json
{
  "success": true,
  "data": {
    "level": "STANDARD",
    "status": "APPROVED",
    "documents": [
      {
        "id": "uuid",
        "type": "CNIB",
        "status": "VERIFIED",
        "submittedAt": "2024-01-01T00:00:00Z",
        "verifiedAt": "2024-01-02T00:00:00Z"
      }
    ],
    "limits": {
      "dailyBuy": 100,
      "monthlyBuy": 500,
      "canSell": true,
      "dailyWithdraw": 500000
    }
  }
}
```

#### Soumettre documents KYC

```http
POST /users/me/kyc/documents
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

```
documentType: CNIB
frontImage: <file>
backImage: <file>
selfie: <file>
```

---

### Market

#### Prix actuel

```http
GET /market/price
```

**Réponse :**

```json
{
  "success": true,
  "data": {
    "priceUsd": 85.50,
    "priceXof": 52583,
    "buyPrice": 53634,
    "sellPrice": 51531,
    "exchangeRate": 615.0,
    "spread": 0.02,
    "source": "goldapi",
    "updatedAt": "2024-01-01T12:00:00Z"
  }
}
```

#### Historique des prix

```http
GET /market/price/history?period=7d
```

Périodes valides : `24h`, `7d`, `30d`, `1y`

#### État du stock

```http
GET /market/stock
```

**Réponse :**

```json
{
  "success": true,
  "data": {
    "totalAllocated": 10000,
    "tokensIssued": 5234,
    "availableStock": 4766,
    "coverage": 1.91,
    "lastAuditDate": "2024-01-01"
  }
}
```

#### Demander un devis

```http
POST /market/quote
Authorization: Bearer <token>
```

```json
{
  "type": "BUY",
  "amount": 100,
  "amountType": "grams"
}
```

**Réponse :**

```json
{
  "success": true,
  "data": {
    "quoteId": "uuid",
    "type": "BUY",
    "tokenAmount": 100,
    "cashAmount": 5363400,
    "pricePerGram": 53634,
    "fees": 26817,
    "total": 5390217,
    "expiresAt": "2024-01-01T12:05:00Z"
  }
}
```

#### Exécuter un achat

```http
POST /market/buy
Authorization: Bearer <token>
```

```json
{
  "quoteId": "uuid",
  "paymentMethod": "orange_money",
  "idempotencyKey": "unique-client-key"
}
```

#### Exécuter une vente

```http
POST /market/sell
Authorization: Bearer <token>
```

```json
{
  "quoteId": "uuid",
  "paymentMethod": "orange_money"
}
```

---

### Wallet

#### Solde

```http
GET /wallet
Authorization: Bearer <token>
```

**Réponse :**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "tokenBalance": 15.5,
    "cashBalance": 250000,
    "tokenValueXof": 831527,
    "totalValueXof": 1081527
  }
}
```

#### Historique des transactions

```http
GET /wallet/transactions?page=1&limit=20
Authorization: Bearer <token>
```

**Réponse :**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "type": "BUY",
        "status": "COMPLETED",
        "tokenAmount": 10,
        "cashAmount": 536340,
        "pricePerGram": 53634,
        "fees": 2681,
        "createdAt": "2024-01-01T12:00:00Z",
        "completedAt": "2024-01-01T12:01:00Z"
      }
    ],
    "total": 45,
    "page": 1,
    "limit": 20
  }
}
```

#### Demande de retrait

```http
POST /wallet/withdraw
Authorization: Bearer <token>
```

```json
{
  "amount": 100000,
  "paymentMethod": "orange_money",
  "phoneNumber": "+22670000000"
}
```

#### Générer certificat de propriété

```http
GET /wallet/certificate
Authorization: Bearer <token>
```

Retourne un PDF du certificat de propriété.

---

### Admin

> Nécessite un token admin avec les permissions appropriées.

#### Dashboard

```http
GET /admin/dashboard
Authorization: Bearer <admin_token>
```

#### Liste des utilisateurs

```http
GET /admin/users?page=1&limit=20&kycStatus=SUBMITTED
Authorization: Bearer <admin_token>
```

#### Valider KYC

```http
PATCH /admin/users/:id/kyc
Authorization: Bearer <admin_token>
```

```json
{
  "action": "approve",
  "newLevel": "VERIFIED"
}
```

#### Gérer les retraits

```http
GET /admin/withdrawals?status=PENDING
Authorization: Bearer <admin_token>
```

```http
PATCH /admin/withdrawals/:id
Authorization: Bearer <admin_token>
```

```json
{
  "action": "approve"
}
```

#### Configuration

```http
GET /admin/config
Authorization: Bearer <admin_token>
```

```http
PATCH /admin/config/:key
Authorization: Bearer <admin_token>
```

```json
{
  "value": "new_value"
}
```

---

### State (Portail État)

> Lecture seule pour les représentants de l'État.

#### Dashboard

```http
GET /state/dashboard
Authorization: Bearer <state_token>
```

#### Proof of Reserve

```http
GET /state/reports/por
Authorization: Bearer <state_token>
```

**Réponse :**

```json
{
  "success": true,
  "data": {
    "reportDate": "2024-01-01",
    "goldStock": {
      "totalAllocated": 10000,
      "tokensIssued": 5234,
      "coverage": 1.91
    },
    "users": {
      "total": 15000,
      "verified": 8500
    },
    "transactions": {
      "totalBuyVolume": 25000000,
      "totalSellVolume": 12000000,
      "totalFees": 1850000
    }
  }
}
```

#### Rapport mensuel

```http
GET /state/reports/monthly?month=2024-01
Authorization: Bearer <state_token>
```

---

## Rate Limiting

| Endpoint | Limite |
|----------|--------|
| Général | 100 req/min |
| Auth (login, register) | 20 req/min |
| Trading (buy, sell) | 10 req/min |
| Admin | 30 req/min |

Headers de réponse :
- `X-RateLimit-Limit`: Limite totale
- `X-RateLimit-Remaining`: Requêtes restantes
- `Retry-After`: Secondes avant reset (si limité)

---

## Webhooks

### Payment Callbacks

```http
POST /webhooks/payment/orange
POST /webhooks/payment/moov
POST /webhooks/payment/cinetpay
```

### KYC Callbacks

```http
POST /webhooks/kyc
```

Signature vérifiée via header `X-Signature` (HMAC-SHA256).
