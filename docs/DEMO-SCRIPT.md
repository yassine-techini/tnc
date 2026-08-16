# Script de démonstration — TNC Trading

Ce document sert à faire une démo **sans mauvaise surprise**. Chaque étape
indique ce qu'elle exige de configuré. Une étape dont la configuration manque
ne rate pas discrètement : elle échoue, parce que la plateforme est *fail-closed*
sur la crypto et le paiement. Mieux vaut le savoir avant, pas devant le client.

**Avant toute chose** : ouvrez `/admin/readiness?probe=true` dans le back-office.
Il répond clé par clé à la seule question qui compte — *ce déploiement peut-il
réellement faire ce qu'il implémente ?* Les étapes ci-dessous reprennent
exactement ses identifiants (`gold_api`, `encryption_key`, …).

> Le rapport ne renvoie **jamais la valeur** d'un secret, seulement sa présence,
> et ne sonde **jamais** une passerelle de paiement : sonder un prestataire de
> paiement en production, c'est risquer une transaction réelle.

---

## Étape 0 — Contrôle avant démo (5 min)

| Vérifier | Où | Si absent |
|---|---|---|
| Migrations appliquées jusqu'à `0031` | `pnpm db:migrate` | Rien ne fonctionne |
| Rapport de readiness au vert sur les clés des étapes prévues | `/admin/readiness?probe=true` | Voir chaque étape |
| Un prix d'or récent en base | `/api/v1/market/price` | Achat et vente indisponibles |
| Pins SSL (si démo sur build mobile) | `pnpm --filter @tnc-trading/mobile check:pins` | Le build refuse l'API de production |

**Décidez à l'avance ce que vous ne montrerez pas.** Une démo qui annonce trois
parcours et en réussit trois vaut mieux qu'une qui en promet six.

---

## Parcours A — L'investisseur (8 min)

### A1. Inscription et connexion
**Configuration requise** : aucune pour créer le compte.
`email` (Resend ou SendGrid) pour recevoir le code de vérification, `sms`
(Twilio) pour la vérification téléphone.
**Sans ces clés** : le compte se crée, le code de vérification ne part pas.
Contournement : validez le compte depuis le back-office.

### A2. Consultation du prix
**Configuration requise** : `gold_api`. `exchange_rate_api` est facultative — sans
elle, la conversion USD→XOF utilise le taux de repli configuré, ce qui est
acceptable en démo mais doit être dit.
**Sans `gold_api`** : pas de prix, donc ni achat ni vente. C'est l'étape à
vérifier en premier.

### A3. KYC
**Configuration requise** : `encryption_key` **obligatoire**, `smile_identity`
pour la vérification automatique.
**Sans `encryption_key`** : le dépôt de document est **refusé**, délibérément —
la plateforme préfère refuser un document que le stocker en clair. Ce n'est pas
un bug à contourner en direct.
**Sans `smile_identity`** : le document est déposé et attend une validation
manuelle depuis le back-office. C'est un chemin de démo tout à fait montrable.

### A4. Dépôt et achat
**Configuration requise** : au moins un prestataire de paiement branché
(`orange_money`, `moov_money`, `cinetpay` ou `stripe`) et `gold_api`.
**Sans prestataire** : créditez le solde depuis le back-office et enchaînez sur
l'achat. Dites-le plutôt que de le masquer — un dépôt simulé présenté comme réel
est le genre de détail qui se retourne contre vous en due diligence.

### A5. Location d'or — *le morceau qui fait la différence*
**Configuration requise** : un solde en tokens. Aucune clé externe.

Montrez, dans cet ordre :
1. Les conditions : taux annuel, délai de sortie en jours ouvrés, minimum.
2. **L'avertissement**, lu à voix haute : l'or est *prêté*, il n'est plus en
   coffre, il n'est pas vendable tant que la position est ouverte.
3. La case à cocher obligatoire, puis l'ouverture.
4. Le portefeuille : les grammes **ont quitté** le solde.
5. La page `/reserve` : `gold_on_loan` a augmenté d'autant.

