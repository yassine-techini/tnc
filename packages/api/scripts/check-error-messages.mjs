/**
 * Aucune reponse d'erreur ne porte son texte — ADR 025.
 *
 * Le texte d'une erreur vit dans `lib/messages-erreur.ts`, qui possede les deux
 * langues. Un site d'appel nomme un code ; s'il ecrit aussi une phrase, cette
 * phrase existe en une seule langue et devient une seconde source de verite qui
 * derive des la premiere retouche.
 *
 * TROIS SENS, et le troisieme est celui qui coute cher :
 *
 *   1. Un message litteral dans une reponse d'erreur : du francais fige.
 *   2. Un code emis absent du catalogue : `texte()` rendrait `undefined`.
 *   3. Un `texte(c, 'X')` pose a cote d'un `code: 'Y'`. Le message est traduit,
 *      correct, et parle d'autre chose que de l'erreur. C'est le seul des trois
 *      qu'une relecture ne voit pas : les deux lignes sont justes chacune de son
 *      cote.
 *
 * Le code se retrouve ecrit deux fois sur deux lignes voisines ; c'est le prix
 * d'avoir laisse la forme de la reponse tranquille plutot que de reecrire 359
 * sites de controle de flux. La duplication est acceptable parce qu'elle est
 * verifiee ici.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const NL = String.fromCharCode(10);
const SEPARATEUR = String.fromCharCode(92);
const BS = String.fromCharCode(92);
const QUOTE = String.fromCharCode(39);
const FIN_DE_LIGNE = new RegExp(String.fromCharCode(92) + 'r?' + String.fromCharCode(92) + 'n');
const RACINE = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Le catalogue lui-meme ecrit les textes : c'est sa raison d'etre.
 *
 * `ownership.ts` est un cas different : il RECOIT son libelle en parametre
 * requis, sans valeur par defaut. Le texte n'est donc jamais ecrit ici — il
 * vient de l'appelant, qui est controle, lui.
 */
const HORS_CONTROLE = new Set([
  'lib/messages-erreur.ts',
  'lib/reponse-erreur.ts',
  'lib/ownership.ts',
]);

/**
 * Ces cles ne designent pas un code d'erreur.
 *
 * `country_config` porte un `code:` qui est un code pays, et un evenement de
 * securite porte un `code:` qui n'a pas de message. Les confondre ferait crier
 * le controle sur du code sain — et un controle qui crie a tort finit par etre
 * desactive.
 */
const PAS_UN_CODE_ERREUR = /^[A-Z]{2}$/;

/**
 * Une chaine de cette expression est-elle de la prose ?
 *
 * Un espace ou un caractere accentue trahit une phrase destinee a etre lue.
 * `'NOT_FOUND'`, `'dossier'`, `'XOF'` n'en ont ni l'un ni l'autre : ce sont des
 * cles, et elles ont le droit de rester ecrites en clair.
 */
function estUnePhrase(expression) {
  for (const m of expression.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
    const contenu = m[1] ?? m[2] ?? m[3] ?? '';
    if (/\s/.test(contenu) || /[^\x00-\x7F]/.test(contenu)) return true;
  }
  return false;
}

function fichiersSource(racine) {
  const trouves = [];
  (function marcher(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) marcher(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) trouves.push(p);
    }
  })(racine);
  return trouves;
}

