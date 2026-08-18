import { describe, expect, it } from 'vitest';
import { createTestD1, seedWallet, seedStock } from '../helpers/real-d1';
import { WalletService } from '../../src/services/wallet.service';
import { accumulationsNonArrondies } from '../../scripts/check-gram-rounding.mjs';

/**
 * La derive flottante des soldes en grammes — ADR 013, constat T.
 *
 * `token_balance` est un REAL et chaque achat faisait `token_balance + ?`.
 * L'addition flottante de valeurs pourtant quantifiees au milligramme derive :
 * trois achats suffisent pour que le solde stocke tombe SOUS la valeur affichee,
 * et la vente du solde entier est alors refusee pour « solde insuffisant » — sur
 * le solde exact que l'ecran vient de montrer.
 *
 * Ces tests tournent sur une VRAIE base SQLite : c'est le moteur qui decide,
 * pas notre idee de ce qu'il fait. Un mock aurait rendu la suite verte en ne
 * reproduisant justement pas l'arithmetique en cause.
 */

/** La suite d'achats trouvee par recherche : la plus courte qui derive. */
const ACHATS_QUI_DERIVENT = [0.018, 2.106, 4.337];
const AFFICHE = 6.461; // ce que `toFixed(3)` montre a l'utilisateur

describe('Le solde affiche est vendable', () => {
  it('reste exactement egal a ce que l ecran montre apres trois achats', async () => {
    const db = createTestD1();
    seedWallet(db, { id: 'w1', userId: 'u1' });
    const service = new WalletService(db as never);

    for (const grammes of ACHATS_QUI_DERIVENT) {
      await service.updateTokenBalance('w1', grammes);
    }

    const { token_balance } = db.sqlite
      .prepare('SELECT token_balance FROM wallets WHERE id = ?')
      .get('w1') as { token_balance: number };

    // Sans arrondi a l'ecriture, on obtenait 6.4609999999999994.
    expect(token_balance).toBe(AFFICHE);
  });

  it('laisse vendre la totalite du solde affiche', async () => {
    const db = createTestD1();
    seedWallet(db, { id: 'w1', userId: 'u1' });
    const service = new WalletService(db as never);
    for (const g of ACHATS_QUI_DERIVENT) await service.updateTokenBalance('w1', g);

    // Le garde autoritaire : `WHERE ... AND token_balance >= ?`. Il ne modifiait
    // AUCUNE ligne, et l'utilisateur lisait « solde insuffisant ».
    const r = db.sqlite
      .prepare('UPDATE wallets SET token_balance = ROUND(token_balance - ?, 3) WHERE id = ? AND token_balance >= ?')
      .run(AFFICHE, 'w1', AFFICHE);

    expect(r.changes).toBe(1);
  });

  it('retombe exactement a zero une fois tout vendu', async () => {
    const db = createTestD1();
    seedWallet(db, { id: 'w1', userId: 'u1' });
    const service = new WalletService(db as never);
    for (const g of ACHATS_QUI_DERIVENT) await service.updateTokenBalance('w1', g);
    await service.updateTokenBalance('w1', -AFFICHE);

    const { token_balance } = db.sqlite
      .prepare('SELECT token_balance FROM wallets WHERE id = ?')
      .get('w1') as { token_balance: number };

    // Un residu de 1e-15 g laisserait un portefeuille « non vide » indefiniment :
    // les ecrans le comptent comme detenteur et les frais de garde le suivent.
    expect(token_balance).toBe(0);
  });
});

describe('Le stock national aussi', () => {
  it('garde tokens_issued comparable a total_allocated', () => {
    const db = createTestD1();
    seedStock(db, { totalAllocated: 6.461 });

    // La contrainte `CHECK (tokens_issued <= total_allocated)` compare deux
    // REAL. Si l'un derive et l'autre non, elle refuse une emission legitime —
    // ou en laisse passer une qui ne l'est pas.
    for (const g of ACHATS_QUI_DERIVENT) {
      db.sqlite
        .prepare("UPDATE gold_stock SET tokens_issued = ROUND(tokens_issued + ?, 3) WHERE id = 'main'")
        .run(g);
    }

    const row = db.sqlite
      .prepare('SELECT total_allocated, tokens_issued FROM gold_stock')
      .get() as { total_allocated: number; tokens_issued: number };

    expect(row.tokens_issued).toBe(row.total_allocated);
  });
});

describe('Le garde-fou', () => {
  it('repere une accumulation ecrite sans arrondi', () => {
    const p = accumulationsNonArrondies(
      "db.prepare(`UPDATE wallets SET token_balance = token_balance + ? WHERE id = ?`)"
    );

    expect(p).toHaveLength(1);
    expect(p[0].colonne).toBe('token_balance');
  });

  it('accepte la forme arrondie', () => {
    expect(
      accumulationsNonArrondies(
        "db.prepare(`UPDATE wallets SET token_balance = ROUND(token_balance + ?, 3) WHERE id = ?`)"
      )
    ).toEqual([]);
  });

  it('couvre les quatre colonnes de grammes, pas seulement les portefeuilles', () => {
    // Corriger `token_balance` seul aurait corrige l'instance, pas la categorie.
    const p = accumulationsNonArrondies(
      'SET tokens_issued = tokens_issued + ?; SET gold_on_loan = gold_on_loan - ?; SET total_allocated = total_allocated + ?'
    );

    expect(p.map((x) => x.colonne).sort()).toEqual(['gold_on_loan', 'tokens_issued', 'total_allocated']);
  });
});
