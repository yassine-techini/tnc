/**
 * Le catalogue d'erreurs et la langue d'une reponse — ADR 025.
 *
 * Ce qui est verifie ici ne l'est pas par le garde-fou `check:messages` : lui
 * controle qu'aucun site d'appel ne porte de texte. Ces tests controlent que le
 * texte rendu est le bon, et surtout qu'il CHANGE avec la langue — une entree
 * dont l'anglais aurait ete copie du francais passerait toutes les inspections
 * de forme.
 */

import { describe, it, expect } from 'vitest';
import {
  MESSAGES,
  CODES_ERREUR,
  estCodeConnu,
  messageErreur,
  type CodeErreur,
} from '../../src/lib/messages-erreur';
import { langueDeLaRequete, texte } from '../../src/lib/reponse-erreur';

/** Un contexte reduit a ce que la resolution de langue consulte. */
const requete = (acceptLanguage?: string) =>
  ({
    req: { header: (nom: string) => (nom === 'Accept-Language' ? acceptLanguage : undefined) },
  }) as never;

describe('Catalogue', () => {
  it('porte les deux langues pour chaque code', () => {
    for (const code of CODES_ERREUR) {
      const entree = MESSAGES[code] as { fr: unknown; en: unknown };
      expect(entree.fr, `${code}.fr`).toBeDefined();
      expect(entree.en, `${code}.en`).toBeDefined();
    }
    expect(CODES_ERREUR.length).toBeGreaterThan(100);
  });

  it('ne recopie jamais le francais dans l anglais', () => {
    const identiques: string[] = [];
    for (const code of CODES_ERREUR) {
      const entree = MESSAGES[code] as { fr: unknown; en: unknown };
      if (typeof entree.fr === 'string' && entree.fr === entree.en) identiques.push(code);
    }
    expect(identiques).toEqual([]);
  });

  it('reconnait ses codes, et seulement les siens', () => {
    expect(estCodeConnu('WALLET_NOT_FOUND')).toBe(true);
    expect(estCodeConnu('2FA_REQUIRED')).toBe(true);
    expect(estCodeConnu('CODE_QUI_N_EXISTE_PAS')).toBe(false);
  });

  it('inclut les codes commencant par un chiffre', () => {
    // Ils ont echappe a l'inventaire, au codemod et a la premiere version du
    // garde-fou, tous cales sur `[A-Z]` en tete.
    for (const code of ['2FA_REQUIRED', '2FA_INVALID_CODE', '2FA_SETUP_REQUIRED']) {
      expect(CODES_ERREUR).toContain(code as CodeErreur);
    }
  });
});

describe('Langue d une reponse', () => {
  it('suit Accept-Language', () => {
    expect(langueDeLaRequete(requete('en-US,en;q=0.9'))).toBe('en');
    expect(langueDeLaRequete(requete('fr-BF,fr;q=0.9'))).toBe('fr');
  });

  it('retient la premiere langue reconnue, pas la premiere tout court', () => {
    expect(langueDeLaRequete(requete('de-DE,en;q=0.8'))).toBe('en');
    expect(langueDeLaRequete(requete('de-DE,fr;q=0.8,en;q=0.7'))).toBe('fr');
  });

  it('repond en francais quand l en-tete manque ou est inconnu', () => {
    expect(langueDeLaRequete(requete(undefined))).toBe('fr');
    expect(langueDeLaRequete(requete(''))).toBe('fr');
    expect(langueDeLaRequete(requete('de-DE,es;q=0.8'))).toBe('fr');
  });
});

describe('Rendu', () => {
  it('rend le texte de la langue demandee', () => {
    expect(texte(requete('en'), 'WALLET_NOT_FOUND')).toBe('Wallet not found');
    expect(texte(requete('fr'), 'WALLET_NOT_FOUND')).toBe('Portefeuille introuvable');
  });

  it('injecte les parametres dans les deux langues', () => {
    const fr = messageErreur('TRADING_LIMIT_EXCEEDED', 'fr', { limiteG: 100, periode: 'jour' });
    const en = messageErreur('TRADING_LIMIT_EXCEEDED', 'en', { limiteG: 100, periode: 'jour' });

    expect(fr).toContain('100');
    expect(fr).toContain('jour');
    expect(en).toContain('100');
    expect(en).toContain('day');
    expect(fr).not.toBe(en);
  });

  it('distingue le mois du jour', () => {
    const jour = messageErreur('TRADING_LIMIT_EXCEEDED', 'fr', { limiteG: 5, periode: 'jour' });
    const mois = messageErreur('TRADING_LIMIT_EXCEEDED', 'fr', { limiteG: 5, periode: 'mois' });
    expect(jour).not.toBe(mois);
  });

  it('nomme la ressource absente derriere un NOT_FOUND', () => {
    expect(messageErreur('NOT_FOUND', 'fr', { ressource: 'position' })).toBe(
      'Position introuvable'
    );
    expect(messageErreur('NOT_FOUND', 'en', { ressource: 'consignation' })).toBe(
      'Consignment not found'
    );
    expect(messageErreur('NOT_FOUND', 'fr', { ressource: 'stock' })).not.toBe(
      messageErreur('NOT_FOUND', 'fr', { ressource: 'position' })
    );
  });

  it('nomme l operation qu un niveau de verification a empechee', () => {
    const achat = messageErreur('KYC_LEVEL_INSUFFICIENT', 'fr', { operation: 'achat' });
    const retrait = messageErreur('KYC_LEVEL_INSUFFICIENT', 'fr', { operation: 'retrait' });
    expect(achat).not.toBe(retrait);
    expect(messageErreur('KYC_LEVEL_INSUFFICIENT', 'en', { operation: 'achat' })).toContain('buy');
  });

  it('ecrit les nombres comme la langue les ecrit', () => {
    const fr = messageErreur('WITHDRAWAL_LIMIT_EXCEEDED', 'fr', {
      plafond: 500000,
      devise: 'XOF',
    });
    const en = messageErreur('WITHDRAWAL_LIMIT_EXCEEDED', 'en', {
      plafond: 500000,
      devise: 'XOF',
    });
    expect(en).toContain('500,000');
    expect(fr).not.toContain('500,000');
  });

  it('bascule de message quand un parametre optionnel manque', () => {
    // Le blocage est connu, sa duree restante ne l'est pas : deux phrases, un
    // seul code, parce que le code fait partie du contrat d'API.
    const avecDuree = messageErreur('AUTH_ACCOUNT_LOCKED', 'fr', { minutes: 15 });
    const sansDuree = messageErreur('AUTH_ACCOUNT_LOCKED', 'fr', {});
    expect(avecDuree).toContain('15');
    expect(sansDuree).not.toContain('15');
    expect(avecDuree).not.toBe(sansDuree);

    const concurrent = messageErreur('STOCK_BELOW_ISSUED', 'fr', {});
    const plancher = messageErreur('STOCK_BELOW_ISSUED', 'fr', { emisG: 900 });
    expect(plancher).toContain('900');
    expect(concurrent).not.toBe(plancher);
  });
});

describe('INTERNAL_ERROR', () => {
  it('ne dit plus quelle etape interne a echoue', () => {
    // Ce code portait une cinquantaine de phrases nommant la requete en echec.
    // Elles renseignaient un appelant sur la structure de la plateforme.
    const fr = messageErreur('INTERNAL_ERROR', 'fr');
    for (const fuite of ['dashboard', 'audit', 'stock', 'KYC', 'retrait', 'seeding']) {
      expect(fr).not.toContain(fuite);
    }
    expect(fr).toContain('support');
  });
});
