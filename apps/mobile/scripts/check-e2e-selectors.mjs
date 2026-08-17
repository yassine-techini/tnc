#!/usr/bin/env node
/**
 * Verifie que chaque selecteur des parcours bout-en-bout existe dans l'application.
 *
 * POURQUOI CE CONTROLE EXISTE
 *
 * Un parcours Maestro qui designe `id: 'marche-valider'` alors que rien ne porte
 * ce testID echoue au bout d'un delai d'attente, sur un appareil, apres une
 * compilation complete — donc tard, lentement, et avec un message qui ressemble
 * a une lenteur reseau. C'est la meme faute que les types de client qui
 * declaraient des champs inexistants : une affirmation sur une realite qu'on n'a
 * pas verifiee.
 *
 * Ici la verification est statique et tient en une seconde, sans emulateur.
 * Elle ne prouve PAS que le parcours passe — seulement qu'il designe des choses
 * qui existent. C'est la moitie du chemin, et c'est la moitie faisable partout,
 * y compris la ou aucun appareil n'est branche.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DOSSIER_PARCOURS = join(RACINE, 'e2e');
const SOURCES = [join(RACINE, 'app'), join(RACINE, 'components')];

function fichiers(dossier, extensions) {
  const trouves = [];
  const parcourir = (chemin) => {
    for (const entree of readdirSync(chemin)) {
      const complet = join(chemin, entree);
      if (statSync(complet).isDirectory()) parcourir(complet);
      else if (extensions.some((e) => entree.endsWith(e))) trouves.push(complet);
    }
  };
  parcourir(dossier);
  return trouves;
}

/** Extrait d'un source les identifiants qu'il pose reellement sur des composants. */
export function testIdsDuSource(source) {
  const ids = new Set();

  // testID="x" | testID={'x'} | testID={"x"}
  for (const m of source.matchAll(/testID=(?:"([^"]+)"|\{\s*['"]([^'"]+)['"]\s*\})/g)) {
    ids.add(m[1] ?? m[2]);
  }
  // tabBarButtonTestID: 'x'
  for (const m of source.matchAll(/tabBarButtonTestID:\s*['"]([^'"]+)['"]/g)) {
    ids.add(m[1]);
  }
  // Tables d'identifiants ecrites en entier : const TEST_ID… = { clef: 'x' }
  for (const bloc of source.matchAll(/const\s+TEST_ID\w*[^=]*=\s*\{([^}]*)\}/g)) {
    for (const m of bloc[1].matchAll(/['"]([^'"]+)['"]/g)) ids.add(m[1]);
  }
  return ids;
}

/** Extrait d'un fichier de parcours les selecteurs et sous-parcours qu'il utilise. */
export function utilisationsDuParcours(contenu, fichier = 'parcours.yaml') {
  const utilisations = [];
  contenu.split(/\r?\n/).forEach((ligne, index) => {
    if (/^\s*#/.test(ligne)) return;
    const parId = ligne.match(/^\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (parId) utilisations.push({ type: 'id', valeur: parId[1], fichier, ligne: index + 1 });
    const parFlux = ligne.match(/^\s*-?\s*runFlow:\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (parFlux) utilisations.push({ type: 'runFlow', valeur: parFlux[1], fichier, ligne: index + 1 });
  });
  return utilisations;
}

/**
 * Confronte les utilisations aux identifiants disponibles.
 * `sousParcoursExistants` est l'ensemble des chemins de sous-parcours presents.
 */
export function verifier(utilisations, idsDisponibles, sousParcoursExistants) {
  const problemes = [];
  for (const usage of utilisations) {
    if (usage.type === 'id') {
      // Les identifiants derives (`…-texte`) sont poses a cote de leur racine.
      const racine = usage.valeur.replace(/-texte$/, '');
      if (!idsDisponibles.has(usage.valeur) && !idsDisponibles.has(racine)) {
        problemes.push({
          ...usage,
          message: `aucun composant ne porte le testID « ${usage.valeur} »`,
        });
      }
    } else if (!sousParcoursExistants.has(usage.valeur)) {
      problemes.push({ ...usage, message: `sous-parcours introuvable : ${usage.valeur}` });
    }
  }
  return problemes;
}

/** Lit le depot reel et renvoie le resultat complet. */
export function verifierLeDepot() {
  const idsDisponibles = new Set();
  for (const fichier of SOURCES.flatMap((d) => fichiers(d, ['.tsx', '.ts']))) {
    for (const id of testIdsDuSource(readFileSync(fichier, 'utf8'))) idsDisponibles.add(id);
  }

  const parcours = fichiers(DOSSIER_PARCOURS, ['.yaml', '.yml']);
  const sousParcoursExistants = new Set(
    parcours.map((f) => relative(DOSSIER_PARCOURS, f).split('\\').join('/'))
  );

  const utilisations = parcours.flatMap((f) =>
    utilisationsDuParcours(readFileSync(f, 'utf8'), relative(RACINE, f))
  );

  return {
    idsDisponibles,
    utilisations,
    problemes: verifier(utilisations, idsDisponibles, sousParcoursExistants),
  };
}

// Execution directe en ligne de commande.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { idsDisponibles, utilisations, problemes } = verifierLeDepot();
  const nbId = utilisations.filter((u) => u.type === 'id').length;
  console.log(
    `Parcours bout-en-bout : ${nbId} selecteurs et ${utilisations.length - nbId} sous-parcours verifies ` +
      `contre ${idsDisponibles.size} testID presents dans l'application.`
  );

  if (problemes.length > 0) {
    console.error(`\n${problemes.length} probleme(s) :\n`);
    for (const p of problemes) console.error(`  ✗ ${p.fichier}:${p.ligne} — ${p.message}`);
    console.error(
      '\nUn parcours qui designe un element inexistant echoue sur appareil, apres une\n' +
        'compilation complete, avec un message de delai depasse. Corriger ici coute une seconde.'
    );
    process.exit(1);
  }
  console.log('Tous les selecteurs designent un element qui existe.');
}
