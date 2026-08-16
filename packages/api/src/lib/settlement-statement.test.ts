import { describe, it, expect } from 'vitest';
import {
  buildSettlementStatement,
  statementTotals,
  type StatementInput,
  type StatementDisposition,
} from './settlement-statement';
import { renderPdf } from './pdf';

const base: StatementInput = {
  reference: 'CONS-AB12CD34',
  producerName: 'Coopérative de Poura',
  producerId: 'producer-1',
  declaredWeightG: 1000,
  declaredPurity: 0.92,
  goldType: 'nuggets',
  originCountry: 'BF',
  originZone: 'Poura',
  originVerified: true,
  refinedWeightG: 910,
  refineryLot: 'LOT-2026-114',
  lbmaCertificate: 'LBMA-88231',
  producerShare: 1,
  advanceTokensG: 621,
  advanceCashXof: null,
  advancePaidAt: '2026-07-02T10:00:00Z',
  advancePricePerGram: null,
  balanceTokensG: 289,
  balancePaidAt: '2026-07-20T10:00:00Z',
  producerTokensCredited: 289,
  submittedAt: '2026-06-01T10:00:00Z',
  forwarderValidatedAt: '2026-06-03T10:00:00Z',
  transitStartedAt: '2026-06-05T10:00:00Z',
  arrivedDubaiAt: '2026-07-02T10:00:00Z',
  auditedAt: '2026-07-20T10:00:00Z',
  status: 'AUDIT_VALIDATED',
  generatedAt: '2026-08-16T12:00:00Z',
  disposition: null,
};

const disposed: StatementDisposition = {
  sellG: 300,
  leaseG: 400,
  storeG: 210,
  sellPricePerGram: 53_000,
  sellProceedsXof: 15_900_000,
  status: 'EXECUTED',
  failureReason: null,
  executedAt: '2026-07-21T09:00:00Z',
};

const text = (doc: ReturnType<typeof buildSettlementStatement>) =>
  JSON.stringify(doc.blocks);

describe('statementTotals', () => {
  it('reconciles: advance + balance = what was due on the assay', () => {
    const t = statementTotals(base);
    expect(t).toMatchObject({ dueG: 910, advanceG: 621, balanceG: 289, creditedG: 910 });
    expect(t.advanceG + t.balanceG).toBe(t.dueG);
  });

  it('applies the platform share to the assay, not to the declared weight', () => {
    // 910 refined x 95% = 864.5, regardless of the 1000 g declared.
    const t = statementTotals({ ...base, producerShare: 0.95, advanceTokensG: 0 });
    expect(t.dueG).toBe(864.5);
    expect(t.balanceG).toBe(864.5);
  });

  it('never shows a negative balance when the assay comes in under the advance', () => {
    // The advance was paid on a declared weight that did not survive refining.
    const t = statementTotals({ ...base, refinedWeightG: 500, advanceTokensG: 621 });
    expect(t.dueG).toBe(500);
    expect(t.balanceG).toBe(0); // nothing more is paid...
    expect(t.creditedG).toBe(621); // ...and nothing is taken back
    expect(t.advanceExceedsDue).toBe(true);
  });

  it('treats an un-assayed lot as pending rather than as zero owed', () => {
    const t = statementTotals({ ...base, refinedWeightG: null });
    expect(t).toMatchObject({ dueG: 0, balanceG: 0, creditedG: 621, advanceExceedsDue: false });
  });

  it('handles a lot with no advance at all', () => {
    const t = statementTotals({ ...base, advanceTokensG: null });
    expect(t).toMatchObject({ advanceG: 0, dueG: 910, balanceG: 910, creditedG: 910 });
  });

  it('rounds to the milligram, the unit the platform accounts in', () => {
    const t = statementTotals({ ...base, refinedWeightG: 910.0004, advanceTokensG: 0 });
    expect(t.dueG).toBe(910);
  });
});

