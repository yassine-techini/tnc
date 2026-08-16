# Configuration — guide pas à pas

Plusieurs fonctionnalités de cette plateforme sont écrites, testées, et **totalement inertes**
tant qu'une clé manque : notifications push, attestations de réserve, filtrage réseau des
portails. Ce guide sert à les activer, dans un ordre qui évite de s'enfermer dehors.

**Avant tout : mesurer.**

```bash
node scripts/readiness.mjs --url https://votre-api --token <jwt admin>
```

La commande sort un tableau clé par clé et se termine en code d'erreur s'il manque quelque chose,
ce qui permet de la mettre dans un script de pré-démo. Ajouter `--probe` pour tester réellement
les intégrations sondables (lecture seule ; **aucune passerelle de paiement n'est appelée**).

Le même diagnostic est exposé sur `GET /api/v1/admin/readiness` (permission `integrations:view`).
Ni l'un ni l'autre n'affiche jamais une valeur de secret.

---

## 0. Deux règles

**Les secrets ne passent pas par un fichier.** En production ils sont injectés un par un :

```bash
npx wrangler secret put NOM_DU_SECRET --env production
```

`.env.example` documente ce qui est attendu ; il ne contient aucune valeur et ne doit jamais en
contenir.

**Certaines clés valent en base plutôt qu'en secret.** Les clés d'intégration sont résolues
d'abord depuis la table `config` (modifiable depuis le back-office, sans redéploiement), puis
depuis l'environnement en repli. Les listes d'IP et la clé publique d'attestation vivent
uniquement en `config`.

---

## 1. Socle obligatoire

| Clé | Effet si absente |
|---|---|
| `JWT_SECRET` | Aucune authentification possible |
| `ENCRYPTION_KEY` | **Tout dépôt de document KYC/KYB est refusé** (fail-closed, volontaire) |
| `ENVIRONMENT` | Certains contrôles restent en mode permissif |
| `ALLOWED_ORIGINS` | Le front est bloqué par le CORS |

## 2. Amorçage du premier administrateur

Les migrations ne créent **aucun** administrateur ni stock d'or : c'était le cas avant, et une
base neuve démarrait avec 10 kg d'or fictif. L'amorçage passe uniquement par `/setup/*`, protégé
par `SETUP_SECRET` (sans lui, ces routes sont désactivées).

```bash
npx wrangler secret put SETUP_SECRET --env production
npx wrangler secret put SETUP_ADMIN_PASSWORD --env production
```

Créer l'administrateur, puis **retirer `SETUP_SECRET`**. À la première connexion, le TOTP est
imposé : il n'y a pas d'échappatoire.

## 3. Listes d'IP des portails — à faire tôt et dans le bon ordre

Cloudflare Access n'est pas utilisé sur ce déploiement. Ces listes sont donc le **seul rempart
réseau** devant le back-office et le portail État.

> **Ordre impératif.** Renseigner `admin_ip_allowlist` **en incluant l'adresse depuis laquelle
> vous la renseignez**, vérifier que le back-office répond toujours, et seulement ensuite
> `state_ip_allowlist`. En cas d'erreur, la seule issue est de vider la clé directement en base.

Depuis le back-office (Configuration), ou en secours :

```bash
npx wrangler d1 execute tnc-trading-db-production --env production --remote \
  --command "UPDATE config SET value='41.202.0.0/16, 197.215.0.0/16' WHERE key='admin_ip_allowlist'"
```

Entrées séparées par virgules ou espaces, adresses ou blocs CIDR, IPv4 et IPv6. **Vide = filtre
désactivé** : imposer une liste vide enfermerait tout le monde dehors.

## 4. Prix de l'or

`GOLD_API_KEY` et `EXCHANGE_RATE_API_KEY`. Sans la première, aucun prix, donc ni achat ni vente.
Sans la seconde, la conversion USD→XOF se fige sur le taux de repli configuré — la plateforme
fonctionne, mais sur un taux qui ne bouge plus.

Vérifier réellement : `node scripts/readiness.mjs --probe`.

## 5. Notifications

**Email** — `RESEND_API_KEY` en principal, `SENDGRID_API_KEY` en repli. Le diagnostic signale
« partiel » si un seul est présent : la plateforme fonctionne, sans filet.

**SMS** — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`. Les trois, sinon rien.

**Push** — `FCM_SERVICE_ACCOUNT`, le **JSON complet** du compte de service Firebase (Console →
Paramètres → Comptes de service → Générer une clé privée).

> Une « clé serveur » FCM ne convient pas. L'endpoint legacy qu'elle adressait a été **coupé par
> Google en juin 2024** ; le code a été migré vers HTTP v1, qui s'authentifie par compte de
> service. Le diagnostic refuse explicitement une clé legacy collée à cet emplacement.

## 6. KYC automatique

`SMILE_IDENTITY_API_KEY` et `SMILE_IDENTITY_PARTNER_ID`. Sans eux, la revue KYC reste manuelle
depuis le back-office — la plateforme reste utilisable.

## 7. Paiements

Orange Money, Moov Money, CinetPay, Stripe : chaque fournisseur a ses clés (voir `.env.example`).
`WEBHOOK_SECRET` est indispensable, faute de quoi **aucune confirmation de paiement n'est
acceptée** — les dépôts resteraient éternellement en attente.

Le diagnostic ne sonde **jamais** une passerelle de paiement : exercer un compte marchand réel
depuis un contrôle de préparation serait un effet de bord inacceptable.

## 8. Attestations de réserve

Deux moitiés, plus un trigger.

**La clé privée**, qui signe :

```bash
npx wrangler secret put ATTESTATION_SIGNING_JWK --env production
```

Une clé **EC P-256 privée au format JWK**. Le code refuse explicitement une clé symétrique : elle
produirait un HMAC, vérifiable seulement par qui peut aussi le forger, ce qui viderait l'exercice
de son sens.

**La clé publique**, qui permet à un tiers de vérifier — dans la config `attestation_public_jwk`,
servie par `GET /api/v1/public/reserve/key`.

**Le trigger.** Ajouter à `wrangler.toml`, section de l'environnement visé :

```toml
[triggers]
crons = ["30 0 * * *"]
```

Le handler route déjà ce motif vers le job. Sans le trigger, rien n'est publié.

> Conserver les anciennes clés publiques lors d'une rotation : chaque signature porte son `kid`,
> donc les attestations passées restent vérifiables — à condition que la clé correspondante reste
> publiée.

## 9. Supervision

`SENTRY_DSN`, `ALERT_EMAIL_RECIPIENTS`, `ALERT_SMS_RECIPIENTS`. Sans eux, un incident en
production ne remonte nulle part.

---

## Récapitulatif — ce qui casse quoi

| Manque | Conséquence visible |
|---|---|
| `ENCRYPTION_KEY` | Aucun document KYC/KYB déposable |
| `admin_ip_allowlist` | Back-office joignable depuis le monde entier |
| `GOLD_API_KEY` | Ni achat ni vente |
| `WEBHOOK_SECRET` | Dépôts bloqués en attente |
| `FCM_SERVICE_ACCOUNT` | Aucune notification push |
| `ATTESTATION_SIGNING_JWK` + cron | Aucune preuve de réserve publiée |
| Clés paiement | Dépôts et retraits indisponibles |
