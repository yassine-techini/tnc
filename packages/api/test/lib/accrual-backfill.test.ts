import type { D1Database } from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';
import { joursDus, planifierRattrapage, prixDuJour, veille } from '../../src/lib/accrual-backfill';

/**
 * Rattrapage des jours manques — ADR 011.
 *
 * Le code annoncait que « le job reprend le jour au passage suivant » et
 * creditait en realite la date COURANTE : la position etait reprise, le jour
 * perdu jamais. Ces tests figent les trois regles qui remplacent cette promesse
 * non tenue — quels jours sont dus, a quel prix, et ce qu'on fait quand il n'y
 * en a pas.
 */

/** Une base qui ne connait de prix que pour les dates fournies. */
function dbAvecPrix(prixParJour: Record<string, number>): D1Database {
  return {
    prepare: () => ({
      bind: (debut: string) => ({
        first: async () => {
          const jour = String(debut).slice(0, 10);
          const p = prixParJour[jour];
          return p === undefined ? null : { price_xof: p };
        },
      }),
    }),
  } as unknown as D1Database;
}

describe('Quels jours sont dus', () => {
  it('rend le seul jour courant quand rien n est en retard', () => {
    expect(joursDus('2026-08-16', '2026-08-17', 30).jours).toEqual(['2026-08-17']);
  });

  it('rend tous les jours manques, du plus ancien au plus recent', () => {
    const { jours, tronque } = joursDus('2026-08-14', '2026-08-17', 30);

    expect(jours).toEqual(['2026-08-15', '2026-08-16', '2026-08-17']);
    expect(tronque).toBe(false);
  });

  it('ne rend rien quand le beneficiaire est deja a jour', () => {
    expect(joursDus('2026-08-17', '2026-08-17', 30).jours).toEqual([]);
  });

  it('ne rend rien quand le dernier traitement est posterieur', () => {
    // Horloge decalee : on ne rembobine pas, et surtout on ne credite pas.
    expect(joursDus('2026-08-20', '2026-08-17', 30).jours).toEqual([]);
  });

  it('ne remonte pas plus loin que le jour courant quand rien n a jamais ete traite', () => {
    // Sans date de reference, on ne sait pas depuis quand : on ne devine pas.
    expect(joursDus(null, '2026-08-17', 30).jours).toEqual(['2026-08-17']);
  });
});

describe('Une position jamais creditee', () => {
  // Le job valorise la veille : une position ouverte le 10 voit son 10 credite
  // dans la nuit du 11. Son premier jour du est donc son jour d'ouverture, et la
  // reference a passer est la veille de celle-ci.
  it('doit son premier jour a compter de son ouverture', () => {
    expect(joursDus(veille('2026-08-15'), '2026-08-17', 30).jours).toEqual([
      '2026-08-15',
      '2026-08-16',
      '2026-08-17',
    ]);
  });

  it('ne doit qu un seul jour quand elle vient d ouvrir', () => {
    expect(joursDus(veille('2026-08-17'), '2026-08-17', 30).jours).toEqual(['2026-08-17']);
  });

  it('franchit un debut de mois', () => {
    expect(veille('2026-09-01')).toBe('2026-08-31');
  });
});

describe('Le plafond', () => {
  it('garde les jours les plus recents et signale la troncature', () => {
    const { jours, tronque } = joursDus('2026-01-01', '2026-08-17', 3);

    // Rattraper le proche et signaler le reste vaut mieux que s'enliser dans le
    // plus ancien en laissant le present en souffrance.
    expect(jours).toEqual(['2026-08-15', '2026-08-16', '2026-08-17']);
    expect(tronque).toBe(true);
  });

  it('ne signale rien quand tout tient sous le plafond', () => {
    expect(joursDus('2026-08-15', '2026-08-17', 30).tronque).toBe(false);
  });
});

describe('Le prix retenu pour une journee', () => {
  it('prend un prix releve ce jour-la', async () => {
    const db = dbAvecPrix({ '2026-08-17': 53_000 });

    expect(await prixDuJour(db, '2026-08-17')).toBe(53_000);
  });

  it('ne rend rien quand aucun prix n a ete releve', async () => {
    expect(await prixDuJour(dbAvecPrix({}), '2026-08-17')).toBeNull();
  });

  it('traite un prix a zero comme une absence de prix', async () => {
    // Un zero enregistre est une panne de collecte, pas un cours. L'accepter
    // marquerait la journee comme traitee en ne creditant rien : le jour serait
    // perdu sans jamais etre signale.
    expect(await prixDuJour(dbAvecPrix({ '2026-08-17': 0 }), '2026-08-17')).toBeNull();
  });

  it('borne la recherche a la journee demandee', async () => {
    const db = dbAvecPrix({ '2026-08-16': 51_000, '2026-08-17': 53_000 });

    // Valoriser le 16 au cours du 17 paierait un rendement que le marche n a
    // pas produit ce jour-la.
    expect(await prixDuJour(db, '2026-08-16')).toBe(51_000);
  });
});

describe('Le plan de rattrapage', () => {
  it('associe chaque jour du a son propre prix', async () => {
    const db = dbAvecPrix({ '2026-08-16': 51_000, '2026-08-17': 53_000 });

    const plan = await planifierRattrapage(db, '2026-08-15', '2026-08-17', 30);

    expect(plan.jours).toEqual([
      { date: '2026-08-16', pricePerGram: 51_000 },
      { date: '2026-08-17', pricePerGram: 53_000 },
    ]);
    expect(plan.sansPrix).toEqual([]);
  });

  it('ecarte un jour sans prix au lieu d en inventer un', async () => {
    // Le releve de prix a echoue ce jour-la aussi. Interpoler, reprendre la
    // veille ou prendre celui d aujourd hui produirait un chiffre qu aucun
    // audit ne pourrait justifier.
    const db = dbAvecPrix({ '2026-08-17': 53_000 });

    const plan = await planifierRattrapage(db, '2026-08-15', '2026-08-17', 30);

    expect(plan.jours).toEqual([{ date: '2026-08-17', pricePerGram: 53_000 }]);
    expect(plan.sansPrix).toEqual(['2026-08-16']);
  });

  it('signale la troncature en meme temps que les jours retenus', async () => {
    const db = dbAvecPrix({ '2026-08-16': 51_000, '2026-08-17': 53_000 });

    const plan = await planifierRattrapage(db, '2026-01-01', '2026-08-17', 2);

    expect(plan.tronque).toBe(true);
    expect(plan.jours).toHaveLength(2);
  });

  it('ne planifie rien pour un beneficiaire a jour', async () => {
    const plan = await planifierRattrapage(dbAvecPrix({}), '2026-08-17', '2026-08-17', 30);

    expect(plan).toEqual({ jours: [], sansPrix: [], tronque: false });
  });
});
