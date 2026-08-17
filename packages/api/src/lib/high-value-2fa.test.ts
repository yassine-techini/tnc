import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecurityService } from '../services/security.service';
import { requireTwoFactorIfHighValue } from './high-value-2fa';

/**
 * Le garde du second facteur (ADR 009).
 *
 * Une regle de securite qui n'est pas testee finit comme celle-ci l'etait avant :
 * ecrite, presente, et appelee par personne. Ce qui est verifie ici, c'est le
 * COMPORTEMENT aux bornes — sous le seuil, dessus, sans facteur enrole, avec un
 * mauvais code — parce que c'est la que se joue la difference entre une regle et
 * une decoration.
 */

const SEUIL = 1_000_000;
const SECRET_CHIFFRE = 'chiffre:JBSWY3DPEHPK3PXP';

vi.mock('./totp-secret', () => ({
  decryptTotpSecret: vi.fn(async (_cle: string, stocke: string) => stocke.replace('chiffre:', '')),
}));

const verifyTotpCode = vi.fn<(secret: string, code: string, guard?: string) => Promise<boolean>>();
const logSecurityEvent = vi.fn<(e: unknown) => Promise<void>>();

/**
 * Le VRAI SecurityService est utilise, avec seulement deux methodes remplacees :
 * la verification TOTP (qui exigerait de generer un vrai code) et la
 * journalisation (qui ecrit dans KV).
 *
 * `isHighValueTransaction` et la lecture du seuil restent celles du code. Les
 * mocker reviendrait a tester une copie de la regle plutot que la regle — et
 * un test qui verifie son propre mock passe meme quand le code est faux.
 */
vi.mock('./../services/config.service', () => ({
  ConfigService: class {
    async getNumber(clef: string, defaut: number) {
      return clef === 'high_value_threshold_xof' ? SEUIL : defaut;
    }
    async get(_clef: string, defaut: string) {
      return defaut;
    }
  },
}));

vi.spyOn(SecurityService.prototype, 'verifyTotpCode').mockImplementation(
  (secret, code, guard) => verifyTotpCode(secret, code, guard)
);
vi.spyOn(SecurityService.prototype, 'logSecurityEvent').mockImplementation((e) =>
  logSecurityEvent(e)
);

/** Un utilisateur, ou `null` pour un identifiant inconnu. */
function db(utilisateur: LigneUtilisateur | null) {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(utilisateur),
      }),
    }),
  } as unknown as D1Database;
}

interface LigneUtilisateur {
  two_factor_secret: string | null;
  two_factor_enabled: number;
}

const AVEC_2FA: LigneUtilisateur = { two_factor_secret: SECRET_CHIFFRE, two_factor_enabled: 1 };
const SANS_2FA: LigneUtilisateur = { two_factor_secret: null, two_factor_enabled: 0 };

const cache = {} as KVNamespace;

const appel = (
  montant: number,
  utilisateur: LigneUtilisateur | null,
  totpCode?: string
) =>
  requireTwoFactorIfHighValue({
    db: db(utilisateur),
    cache,
    encryptionKey: 'cle',
    userId: 'usr_1',
    amountXof: montant,
    operation: 'WITHDRAW',
    totpCode,
  });

beforeEach(() => {
  vi.clearAllMocks();
  verifyTotpCode.mockResolvedValue(true);
  logSecurityEvent.mockResolvedValue(undefined);
});

describe('Sous le seuil', () => {
  it('laisse passer sans rien demander', async () => {
    const r = await appel(SEUIL - 1, AVEC_2FA);

    expect(r.ok).toBe(true);
    expect(r.challenged).toBe(false);
  });

  it('ne demande rien meme a un compte sans second facteur', async () => {
    // Sinon la regle rendrait la plateforme inutilisable pour qui achete un
    // gramme, ce que la specification ne demande pas.
    const r = await appel(50_000, SANS_2FA);

    expect(r.ok).toBe(true);
  });
});

describe('Au seuil exact', () => {
  it('exige deja un code', async () => {
    // `isHighValueTransaction` compare avec `>=` : la borne est INCLUSE. C'est la
    // vraie methode qui repond ici, pas une copie — sinon ce test figerait le
    // mock et laisserait la regle deriver.
    const r = await appel(SEUIL, AVEC_2FA);

    expect(r.ok).toBe(false);
    expect(r.code).toBe('AUTH_2FA_REQUIRED');
  });
});

