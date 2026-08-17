# ADR 009 — Second facteur sur les transactions de forte valeur : échec fermé

- **Statut** : accepté
- **Date** : 2026-08-17
- **Contexte** : écart A relevé à l'audit du 17 août 2026

## Contexte

`CLAUDE.md` ligne 246 énonce, parmi les règles de sécurité : « 2FA obligatoire
pour transactions > seuil ». L'audit a montré que la règle n'était appliquée
nulle part.

Le plus instructif est que **tout le nécessaire était déjà écrit** :

- `SECURITY_DEFAULTS.HIGH_VALUE_THRESHOLD_XOF = 1 000 000`,
- la clé de configuration `high_value_threshold_xof`, modifiable sans déploiement,
- `SecurityService.isHighValueTransaction(amount)`,
- `SecurityService.verifyTotpCode(secret, code, replayGuardId)`, avec garde
  anti-rejeu.

`isHighValueTransaction()` n'était appelée par **personne**. Le garde-fou avait
été construit puis jamais branché — un retrait de 5 000 000 XOF ne demandait
aucun second facteur.

## Décisions

### 1. Le seuil porte sur le montant en francs, pas sur les grammes

`HIGH_VALUE_THRESHOLD_XOF` est déjà libellé en XOF, et les trois opérations
concernées (achat, vente, retrait) ont toutes un montant en francs. Le prix de
l'or bouge ; un seuil en grammes se déplacerait avec lui, ce qu'un responsable
conformité ne veut pas.

Montant retenu : ce qui **change de mains**. Pour un achat, le total débité
(montant + frais) ; pour une vente, le net crédité ; pour un retrait, la somme
demandée.

### 2. Un compte sans second facteur est refusé, pas dispensé

La connexion par mot de passe impose déjà l'enrôlement. Mais le chemin **sans
mot de passe** n'exige le code que si l'utilisateur l'a déjà activé : un compte
qui n'a jamais utilisé le mot de passe peut donc exister sans TOTP.

Pour ces comptes, deux lectures possibles au moment d'une grosse opération :

- laisser passer, faute de facteur à vérifier ;
- refuser et demander l'enrôlement.

**On refuse.** Laisser passer ferait de la règle une décoration : elle
protégerait exactement les comptes qui ont déjà fait l'effort, et pas ceux qui ne
l'ont pas fait. Le refus renvoie `AUTH_2FA_SETUP_REQUIRED`, que les clients
savent déjà traiter — c'est le code utilisé à la connexion.

Coût assumé : un utilisateur peut se retrouver bloqué en cours de retrait
jusqu'à ce qu'il enrôle une application d'authentification. C'est le prix d'une
règle qui protège réellement, et le parcours d'enrôlement existe déjà.

### 3. La vérification a lieu AVANT la consommation du devis

`useQuote()` marque le devis `USED` de façon atomique — c'est ce qui empêche
qu'un même devis serve deux fois. Vérifier le code après cet appel ferait perdre
le devis à chaque code mal saisi, et le prix aurait changé au moment de
recommencer.

La vérification lit donc le devis sans le consommer (`getQuote`), contrôle
l'appartenance, applique le seuil, et ne laisse consommer qu'ensuite. Un code
erroné coûte une nouvelle saisie, pas un nouveau devis.

### 4. Un refus renvoie 403, jamais 401

Premier réflexe : 401, « il manque une authentification ». C'était une erreur, et
elle aurait été coûteuse — **les trois clients traitent un 401 comme une session
expirée**, tentent un rafraîchissement, puis déconnectent. Un retrait au-dessus du
seuil aurait jeté l'utilisateur dehors au lieu de lui demander six chiffres.

403 est aussi la bonne lecture : la session *est* valide, c'est l'opération qui
est interdite sans second facteur. Un test fige ce choix, parce que rien dans le
code ne le rappellerait autrement.

### 5. Le code est à usage unique, y compris entre opérations

`verifyTotpCode` est appelée avec l'identifiant de l'utilisateur comme garde
anti-rejeu. Un même code à six chiffres ne peut donc pas valider deux
transactions dans sa fenêtre de trente secondes — ce qui serait exactement le
scénario d'un code intercepté et rejoué.

## Conséquences

- Trois routes concernées : `POST /market/buy`, `POST /market/sell`,
  `POST /wallet/withdraw`.
- `totpCode` devient un champ optionnel de leurs corps de requête — exigé
  seulement au-dessus du seuil, pour ne pas alourdir les petites opérations.
- Trois codes d'erreur renvoyés, tous en **403** : `AUTH_2FA_REQUIRED` (code
  absent), `AUTH_2FA_INVALID` (code refusé) et `AUTH_2FA_SETUP_REQUIRED` (aucun
  facteur enrôlé).
- Chaque défi émis et chaque échec sont journalisés comme évènements de sécurité :
  une série d'échecs sur de gros montants est un signal, et il doit être visible.
- Le seuil reste modifiable en base (`high_value_threshold_xof`) sans
  redéploiement, comme les limites KYC.

## Ce qui n'est pas fait

Les **codes de secours** (déjà générés à l'activation du 2FA) ne sont pas
acceptés ici : ils servent à récupérer un accès perdu, pas à valider une
opération courante. Les accepter reviendrait à offrir un contournement permanent
à qui les a copiés.
