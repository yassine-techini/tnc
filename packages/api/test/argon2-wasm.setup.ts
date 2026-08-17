/**
 * Fournir a `argon2-browser` ses octets wasm avant qu'il ne tente de les charger.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * `argon2-browser@1.18` cherche `argon2.wasm` de deux facons, et sous vitest les
 * deux echouent : `require('../dist/argon2.wasm')`, que vite essaie de lire comme
 * du JavaScript, et `fetch(<chemin de fichier>)`, que Node refuse depuis qu'il a
 * un `fetch` global. Emscripten repond a l'echec par `abort()`, qui tue le
 * processus.
 *
 * Sous vitest, ce deces tue le worker. Les 26 tests de `auth.service.test.ts` ne
 * s'executaient donc pas — et, ce qui est bien pire, ils n'echouaient pas non
 * plus : ils disparaissaient du total. Le compte affichait « 736 passed (762) »
 * sans jamais nommer le fichier absent.
 *
 * COMMENT
 *
 * La bibliotheque prevoit exactement ce cas : `loadArgon2WasmBinary` est le
 * point d'entree par lequel l'hote fournit les octets lui-meme. Renseigne, il
 * court-circuite le `require` comme le `fetch`.
 *
 * `self` doit par ailleurs designer le meme objet que `globalThis` : la couche
 * emscripten depose sa configuration dans `global.Module` et la relit dans
 * `self.Module`. Faire de `self` un objet distinct romprait ce lien.
 *
 * Consequence voulue : les tests s'executent contre le VRAI argon2. Un bouchon
 * aurait fait passer la suite en ne verifiant plus rien du hachage des mots de
 * passe — precisement la garantie que ces tests existent pour tenir.
 *
 * La production n'est pas concernee : le bundle Workers inline le wasm a la
 * construction et ne fait aucun fetch.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const resoudre = createRequire(import.meta.url);
const octets = new Uint8Array(readFileSync(resoudre.resolve('argon2-browser/dist/argon2.wasm')));

const global = globalThis as typeof globalThis & {
  self?: unknown;
  Module?: unknown;
  loadArgon2WasmBinary?: () => Promise<Uint8Array>;
};

// `self` DOIT designer globalThis : la bibliotheque en fait son objet global
// (`const global = typeof self !== 'undefined' ? self : this`) et y cherche
// `process` pour choisir sa branche. Un objet distinct lui ferait croire qu'elle
// tourne dans un navigateur.
global.self = global.self || global;

// La branche Node charge la couche emscripten telle quelle ; celle-ci lit sa
// configuration dans `self.Module` au moment du chargement. `wasmBinary`
// renseigne, elle n'essaie plus d'aller chercher le fichier.
global.Module = { wasmBinary: octets };

// La branche navigateur, elle, passe par ce point d'entree. Les deux sont
// couvertes : le choix de branche depend de l'environnement de test, pas de nous.
global.loadArgon2WasmBinary = () => Promise.resolve(octets);
