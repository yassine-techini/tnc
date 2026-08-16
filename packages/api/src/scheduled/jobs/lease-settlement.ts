/**
 * Lease exit settlement.
 *
 * Executes exit orders whose recall period has elapsed: the grams return to the
 * wallet, `gold_on_loan` drops, the accrued yield is paid in XOF and the holder
 * is told. The exit returns the metal rather than selling it — ADR 004.
 *
 * Orders are settled one by one and a failure on one does not stop the others:
 * a holder whose gold is back should not wait on someone else's broken row.
 */

import type { Env } from '../../types/env';
import { LeaseService } from '../../services/lease.service';
import { NotificationService } from '../../services/notification.service';

export async function settleLeaseExits(env: Env, _ctx: ExecutionContext): Promise<void> {
  const service = new LeaseService(env.DB);
  const due = await service.dueExitOrders();

  if (due.length === 0) {
    console.log('[LeaseSettlement] Nothing due');
    return;
  }

  const price = await env.DB.prepare(
    'SELECT price_xof FROM gold_prices ORDER BY timestamp DESC LIMIT 1'
  ).first<{ price_xof: number }>();
  const pricePerGram = price?.price_xof ?? 0;

  // The in-app notification is written to the database regardless; the push
  // credentials only decide whether it also reaches the device.
  const notifications = new NotificationService(env.DB, {
    resendApiKey: env.RESEND_API_KEY,
    sendgridApiKey: env.SENDGRID_API_KEY,
    twilioAccountSid: env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: env.TWILIO_PHONE_NUMBER,
  });
  let settled = 0;

  for (const order of due) {
    let result: Awaited<ReturnType<LeaseService['settleExit']>>;
    try {
      result = await service.settleExit(order, pricePerGram);
    } catch (error) {
      console.error(`[LeaseSettlement] ${order.id} threw`, String(error));
      await service.failExit(order.id, String(error));
      continue;
    }

    if (!result.ok) {
      // NOT_ACTIVE / NOT_FOUND mean the position is not in a state this job can
      // settle; retrying every hour would only repeat the same outcome.
      console.error(`[LeaseSettlement] ${order.id} failed: ${result.error}`);
      await service.failExit(order.id, result.error || 'UNKNOWN');
      continue;
    }

    settled++;

    // Notification failure must not undo a settlement that already happened.
    try {
      const yieldLine =
        result.yieldXof > 0
          ? ` Votre rendement de ${result.yieldXof.toLocaleString('fr-FR')} XOF a été crédité sur votre solde.`
          : '';
      await notifications.notifyUser({
        userId: order.user_id,
        type: 'TRANSACTION',
        title: 'Votre or est de retour',
        body: `${result.principalG} g sont de nouveau disponibles dans votre portefeuille.${yieldLine}`,
        data: { positionId: order.position_id, grams: String(result.principalG) },
      });
    } catch (error) {
      console.error(`[LeaseSettlement] Notification failed for ${order.id}`, String(error));
    }
  }

  console.log(`[LeaseSettlement] ${settled}/${due.length} exit orders settled`);
}
