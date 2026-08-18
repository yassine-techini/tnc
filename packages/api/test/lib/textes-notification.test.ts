import { describe, expect, it } from 'vitest';
import { createTestD1 } from '../helpers/real-d1';
import {
  langueDe,
  ACCROCHE,
  BIENVENUE,
  KYC_APPROUVE,
  KYC_REFUSE,
  CODE_VERIFICATION,
  TRANSACTION_TERMINEE,
  ALERTE_SECURITE,
  RETRAIT_APPROUVE,
  SMS,
} from '../../src/lib/textes-notification';
import { langueDeLUtilisateur } from '../../src/services/country-config.service';

/**
 * Ce que la plateforme dit, dans la langue de qui l'ecoute — ADR 020, constat AN.
 *
 * `country_config.locale` etait expose par la route publique et jamais consulte
 * cote serveur. L'Ouganda est declare `en-UG` : un raffineur ougandais recevait
 * « Bienvenue sur TNC Trading », puis « Votre KYC a ete approuve ».
 */

describe('La langue se deduit de la locale du pays', () => {
  it('reconnait une locale anglophone', () => {
    for (const l of ['en-UG', 'en-GH', 'EN-KE', 'en']) {
      expect(langueDe(l), l).toBe('en');
    }
  });

  it('retient le francais par defaut', () => {
    // Fail-closed dans le sens utile : une locale inconnue rend la langue
    // d'origine de la plateforme, pas une chaine vide.
    for (const l of ['fr-FR', 'fr-BF', null, undefined, '', 'xx-YY']) {
      expect(langueDe(l), String(l)).toBe('fr');
    }
  });

  it('lit la locale du pays du titulaire', async () => {
    const db = createTestD1();
    db.sqlite
      .prepare(
        `INSERT INTO country_config (code, name, currency, currency_symbol, currency_decimals,
           phone_prefix, certificate_prefix, id_document_types, payment_methods, locale, timezone, enabled)
         VALUES ('UG','Uganda','UGX','USh',0,'+256','UG','[]','[]','en-UG','Africa/Kampala',1)`
      )
      .run();
    db.sqlite.prepare("INSERT INTO users (id, email, phone, country) VALUES ('u1','a@b.c','+256','UG')").run();

    expect(await langueDeLUtilisateur(db as never, 'u1')).toBe('en');
  });

  it('retombe sur le francais quand le pays est inconnu', async () => {
    const db = createTestD1();
    db.sqlite.prepare("INSERT INTO users (id, email, phone, country) VALUES ('u1','a@b.c','+226','ZZ')").run();

    expect(await langueDeLUtilisateur(db as never, 'u1')).toBe('fr');
  });
});

describe('Chaque message existe dans les deux langues', () => {
  const courriels = [
    ['BIENVENUE', () => BIENVENUE.fr('Awa'), () => BIENVENUE.en('Awa')],
    ['KYC_APPROUVE', () => KYC_APPROUVE.fr('Awa', 'VERIFIED'), () => KYC_APPROUVE.en('Awa', 'VERIFIED')],
    ['KYC_REFUSE', () => KYC_REFUSE.fr('Awa', 'flou'), () => KYC_REFUSE.en('Awa', 'blurred')],
    ['CODE_VERIFICATION', () => CODE_VERIFICATION.fr('123456', 'email'), () => CODE_VERIFICATION.en('123456', 'email')],
    ['TRANSACTION_TERMINEE', () => TRANSACTION_TERMINEE.fr('achat', '1 000', 2), () => TRANSACTION_TERMINEE.en('buy', '1 000', 2)],
    ['ALERTE_SECURITE', () => ALERTE_SECURITE.fr('connexion', 'ip'), () => ALERTE_SECURITE.en('sign-in', 'ip')],
    ['RETRAIT_APPROUVE', () => RETRAIT_APPROUVE.fr('1 000', 'Orange'), () => RETRAIT_APPROUVE.en('1 000', 'Orange')],
  ] as const;

  for (const [nom, fr, en] of courriels) {
    it(`${nom} : les deux versions sont completes et distinctes`, () => {
      const f = fr();
      const e = en();

      for (const t of [f, e]) {
        expect(t.sujet.length, nom).toBeGreaterThan(5);
        expect(t.titre.length, nom).toBeGreaterThan(3);
        expect(t.paragraphes.length, nom).toBeGreaterThan(0);
      }
      // Une traduction qui recopie le francais n'en est pas une.
      expect(e.sujet, nom).not.toBe(f.sujet);
    });
  }

  it('les SMS aussi', () => {
    for (const [nom, cat] of Object.entries(SMS)) {
      const f = (cat.fr as (a: string, b?: string) => string)('X', 'Y');
      const e = (cat.en as (a: string, b?: string) => string)('X', 'Y');

      expect(f.length, nom).toBeGreaterThan(10);
      expect(e, nom).not.toBe(f);
    }
  });
});

describe("L'accroche ne nomme aucun pays", () => {
  it('ne mentionne plus le Burkina Faso', () => {
    // Le courriel de bienvenue disait « la plateforme souveraine de tokenisation
    // d'or du Burkina Faso » et « Investissez dans l'or du Burkina Faso » : vrai
    // d'un pays, faux des le deuxieme, et adresse a des raffineurs qui n'y sont
    // pas.
    for (const langue of ['fr', 'en'] as const) {
      expect(ACCROCHE[langue]).not.toMatch(/Burkina/i);
      const t = BIENVENUE[langue]('Awa');
      expect([t.titre, ...t.paragraphes, ...(t.puces ?? [])].join(' ')).not.toMatch(/Burkina/i);
    }
  });
});