describe('buildSettlementStatement', () => {
  it('states the figures a producer needs to check the settlement', () => {
    const doc = buildSettlementStatement(base);
    const body = text(doc);

    expect(doc.title).toBe('Relevé de règlement');
    expect(doc.subtitle).toContain('CONS-AB12CD34');
    expect(body).toContain('1000.000 g'); // declared
    expect(body).toContain('910.000 g'); // assay and total credited
    expect(body).toContain('621.000 g'); // advance
    expect(body).toContain('289.000 g'); // balance
    expect(body).toContain('LBMA-88231');
  });

  it('says whether the origin was measured or merely declared', () => {
    expect(text(buildSettlementStatement(base))).toContain("Relevée par l'appareil");
    expect(text(buildSettlementStatement({ ...base, originVerified: false }))).toContain(
      'Déclarée par le producteur'
    );
  });

  it('explains in words that a short assay is not clawed back', () => {
    const body = text(buildSettlementStatement({ ...base, refinedWeightG: 500, producerTokensCredited: 0 }));
    expect(body).toContain('aucun remboursement');
    // And no negative figure is left for the producer to interpret.
    expect(body).not.toContain('-121');
  });

  it('flags a disagreement with the wallet instead of hiding it', () => {
    // The statement must never quietly differ from what was actually credited.
    const body = text(buildSettlementStatement({ ...base, producerTokensCredited: 200 }));
    expect(body).toContain('Écart constaté');
  });

  it('stays silent when the statement and the wallet agree', () => {
    expect(text(buildSettlementStatement(base))).not.toContain('Écart constaté');
  });

  it('shows a lot still in transit as pending, not as settled at zero', () => {
    const body = text(
      buildSettlementStatement({
        ...base,
        refinedWeightG: null,
        auditedAt: null,
        balancePaidAt: null,
        producerTokensCredited: null,
        status: 'IN_TRANSIT',
      })
    );
    expect(body).toContain('En attente');
    expect(body).not.toContain('LBMA-88231');
  });

  it('reports a cash advance with the rate it was paid at', () => {
    const body = text(
      buildSettlementStatement({
        ...base,
        advanceTokensG: 0,
        advanceCashXof: 33_000_000,
        advancePricePerGram: 53_000,
      })
    );
    expect(body).toContain('33 000 000 XOF');
    expect(body).toContain('53 000 XOF/g');
  });

  it('retrace ce que le raffineur a fait du lot', () => {
    const body = text(buildSettlementStatement({ ...base, disposition: disposed }));

    expect(body).toContain('Destination du lot');
    expect(body).toContain('300.000 g'); // vendu
    expect(body).toContain('400.000 g'); // loué
    expect(body).toContain('210.000 g'); // gardé
    expect(body).toContain('15 900 000 XOF');
    expect(body).toContain('53 000 XOF/g');
  });

  it('ne mentionne aucune destination tant que le lot n’est pas réparti', () => {
    // Un lot réglé mais non réparti n'est pas un lot entièrement stocké : le
    // relevé ne doit pas laisser croire l'un pour l'autre.
    const body = text(buildSettlementStatement(base));
    expect(body).not.toContain('Destination du lot');
    expect(body).not.toContain('Gardé en coffre');
  });

  it('n’attribue pas de rendement à la part louée', () => {
    // Le rendement s'accumule jour après jour sur la position ; le figer sur un
    // relevé daté serait faux dès le lendemain.
    const body = text(buildSettlementStatement({ ...base, disposition: disposed }));
    const rows = JSON.parse(body).find((b: { type: string }) => b.type === 'table' && JSON.stringify(b).includes('Placé en location'));
    const leaseRow = rows.rows.find((r: string[]) => r[0] === 'Placé en location');
    expect(leaseRow[2]).toBe('—');
  });

  it('dit qu’une répartition incomplète l’est', () => {
    const body = text(
      buildSettlementStatement({
        ...base,
        disposition: { ...disposed, status: 'PARTIAL', failureReason: 'location: BELOW_MINIMUM' },
      })
    );
    // Présenter une répartition incomplète comme faite serait faux sur le point
    // qui compte le plus pour le lecteur.
    expect(body).toContain("n'a pas été exécutée en totalité");
    expect(body).toContain('BELOW_MINIMUM');
    expect(body).toContain('Les opérations réussies ont bien eu lieu');
  });

  it('n’impute aucun frais de garde à un lot', () => {
    // Les frais portent sur l'or détenu en compte, jour par jour. Les rattacher
    // à un lot supposerait une répartition qui n'existe pas.
    const body = text(buildSettlementStatement({ ...base, disposition: disposed }));
    expect(body).toContain('Les frais de garde ne figurent pas sur ce relevé');
  });

  it('renders to a real PDF', () => {
    const pdf = renderPdf(buildSettlementStatement(base));
    expect(new TextDecoder().decode(pdf.slice(0, 8))).toContain('%PDF-1.4');
    expect(new TextDecoder('latin1').decode(pdf.slice(-6))).toContain('%%EOF');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
