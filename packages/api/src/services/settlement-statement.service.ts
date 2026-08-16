/**
 * Assembles the settlement statement for a lot.
 *
 * Reads the lot and its producer, applies the share in force, and hands the
 * result to the pure builder. Kept out of the routes because the producer, the
 * back-office and the refiner all serve the same document — the only difference
 * is who is allowed to ask for it.
 */

import { ConsignmentService, type ConsignmentRow } from './consignment.service';
import { ConfigService } from './config.service';
import { buildSettlementStatement, type StatementInput } from '../lib/settlement-statement';
import { renderPdf } from '../lib/pdf';

export class SettlementStatementService {
  constructor(
    private db: D1Database,
    private config: ConfigService
  ) {}

  async inputFor(consignmentId: string, now: Date = new Date()): Promise<StatementInput | null> {
    const consignments = new ConsignmentService(this.db);
    const lot = await consignments.getById(consignmentId);
    if (!lot) return null;

    const producer = await this.db
      .prepare(
        // Two independent lookups rather than a join FROM users: a missing user
        // row must not erase the legal name, and a missing profile must not
        // erase the email. Neither should make a lot undocumentable.
        `SELECT
           (SELECT legal_name FROM producer_profiles WHERE user_id = ?) AS legal_name,
           (SELECT email FROM users WHERE id = ?) AS email`
      )
      .bind(lot.producer_id, lot.producer_id)
      .first<{ email: string | null; legal_name: string | null }>();

    const producerShare = await this.config.getNumber('consignment_producer_share', 1);

    return toStatementInput(lot, {
      producerName: producer?.legal_name || producer?.email || lot.producer_id,
      producerShare,
      generatedAt: now.toISOString(),
    });
  }

  /** The statement as a PDF, or null when the lot does not exist. */
  async pdfFor(consignmentId: string, now: Date = new Date()): Promise<Uint8Array | null> {
    const input = await this.inputFor(consignmentId, now);
    return input ? renderPdf(buildSettlementStatement(input)) : null;
  }
}

export function toStatementInput(
  lot: ConsignmentRow,
  extra: { producerName: string; producerShare: number; generatedAt: string }
): StatementInput {
  return {
    reference: lot.reference,
    producerName: extra.producerName,
    producerId: lot.producer_id,

    declaredWeightG: lot.weight_declared_g,
    declaredPurity: lot.purity_declared,
    goldType: lot.gold_type,
    originCountry: lot.origin_country,
    originZone: lot.origin_zone,
    originVerified: lot.origin_verified === 1,

    refinedWeightG: lot.refined_weight_g,
    refineryLot: lot.refinery_lot,
    lbmaCertificate: lot.lbma_certificate,

    producerShare: extra.producerShare,
    advanceTokensG: lot.advance_tokens_g,
    advanceCashXof: lot.advance_cash_xof,
    advancePaidAt: lot.advance_paid_at,
    advancePricePerGram: lot.advance_price_per_gram,
    balanceTokensG: lot.balance_tokens_g,
    balancePaidAt: lot.balance_paid_at,
    producerTokensCredited: lot.producer_tokens_credited,

    submittedAt: lot.created_at,
    forwarderValidatedAt: lot.forwarder_validated_at,
    transitStartedAt: lot.transit_started_at,
    arrivedDubaiAt: lot.arrived_dubai_at,
    auditedAt: lot.audited_at,

    status: lot.status,
    generatedAt: extra.generatedAt,
  };
}

/** Filename used by every caller, so a lot's statement is always named the same. */
export function statementFilename(reference: string): string {
  return `releve-reglement-${reference}.pdf`;
}
