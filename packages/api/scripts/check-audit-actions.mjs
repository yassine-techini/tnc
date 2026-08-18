/**
 * Le registre des actions d'audit doit correspondre a ce qui est ecrit — ADR 014.
 *
 * Deux sens, et c'est le second qui manquait :
 *
 *   1. Une action ECRITE mais absente du registre echappe a toute decision de
 *      retention : elle sera purgee par defaut, sans que personne l'ait voulu.
 *   2. Une action INSCRITE au registre que personne n'ecrit est une protection
 *      qui ne protege rien. C'est le cas d'`ADMIN_CREATED`, epargne par la purge
 *      alors que creer un administrateur n'ecrivait aucune trace — et celui des
 *      participes passes (`KYC_APPROVED` cote liste, `KYC_APPROVE` cote route)
 *      qui laissaient purger les decisions les plus lourdes.
 *
 * Un controle qui ne verifie que le premier sens se serait tu sur les deux vrais
 * defauts.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Ces mots apparaissent dans une requete d'audit sans etre des actions. */
const MOTS_SQL = new Set([
  'SELECT', 'INSERT', 'VALUES', 'WHERE', 'EXISTS', 'FROM', 'NULL', 'JSON',
  'SYSTEM', 'SUCCESS', 'FAILED', 'PENDING', 'COMPLETED', 'PROCESSING',
  'CANCELLED', 'APPROVED', 'REJECTED', 'SUBMITTED', 'EXPIRED', 'BASIC',
  'STANDARD', 'VERIFIED', 'DEPOSIT', 'ARRIVED_DUBAI', 'AUDIT_VALIDATED',
]);

/**
 * Vrai quand la position tombe dans un commentaire de LIGNE.
 *
 * On ne reecrit pas le source pour en retirer les commentaires : une premiere
 * version le faisait et supprimait 5 des 8 requetes d audit du fichier, parce
 * qu'un `//` ou un `/*` a l interieur d une chaine emportait le code qui suit.
 * Un controle qui sous-detecte se declare satisfait — le defaut meme que ce
 * fichier traque.
 */
function dansUnCommentaire(source, position) {
  const RETOUR = String.fromCharCode(10);
  const debutLigne = source.lastIndexOf(RETOUR, position) + 1;
  const avant = source.slice(debutLigne, position);
  return avant.includes("//") || /^\s*\*/.test(avant);
}

function fichiersSource(racine) {
  const out = [];
  for (const e of readdirSync(racine, { withFileTypes: true })) {
    const p = join(racine, e.name);
    if (e.isDirectory()) out.push(...fichiersSource(p));
    else if (e.name.endsWith('.ts') && !e.name.includes('.test.')) out.push(p);
  }
  return out;
}

/**
 * Les actions ecrites dans `audit_logs`, avec leur emplacement.
 *
 * La fenetre part de `INSERT INTO audit_logs` et couvre le `.bind(...)` qui
 * suit : l'action est tantot un litteral dans le SQL, tantot un parametre lie.
 */