describe('Au-dessus du seuil', () => {
  it('refuse quand aucun code n est fourni', async () => {
    const r = await appel(5_000_000, AVEC_2FA);

    expect(r).toMatchObject({ ok: false, code: 'AUTH_2FA_REQUIRED', status: 403 });
    expect(r.thresholdXof).toBe(SEUIL);
  });

  it('refuse un code invalide', async () => {
    verifyTotpCode.mockResolvedValue(false);

    const r = await appel(5_000_000, AVEC_2FA, '000000');

    expect(r).toMatchObject({ ok: false, code: 'AUTH_2FA_INVALID', challenged: true });
  });

  it('ne renvoie jamais 401', async () => {
    // Un 401 declencherait la logique d'expiration de session des clients :
    // l'utilisateur serait deconnecte au lieu de se voir demander son code.
    const sansCode = await appel(5_000_000, AVEC_2FA);
    verifyTotpCode.mockResolvedValue(false);
    const mauvaisCode = await appel(5_000_000, AVEC_2FA, '000000');

    expect(sansCode.status).toBe(403);
    expect(mauvaisCode.status).toBe(403);
  });

  it('accepte un code valide', async () => {
    const r = await appel(5_000_000, AVEC_2FA, '123456');

    expect(r).toMatchObject({ ok: true, challenged: true });
  });

  it('dechiffre le secret avant de verifier le code', async () => {
    await appel(5_000_000, AVEC_2FA, '123456');

    // Verifier contre le secret CHIFFRE echouerait toujours : la panne serait
    // silencieuse et se lirait comme « le code est faux ».
    expect(verifyTotpCode).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP', '123456', 'usr_1');
  });

  it('passe l identifiant en garde anti-rejeu', async () => {
    await appel(5_000_000, AVEC_2FA, '123456');

    // Sans ce troisieme argument, un meme code validerait deux operations dans
    // sa fenetre de trente secondes (ADR 009 § 4).
    expect(verifyTotpCode.mock.calls[0][2]).toBe('usr_1');
  });
});

describe('Echec ferme', () => {
  it('refuse un compte sans second facteur au lieu de le dispenser', async () => {
    const r = await appel(5_000_000, SANS_2FA);

    // Laisser passer ferait de la regle une decoration : elle ne protegerait
    // que les comptes ayant deja fait l'effort.
    expect(r).toMatchObject({ ok: false, code: 'AUTH_2FA_SETUP_REQUIRED', status: 403 });
  });

  it('refuse un compte dont le second facteur est desactive', async () => {
    const r = await appel(5_000_000, { two_factor_secret: SECRET_CHIFFRE, two_factor_enabled: 0 });

    expect(r.code).toBe('AUTH_2FA_SETUP_REQUIRED');
  });

  it('refuse un utilisateur introuvable', async () => {
    const r = await appel(5_000_000, null);

    expect(r.ok).toBe(false);
  });

  it('refuse un montant non fini plutot que de le laisser glisser sous le seuil', async () => {
    const r = await appel(Number.NaN, AVEC_2FA);

    // `NaN >= seuil` vaut false : sans ce controle, un montant corrompu passerait
    // pour une petite operation.
    expect(r).toMatchObject({ ok: false, code: 'TRADING_INVALID_AMOUNT' });
  });

  it('applique le seuil sur la valeur absolue', async () => {
    const r = await appel(-5_000_000, AVEC_2FA);

    expect(r.ok).toBe(false);
  });
});

describe('Piste d audit', () => {
  it('journalise le defi, l echec et le succes', async () => {
    await appel(5_000_000, AVEC_2FA);
    await appel(5_000_000, SANS_2FA);
    verifyTotpCode.mockResolvedValue(false);
    await appel(5_000_000, AVEC_2FA, '000000');
    verifyTotpCode.mockResolvedValue(true);
    await appel(5_000_000, AVEC_2FA, '123456');

    const actions = logSecurityEvent.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toEqual([
      'HIGH_VALUE_2FA_CHALLENGED',
      'HIGH_VALUE_2FA_SETUP_REQUIRED',
      'HIGH_VALUE_2FA_FAILED',
      'HIGH_VALUE_2FA_PASSED',
    ]);
  });

  it('ne journalise rien sous le seuil', async () => {
    await appel(1000, AVEC_2FA);

    // Une operation courante n'est pas un evenement de securite : noyer la piste
    // reviendrait a la rendre illisible.
    expect(logSecurityEvent).not.toHaveBeenCalled();
  });
});
