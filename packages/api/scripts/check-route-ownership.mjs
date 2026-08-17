#!/usr/bin/env node
/**
 * Refuse une route utilisateur a parametre qui ne verifie pas l'appartenance.
 *
 * POURQUOI CE CONTROLE EXISTE
 *
 * `requirePermission` repond a « cet appelant a-t-il ce droit ». Rien ne
 * repondait a « CETTE ressource est-elle la sienne ». Le sixieme audit a trouve
 * les dix-sept routes concernees correctement gardees — mais par quatre idiomes
 * differents, chacun applique de memoire. Quinze routes s'en souviennent
 * aujourd'hui ; la seizieme peut l'oublier sans que rien ne le signale.
 *
 * Ce controle transforme la convention en mecanisme. Il n'impose pas UNE forme :
 * il exige qu'une forme reconnaissable soit presente, ou qu'une exception soit
 * ECRITE ci-dessous avec sa raison. Un oubli devient impossible ; une derogation
 * reste possible, mais elle se decide et se lit.
 *
 * PERIMETRE
 *
 * Les routeurs exposes a un utilisateur ordinaire. L'administration et le
 * portail Etat operent sur les donnees de tous par definition : leur controle
 * est `requirePermission`, verifie par le troisieme audit.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTEURS = ['wallet.ts', 'lease.ts', 'users.ts', 'producer.ts', 'market.ts', 'verify.ts'];

/**
 * Routes deliberement ouvertes, avec la raison.
 *
 * Une entree ici est une DECISION. Elle doit dire pourquoi l'absence de filtre
 * est correcte, pas simplement constater qu'il manque.
 */
export const PUBLIQUES = {
  'verify.ts GET /:code':
    'Verification publique d un certificat : le code EST le justificatif, ' +
    'et le detenteur du code est precisement celui qu on veut servir.',
};

/**
 * Routes dont la garantie vit ailleurs, avec l'endroit exact.
 *
 * Deleguer est legitime — dupliquer le controle au niveau de la route couterait
 * une lecture de plus. Mais la delegation doit etre nommee : sans cette ligne,
 * « le service s en charge » est une croyance, pas une verification.
 */
export const GARANTIES_AILLEURS = {
  'lease.ts POST /positions/:id/exit':
    'LeaseService.requestExit compare position.user_id a userId et refuse par ' +
    'NOT_FOUND avant toute ecriture (services/lease.service.ts).',
};

/** Les formes reconnues comme un controle d'appartenance. */
const FORMES = [
  // Filtre SQL sur le porteur.
  { nom: 'filtre SQL', motif: /(?:user_id|producer_id|owner_id)\s*=\s*\?/i },
  // Comparaison explicite dans le corps de la route.
  { nom: 'comparaison', motif: /(?:user_id|producer_id|owner_id)\s*(?:!==|===|!=|==)\s*\w/ },
  { nom: 'comparaison', motif: /(?:!==|===|!=|==)\s*userId\b/ },
  // Forme canonique de src/lib/ownership.ts.
  { nom: 'helper', motif: /\b(?:appartientA|refusSiEtranger)\s*\(/ },
];

/** Decoupe un fichier de routes en (methode, chemin, corps). */
export function routesDuFichier(source) {
  const entetes = [];
  const motif = /^\w+\.(get|post|patch|put|delete)\(\s*['"]([^'"]*)['"]/gm;
  for (const m of source.matchAll(motif)) {
    entetes.push({ position: m.index, methode: m[1].toUpperCase(), chemin: m[2] });
  }
  return entetes.map((e, i) => ({
    ...e,
    corps: source.slice(e.position, i + 1 < entetes.length ? entetes[i + 1].position : source.length),
    ligne: source.slice(0, e.position).split('\n').length,
  }));
}

/** La route porte-t-elle une forme reconnue ? */
export function formeTrouvee(corps) {
  for (const { nom, motif } of FORMES) {
    if (motif.test(corps)) return nom;
  }
  return null;
}

export function verifierLeDepot() {
  const problemes = [];
  const couvertes = [];

  for (const fichier of ROUTEURS) {
    const chemin = join(RACINE, 'src', 'routes', fichier);
    if (!existsSync(chemin)) continue;
    const source = readFileSync(chemin, 'utf8');

    for (const route of routesDuFichier(source)) {
      if (!route.chemin.includes(':')) continue;
      const cle = `${fichier} ${route.methode} ${route.chemin}`;

      if (cle in PUBLIQUES) {
        couvertes.push({ cle, par: 'publique (decidee)' });
        continue;
      }
      const forme = formeTrouvee(route.corps);
      if (forme) {
        couvertes.push({ cle, par: forme });
        continue;
      }
      if (cle in GARANTIES_AILLEURS) {
        couvertes.push({ cle, par: 'deleguee (documentee)' });
        continue;
      }
      problemes.push({ cle, fichier, ligne: route.ligne });
    }
  }
  return { couvertes, problemes };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { couvertes, problemes } = verifierLeDepot();
  console.log(`Routes utilisateur a parametre : ${couvertes.length + problemes.length}`);

  if (problemes.length > 0) {
    console.error(`\n${problemes.length} route(s) sans controle d appartenance :\n`);
    for (const p of problemes) {
      console.error(`  X src/routes/${p.fichier}:${p.ligne}`);
      console.error(`    ${p.cle}\n`);
    }
    console.error(
      'Ajoutez un filtre sur le porteur, appelez refusSiEtranger() de lib/ownership,\n' +
        'ou inscrivez la route dans PUBLIQUES / GARANTIES_AILLEURS avec sa raison.'
    );
    process.exit(1);
  }

  const parForme = {};
  for (const c of couvertes) parForme[c.par] = (parForme[c.par] || 0) + 1;
  console.log('Toutes gardees : ' + Object.entries(parForme).map(([k, v]) => `${v} ${k}`).join(', ') + '.');
}
