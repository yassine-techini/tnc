import { describe, expect, it } from 'vitest';
import { createTestD1, seedWallet } from '../helpers/real-d1';
import { arrondirMonnaie, prixDuGramme, tauxDuJour, memeDevise } from '../../src/lib/monnaie';
import { WalletService } from '../../src/services/wallet.service';

/**
 * L'argent connait sa devise — ADR 019, constat AK (et son corollaire AL).
 *
 * Rien ne portait de devise : l'unite vivait dans un commentaire du schema
 * (« Total XOF depenses »), et `gold_prices` ne stockait qu'une conversion — un
 * utilisateur ougandais aurait recu un prix en francs CFA presente comme le sien.
 */

const SPREADS = { achat: 0.02, vente: 0.02 };

function baseAvecPrix(prixUsd = 85.5) {
  const db = createTestD1();
  db.sqlite
    .prepare(
      `INSERT INTO gold_prices (id, price_usd, price_xof, exchange_rate, buy_price, sell_price, source)
       VALUES ('p1', ?, 0, 0, 0, 0, 'test')`
    )
    .run(prixUsd);
  return db;
}

const poserTaux = (db: ReturnType<typeof createTestD1>, devise: string, taux: number) =>
  db.sqlite
    .prepare("INSERT INTO exchange_rates (id, currency, rate_per_usd, source) VALUES (?, ?, ?, 'test')")
    .run(`r-${devise}`, devise, taux);

describe('Le prix est rendu dans la devise demandee', () => {
  it('convertit depuis la reference en dollars', async () => {
    const db = baseAvecPrix(85.5);
    poserTaux(db, 'XOF', 615);

    const p = await prixDuGramme(db as never, 'XOF', SPREADS, 0);

    expect(p?.spot).toBe(Math.round(85.5 * 615));
    expect(p?.devise).toBe('XOF');
  });

  it('rend un montant DIFFERENT pour une autre devise', async () => {
    // Le defaut : `gold_prices` ne stockait qu'une conversion, donc tout le monde
    // recevait le meme chiffre quel que soit son pays.
    const db = baseAvecPrix(85.5);
    poserTaux(db, 'XOF', 615);
    poserTaux(db, 'UGX', 3700);

    const xof = await prixDuGramme(db as never, 'XOF', SPREADS, 0);
    const ugx = await prixDuGramme(db as never, 'UGX', SPREADS, 0);

    expect(ugx!.spot).toBeGreaterThan(xof!.spot);
    expect(ugx!.tauxParUsd).toBe(3700);
  });

  it('applique les ecarts sur le cours converti', async () => {
    const db = baseAvecPrix(100);
    poserTaux(db, 'XOF', 600);

    const p = await prixDuGramme(db as never, 'XOF', SPREADS, 0);

    expect(p?.achat).toBe(61_200); // 60 000 × 1,02
    expect(p?.vente).toBe(58_800); // 60 000 × 0,98
  });
});

describe('Sans taux, on ne sert rien', () => {
  it('refuse plutot que de servir la devise d un autre pays', async () => {
    // Servir des francs CFA a un Ougandais parce que le sien manque serait pire
    // que de ne rien servir : le chiffre aurait l'air juste.
    const db = baseAvecPrix(85.5);
    poserTaux(db, 'XOF', 615);

    expect(await prixDuGramme(db as never, 'UGX', SPREADS, 0)).toBeNull();
  });

  it('refuse aussi quand aucun cours n a ete releve', async () => {
    const db = createTestD1();
    poserTaux(db, 'XOF', 615);

    expect(await prixDuGramme(db as never, 'XOF', SPREADS, 0)).toBeNull();
  });

  it('ignore un taux nul ou negatif', async () => {
    const db = baseAvecPrix();
    // La contrainte CHECK refuse deja l'ecriture : la garde tient des deux cotes.
    expect(() => poserTaux(db, 'KES', 0)).toThrow();
    expect(await tauxDuJour(db as never, 'KES')).toBeNull();
  });

  it('retient le taux le PLUS RECENT', async () => {
    const db = baseAvecPrix();
    db.sqlite
      .prepare("INSERT INTO exchange_rates (id, currency, rate_per_usd, source, timestamp) VALUES ('vieux','XOF',500,'test','2026-01-01 00:00:00')")
      .run();
    db.sqlite
      .prepare("INSERT INTO exchange_rates (id, currency, rate_per_usd, source, timestamp) VALUES ('neuf','XOF',615,'test','2026-08-18 00:00:00')")
      .run();

    expect((await tauxDuJour(db as never, 'XOF'))?.rate).toBe(615);
  });
});

