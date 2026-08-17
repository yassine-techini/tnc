import { describe, expect, it } from 'vitest';
import {
  GARANTIES_AILLEURS,
  PUBLIQUES,
  formeTrouvee,
  routesDuFichier,
  verifierLeDepot,
} from '../../scripts/check-route-ownership.mjs';
import { appartientA, refusSiEtranger } from '../../src/lib/ownership';

/**
 * Le garde-fou d'appartenance.
 *
 * Il ne cherche pas un defaut existant — le sixieme audit n'en a trouve aucun.
 * Il empeche le prochain : quinze routes se souviennent aujourd'hui de verifier
 * le porteur, la seizieme peut l'oublier en silence.
 */

describe('appartientA', () => {
  it('accepte une ressource dont le porteur est l appelant', () => {
    expect(appartientA({ user_id: 'usr_1' }, 'usr_1')).toBe(true);
    expect(appartientA({ producer_id: 'usr_1' }, 'usr_1')).toBe(true);
  });

  it('refuse une ressource etrangere', () => {
    expect(appartientA({ user_id: 'usr_2' }, 'usr_1')).toBe(false);
  });

  it('refuse une ressource absente', () => {
    // Absente et etrangere doivent se comporter pareil : distinguer les deux
    // confirmerait l'existence de ce qu'on refuse de montrer.
    expect(appartientA(null, 'usr_1')).toBe(false);
    expect(appartientA(undefined, 'usr_1')).toBe(false);
  });

  it('refuse quand le porteur est vide', () => {
    // Une ligne sans porteur n'appartient a personne — surtout pas au premier
    // appelant dont l'identifiant serait lui aussi vide.
    expect(appartientA({ user_id: null }, 'usr_1')).toBe(false);
    expect(appartientA({ user_id: '' }, '')).toBe(false);
    expect(appartientA({ user_id: 'usr_1' }, null)).toBe(false);
  });
});

describe('refusSiEtranger', () => {
  it('ne rend rien quand la ressource appartient a l appelant', () => {
    expect(refusSiEtranger({ user_id: 'usr_1' }, 'usr_1')).toBeNull();
  });

  it('rend un 404 pour une ressource etrangere', () => {
    const refus = refusSiEtranger({ user_id: 'usr_2' }, 'usr_1', 'Lot introuvable');

    expect(refus).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Lot introuvable' },
    });
  });

  it('rend le meme refus pour une ressource absente', () => {
    const etrangere = refusSiEtranger({ user_id: 'usr_2' }, 'usr_1');
    const absente = refusSiEtranger(null, 'usr_1');

    expect(absente).toEqual(etrangere);
  });
});

describe('Reconnaissance des formes', () => {
  it('reconnait un filtre SQL', () => {
    expect(formeTrouvee("prepare('SELECT * FROM t WHERE id = ? AND user_id = ?')")).toBe('filtre SQL');
  });

  it('reconnait une comparaison sur user_id', () => {
    expect(formeTrouvee('if (row.user_id !== userId) return c.notFound();')).toBe('comparaison');
  });

  it('reconnait une comparaison sur producer_id', () => {
    // Le champ ne s'appelle pas partout `user_id` : c'est precisement ce qui
    // avait produit un faux positif pendant l'audit.
    expect(formeTrouvee('if (lot.producer_id !== userId) return c.notFound();')).toBe('comparaison');
  });

  it('reconnait la forme canonique', () => {
    expect(formeTrouvee('const refus = refusSiEtranger(lot, userId);')).toBe('helper');
  });

  it('ne reconnait rien dans une route qui ne verifie pas', () => {
    expect(formeTrouvee("const row = await db.prepare('SELECT * FROM t WHERE id = ?').bind(id).first();")).toBeNull();
  });

  it('ne se laisse pas berner par une simple mention de userId', () => {
    // Lire l'identifiant de l'appelant ne prouve rien : encore faut-il s'en
    // servir pour filtrer.
    expect(formeTrouvee("const userId = c.get('userId'); const row = await lire(id);")).toBeNull();
  });
});

describe('Decoupage des routes', () => {
  it('separe chaque route et retient sa ligne', () => {
    const source = [
      "wallet.get('/a', async (c) => {",
      '  return c.json({});',
      '});',
      "wallet.post('/b/:id', async (c) => {",
      '  return c.json({});',
      '});',
    ].join('\n');

    const routes = routesDuFichier(source);

    expect(routes.map((r) => `${r.methode} ${r.chemin}`)).toEqual(['GET /a', 'POST /b/:id']);
    expect(routes[1].ligne).toBe(4);
    expect(routes[1].corps).toContain("'/b/:id'");
    expect(routes[1].corps).not.toContain("'/a'");
  });
});

describe('Les exceptions sont des decisions', () => {
  it('chaque route publique porte sa raison', () => {
    for (const [cle, raison] of Object.entries(PUBLIQUES)) {
      // Une entree sans justification serait un oubli deguise en decision.
      expect(raison.length, cle).toBeGreaterThan(40);
    }
  });

  it('chaque delegation nomme ou vit la garantie', () => {
    for (const [cle, raison] of Object.entries(GARANTIES_AILLEURS)) {
      expect(raison, cle).toMatch(/service|\.ts/i);
    }
  });
});

describe('Le depot reel', () => {
  const { couvertes, problemes } = verifierLeDepot();

  it('ne contient aucune route a parametre sans controle', () => {
    expect(problemes).toEqual([]);
  });

  it('couvre effectivement des routes', () => {
    // Sans ce controle, un decoupage casse rendrait zero route et le test
    // precedent passerait au vert sans rien avoir verifie.
    expect(couvertes.length).toBeGreaterThan(10);
  });
});
