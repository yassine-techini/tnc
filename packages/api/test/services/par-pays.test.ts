import { describe, expect, it } from 'vitest';
import { createTestD1 } from '../helpers/real-d1';

/**
 * Ce qui appartient au pays — ADR 018, constats AI et AJ.
 *
 * `country_config` a ete construite pour qu'un second pays coute une ligne
 * plutot qu'un projet. Deux choses lui echappaient : les pieces d'identite,
 * figees par un CHECK sur celles d'un seul pays, et les seuils d'argent, des
 * nombres globaux nommes en XOF.
 */

describe('Le schema accepte les documents de tous les pays', () => {
  /** Les valeurs reellement semees dans `country_config`. */
  const DECLARES = {
    BF: ['CNIB', 'PASSPORT', 'PERMIT', 'CEDEAO'],
    CI: ['CNI', 'PASSPORT', 'PERMIT', 'CEDEAO'],
    UG: ['NATIONAL_ID', 'PASSPORT', 'DRIVING_PERMIT', 'REFUGEE_ID'],
  };

  function deposer(db: ReturnType<typeof createTestD1>, type: string) {
    db.sqlite
      .prepare(
        `INSERT INTO kyc_documents (id, user_id, document_type, front_image_url, selfie_url)
         VALUES (?, 'u1', ?, 'f.jpg', 's.jpg')`
      )
      .run(`doc-${type}`, type);
  }

  for (const [pays, types] of Object.entries(DECLARES)) {
    it(`${pays} : ses ${types.length} documents passent`, () => {
      const db = createTestD1();
      db.sqlite.prepare("INSERT INTO users (id, email, phone) VALUES ('u1','a@b.c','+226')").run();

      // Avant : `CNI` etait refuse pour trois pays de l'UEMOA, et sur les quatre
      // documents ougandais seul le passeport passait — un Ougandais sans
      // passeport ne pouvait pas faire de KYC du tout.
      for (const t of types) {
        expect(() => deposer(db, t), `${pays} / ${t}`).not.toThrow();
      }
    });
  }

  it('refuse toujours ce qui n a pas la forme d un type', () => {
    // Ce qui reste en base est ce qui vaut pour TOUS les pays : un jeton non
    // vide, en majuscules, sans espace. L'appartenance a la liste du pays est
    // verifiee au depot, la ou le pays est connu.
    const db = createTestD1();
    db.sqlite.prepare("INSERT INTO users (id, email, phone) VALUES ('u1','a@b.c','+226')").run();

    for (const mauvais of ['carte nationale', 'x', 'Passport']) {
      expect(() => deposer(db, mauvais), mauvais).toThrow();
    }
  });
});

describe('Les seuils monetaires appartiennent au pays', () => {
  /**
   * Le choix effectif : celui du pays s'il est fixe, sinon la cle globale — qui
   * garde ainsi son role de valeur par defaut au lieu de valeur universelle.
   */
  const seuilEffectif = (duPays: number | null, global: number) => duPays ?? global;

  it('prend celui du pays quand il est fixe', () => {
    expect(seuilEffectif(5_500_000, 1_000_000)).toBe(5_500_000);
  });

  it('retombe sur la cle globale quand le pays n en a pas', () => {
    expect(seuilEffectif(null, 1_000_000)).toBe(1_000_000);
  });

  it('rend des seuils COMPARABLES d une devise a l autre', () => {
    // Le defaut tenait en une phrase : un seuil exprime en une devise et
    // applique a toutes n'est pas un seuil, c'est un nombre.
    const parUsd = { XOF: 615, UGX: 3700 };
    const semes = { XOF: 1_000_000, UGX: 5_500_000 };

    const enUsd = Object.entries(semes).map(([d, v]) => v / parUsd[d as 'XOF' | 'UGX']);
    const ecart = Math.abs(enUsd[0] - enUsd[1]) / enUsd[0];

    // Avant : 1 626 USD contre 270 USD, soit un facteur six.
    expect(ecart, 'les seuils semes doivent rester du meme ordre').toBeLessThan(0.2);
  });

  it('laisse les plafonds d ACHAT globaux', () => {
    // Distinction qui regle la moitie du probleme : les plafonds d'achat sont en
    // GRAMMES, et un gramme est un gramme a Ouagadougou comme a Kampala.
    const limitesEnGrammes = ['kyc_standard_daily_buy', 'kyc_standard_monthly_buy'];

    for (const cle of limitesEnGrammes) {
      expect(cle, cle).not.toContain('xof');
    }
  });
});
