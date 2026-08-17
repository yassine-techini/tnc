# Parcours bout-en-bout — application mobile

Trois parcours Maestro sur l'application réelle, plus un contrôle statique qui
s'exécute partout.

> **État : les parcours n'ont jamais été exécutés contre un appareil.** Ils sont
> écrits et leurs sélecteurs sont prouvés existants (voir plus bas), mais la
> machine de développement n'a ni image système Android, ni JDK, ni Maestro
> installé. Le premier passage sur émulateur reste à faire, et il révélera
> probablement des attentes à ajuster — c'est normal et attendu.

## Les parcours

| Fichier | Ce qu'il vérifie |
|---|---|
| `01-connexion.yaml` | La porte d'entrée : identifiants → arrivée dans la zone authentifiée. |
| `02-achat.yaml` | Le chemin de l'argent : devis, confirmation explicite, solde qui bouge. |
| `03-kyc-insuffisant.yaml` | **Un refus.** Un compte `BASIC` ne peut pas acheter et l'écran le dit. |
| `sous-parcours/connexion.yaml` | Connexion réutilisable, pour qu'un échec d'achat ne soit pas un échec de connexion déguisé. |

`03` est le plus important des trois. Un parcours qui vérifie seulement que
l'achat fonctionne ne verrait jamais une limite KYC se rompre — et une règle de
conformité qui se rompt en silence ne se remarque qu'à l'audit.

## Le contrôle qui tourne sans appareil

```bash
pnpm --filter @tnc-trading/mobile e2e:verifier
```

Il confronte chaque `id:` des parcours aux `testID` réellement posés dans
`app/` et `components/`, et vérifie que chaque `runFlow:` désigne un fichier
existant. Il **ne prouve pas** qu'un parcours passe — seulement qu'il ne
désigne rien d'imaginaire.

C'est la même faute que les types de client qui déclaraient des champs
inexistants : sans ce contrôle, renommer `marche-valider` casse un parcours qui
n'échouera que sur un appareil, après une compilation complète, avec un message
de délai dépassé qui ressemble à une lenteur réseau.

Le contrôle est aussi un test (`scripts/check-e2e-selectors.test.mjs`), donc il
part avec `pnpm test` sans qu'on ait à y penser.

## Exécuter les parcours

Prérequis, dans l'ordre :

1. **JDK 17+** — Maestro tourne sur la JVM.
2. **Maestro** — `curl -Ls "https://get.maestro.mobile.dev" | bash`
   (sous Windows : via WSL, ou `iwr` selon la documentation Maestro).
3. **Un appareil** — émulateur Android avec une image système
   (`sdkmanager "system-images;android-35;google_apis;x86_64"` puis `avdmanager create avd`),
   ou un téléphone en débogage USB.
4. **L'application installée** — les parcours pilotent `com.tnc.trading`, donc
   une compilation native :
   ```bash
   pnpm --filter @tnc-trading/mobile exec expo prebuild --platform android
   pnpm --filter @tnc-trading/mobile exec expo run:android
   ```
   Expo Go ne convient pas : il porte son propre identifiant d'application.

Puis :

```bash
pnpm --filter @tnc-trading/mobile e2e
```

## Les comptes attendus

Les parcours lisent leurs identifiants dans `env:`. Les valeurs par défaut
supposent les comptes de démonstration décrits dans `docs/DEMO-SCRIPT.md` :

| Variable | Compte | Niveau KYC attendu |
|---|---|---|
| `IDENTIFIANT` / `MOT_DE_PASSE` (01, 02) | `client.demo@tnc-trading.com` | `VERIFIED`, avec du solde |
| `IDENTIFIANT` / `MOT_DE_PASSE` (03) | `client.basic@tnc-trading.com` | `BASIC` |

Pour viser un autre environnement :

```bash
maestro test e2e/ -e IDENTIFIANT=... -e MOT_DE_PASSE=...
```

**Aucun mot de passe réel ne doit être écrit dans ces fichiers.** Les valeurs
présentes sont celles de comptes de démonstration jetables ; en intégration
continue, elles passent par `-e` depuis les secrets du dépôt.

## Ajouter un parcours

1. Poser un `testID` sur ce qu'on veut désigner — écrit **en entier**, jamais
   assemblé par interpolation : le contrôle ne trouverait pas un identifiant
   construit à l'exécution, et laisserait passer le parcours sans rien vérifier.
2. Écrire le `.yaml`, en préférant les `id:` aux libellés affichés (les libellés
   sont traduisibles, les identifiants non).
3. Lancer `pnpm e2e:verifier` avant même d'avoir un appareil sous la main.
