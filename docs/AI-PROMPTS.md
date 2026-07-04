# Playbook — 10 prompts IA pour développer sur TNC Trading

> Adaptation, à la stack de ce projet, des **« 10 indispensable prompts »** de l'équipe Google Cloud
> ([article source](https://cloud.google.com/blog/topics/developers-practitioners/10-indispensable-prompts-our-team-refuses-to-build-without)).
> Fil conducteur : faire de l'IA un **relecteur adversarial** qui débusque les hypothèses, cas limites et risques
> qu'on rate quand on a « le nez dans le guidon ».
>
> Stack ciblée : **Cloudflare Workers + HonoJS + D1** (`packages/api`), **React + Vite** (`apps/web`, `apps/admin`,
> `apps/state-portal`), **React Native + Expo** (`apps/mobile`), tests **Vitest** + Playwright.
> Les prompts ci-dessous sont réécrits pour cette stack (les originaux visaient Flutter/Android).

Comment s'en servir : copier le prompt, l'exécuter dans l'agent (Claude Code / Gemini CLI) à la racine du repo.
Les résultats de leur première application à ce projet sont dans [`AI-PROMPTS-RESULTS.md`](./AI-PROMPTS-RESULTS.md).

---

## 1. Construire une spec (avant de coder)

**Quand** : nouvelle fonctionnalité (ex. staking d'or, parrainage, nouveau moyen de paiement). À faire **avant** toute ligne de code.

```
Agis comme un Principal Architect / PM technique cynique. Je veux construire [fonctionnalité]
permettant à [type d'utilisateur] de [action], sur la stack TNC (Cloudflare Workers + Hono + D1,
front React/React Native). N'écris pas de code. Liste les 5 principales considérations techniques,
UX, sécurité et d'exactitude financière. Pour chacune, pose-moi les questions clés dont tu as besoin.
Une fois mes réponses obtenues, produis un PRD court + un plan d'implémentation. Ne sur-conçois ni
ne sous-conçois : reste au niveau d'altitude adapté à une V1 souveraine.
```

## 2. Combler les lacunes de tests UI / composants

**Quand** : augmenter la robustesse d'un front (`apps/web`, `apps/admin`, `apps/state-portal`, `apps/mobile`).

```
Partenaire avec moi pour fiabiliser [apps/web] via des tests de composants (Vitest + @testing-library/react ;
pour mobile, React Native Testing Library). Procède étape par étape, sans passer à l'étape suivante tant que
ton raisonnement n'est pas certain :
1. Repère les zones UI/UX critiques non testées (formulaires KYC, achat/vente, retrait, 2FA, sessions).
2. Évalue si le code est écrit de façon testable ; propose les refactors minimaux si non.
3. Classe les domaines par niveau de rigueur requis (les flux financiers d'abord).
4. Établis un plan de tests global + la liste des tests manquants.
5. Implémente le plan.
```

## 3. Trouver les tests manquants + nettoyer le commit

**Quand** : juste avant d'ouvrir une PR.

```
(a) Lance toute la suite (`pnpm --filter @tnc-trading/api exec vitest run`) et identifie puis écris les
tests manquants, en insistant sur les cas limites et les conditions de course (achat/vente concurrents,
webhooks rejoués, refresh après reset).
(b) Passe en revue le diff de ce commit : repère le code mort, les commentaires gênants ou incohérents
avec le code, les TODO non résolus, les console.log de debug, et tout ce qui ne devrait pas partir en prod.
```

## 4. Vérifier les permissions (mobile Expo)

**Quand** : avant un build EAS de `apps/mobile`. (Équivalent RN/Expo du prompt Android original.)

```
Audite `apps/mobile` pour des permissions correctes et minimales :
1. Extrais la liste maîtresse des permissions déclarées : `app.json` (android.permissions, ios.infoPlist
   NS*UsageDescription) + les plugins Expo (expo-camera, expo-local-authentication, expo-notifications…).
2. Croise avec le code (`app/`, `lib/`, `stores/`) : chaque permission est-elle réellement utilisée ?
   Signale le bloatware / permissions inutilisées et les permissions manquantes pour une feature présente.
3. Vérifie que chaque permission runtime implémente bien la demande dynamique (request()) et gère le refus.
4. Vérifie la cohérence du SSL pinning (`plugins/withSSLPinning`, `lib/ssl-pinning.ts`) : pins prod présents,
   pas de placeholder, gestion d'échec.
Sortie : rapport Markdown avec chemins de fichiers et diffs suggérés. N'édite rien tant que je n'ai pas validé.
```

## 5. Revue de code stricte, notée A→F

**Quand** : avant merge d'une PR sensible.

```
Agis comme un Principal Engineer extrêmement exigeant, tolérance zéro pour le code fragile « happy-path ».
Note mes changements non commités (ou `git diff main..HEAD`) de A à F sur la maturité prod — pas de A sauf
robustesse exceptionnelle. Analyse : (1) Efficacité (appels API/DB redondants, fuites non cachées, N+1) ;
(2) Résilience (échecs silencieux, absence de bornes d'erreur, fallbacks rate-limit/KV/DB manquants,
fail-open vs fail-closed) ; (3) Architecture (couplage fort, séparation des responsabilités) ; (4) sur les
flux financiers : atomicité, invariant de stock, anti double-dépense. Pour chaque problème, explique où le
code casse en production réelle, puis donne le git diff exact pour atteindre le « A ».
```

## 6. Expliciter les compromis pour décider

**Quand** : l'IA propose un plan et il faut trancher.

```
Explique le pour/contre de ton plan d'implémentation. Sois précis sur les compromis en termes de
performance, coût (Workers/D1/KV/R2), sécurité et maintenabilité, pour que je décide en connaissance de cause.
```

## 7. Fiabiliser le code généré par IA via recherche

**Quand** : après avoir généré du code sur une techno du projet.

```
Recherche en ligne (issues GitHub, StackOverflow, blogs tech) les pièges de sécurité, désalignements
d'architecture et erreurs de logique subtiles fréquents dans le code IA pour [Cloudflare Workers / HonoJS /
D1 / React / Expo]. À partir de ces constats, génère une checklist de revue manuelle ciblant les zones à
haut risque de NOTRE stack (auth JWT, atomicité D1, webhooks signés, gestion des secrets, RBAC). Garde
l'humain dans la boucle là où ça compte.
```

## 8. Trouver les problèmes par itération (regard neuf)

**Quand** : après une première revue ; on veut un second passage « yeux neufs ».

```
Passage 1 (nouvelle session, peu de consignes pour éviter les angles morts) :
« Fais une revue des changements non commités. »
Passage 2 (plus ciblé) :
« Revue des changements non commités : identifie les cas limites non gérés, évalue la performance,
  résume les constats. »
```

## 9. Revoir chaque Pull Request automatiquement (CI)

**Quand** : en continu, dans GitHub Actions, comme premier passage avant la revue humaine.

> Fourni dans ce repo : [`.github/workflows/ai-pr-review.yml`](../.github/workflows/ai-pr-review.yml) — inactif tant que
> le secret `GEMINI_API_KEY` (ou `ANTHROPIC_API_KEY`) n'est pas configuré. Le prompt d'agent embarqué :

```
Tu es un agent de revue de code autonome de classe mondiale, opérant dans GitHub Actions sur une PR d'une
plateforme fintech (Cloudflare Workers/Hono/D1 + React/Expo). Analyse le diff de la PR pour : bugs et cas
limites, failles de sécurité (auth, secrets, injections, webhooks non vérifiés), exactitude financière
(atomicité, invariant de stock), et régressions. Poste tes retours en commentaires de PR, priorisés, avec
fichier:ligne et correctif suggéré. Laisse les sujets d'architecture de haut niveau au relecteur humain.
```

## 10. Analyse DAG pour cibler les tests

**Quand** : décider quels tests écrire en priorité sur un workflow complexe.

```
Modélise le workflow [achat/vente | retrait | KYC | auth] comme un graphe orienté acyclique (nœuds =
composants/étapes, arêtes = transitions). Identifie les tests les plus impactants à trois niveaux :
composants, « seams » (frontières route→service→D1, webhook→réconciliation), et système de bout en bout.
Présente le résultat en tableau Markdown d'analyse de lacunes priorisée (P0/P1/P2).
```

---

_Adapté par l'équipe TNC à partir de l'article Google Cloud « 10 indispensable prompts our team refuses to build without »._
