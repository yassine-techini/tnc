/**
 * Second facteur sur les transactions de forte valeur.
 *
 * `CLAUDE.md` l'exige depuis le depart ; tout le necessaire existait deja
 * (`HIGH_VALUE_THRESHOLD_XOF`, `isHighValueTransaction`, `verifyTotpCode` avec
 * garde anti-rejeu) mais n'etait appele par personne. Voir ADR 009.
 *
 * Ce module est le SEUL endroit ou la regle est ecrite : achat, vente et retrait
 * l'appellent. Trois copies auraient diverge, et une regle de securite qui
 * diverge ne protege plus que les chemins dont on se souvient.
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { SecurityService } from '../services/security.service';
import { ConfigService } from '../services/config.service';
import { decryptTotpSecret } from './totp-secret';

export type HighValueOperation = 'BUY' | 'SELL' | 'WITHDRAW';

export interface HighValueGuardInput {
  db: D1Database;
  cache: KVNamespace;
  encryptionKey: string | undefined;
  userId: string;
  /** Ce qui change de mains, en XOF. Voir ADR 009 § 1. */
  amountXof: number;
  operation: HighValueOperation;
  /** Code a six chiffres fourni par le client, s'il en a fourni un. */
  totpCode?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * TOUJOURS 403, jamais 401.
 *
 * La session EST valide — c'est l'operation qui est interdite sans second
 * facteur. Et pratiquement : les trois clients traitent un 401 comme une
 * expiration de session, tentent un rafraichissement, puis deconnectent. Un
 * retrait au-dessus du seuil aurait donc jete l'utilisateur dehors au lieu de
 * lui demander six chiffres.
 */

/**
 * Forme PLATE, pas une union discriminee : ce paquet compile avec
 * `strictNullChecks: false`, ou TypeScript ne retrecit pas les unions sur `ok`.
 * Une union serait ici une elegance qui ne compile pas.
 */
export interface HighValueGuardResult {
  ok: boolean;
  /** Vrai quand un code a effectivement ete demande et verifie. */
  challenged: boolean;
  code?: string;
  message?: string;
  status?: 403;
  /** Toujours renseigne : les clients affichent le seuil dans leur message. */
  thresholdXof: number;
}

interface UserTotpRow {
  two_factor_secret: string | null;
  two_factor_enabled: number;
}

/**
 * Renvoie `ok: true` quand l'operation peut se poursuivre.
 *
 * ECHEC FERME : en dessous du seuil on laisse passer, au-dessus on exige un code
 * valide, et un compte sans facteur enrole est REFUSE plutot que dispense
 * (ADR 009 § 2). Toute erreur inattendue remonte : on ne laisse pas passer une
 * grosse operation parce qu'une verification a echoue.
 */
export async function requireTwoFactorIfHighValue(
  input: HighValueGuardInput
): Promise<HighValueGuardResult> {
  const { db, cache, encryptionKey, userId, amountXof, operation, totpCode } = input;

  const configService = new ConfigService(db, cache);
  const securityService = new SecurityService(db, cache, configService);

  const { highValueThresholdXof: seuil } = await securityService.getSecurityConfig();

  // Un montant non fini ne doit pas glisser sous le seuil par accident.
  if (!Number.isFinite(amountXof)) {
    return {
      ok: false,
      challenged: false,
      code: 'TRADING_INVALID_AMOUNT',
      message: 'Montant de transaction invalide.',
      status: 403,
      thresholdXof: seuil,
    };
  }

  if (!(await securityService.isHighValueTransaction(Math.abs(amountXof)))) {
    return { ok: true, challenged: false, thresholdXof: seuil };
  }

  const user = await db
    .prepare('SELECT two_factor_secret, two_factor_enabled FROM users WHERE id = ?')
    .bind(userId)
    .first<UserTotpRow>();

  if (!user) {
    return {
      ok: false,
      challenged: false,
      code: 'AUTH_USER_NOT_FOUND',
      message: 'Utilisateur introuvable.',
      status: 403,
      thresholdXof: seuil,
    };
  }

  // Aucun facteur enrole : on refuse et on demande l'enrolement (ADR 009 § 2).
  if (!user.two_factor_secret || !user.two_factor_enabled) {
    await securityService.logSecurityEvent({
      action: 'HIGH_VALUE_2FA_SETUP_REQUIRED',
      userId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      riskLevel: 'high',
      details: { operation, amountXof, thresholdXof: seuil },
    });

    return {
      ok: false,
      challenged: false,
      code: 'AUTH_2FA_SETUP_REQUIRED',
      message:
        "Cette operation depasse le seuil de verification renforcee. " +
        "Activez la double authentification dans vos parametres de securite pour la realiser.",
      status: 403,
      thresholdXof: seuil,
    };
  }

  if (!totpCode) {
    await securityService.logSecurityEvent({
      action: 'HIGH_VALUE_2FA_CHALLENGED',
      userId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      riskLevel: 'medium',
      details: { operation, amountXof, thresholdXof: seuil },
    });

    return {
      ok: false,
      challenged: false,
      code: 'AUTH_2FA_REQUIRED',
      message: 'Code de double authentification requis pour cette operation.',
      status: 403,
      thresholdXof: seuil,
    };
  }

  const secret = await decryptTotpSecret(encryptionKey, user.two_factor_secret);
  // L'identifiant sert de garde anti-rejeu : un meme code ne peut pas valider
  // deux operations dans sa fenetre (ADR 009 § 4).
  const valide = await securityService.verifyTotpCode(secret, totpCode, userId);

  if (!valide) {
    await securityService.logSecurityEvent({
      action: 'HIGH_VALUE_2FA_FAILED',
      userId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      riskLevel: 'high',
      details: { operation, amountXof, thresholdXof: seuil },
    });

    return {
      ok: false,
      // Un code a bien ete presente puis rejete : c'est different d'un code absent.
      challenged: true,
      code: 'AUTH_2FA_INVALID',
      message: 'Code de double authentification invalide.',
      status: 403,
      thresholdXof: seuil,
    };
  }

  await securityService.logSecurityEvent({
    action: 'HIGH_VALUE_2FA_PASSED',
    userId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    riskLevel: 'low',
    details: { operation, amountXof, thresholdXof: seuil },
  });

  return { ok: true, challenged: true, thresholdXof: seuil };
}
