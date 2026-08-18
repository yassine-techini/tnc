import { describe, expect, it } from 'vitest';
import { formatDate, formatTime } from './formatters';

/**
 * L'affichage des dates — ADR 017, constat AF.
 *
 * Ce fichier portait sa propre copie de l'analyse de date, qui faisait
 * simplement `new Date(date)`. V8 lit la forme sans fuseau de SQLite
 * (« 2026-08-18 09:00:00 ») comme une heure LOCALE : sur un navigateur a UTC+2,
 * un evenement vieux de 30 minutes s'affichait « il y a 2 h 30 » — y compris sur
 * l'ecran des sessions actives, la ou un titulaire repere une intrusion.
 *
 * Un utilisateur a Ouagadougou (UTC+0) voyait l'heure juste : c'est exactement
 * pour cela que le defaut a survecu. La plateforme sera exploitee dans plusieurs
 * pays d'Afrique.
 */

/** L'horodatage tel que SQLite l'ecrit : sans marqueur de fuseau, en UTC. */
const SANS_FUSEAU = '2026-08-18 09:00:00';
const MEME_INSTANT = '2026-08-18T09:00:00Z';

describe('Un horodatage sans fuseau est lu comme de l UTC', () => {
  it('donne le meme resultat que sa forme explicite', () => {
    expect(formatTime(SANS_FUSEAU)).toBe(formatTime(MEME_INSTANT));
    expect(formatDate(SANS_FUSEAU, 'datetime')).toBe(formatDate(MEME_INSTANT, 'datetime'));
  });

  it('rend l heure dans le fuseau du LECTEUR', () => {
    // Ce que ce test peut affirmer sans dependre de la machine : l'heure rendue
    // est celle de l'appareil pour cet instant precis. C'est le comportement
    // voulu — et non un fuseau fige dans le code.
    const attendu = new Date(MEME_INSTANT).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    expect(formatTime(SANS_FUSEAU)).toBe(attendu);
  });

  it('ne decale plus la date affichee', () => {
    // Le defaut : `new Date("2026-08-18 09:00:00")` valait 07:00 UTC sur une
    // machine a UTC+2, soit deux heures d'ecart avec la verite.
    expect(formatDate(SANS_FUSEAU, 'datetime')).toBe(formatDate(MEME_INSTANT, 'datetime'));
    expect(formatDate(SANS_FUSEAU, 'short')).toBe(formatDate(MEME_INSTANT, 'short'));
  });
});

describe('Les formes deja horodatees ne sont pas touchees', () => {
  it('accepte un decalage explicite', () => {
    // « 11:00+02:00 » designe le meme instant que 09:00 UTC.
    expect(formatTime('2026-08-18T11:00:00+02:00')).toBe(formatTime(MEME_INSTANT));
  });

  it('accepte un objet Date', () => {
    expect(formatTime(new Date(MEME_INSTANT))).toBe(formatTime(MEME_INSTANT));
  });
});