describe('L arrondi suit la devise', () => {
  it('rend un entier pour une devise sans sous-unite', () => {
    // XOF et UGX n'ont pas de centimes.
    expect(arrondirMonnaie(1234.56, 0)).toBe(1235);
  });

  it('garde les centimes pour une devise qui en a', () => {
    // Le defaut : `Math.round` partout faisait perdre les centimes du cedi, du
    // shilling kenyan, du naira ou du rand — toujours dans le meme sens.
    expect(arrondirMonnaie(1234.567, 2)).toBe(1234.57);
  });

  it('se protege d une configuration absurde', () => {
    // `currency_decimals` vient de la base : une valeur aberrante ne doit pas
    // produire un arrondi aberrant.
    for (const d of [-1, 99, 1.5, Number.NaN]) {
      expect(arrondirMonnaie(1234.56, d as number), String(d)).toBe(1235);
    }
  });
});

describe('Un portefeuille porte sa devise, et ses ecritures la partagent', () => {
  it('nait dans la devise du pays de son titulaire', async () => {
    const db = createTestD1();
    db.sqlite.prepare("INSERT INTO users (id, email, phone, country) VALUES ('u1','a@b.c','+256','UG')").run();
    db.sqlite
      .prepare(
        `INSERT INTO country_config (code, name, currency, currency_symbol, currency_decimals,
           phone_prefix, certificate_prefix, id_document_types, payment_methods, locale, timezone, enabled)
         VALUES ('UG','Uganda','UGX','USh',0,'+256','UG','[]','[]','en-UG','Africa/Kampala',1)`
      )
      .run();

    await new WalletService(db as never).create('u1', 'w1');

    const w = db.sqlite.prepare("SELECT currency FROM wallets WHERE id = 'w1'").get() as { currency: string };
    expect(w.currency).toBe('UGX');
  });

  it('retombe sur XOF quand le pays est inconnu', async () => {
    // Un portefeuille ne peut pas naitre sans devise ; mieux vaut celle de la
    // zone d'origine, explicite, qu'une valeur vide.
    const db = createTestD1();
    db.sqlite.prepare("INSERT INTO users (id, email, phone, country) VALUES ('u1','a@b.c','+226','ZZ')").run();

    await new WalletService(db as never).create('u1', 'w1');

    const w = db.sqlite.prepare("SELECT currency FROM wallets WHERE id = 'w1'").get() as { currency: string };
    expect(w.currency).toBe('XOF');
  });

  it('marque chaque transaction de la devise de son portefeuille', async () => {
    const db = createTestD1();
    db.sqlite.prepare("INSERT INTO users (id, email, phone) VALUES ('u1','a@b.c','+256')").run();
    seedWallet(db, { id: 'w1', userId: 'u1' });
    db.sqlite.prepare("UPDATE wallets SET currency = 'UGX' WHERE id = 'w1'").run();

    await new WalletService(db as never).createTransaction({
      id: 't1',
      userId: 'u1',
      walletId: 'w1',
      type: 'DEPOSIT',
      cashAmount: 50_000,
      fees: 0,
    } as never);

    const t = db.sqlite.prepare("SELECT currency FROM transactions WHERE id = 't1'").get() as { currency: string };
    expect(t.currency, "la transaction doit porter la devise du portefeuille").toBe('UGX');
  });

  it('refuse un mouvement dans une autre devise', () => {
    expect(memeDevise('UGX', 'UGX')).toBe(true);
    expect(memeDevise('UGX', 'XOF')).toBe(false);
  });
});
