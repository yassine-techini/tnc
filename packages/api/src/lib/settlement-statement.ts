/**
 * Settlement statement for a consignment lot.
 *
 * This is the document that answers the producer's only real question: I sent
 * gold, what did I get and why. Everything on it has to reconcile — declared
 * weight, assay, share applied, advance already received, balance, total.
 *
 * Kept as a pure function returning a PdfDoc so the arithmetic can be tested
 * without generating a PDF. The numbers are the point; the layout is not.
 */

import { groupDigits, type PdfDoc, type PdfBlock } from './pdf';

export interface StatementInput {
  reference: string;
  producerName: string;
  producerId: string;

  declaredWeightG: number;
  declaredPurity: number;
  goldType: string;
  originCountry: string | null;
  originZone: string | null;
  /** True when the position came from a device fix rather than a declaration. */
  originVerified: boolean;

  refinedWeightG: number | null;
  refineryLot: string | null;
  lbmaCertificate: string | null;

  producerShare: number;
  advanceTokensG: number | null;
  advanceCashXof: number | null;
  advancePaidAt: string | null;
  advancePricePerGram: number | null;
  balanceTokensG: number | null;
  balancePaidAt: string | null;
  producerTokensCredited: number | null;

  submittedAt: string | null;
  forwarderValidatedAt: string | null;
  transitStartedAt: string | null;
  arrivedDubaiAt: string | null;
  auditedAt: string | null;

  status: string;
  generatedAt: string;

  /**
   * Ce que le raffineur a décidé de faire du lot une fois réglé. Absent tant
   * qu'aucune répartition n'a eu lieu — un lot réglé mais non réparti n'est pas
   * un lot entièrement stocké, et le relevé ne doit pas laisser croire l'un
   * pour l'autre.
   */
  disposition: StatementDisposition | null;
}

export interface StatementDisposition {
  sellG: number;
  leaseG: number;
  storeG: number;
  sellPricePerGram: number | null;
  sellProceedsXof: number | null;
  status: 'PENDING' | 'EXECUTED' | 'PARTIAL' | 'FAILED';
  failureReason: string | null;
  executedAt: string | null;
}

const g = (n: number) => `${(Math.round(n * 1000) / 1000).toFixed(3)} g`;
const xof = (n: number) => `${groupDigits(n)} XOF`;
const pct = (n: number) => `${Math.round(n * 10000) / 100} %`;
const date = (value: string | null) => (value ? value.slice(0, 10) : '—');

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface StatementTotals {
  /** Grams owed on the assay, after the platform share. */
  dueG: number;
  advanceG: number;
  balanceG: number;
  creditedG: number;
  /** True when the assay came in below what the advance already paid. */
  advanceExceedsDue: boolean;
}

/**
 * The arithmetic of the statement, separated from its rendering.
 *
 * `balanceG` is never negative: an assay coming in under the advance pays
 * nothing more and claws nothing back — the producer keeps the advance. That is
 * a commercial choice, and the statement says so in words rather than showing a
 * negative line the producer would have to interpret.
 */
export function statementTotals(input: StatementInput): StatementTotals {
  const advanceG = round3(input.advanceTokensG ?? 0);
  const refined = input.refinedWeightG;

  if (refined === null || refined === undefined) {
    return { dueG: 0, advanceG, balanceG: 0, creditedG: advanceG, advanceExceedsDue: false };
  }

  const dueG = round3(refined * input.producerShare);
  const balanceG = round3(Math.max(0, dueG - advanceG));
  return {
    dueG,
    advanceG,
    balanceG,
    creditedG: round3(advanceG + balanceG),
    advanceExceedsDue: dueG < advanceG,
  };
}