export function actionsEcrites(source, fichier = "?") {
  const trouvees = [];
  let depuis = 0;

  for (;;) {
    const at = source.indexOf("INSERT INTO audit_logs", depuis);
    if (at === -1) break;
    depuis = at + 22;

    // La fenetre s arrete a la fin du `.bind(...)` qui suit. Une fenetre a
    // longueur fixe ratissait le code voisin et signalait des codes d erreur
    // et des noms de role comme s ils etaient des actions.
    const fin = finDuBind(source, at);
    const fenetre = source.slice(at, fin);
    const ligne = source.slice(0, at).split(String.fromCharCode(10)).length;

    for (const m of fenetre.matchAll(/'([A-Z][A-Z0-9_]{3,})'/g)) {
      if (MOTS_SQL.has(m[1])) continue;
      trouvees.push({ action: m[1], fichier, ligne });
    }

    // Action construite par gabarit : sa valeur reelle est invisible ici, et
    // c est precisement ainsi que la liste de purge a pu diverger en silence.
    const gabarit = fenetre.match(/`([A-Z][A-Z0-9_]*)\$\{/);
    if (gabarit && !dansUnCommentaire(source, at + gabarit.index)) {
      trouvees.push({ action: null, prefixe: gabarit[1], fichier, ligne });
    }
  }

  return trouvees;
}

/** Fin du premier `.bind(...)` suivant `at`, parentheses equilibrees. */
function finDuBind(source, at) {
  const bind = source.indexOf(".bind(", at);
  if (bind === -1 || bind - at > 1200) return Math.min(source.length, at + 600);
  let profondeur = 0;
  for (let i = bind + 5; i < source.length; i++) {
    if (source[i] === "(") profondeur++;
    else if (source[i] === ")") {
      profondeur--;
      if (profondeur === 0) return i + 1;
    }
  }
  return source.length;
}

/**
 * Vrai quand l'INSERT a la position donnee est DANS un `db.batch([...])`.
 *
 * On compte les crochets ouverts depuis le dernier `.batch([` : si le compte est
 * positif, l'instruction fait partie du lot. Une simple recherche en arriere sur
 * une fenetre fixe se trompait — les lots de ce depot s'ouvrent parfois cinquante
 * lignes plus haut.
 */
/**
 * CE QUE CE CONTROLE NE VERIFIE PAS : l'atomicite.
 *
 * Une trace ecrite hors de la transaction de son action peut manquer alors que
 * l'action a eu lieu — c'est le constat Z, corrige a la main sur les huit sites
 * concernes (ADR 016).
 *
 * Un controle automatique a ete tente puis ABANDONNE. Detecter « cet INSERT
 * est-il dans un lot » demande de compter les crochets non fermes en ignorant
 * chaines, gabarits et commentaires ; la version obtenue se perdait sur un
 * gabarit imbrique et signalait comme fautifs des sites corrects. Et la moitie
 * des traces du depot n'ont legitimement aucune action a accompagner : un
 * battement de cron, un webhook sans correspondance ou une sonde sont a
 * eux-memes leur evenement.
 *
 * Un controle qui se trompe finit desactive. Les huit sites sont donc tenus par
 * des tests (`test/routes/audit-atomique.test.ts`), pas par ce script.
 */

export function verifierLeDepot(registre, racine = "src") {
  const ecrites = [];
  for (const f of fichiersSource(racine)) {
    ecrites.push(...actionsEcrites(readFileSync(f, "utf8"), f));
  }

  const connues = new Set(Object.keys(registre));
  const vues = new Set();
  const problemes = [];

  for (const e of ecrites) {
    // Un gabarit est REFUSE, jamais tolere. La premiere version benissait toute
    // action du registre partageant le prefixe : une entree fantome
    // `KYC_APPROVED_LEGACY` passait le controle sans etre ecrite nulle part —
    // exactement le defaut que ce fichier existe pour empecher.
    if (e.action === null) {
      problemes.push({ quoi: "action construite par gabarit, donc invisible au controle", ...e });
      continue;
    }
    vues.add(e.action);
    if (!connues.has(e.action)) {
      problemes.push({ quoi: "action ecrite absente du registre", ...e });
    }
  }

  // Une action peut etre liee depuis l'appelant plutot qu'ecrite au bord de
  // l'INSERT (`logVerification(..., 'KYC_SUBMITTED', ...)`). On la cherche donc
  // comme litteral partout dans le source — SAUF dans le registre lui-meme, qui
  // la contient forcement et rendrait le controle tautologique.
  const sources = fichiersSource(racine)
    .filter((f) => !f.endsWith('audit-actions.ts'))
    .map((f) => readFileSync(f, 'utf8'));

  const citeeAilleurs = (action) =>
    sources.some((src) => {
      let at = src.indexOf("'" + action + "'");
      while (at !== -1) {
        if (!dansUnCommentaire(src, at)) return true;
        at = src.indexOf("'" + action + "'", at + 1);
      }
      return false;
    });

  for (const a of connues) {
    if (vues.has(a) || citeeAilleurs(a)) continue;
    problemes.push({ quoi: "action du registre que personne n ecrit", action: a });
  }


  return problemes;
}

/**
 * Lit le registre depuis sa source TypeScript.
 *
 * Le recopier en JavaScript recreerait exactement le defaut que ce controle
 * existe pour empecher : deux listes qui divergent en silence.
 */
export function lireRegistre(chemin = 'src/lib/audit-actions.ts') {
  const source = readFileSync(chemin, 'utf8');
  const debut = source.indexOf('ACTIONS_AUDIT: Record<string, ActionAudit> = {');
  if (debut === -1) throw new Error('Registre introuvable dans ' + chemin);

  const registre = {};
  for (const m of source.slice(debut).matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*\{\s*permanent:\s*(true|false)/gm)) {
    registre[m[1]] = { permanent: m[2] === 'true' };
  }
  return registre;
}

if (process.argv[1] && process.argv[1].endsWith('check-audit-actions.mjs')) {
  const ACTIONS_AUDIT = lireRegistre();
  const ACTIONS_PERMANENTES = Object.entries(ACTIONS_AUDIT).filter(([, v]) => v.permanent);
  const problemes = verifierLeDepot(ACTIONS_AUDIT);

  if (problemes.length) {
    console.error('Registre des actions d audit (ADR 014) :\n');
    for (const p of problemes) {
      const ou = p.fichier ? `  ${p.fichier}:${p.ligne}` : '  (registre)';
      console.error(`${ou}  ${p.quoi} : ${p.action ?? p.prefixe + '${…}'}`);
    }
    process.exit(1);
  }

  console.log(`Actions enregistrees : ${Object.keys(ACTIONS_AUDIT).length}.`);
  console.log(`Permanentes (jamais purgees) : ${ACTIONS_PERMANENTES.length}.`);
  console.log('Chaque action ecrite est enregistree, et chaque enregistrement est ecrit.');
}
