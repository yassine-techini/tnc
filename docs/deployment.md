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

## Sauvegarde et restauration

Trois niveaux, qui ne protegent pas des memes choses. Les confondre revient a
croire qu'on est couvert alors qu'on ne l'est que partiellement.

### 1. Time Travel (D1, automatique, 0 configuration)

Restauration a un instant donne sur les **30 derniers jours**. Couvre la fausse
manoeuvre et la migration ratee.

```bash
wrangler d1 time-travel restore tnc-trading-db --timestamp <ISO8601> --env production
```

Ne couvre pas : la retention au-dela de 30 jours, la perte d'acces au compte
Cloudflare, et l'inspection du contenu (Time Travel restaure, il ne se lit pas).

### 2. Export quotidien verifie (cron `0 7 * * *`, ADR 010)

Ecrit dans le seau `LOGS_STORAGE` sous `backups/<date>/` : un fichier NDJSON par
table, plus un `manifest.json` portant le nombre de lignes et l'empreinte SHA-256
de chacune.

Chaque fichier est **relu depuis R2** apres ecriture et son empreinte recalculee.
Un ecart, ou une table tronquee, et l'execution est un **echec** — pas un succes
assorti d'un avertissement.

**Ce que l'export ne contient pas**, deliberement : les tables de session et
d'identifiants (`sessions`, `verification_codes`, `recovery_codes`,
`two_factor_backup_codes`, `api_keys`), les secrets de fournisseurs (`config`,
`integrations`), et les colonnes `password_hash` / `two_factor_secret`.

Une restauration depuis cet export exige donc une reinitialisation des mots de
passe et un re-enrolement du second facteur. C'est le prix d'une sauvegarde qui
ne cree pas une seconde copie des identifiants dans un stockage moins garde que
la base.

Reglages (table `config`) :

| Cle | Defaut | Effet |
|---|---|---|
| `backup_retention_days` | 90 | Age au-dela duquel un jour de sauvegarde est purge |
| `backup_max_rows_per_table` | 200000 | Plafond par table ; l'atteindre marque la sauvegarde en ECHEC |

**Surveiller** : le diagnostic de disponibilite porte une verification
`database_backup`. Elle passe au rouge si la derniere sauvegarde verifiee date de
plus de 48 h, ou si la derniere tentative a echoue. Un cron qui echoue en silence
ramene a l'absence de sauvegarde, en donnant en plus l'illusion contraire.

### 3. Copie hors Cloudflare — DECISION A PRENDRE

L'export du point 2 vit dans le meme compte que la base. Il protege de la perte
de la base, **pas de la perte du compte**.

Une copie chez un tiers demande des identifiants qui ne peuvent pas etre inventes
ici. C'est une decision d'exploitation, consignee au carnet et volontairement non
tranchee.

### Restauration depuis un export

Le format NDJSON se reimporte par script (une ligne = un `INSERT`). Aucune
procedure automatisee n'est fournie, et **une restauration jamais repetee n'est
pas une restauration eprouvee** : elle merite un exercice avant la mise en
production, pas apres.

### Backup R2

Les documents R2 sont automatiquement repliques.
Pour un backup manuel, utilisez `rclone` avec l'API S3.

## Support

- Documentation: `/docs`
- Issues: GitHub Issues
- Contact technique: support@tnc-trading.bf