export function buildSettlementStatement(input: StatementInput): PdfDoc {
  const totals = statementTotals(input);
  const settled = input.refinedWeightG !== null && input.refinedWeightG !== undefined;

  const blocks: PdfBlock[] = [
    {
      type: 'keyValue',
      rows: [
        ['Référence du lot', input.reference],
        ['Producteur', input.producerName],
        ['Statut', input.status],
        ['Édité le', input.generatedAt.slice(0, 10)],
      ],
    },
    { type: 'heading', text: 'Origine' },
    {
      type: 'keyValue',
      rows: [
        ['Pays', input.originCountry || '—'],
        ['Zone', input.originZone || '—'],
        // Stated because it changes what the document proves: a declared
        // position is the producer's word, a verified one is a device fix.
        [
          'Position',
          input.originVerified ? 'Relevée par l\'appareil' : 'Déclarée par le producteur',
        ],
        ['Nature', input.goldType],
      ],
    },
    { type: 'heading', text: 'Pesée et essai' },
    {
      type: 'table',
      columns: ['', 'Poids', 'Pureté'],
      rows: [
        ['Déclaré au départ', g(input.declaredWeightG), pct(input.declaredPurity)],
        [
          'Après affinage (essai)',
          settled ? g(input.refinedWeightG as number) : 'En attente',
          settled ? 'Mesurée par l\'affineur' : '—',
        ],
      ],
    },
  ];

  if (settled) {
    blocks.push({
      type: 'keyValue',
      rows: [
        ['Lot affineur', input.refineryLot || '—'],
        ['Certificat LBMA', input.lbmaCertificate || '—'],
      ],
    });
  }

  blocks.push({ type: 'heading', text: 'Règlement' });
  blocks.push({
    type: 'table',
    columns: ['Poste', 'Poids', 'Date'],
    rows: [
      [
        `Dû sur essai (part producteur ${pct(input.producerShare)})`,
        settled ? g(totals.dueG) : 'En attente',
        date(input.auditedAt),
      ],
      [
        'Acompte à la réception à Dubaï',
        totals.advanceG > 0 ? g(totals.advanceG) : '—',
        date(input.advancePaidAt),
      ],
      ['Solde à l\'outturn', settled ? g(totals.balanceG) : 'En attente', date(input.balancePaidAt)],
      ['Total crédité', g(totals.creditedG), ''],
    ],
  });

  if (input.advanceCashXof && input.advanceCashXof > 0) {
    blocks.push({
      type: 'keyValue',
      rows: [
        ['Acompte versé en espèces', xof(input.advanceCashXof)],
        [
          'Cours retenu pour l\'acompte',
          input.advancePricePerGram ? `${groupDigits(input.advancePricePerGram)} XOF/g` : '—',
        ],
      ],
    });
  }

  if (totals.advanceExceedsDue) {
    // Said plainly rather than shown as a negative line: the producer needs to
    // know no money is being asked back.
    blocks.push({
      type: 'note',
      text:
        "L'essai est ressorti en dessous de l'acompte déjà versé. Conformément aux conditions, " +
        "aucun solde n'est dû et aucun remboursement n'est demandé : l'acompte reste acquis " +
        'au producteur.',
    });
  }

  if (
    settled &&
    input.producerTokensCredited !== null &&
    input.producerTokensCredited !== undefined &&
    Math.abs(round3(input.producerTokensCredited) - totals.balanceG) > 0.001
  ) {
    // The statement must never silently disagree with the wallet. If it does,
    // the document says so instead of picking a side.
    blocks.push({
      type: 'note',
      text: `Écart constaté entre le solde calculé (${g(totals.balanceG)}) et le montant effectivement crédité (${g(
        input.producerTokensCredited
      )}). Contactez le support en citant la référence du lot.`,
    });
  }

  if (input.disposition) {
    const d = input.disposition;
    blocks.push({ type: 'heading', text: 'Destination du lot' });
    blocks.push({
      type: 'table',
      columns: ['Destination', 'Poids', 'Produit'],
      rows: [
        ['Vendu', g(d.sellG), d.sellProceedsXof ? xof(d.sellProceedsXof) : '—'],
        // Une location ne produit rien à la date du relevé : le rendement
        // s'accumule jour après jour et figure sur la position, pas ici.
        ['Placé en location', g(d.leaseG), '—'],
        ['Gardé en coffre à Dubaï', g(d.storeG), '—'],
      ],
    });

    if (d.sellPricePerGram) {
      blocks.push({
        type: 'keyValue',
        rows: [
          ['Cours retenu pour la vente', `${groupDigits(d.sellPricePerGram)} XOF/g`],
          ['Répartition exécutée le', date(d.executedAt)],
        ],
      });
    }

    if (d.status !== 'EXECUTED') {
      // Un relevé qui présenterait une répartition incomplète comme faite
      // serait faux sur le point qui compte le plus pour son lecteur.
      blocks.push({
        type: 'note',
        text:
          `La répartition n'a pas été exécutée en totalité (${d.status})` +
          (d.failureReason ? ` : ${d.failureReason}` : '') +
          ". Les opérations réussies ont bien eu lieu ; les autres n'ont pas été effectuées " +
          "et l'or correspondant est resté disponible.",
      });
    }

    blocks.push({
      type: 'note',
      text:
        "Les frais de garde ne figurent pas sur ce relevé : ils portent sur l'or détenu en " +
        'compte, jour par jour, et non sur un lot en particulier. Les rattacher à un lot ' +
        "supposerait une répartition qui n'existe pas. Le détail figure dans votre espace, " +
        'rubrique frais de garde.',
    });
  }

  blocks.push({ type: 'heading', text: 'Parcours du lot' });
  blocks.push({
    type: 'table',
    columns: ['Étape', 'Date'],
    rows: [
      ['Dépôt du lot', date(input.submittedAt)],
      ['Validation transitaire', date(input.forwarderValidatedAt)],
      ['Départ en transit', date(input.transitStartedAt)],
      ['Arrivée à Dubaï', date(input.arrivedDubaiAt)],
      ['Validation après essai', date(input.auditedAt)],
    ],
  });

  blocks.push({
    type: 'note',
    text:
      '1 token = 1 gramme d\'or affiné. Les poids sont exprimés au milligramme. ' +
      'Ce relevé reprend les montants enregistrés pour ce lot ; il ne remplace pas le ' +
      'certificat d\'affinage émis par l\'affineur.',
  });

  return {
    title: 'Relevé de règlement',
    subtitle: `Lot ${input.reference} — TNC Trading`,
    footer: `Lot ${input.reference} — document généré automatiquement`,
    blocks,
  };
}
