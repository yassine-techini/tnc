# Sécurité - TNC Trading

Ce document décrit les pratiques et mesures de sécurité implémentées dans la plateforme TNC Trading.

## Table des Matières

1. [Authentification](#authentification)
2. [Autorisation (RBAC)](#autorisation-rbac)
3. [Protection des Données](#protection-des-données)
4. [Sécurité API](#sécurité-api)
5. [Sécurité Infrastructure](#sécurité-infrastructure)
6. [Audit et Conformité](#audit-et-conformité)
7. [Procédures d'Incident](#procédures-dincident)

---

## Authentification

### Mots de Passe

#### Hachage
- **Algorithme** : Argon2id (vainqueur Password Hashing Competition)
- **Configuration** :
  - Memory : 65536 KB
  - Iterations : 3
  - Parallelism : 4
  - Hash length : 32 bytes

#### Politique de Mots de Passe
- Minimum 8 caractères
- Au moins 1 majuscule
- Au moins 1 minuscule
- Au moins 1 chiffre
- Au moins 1 caractère spécial
- Vérification contre liste de mots de passe compromis (Have I Been Pwned)

### Authentification à Deux Facteurs (2FA)

- **Méthode** : TOTP (Time-based One-Time Password)
- **Algorithme** : SHA-1 avec période de 30 secondes
- **Obligatoire pour** :
  - Tous les comptes admin
  - Transactions > seuil configurable
  - Changements de paramètres sensibles

### Gestion des Sessions

#### JWT (JSON Web Tokens)
- **Access Token** : 15 minutes
- **Refresh Token** : 7 jours
- **Algorithme** : HS256
- **Rotation** : Refresh token rotation activée

#### Protection
- Tokens stockés en Secure Store (mobile) / HttpOnly cookies (web)
- Invalidation immédiate à la déconnexion
- Blacklist des tokens révoqués en KV

### Protection contre les Attaques

| Attaque | Protection |
|---------|------------|
| Brute force | Verrouillage après 5 tentatives (15 min) |
| Credential stuffing | Rate limiting + CAPTCHA après 3 échecs |
| Session hijacking | Binding IP + User-Agent |
| Token replay | Rotation des refresh tokens |

---

## Autorisation (RBAC)

### Rôles

| Rôle | Description | Permissions |
|------|-------------|-------------|
| `super_admin` | Accès total | Toutes |
| `admin` | Administration | Users, KYC, Transactions |
| `operator` | Opérations | Transactions, Withdrawals |
| `support` | Support client | Users (lecture), Transactions (lecture) |
| `auditor` | Audit | Reports, Logs (lecture) |
| `state` | Représentant État | Dashboard, Reports (lecture) |

### Permissions

Format : `module:action`

```typescript
const PERMISSIONS = {
  users: ['view', 'create', 'update', 'delete', 'suspend'],
  kyc: ['view', 'approve', 'reject'],
  transactions: ['view', 'cancel'],
  withdrawals: ['view', 'approve', 'reject'],
  stock: ['view', 'update'],
  admins: ['view', 'create', 'update', 'delete'],
  config: ['view', 'update'],
  reports: ['view', 'export'],
  logs: ['view'],
  analytics: ['view'],
  alerts: ['view', 'create', 'update', 'delete'],
};
```

### Implémentation

```typescript
// Middleware RBAC
app.use('/admin/*', requirePermission('module', 'action'));

// Vérification dans le code
if (!hasPermission(adminRole, 'kyc', 'approve')) {
  throw new ForbiddenError();
}
```

---

## Protection des Données

### Données Sensibles

| Type | Protection |
|------|------------|
| Mots de passe | Argon2id (jamais stockés en clair) |
| Documents KYC | AES-256-GCM + stockage R2 privé |
| Tokens 2FA secrets | Chiffrement AES-256 |
| Données personnelles | Chiffrement au repos (D1) |

### Chiffrement

#### Au Repos
- **Base de données** : Cloudflare D1 (chiffrement natif)
- **Documents** : AES-256-GCM avant upload R2
- **Cache** : Données sensibles exclues du KV

#### En Transit
- **TLS 1.3** obligatoire
- **HSTS** activé (max-age: 31536000)
- **Certificate pinning** sur mobile

### Anonymisation

Pour les logs et analytics :
- IP hashées (SHA-256 avec salt)
- Emails partiellement masqués
- Pas de données PII dans les logs

---

## Sécurité API

### Rate Limiting

| Tier | Limite | Endpoints | Fail Mode |
|------|--------|-----------|-----------|
| General | 100/min | Tous | Open |
| Auth | 20/min | Login, Register | Closed |
| Trading | 10/min | Buy, Sell | Closed |
| Admin Auth | 5/min | Admin Login | Closed |
| Admin | 30/min | Admin API | Closed |

**Fail-Closed** : En cas d'erreur du rate limiter, les requêtes sont bloquées.

### Validation des Entrées

```typescript
// Validation Zod sur tous les endpoints
const schema = z.object({
  email: z.string().email(),
  amount: z.number().positive().max(MAX_AMOUNT),
});

app.post('/endpoint', zValidator('json', schema), handler);
```

### Protection CSRF

- Tokens CSRF pour les formulaires web
- Vérification `Origin` / `Referer`
- SameSite=Strict sur les cookies

### Headers de Sécurité

```typescript
// Content Security Policy
{
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:", "https:"],
  connectSrc: ["'self'", "https://bf-api.tnc.trading"],
  frameAncestors: ["'none'"],
}

// Autres headers
{
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(self)',
}
```

### Protection contre les Injections

| Type | Protection |
|------|------------|
| SQL Injection | Prepared statements (D1) |
| XSS | Échappement automatique (React) + CSP |
| Command Injection | Pas d'exécution shell |
| Path Traversal | Validation des chemins R2 |

---

## Sécurité Infrastructure

### Cloudflare

- **WAF** : Web Application Firewall activé
- **DDoS Protection** : Incluse
- **Bot Management** : Détection automatique
- **Access** : Authentication pour admin/état

### Isolation

- Workers isolés par requête
- Pas d'accès au filesystem
- Durable Objects pour état partagé contrôlé

### Secrets

```bash
# Jamais dans le code
# Configuration via wrangler secret ou admin UI

# Développement : wrangler.toml (ignoré par git)
# Production : Cloudflare Dashboard ou table config
```

### Backup et Récupération

- **D1** : Backups automatiques quotidiens
- **R2** : Versioning activé
- **Point-in-time recovery** : 30 jours

---

## Audit et Conformité

### Journalisation

Tous les événements critiques sont journalisés :

```typescript
// Structure d'un log d'audit
{
  id: "uuid",
  timestamp: "2024-01-01T12:00:00Z",
  userId: "uuid",
  adminId: "uuid", // si action admin
  action: "KYC_APPROVED",
  entityType: "user",
  entityId: "uuid",
  oldValue: { kycStatus: "SUBMITTED" },
  newValue: { kycStatus: "APPROVED" },
  ipAddress: "hash",
  userAgent: "...",
  requestId: "uuid"
}
```

### Événements Audités

- Connexions/déconnexions
- Échecs d'authentification
- Modifications de profil
- Transactions financières
- Actions KYC
- Actions admin
- Modifications de configuration
- Accès aux données sensibles

### Rétention

| Type | Durée |
|------|-------|
| Logs d'audit | 7 ans |
| Logs d'accès | 1 an |
| Logs d'erreur | 90 jours |
| Métriques | 1 an |

### Conformité

- **RGPD** : Droit à l'oubli, export des données
- **BCEAO** : Réglementation financière UEMOA
- **KYC/AML** : Know Your Customer, Anti-Money Laundering

---

## Procédures d'Incident

### Classification

| Niveau | Description | Temps de Réponse |
|--------|-------------|------------------|
| P1 - Critique | Brèche données, indisponibilité totale | < 15 min |
| P2 - Majeur | Fonctionnalité critique impactée | < 1 heure |
| P3 - Mineur | Impact limité | < 4 heures |
| P4 - Faible | Anomalie sans impact | < 24 heures |

### Processus de Réponse

1. **Détection** : Alerte automatique ou signalement
2. **Triage** : Classification et assignation
3. **Containment** : Isolation de la menace
4. **Éradication** : Suppression de la cause
5. **Récupération** : Restauration des services
6. **Post-mortem** : Analyse et amélioration

### Contacts d'Urgence

- **Sécurité** : security@tnc-trading.com
- **Astreinte** : +226 XX XX XX XX
- **Cloudflare Support** : Via dashboard

### Signalement de Vulnérabilité

Pour signaler une vulnérabilité de sécurité :

1. Email : security@tnc-trading.com
2. Chiffrement PGP disponible sur demande
3. Ne pas divulguer publiquement avant correction
4. Programme de bug bounty en préparation

---

## Checklist de Sécurité

### Avant Déploiement

- [ ] Revue de code sécurité
- [ ] Tests de pénétration (pentest)
- [ ] Scan de vulnérabilités (npm audit)
- [ ] Vérification des secrets
- [ ] Vérification des permissions
- [ ] Tests de charge

### Régulièrement

- [ ] Rotation des secrets (90 jours)
- [ ] Revue des accès admin
- [ ] Analyse des logs d'audit
- [ ] Mise à jour des dépendances
- [ ] Formation sécurité équipe

### Après Incident

- [ ] Post-mortem documenté
- [ ] Actions correctives
- [ ] Mise à jour des procédures
- [ ] Communication (si nécessaire)