C'est le point 5 qui vaut la démonstration. La plateforme ne dissimule pas ce
qu'elle prête ; elle l'affiche sur la page publique.

**Le rendement est en XOF, jamais en tokens.** L'accrual quotidien tourne à
4 h UTC : sur un environnement de démo fraîchement lancé, il n'y a encore rien
d'accumulé. Deux options : accepter d'expliquer que le premier calcul a lieu le
lendemain, ou faire tourner le job une fois à l'avance.

### A6. Sortie de location
**Configuration requise** : une position ouverte.
Montrez la seconde confirmation et sa phrase : la sortie **rend** l'or, elle ne
le vend pas. Le règlement tombe à T+n **jours ouvrés** — le délai est le rappel
du prêt, pas un délai administratif ([ADR 004](adr/004-sortie-de-location.md)).
La position cesse de produire dès la demande.

### A7. Certificat de propriété
**Configuration requise** : aucune. Le PDF est généré à l'émission.
Ouvrez le PDF : il porte un **poids, jamais une valeur**, et si le titulaire a
une position de location, il distingue *disponible en portefeuille* de *placé en
location*. Puis vérifiez le code sur `/verify` — publiquement, sans compte.

---

## Parcours B — Le producteur / la coopérative (8 min)

### B1. Dossier KYB
**Configuration requise** : `encryption_key`.
**Sans elle** : les pièces du dossier sont refusées, comme en A3.

### B2. Dépôt d'un lot
**Configuration requise** : aucune clé. Autorisation de localisation sur mobile
pour un relevé d'appareil.
Montrez la différence que la plateforme maintient partout : une position
**relevée par l'appareil** est une preuve, une zone **saisie** est une
déclaration. Les deux sont acceptées, jamais confondues — le relevé de règlement
le redit noir sur blanc.

### B3. Documents d'origine
**Configuration requise** : `encryption_key`.
Certificat d'origine, déclaration minière, document de transport, rapport
d'essai — typés, avec émetteur et référence. C'est ce qui rend la filière
« certifiée » au sens du deck.

### B4. Chaîne transitaire → Dubaï
**Configuration requise** : un compte admin avec le rôle transitaire.
Validation transitaire → transit → arrivée à Dubaï. Chaque transition est
horodatée et tracée.

### B5. Acompte à la réception
**Configuration requise** : `settlement_advance_percent`, `_currency`,
`_haircut` (valeurs par défaut en base).
L'acompte est calculé sur le poids **déclaré**, avec une décote de prudence,
parce que l'essai n'a pas encore eu lieu. Un acompte versé en tokens **alloue
l'or qu'il émet** : l'invariant `tokens_issued <= total_allocated` tient à
chaque étape, pas seulement à la fin.

### B6. Essai et solde
**Configuration requise** : un compte admin.
Saisissez le poids raffiné. Le solde versé est le **dû moins l'acompte**, jamais
le dû entier — et si l'essai ressort sous l'acompte, rien de plus n'est versé et
rien n'est repris.

### B7. Relevé de règlement (PDF)
**Configuration requise** : aucune.
Producteur et back-office téléchargent **le même document**. Poids déclaré,
essai, part appliquée, acompte, solde, total, parcours du lot. Un lot encore en
transit est documenté « en attente », pas réglé à zéro.

---

## Parcours C — Le tiers vérificateur (5 min) — *la démo la plus forte*

À faire **depuis un navigateur en navigation privée, sans compte**. C'est le but.

### C1. Page publique de réserve
**Configuration requise** : `attestation_signing_key`, `attestation_public_jwk`,
et au moins une attestation publiée (cron `30 0 * * *`).
**Sans la clé de signature** : le job ne publie **rien** plutôt qu'une
attestation non signée. La page est alors vide — et c'est le comportement
voulu, pas une panne.

Montrez : total alloué, tokens émis, **part prêtée**, part réellement en coffre.
La divulgation du prêt est sur la page publique, pas dans une note de bas de page.

