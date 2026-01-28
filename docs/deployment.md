# Guide de Deploiement - TNC Trading Platform

Ce guide decrit les etapes pour deployer la plateforme TNC Trading sur Cloudflare.

## Prerequis

### Comptes et Acces
- Compte Cloudflare avec plan Workers Paid
- Compte GitHub avec acces au repository
- Cles API pour les services externes (voir section Configuration)

### Outils Locaux
```bash
node >= 18.0.0
pnpm >= 8.0.0
wrangler >= 3.0.0
```

## Environnements

| Environnement | URL | Usage |
|---------------|-----|-------|
| Development | localhost:5173 | Developpement local |
| Staging | staging.tnc-trading.bf | Tests pre-production |
| Production | tnc-trading.bf | Production |

## Configuration des Secrets Cloudflare

### Secrets Requis

Configurez ces secrets dans le dashboard Cloudflare Workers ou via wrangler:

```bash
# Base de donnees et securite
wrangler secret put JWT_SECRET
wrangler secret put ENCRYPTION_KEY

# API Prix de l'or
wrangler secret put GOLD_API_KEY

# SMS (Twilio)
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put TWILIO_PHONE_NUMBER

# KYC (Smile Identity)
wrangler secret put SMILE_PARTNER_ID
wrangler secret put SMILE_API_KEY

# Paiement Mobile Money
wrangler secret put ORANGE_MONEY_API_KEY
wrangler secret put ORANGE_MONEY_MERCHANT_ID
wrangler secret put MOOV_MONEY_API_KEY
wrangler secret put MOOV_MONEY_MERCHANT_ID
wrangler secret put CINETPAY_API_KEY
wrangler secret put CINETPAY_SITE_ID
```

### Bindings D1, KV, R2

Ces bindings sont configures dans `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "tnc-trading-db"
database_id = "votre-database-id"

[[kv_namespaces]]
binding = "CACHE"
id = "votre-kv-id"

[[r2_buckets]]
binding = "DOCUMENTS"
bucket_name = "tnc-documents"
```

## Deploiement Initial

### 1. Creer les ressources Cloudflare

```bash
# Creer la base D1
wrangler d1 create tnc-trading-db

# Creer le namespace KV
wrangler kv:namespace create CACHE

# Creer le bucket R2
wrangler r2 bucket create tnc-documents

# Creer les queues
wrangler queues create notifications-queue
wrangler queues create reports-queue
```

### 2. Appliquer les migrations

```bash
# Appliquer les migrations sur staging
pnpm db:migrate --env staging

# Appliquer les migrations sur production
pnpm db:migrate --env production
```

### 3. Configurer les secrets

```bash
# Pour chaque secret
wrangler secret put SECRET_NAME --env staging
wrangler secret put SECRET_NAME --env production
```

### 4. Deployer l'API

```bash
# Staging
pnpm deploy:api --env staging

# Production
pnpm deploy:api --env production
```

### 5. Deployer le Frontend Web

```bash
# Build
pnpm build:web

# Deployer sur Pages
pnpm deploy:web
```

## Deploiement Continu (CI/CD)

### GitHub Actions

Le workflow `.github/workflows/deploy.yml` gere le deploiement automatique:

```yaml
name: Deploy
on:
  push:
    branches: [main, staging]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Run tests
        run: pnpm test

      - name: Build
        run: pnpm build

      - name: Deploy to Cloudflare
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          environment: ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}
```

### Variables GitHub Secrets

Configurez dans Settings > Secrets:
- `CLOUDFLARE_API_TOKEN`: Token API Cloudflare avec permissions Workers

## Verification Post-Deploiement

### Checklist

- [ ] API repond sur `/api/v1/health`
- [ ] Frontend charge correctement
- [ ] Connexion D1 fonctionne
- [ ] Cache KV accessible
- [ ] Upload R2 fonctionne
- [ ] Prix de l'or se met a jour
- [ ] SMS de verification envoyes
- [ ] Webhooks paiement configures

### Commandes de verification

```bash
# Verifier l'API
curl https://api.tnc-trading.bf/api/v1/health

# Verifier les logs
wrangler tail --env production

# Verifier les metriques
wrangler d1 info tnc-trading-db --env production
```

## Rollback

En cas de probleme:

```bash
# Voir les deployments precedents
wrangler deployments list --env production

# Rollback vers un deployment specifique
wrangler rollback <deployment-id> --env production
```

## Monitoring et Alertes

### Cloudflare Analytics

Activez dans le dashboard Cloudflare:
- Workers Analytics
- D1 Metrics
- R2 Metrics

### Alertes

Configurez des alertes pour:
- Erreurs 5xx > 1% du trafic
- Latence P95 > 500ms
- Echecs de paiement
- Erreurs KYC

## Securite

### Headers de Securite

Les headers sont configures dans le middleware:
- `Strict-Transport-Security`
- `Content-Security-Policy`
- `X-Frame-Options`
- `X-Content-Type-Options`

### Cloudflare Access

Pour l'admin et le portail Etat:
1. Configurez une application Access
2. Definissez les regles d'acces (email, domaine, IdP)
3. Ajoutez le middleware d'authentification Access

## Backup et Restauration

### Backup D1

```bash
# Export de la base
wrangler d1 export tnc-trading-db --output backup.sql --env production
```

### Backup R2

Les documents R2 sont automatiquement repliques.
Pour un backup manuel, utilisez `rclone` avec l'API S3.

## Support

- Documentation: `/docs`
- Issues: GitHub Issues
- Contact technique: support@tnc-trading.bf