/** Les codes que le catalogue connait. */
function lireCatalogue() {
  const source = readFileSync(join(RACINE, 'lib/messages-erreur.ts'), 'utf8');
  const corps = source.slice(source.indexOf('export const MESSAGES'));
  const codes = new Set();
  for (const m of corps.matchAll(/^ {2}'?([0-9A-Z][0-9A-Z_]*)'?:\s*\{/gm)) codes.add(m[1]);
  return codes;
}

function verifierLeDepot(catalogue) {
  const problemes = [];

  for (const fichier of fichiersSource(RACINE)) {
    const rel = relative(RACINE, fichier).replace(/\\/g, '/');
    if (HORS_CONTROLE.has(rel)) continue;

    // Decouper sur NL seul laisse un \r en fin de ligne sur les fichiers CRLF.
    // `.` ne franchit pas un \r — c'est un terminateur de ligne en JavaScript —
    // donc `message:\s*(.*)$` n'y matchait jamais et le controle se declarait
    // satisfait sur la moitie du depot. Un controle qui sous-detecte rassure.
    const lignes = readFileSync(fichier, 'utf8').split(/\r?\n/);

    for (let i = 0; i < lignes.length; i++) {
      // `[0-9A-Z]` en tete, pas `[A-Z]` : les codes `2FA_*` des portails
      // privilegies commencent par un chiffre. Quinze sites leur ont echappe.
      //
      // Et le code n'est pas toujours un LITTERAL : `code: result.error`,
      // `code: verdict.code`. La regle ne s'accrochait qu'aux litteraux, et
      // laissait donc passer trois `Record<string, string>` de messages
      // francais indexes par code — la forme meme qu'elle existe pour
      // interdire. Elle s'accroche desormais aux deux, et se contente de
      // verifier l'usage du catalogue quand le code est calcule.
      const mCode = lignes[i].match(
        /\bcode:\s*(?:'([0-9A-Z][0-9A-Z_]*)'|([A-Za-z_$][\w$.]*))/
      );
      if (!mCode) continue;
      const code = mCode[1];
      const codeCalcule = !code;
      if (code && PAS_UN_CODE_ERREUR.test(code)) continue;
      // `code: string` dans une signature de fonction n'est pas une reponse.
      if (/^(string|number|boolean)$/.test(mCode[2] || '')) continue;

      // Le message accompagne le code sur sa ligne, ou dans les trois suivantes,
      // sans franchir la fermeture de l'objet.
      for (let j = i; j <= Math.min(i + 3, lignes.length - 1); j++) {
        if (j > i && /^\s*\}/.test(lignes[j])) break;
        const mMessage = lignes[j].match(/\bmessage:\s*(.*)$/);
        if (!mMessage) continue;

        const valeur = mMessage[1].trim();

        // `{ code: 'NOT_FOUND'; message: string }` est une ANNOTATION DE TYPE,
        // pas une reponse. Le controle y voyait un site d'erreur sans texte de
        // catalogue et refusait un fichier sain.
        if (/^(string|number|boolean)\b/.test(valeur)) break;

        // La valeur n'est pas forcement l'appel seul : un message de validation
        // redige dans un schema Zod reste affiche, avec le catalogue en repli
        // (`issues[0]?.message || texte(c, 'X')`), et l'erreur generique laisse
        // passer le detail technique en developpement seulement. Ce qui est
        // interdit, c'est une PHRASE : elle n'existerait qu'en une langue.
        //
        // Une phrase se reconnait a un espace ou a un accent. Les autres
        // chaines sont des cles : un code, une ressource, une devise. Distinguer
        // sur la seule presence d'un guillemet aurait pris
        // `{ ressource: 'dossier' }` pour du texte.
        if (estUnePhrase(valeur)) {
          problemes.push({ rel, ligne: j + 1, quoi: 'message litteral', detail: code });
          break;
        }

        /**
         * Code calcule : `code: result.error`, `code: e.code`.
         *
         * La concordance n'est pas verifiable, et l'exigence d'un `texte()` sur
         * place ne l'est pas non plus : le message a souvent ete construit
         * ailleurs (`e.message`, `messageObstacle(...)`) — legitimement, et le
         * lieu de construction est lui-meme scanne. Ce qui reste verifiable, et
         * qui est le vrai defaut, c'est la PROSE : elle a deja ete refusee
         * au-dessus. On s'arrete donc ici.
         *
         * LIMITE ASSUMEE : une prose cachee derriere deux indirections
         * echapperait. C'est pourquoi la regle des cartes de messages, plus bas,
         * existe separement.
         */
        if (codeCalcule) break;

        // La valeur peut s'etaler sur plusieurs lignes — un ternaire, un appel
        // enveloppe. On elargit la fenetre pour chercher l'appel au catalogue,
        // sans elargir celle de la prose, qui doit rester serree.
        const valeurLarge = lignes.slice(j, j + 5).join(' ');

        // `messageValidation(c, issues)` met en mots le premier probleme d'un
        // schema (ADR 027). C'est le catalogue de validation qui parle, pas le
        // site d'appel : il n'a pas de code a nommer.


        const mTexte = valeurLarge.match(/texte\(\s*c\s*,\s*'([0-9A-Z][0-9A-Z_]*)'/);
        if (!mTexte && !valeurLarge.includes('messageValidation(c,')) {
          problemes.push({
            rel,
            ligne: j + 1,
            quoi: 'message hors catalogue',
            detail: `${code} : ${valeur.slice(0, 48)}`,
          });
          break;
        }

        if (mTexte && mTexte[1] !== code) {
          problemes.push({
            rel,
            ligne: j + 1,
            quoi: 'le message parle d un autre code',
            detail: `code ${code}, texte ${mTexte[1]}`,
          });
        }
        if (!catalogue.has(code)) {
          problemes.push({ rel, ligne: j + 1, quoi: 'code absent du catalogue', detail: code });
        }
        break;
      }
    }

    /**
     * Aucune carte de messages indexee par code, dans une route.
     *
     * `{ INSUFFICIENT_BALANCE: 'Solde en or insuffisant', … }` puis
     * `message: messages[result.error]` : la prose est a deux pas du site
     * d'erreur, et le code y etant calcule, la regle principale ne la voyait
     * pas. Trois routes en portaient une.
     *
     * Restreint a `routes/` et `middleware/` a dessein : `lib/` et `services/`
     * contiennent des cartes de LIBELLES — types de documents, niveaux de
     * verification, natures de transaction — qui composent des documents
     * francais et ne sont pas des messages d'erreur.
     */
    if (rel.startsWith('routes/') || rel.startsWith('middleware/')) {
      for (let i = 0; i < lignes.length; i++) {
        // Pas d'ancrage en debut de ligne : une carte ecrite sur UNE seule
        // ligne est la meme faute, et elle passait.
        const m = lignes[i].match(/\b([A-Z][A-Z0-9_]{3,}):\s*((['"`])(?:(?!\3).)*\3)/);
        if (m && estUnePhrase(m[2])) {
          problemes.push({
            rel,
            ligne: i + 1,
            quoi: 'carte de messages indexee par code',
            detail: m[1],
          });
        }
      }
    }

    /**
     * Tout `zValidator` porte le hook partage — ADR 026.
     *
     * Sans lui, `@hono/zod-validator` repond `c.json(result, 400)` : le
     * `ZodError` brut, sans `code`, sans `message`, sans `requestId`. Vingt-six
     * routes le faisaient. Le controle est ici parce que la prochaine route
     * ajoutee le referait, et que personne ne le verrait avant qu'un client ne
     * s'en plaigne.
     */
    for (let i = 0; i < lignes.length; i++) {
      if (!/\bzValidator\(/.test(lignes[i])) continue;
      const fenetre = lignes.slice(i, i + 3).join(' ');
      if (!fenetre.includes('surErreurDeValidation')) {
        problemes.push({
          rel,
          ligne: i + 1,
          quoi: 'zValidator sans le hook partage',
          detail: lignes[i].trim().slice(0, 56),
        });
      }
    }

    // Un `texte(c, 'X')` peut aussi vivre loin d'un `code:` — il doit tout de
    // meme designer une entree qui existe.
    for (let i = 0; i < lignes.length; i++) {
      for (const m of lignes[i].matchAll(/\btexte\(\s*c\s*,\s*'([0-9A-Z][0-9A-Z_]*)'/g)) {
        if (!catalogue.has(m[1])) {
          problemes.push({
            rel,
            ligne: i + 1,
            quoi: 'code absent du catalogue',
            detail: m[1],
          });
        }
      }
    }
  }

  return problemes;
}

/**
 * Aucune prose dans un schema Zod — ADR 027.
 *
 * Un message pose sur un schema l'emporte sur toute carte d'erreurs : ecrit en
 * clair, il n'existe qu'en une langue et rien ne peut le traduire. Les regles
 * dont l'intention ne se deduit pas du probleme portent donc une CLE, et les
 * autres ne portent plus rien du tout.
 *
 * Le paquet partage est scanne aussi : c'est la que vivent les schemas
 * d'inscription et de mot de passe.
 */
function verifierLesSchemas() {
  const problemes = [];
  const racines = [RACINE, join(RACINE, '../../shared/src')];

  // Construites sans barre oblique inverse litterale : ce fichier a ete ecrit
  // plusieurs fois a travers un shell qui les mangeait.
  const CHAINE = new RegExp(QUOTE + '((?:[^' + QUOTE + BS + BS + ']|' + BS + BS + '.){3,}?)' + QUOTE, 'g');
  const BLANC = new RegExp(BS + 's');
  const NON_ASCII = new RegExp('[^' + BS + 'x00-' + BS + 'x7F]');
  const CLE = new RegExp('^[A-Z][A-Z0-9_]*$');
  const METHODE = new RegExp('^' + BS + 's*' + BS + '.(min|max|length|regex|email|uuid|positive|refine)' + BS + '(');

  for (const racine of racines) {
    let fichiers;
    try {
      fichiers = fichiersSource(racine);
    } catch {
      continue;
    }
    for (const fichier of fichiers) {
      const rel = relative(racine, fichier).split(SEPARATEUR).join('/');
      if (rel.includes('messages')) continue;

      const lignes = readFileSync(fichier, 'utf8').split(FIN_DE_LIGNE);
      for (let i = 0; i < lignes.length; i++) {
        const l = lignes[i];
        if (!l.includes('z.') && !METHODE.test(l)) continue;

        for (const m of l.matchAll(CHAINE)) {
          const t = m[1];
          const prose = BLANC.test(t) || NON_ASCII.test(t);
          // Une regex n'est pas un message, et une cle non plus.
          if (!prose || t.startsWith('^') || t.includes(']+$') || CLE.test(t)) continue;
          problemes.push({
            rel,
            ligne: i + 1,
            quoi: 'prose dans un schema Zod',
            detail: t.slice(0, 48),
          });
        }
      }
    }
  }
  return problemes;
}

if (process.argv[1] && process.argv[1].endsWith('check-error-messages.mjs')) {
  const catalogue = lireCatalogue();
  const problemes = [...verifierLeDepot(catalogue), ...verifierLesSchemas()];

  if (problemes.length) {
    console.error('Messages d erreur (ADR 025) :' + NL);
    for (const p of problemes) {
      console.error(`  ${p.rel}:${p.ligne}  ${p.quoi} : ${p.detail}`);
    }
    console.error(
      NL + 'Le texte d une erreur vit dans lib/messages-erreur.ts, dans les deux langues.'
    );
    process.exit(1);
  }

  console.log(`Codes au catalogue : ${catalogue.size}, chacun en francais et en anglais.`);
  console.log('Aucune reponse d erreur ne porte son texte.');
  console.log('Aucun schema Zod ne porte de prose.');
}