### C2. Vérification d'une attestation
**Configuration requise** : `attestation_public_jwk` publiée.
La vérification de signature s'exécute **dans le navigateur du visiteur**, avec
la clé publique. Personne n'a à nous croire sur parole. Chaque attestation
contient l'empreinte de la précédente : vérifier la dernière couvre l'historique
derrière elle.

### C3. Ancrage sur chaîne publique
**Configuration requise** : `ANCHOR_RPC_URL` et `ANCHOR_PRIVATE_KEY`, cron
`0 1 * * *`. Sur un réseau principal, `ANCHOR_ALLOW_MAINNET=true` est exigé
explicitement.
**Sans ancrage** : l'attestation **reste vérifiable**. L'ancrage est une
confirmation supplémentaire, jamais une condition ([ADR 003](adr/003-ancrage-attestations.md)).
Dites-le ainsi : cela montre que l'architecture ne dépend pas d'une blockchain
pour tenir sa promesse.

### C4. Vérification d'un certificat
**Configuration requise** : aucune.
Saisissez le code d'un certificat émis en A7 sur `/verify`.

---

## Parcours D — L'État (3 min)

**Configuration requise** : un compte État, **mot de passe + TOTP obligatoire**,
et `state_ip_allowlist` si vous démontrez le filtrage réseau.
**Attention** : si la liste d'IP est renseignée et que votre IP de démo n'y est
pas, **le portail refusera la connexion** — c'est le contrôle réseau qui
fonctionne. Vérifiez-le avant la réunion, pas pendant.

Tableau de bord, état du stock, preuve de réserve, rapport mensuel. Lecture
seule : le portail État ne peut rien modifier, et c'est un argument, pas une
limite.

---

## Ce qu'il faut dire quand la question tombe

**« C'est sur la blockchain ? »**
Non, et c'est un choix documenté ([ADR 002](adr/002-smart-contracts.md)). La
propriété est tenue en base avec une piste d'audit ; ce qui est ancré
publiquement, c'est l'**empreinte signée** de l'état des réserves. Un smart
contract n'aurait pas rendu l'or plus présent dans le coffre.

**« Le rendement de 6 %, il vient d'où ? »**
De la **mise en prêt de l'or**. Ce n'est pas un rendement sorti de nulle part,
et la plateforme l'affiche : l'or prêté apparaît en `gold_on_loan` sur la page
publique et sur l'attestation signée. Un investisseur a le droit de savoir que
son or n'est pas dans le coffre pendant qu'il rapporte.

**« Vous êtes prêts pour l'Ouganda ? »**
La configuration existe — UGX, indicatif, pièces d'identité ougandaises. **Les
paiements, non** : MTN MoMo et Airtel Money sont déclarés *non implémentés*, et
le pays est marqué non ouvrable tant qu'aucun moyen de paiement ne fonctionne.
Répondre cela vaut mieux que de montrer une liste de pays qui laisse croire le
contraire.

**« Combien de temps pour ouvrir un nouveau pays ? »**
Une ligne dans `country_config` pour la zone UEMOA — même devise, mêmes pièces.
Hors zone franc, il faut en plus un adaptateur de paiement et la conversion de
devise ; c'est le vrai coût, et il est visible dans la table.

---

## Ce qu'il ne faut pas promettre en démo

- **Les paiements Ouganda** — l'interface est déclarée, l'adaptateur n'existe pas.
- **La vente automatique à la sortie de location** — la sortie rend l'or ; la
  vente reste une action de l'utilisateur (ADR 004).
- **Les tests bout-en-bout mobiles** — la logique est testée, pas les écrans sur
  appareil.
- **L'ancrage sur réseau principal** — configuré pour un réseau de test par
  défaut, et le passage en mainnet exige un opt-in explicite.

Chacun de ces points est déjà écrit dans
[FONCTIONNALITES-IMPLEMENTEES.md](FONCTIONNALITES-IMPLEMENTEES.md). Le tenir à
jour, c'est ce qui permet de répondre vite et juste sous pression.
