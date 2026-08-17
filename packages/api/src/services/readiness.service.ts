/**
 * Configuration readiness — Phase 0.
 *
 * Several features in this platform are fully written, tested, and completely
 * inert because a key is missing: push notifications, reserve attestations, the
 * portal IP allowlists. This service answers one question, key by key: is this
 * deployment actually able to demonstrate what it implements?
 *
 * TWO RULES it never breaks:
 *
 *  1. It NEVER returns a secret value — only presence, and where it was found.
 *     A readiness endpoint that leaks the keys it audits is worse than none.
 *
 *  2. Live probing is OPT-IN and read-only. A readiness check that silently
 *     called a payment gateway would be a surprising side effect on a
 *     production system, so payment providers are never probed: their presence
 *     is reported, their behaviour is not exercised.
 */
import { ConfigService } from './config.service';
import { parseServiceAccount, getAccessToken } from '../lib/fcm-oauth';
import { isEnforced } from '../lib/ip-allowlist';

export type CheckState = 'ok' | 'missing' | 'partial' | 'probe_failed' | 'not_probed';

export interface Check {
  /** Stable identifier, usable by the CLI and by scripts. */
  key: string;
  /** Business grouping, matching FONCTIONNALITES-IMPLEMENTEES.md. */
  group: string;
  label: string;
  state: CheckState;
  /** What is missing or what the probe found. Never contains a secret. */
  detail: string;
  /** Which feature stops working while this is missing. */
  impact: string;
  /** Where the value is expected: env secret, config table, or wrangler.toml. */
  source: 'secret' | 'config' | 'wrangler';
  /** Whether this check supports a live probe. */
  probeable: boolean;
}

export interface ReadinessReport {
  generatedAt: string;
  probed: boolean;
  summary: {
    ok: number;
    missing: number;
    partial: number;
    failed: number;
    /** Sans objet aujourd'hui — un job qui n'a rien a calculer, par exemple. */
    notProbed: number;
    total: number;
  };
  checks: Check[];
}

interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  [key: string]: unknown;
}

/** Presence only — the value is read but never returned. */
function present(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export class ReadinessService {
  private config: ConfigService;

  constructor(private env: Env) {
    this.config = new ConfigService(env.DB, env.CACHE);
  }

  /**
   * A key is satisfied by the config table OR by an env secret — that is how
   * every service in this codebase resolves them (config first, env fallback).
   */
  private async resolve(configKey: string, envKey: string): Promise<{ found: boolean; source: 'config' | 'secret' | null }> {
    const fromConfig = await this.config.get(configKey, undefined);
    if (present(fromConfig)) return { found: true, source: 'config' };
    if (present(this.env[envKey])) return { found: true, source: 'secret' };
    return { found: false, source: null };
  }

  async report(probe: boolean): Promise<ReadinessReport> {
    const checks: Check[] = [];

    // ── Gold price ──────────────────────────────────────────────────────────
    const goldApi = await this.resolve('gold_api_key', 'GOLD_API_KEY');
    checks.push({
      key: 'gold_api',
      group: 'Marché',
      label: 'GoldAPI (prix de l\'or)',
      state: goldApi.found ? (probe ? await this.probeGoldApi() : 'ok') : 'missing',
      detail: goldApi.found ? `Trouvée (${goldApi.source === 'config' ? 'config' : 'secret'})` : 'Absente',
      impact: 'Prix de l\'or et donc achat/vente indisponibles',
      source: 'secret',
      probeable: true,
    });

    const fx = await this.resolve('exchange_rate_api_key', 'EXCHANGE_RATE_API_KEY');
    checks.push({
      key: 'exchange_rate_api',
      group: 'Marché',
      label: 'API taux de change USD/XOF',
      state: fx.found ? 'ok' : 'missing',
      detail: fx.found ? 'Trouvée' : 'Absente — repli sur le taux fixe configuré',
      impact: 'Conversion USD→XOF figée sur le taux de repli',
      source: 'secret',
      probeable: false,
    });

    // ── Notifications ───────────────────────────────────────────────────────
    const resend = await this.resolve('resend_api_key', 'RESEND_API_KEY');
    const sendgrid = await this.resolve('sendgrid_api_key', 'SENDGRID_API_KEY');
    checks.push({
      key: 'email',
      group: 'Notifications',
      label: 'Email (Resend, repli SendGrid)',
      state: resend.found || sendgrid.found ? (resend.found && sendgrid.found ? 'ok' : 'partial') : 'missing',
      detail: resend.found
        ? sendgrid.found
          ? 'Resend + repli SendGrid'
          : 'Resend seul — aucun repli si Resend tombe'
        : sendgrid.found
          ? 'SendGrid seul (fournisseur de repli utilisé en principal)'
          : 'Aucun fournisseur',
      impact: 'Aucun email : vérification de compte, alertes, décisions KYC',
      source: 'secret',
      probeable: false,
    });

    const twilioSid = await this.resolve('twilio_account_sid', 'TWILIO_ACCOUNT_SID');
    const twilioToken = await this.resolve('twilio_auth_token', 'TWILIO_AUTH_TOKEN');
    const twilioPhone = await this.resolve('twilio_phone_number', 'TWILIO_PHONE_NUMBER');
    const twilioCount = [twilioSid, twilioToken, twilioPhone].filter((r) => r.found).length;
    checks.push({
      key: 'sms',
      group: 'Notifications',
      label: 'SMS (Twilio)',
      state: twilioCount === 3 ? 'ok' : twilioCount === 0 ? 'missing' : 'partial',
      detail:
        twilioCount === 3
          ? 'SID, token et numéro présents'
          : `${twilioCount}/3 valeurs présentes — il en manque ${3 - twilioCount}`,
      impact: 'Aucun SMS : vérification de téléphone, alertes de prix',
      source: 'secret',
      probeable: false,
    });

    const fcm = await this.resolve('fcm_service_account', 'FCM_SERVICE_ACCOUNT');
    checks.push({
      key: 'fcm',
      group: 'Notifications',
      label: 'Push mobile (FCM HTTP v1)',
      state: fcm.found ? (probe ? await this.probeFcm() : 'ok') : 'missing',
      detail: fcm.found
        ? 'Compte de service trouvé'
        : 'Absent — une clé serveur legacy ne convient pas, l\'endpoint est coupé depuis juin 2024',
      impact: 'Aucune notification push ne part',
      source: 'secret',
      probeable: true,
    });

    // ── KYC ─────────────────────────────────────────────────────────────────
    const smileKey = await this.resolve('smile_identity_api_key', 'SMILE_IDENTITY_API_KEY');
    const smilePartner = await this.resolve('smile_identity_partner_id', 'SMILE_IDENTITY_PARTNER_ID');
    const smileCount = [smileKey, smilePartner].filter((r) => r.found).length;
    checks.push({
      key: 'smile_identity',
      group: 'KYC',
      label: 'Smile Identity (vérification d\'identité)',
      state: smileCount === 2 ? 'ok' : smileCount === 0 ? 'missing' : 'partial',
      detail: smileCount === 2 ? 'Clé et partner ID présents' : `${smileCount}/2 valeurs présentes`,
      impact: 'Vérification KYC automatique indisponible — revue manuelle uniquement',
      source: 'secret',
      probeable: false,
    });

    checks.push(await this.encryptionCheck());

    // ── Paiements (jamais sondés) ───────────────────────────────────────────
    for (const provider of PAYMENT_PROVIDERS) {
      const found = await Promise.all(
        provider.keys.map(([configKey, envKey]) => this.resolve(configKey, envKey))
      );
      const count = found.filter((r) => r.found).length;
      checks.push({
        key: provider.key,
        group: 'Paiements',
        label: provider.label,
        state: count === provider.keys.length ? 'ok' : count === 0 ? 'missing' : 'partial',
        detail:
          count === provider.keys.length
            ? 'Toutes les valeurs présentes'
            : `${count}/${provider.keys.length} valeurs présentes`,
        impact: `Dépôts et retraits via ${provider.label} indisponibles`,
        source: 'secret',
        // Never probed: exercising a payment gateway from a readiness check
        // would be a real side effect on a real account.
        probeable: false,
      });
    }

    const webhookSecret = await this.resolve('webhook_secret', 'WEBHOOK_SECRET');
    checks.push({
      key: 'webhook_secret',
      group: 'Paiements',
      label: 'Secret de signature des webhooks',
      state: webhookSecret.found ? 'ok' : 'missing',
      detail: webhookSecret.found ? 'Présent' : 'Absent — les webhooks entrants sont rejetés',
      impact: 'Aucune confirmation de paiement ne peut être acceptée',
      source: 'secret',
      probeable: false,
    });

    // ── Preuve de réserve ───────────────────────────────────────────────────
    checks.push(...(await this.attestationChecks()));

    // ── Portails privilégiés ────────────────────────────────────────────────
    for (const [key, label] of [
      ['admin_ip_allowlist', 'Liste d\'IP — back-office'],
      ['state_ip_allowlist', 'Liste d\'IP — portail État'],
    ] as const) {
      const list = await this.config.get(key, '');
      const enforced = isEnforced(list);
      checks.push({
        key,
        group: 'Portails privilégiés',
        label,
        state: enforced ? 'ok' : 'missing',
        detail: enforced
          ? 'Active'
          : 'Vide — aucun filtrage réseau. Cloudflare Access n\'étant pas utilisé, c\'est le seul rempart réseau',
        impact: 'Portail joignable depuis n\'importe quelle adresse',
        source: 'config',
        probeable: false,
      });
    }

    checks.push(...(await this.anchoringChecks()));
    checks.push(...(await this.dailyJobChecks()));
    checks.push(await this.countryCheck());
    checks.push(await this.priceFreshnessCheck());
    checks.push(await this.backupCheck());

    const summary = {
      ok: checks.filter((c) => c.state === 'ok').length,
      missing: checks.filter((c) => c.state === 'missing').length,
      partial: checks.filter((c) => c.state === 'partial').length,
      failed: checks.filter((c) => c.state === 'probe_failed').length,
      notProbed: checks.filter((c) => c.state === 'not_probed').length,
      total: checks.length,
    };

    return { generatedAt: new Date().toISOString(), probed: probe, summary, checks };
  }

  private async encryptionCheck(): Promise<Check> {
    const found = present(this.env.ENCRYPTION_KEY);
    return {
      key: 'encryption_key',
      group: 'KYC',
      label: 'Clé de chiffrement des documents',
      state: found ? 'ok' : 'missing',
      detail: found ? 'Présente' : 'Absente — les uploads KYC et KYB sont refusés (fail-closed)',
      impact: 'Aucun document d\'identité ne peut être déposé',
      source: 'secret',
      probeable: false,
    };
  }

  private async attestationChecks(): Promise<Check[]> {
    const signing = present(this.env.ATTESTATION_SIGNING_JWK);
    const publicJwk = await this.config.get('attestation_public_jwk', '');
    const latest = await this.env.DB
      .prepare('SELECT sequence, created_at FROM reserve_attestations ORDER BY sequence DESC LIMIT 1')
      .first<{ sequence: number; created_at: string }>();

    return [
      {
        key: 'attestation_signing_key',
        group: 'Preuve de réserve',
        label: 'Clé de signature des attestations',
        state: signing ? 'ok' : 'missing',
        detail: signing
          ? 'Présente'
          : 'Absente — le job ne publie rien plutôt qu\'une attestation non signée',
        impact: 'Aucune attestation de réserve publiée',
        source: 'secret',
        probeable: false,
      },
      {
        key: 'attestation_public_jwk',
        group: 'Preuve de réserve',
        label: 'Clé publique de vérification',
        state: present(publicJwk) ? 'ok' : 'missing',
        detail: present(publicJwk)
          ? 'Publiée'
          : 'Absente — la page /reserve ne peut pas vérifier les signatures',
        impact: 'Vérification publique impossible pour un tiers',
        source: 'config',
        probeable: false,
      },
      {
        key: 'attestation_cron',
        group: 'Preuve de réserve',
        label: 'Publication périodique (cron 30 0 * * *)',
        // Workers cannot introspect their own triggers, so this is inferred
        // from the evidence: an attestation exists and is recent.
        state: latest ? 'ok' : 'missing',
        detail: latest
          ? `Dernière attestation #${latest.sequence} le ${latest.created_at}`
          : 'Aucune attestation en base — le trigger cron est probablement absent de wrangler.toml',
        impact: 'La chaîne d\'attestations ne progresse pas',
        source: 'wrangler',
        probeable: false,
      },
    ];
  }

  /**
   * Ancrage sur chaîne publique (ADR 003).
   *
   * Absent du rapport jusqu'ici, alors que le script de démo invite à ouvrir ce
   * rapport en premier : une fonctionnalité inerte donnait un rapport vert.
   */
  private async anchoringChecks(): Promise<Check[]> {
    const rpc = present(this.env.ANCHOR_RPC_URL);
    const key = present(this.env.ANCHOR_PRIVATE_KEY);
    const chain = (this.env.ANCHOR_CHAIN as string) || '';
    const mainnetOptIn = this.env.ANCHOR_ALLOW_MAINNET === 'true';
    const configured = rpc && key;

    let anchored: { sequence: number; anchor_chain: string; anchored_at: string } | null = null;
    try {
      anchored = await this.env.DB
        .prepare(
          `SELECT sequence, anchor_chain, anchored_at FROM reserve_attestations
           WHERE anchor_tx_hash IS NOT NULL ORDER BY sequence DESC LIMIT 1`
        )
        .first<{ sequence: number; anchor_chain: string; anchored_at: string }>();
    } catch {
      // Table absente sur un deploiement non migre : traite comme non ancre.
    }

    return [
      {
        key: 'anchor_credentials',
        group: 'Preuve de réserve',
        label: 'Ancrage — RPC et clé de signature',
        state: configured ? 'ok' : rpc || key ? 'partial' : 'missing',
        detail: configured
          ? 'Présents'
          : rpc || key
            ? `Incomplet : ${rpc ? 'clé absente' : 'URL RPC absente'}`
            : "Absents — les attestations restent vérifiables, simplement non ancrées",
        // Dit explicitement pour éviter la panique : l'ancrage est une
        // confirmation supplémentaire, jamais une condition (ADR 003).
        impact: "Aucun ancrage public ; la vérification des attestations fonctionne malgré tout",
        source: 'secret',
        probeable: false,
      },
      {
        key: 'anchor_activity',
        group: 'Preuve de réserve',
        label: 'Ancrage — activité (cron 0 1 * * *)',
        // Inféré comme pour l'attestation : un Worker ne peut pas lire ses
        // propres triggers, mais une attestation ancrée en est la preuve.
        state: anchored ? 'ok' : configured ? 'missing' : 'not_probed',
        detail: anchored
          ? `Dernier ancrage #${anchored.sequence} sur ${anchored.anchor_chain} le ${anchored.anchored_at}`
          : configured
            ? "Configuré mais aucune attestation ancrée — vérifier le trigger dans wrangler.toml"
            : "Sans objet tant que l'ancrage n'est pas configuré",
        impact: "L'historique n'est pas ancré publiquement",
        source: 'wrangler',
        probeable: false,
      },
      {
        key: 'anchor_mainnet_guard',
        group: 'Preuve de réserve',
        label: 'Ancrage — garde réseau principal',
        // Un déploiement mal configuré doit ancrer sur un testnet, pas dépenser
        // de vrais fonds par accident.
        state: 'ok',
        detail: chain
          ? `Chaîne ${chain}${mainnetOptIn ? ' avec opt-in mainnet explicite' : ''}`
          : 'Chaîne par défaut (réseau de test)',
        impact: 'Sans opt-in explicite, un mainnet est refusé par le job',
        source: 'secret',
        probeable: false,
      },
    ];
  }

  /**
   * Jobs quotidiens : location et frais de garde.
   *
   * Chacun distingue « rien à faire » de « job à l'arrêt ». Sans cette
   * distinction le rapport crierait au loup sur un déploiement neuf, et on
   * apprendrait à l'ignorer — ce qui est pire que de ne rien afficher.
   */
  private async dailyJobChecks(): Promise<Check[]> {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const count = async (sql: string, ...binds: unknown[]): Promise<number> => {
      try {
        const row = await this.env.DB.prepare(sql)
          .bind(...binds)
          .first<{ c: number }>();
        return row?.c ?? 0;
      } catch {
        // Table absente sur un deploiement non migre : rien a signaler.
        return 0;
      }
    };

    const positions = await count(
      "SELECT COUNT(*) AS c FROM lease_positions WHERE status = 'ACTIVE'"
    );
    const accruals = await count(
      'SELECT COUNT(*) AS c FROM lease_accruals WHERE accrual_date = ?',
      yesterday
    );
    const overdue = await count(
      "SELECT COUNT(*) AS c FROM lease_exit_orders WHERE status = 'PENDING' AND settles_on < ?",
      today
    );
    const holders = await count('SELECT COUNT(*) AS c FROM wallets WHERE token_balance > 0');
    const fees = await count(
      'SELECT COUNT(*) AS c FROM storage_fee_accruals WHERE accrual_date = ?',
      yesterday
    );

    return [
      {
        key: 'lease_accrual_cron',
        group: "Location d'or",
        label: 'Rendement quotidien (cron 0 4 * * *)',
        state: positions === 0 ? 'not_probed' : accruals > 0 ? 'ok' : 'missing',
        detail:
          positions === 0
            ? 'Aucune position ouverte — rien à calculer'
            : accruals > 0
              ? `${accruals} calcul(s) pour le ${yesterday}`
              : `${positions} position(s) ouverte(s) et aucun calcul pour le ${yesterday}`,
        impact: 'Le rendement des détenteurs cesse de progresser',
        source: 'wrangler',
        probeable: false,
      },
      {
        key: 'lease_settlement_cron',
        group: "Location d'or",
        label: 'Règlement des sorties (cron 0 5 * * *)',
        // Un ordre échu et non réglé est le seul symptôme observable : c'est de
        // l'or qu'un détenteur attend et qui n'est pas revenu.
        state: overdue === 0 ? 'ok' : 'missing',
        detail:
          overdue === 0
            ? 'Aucun ordre échu en attente'
            : `${overdue} sortie(s) échue(s) non réglée(s) — l'or n'est pas revenu aux détenteurs`,
        impact: 'Les sorties de location restent bloquées',
        source: 'wrangler',
        probeable: false,
      },
      {
        key: 'storage_fee_cron',
        group: 'Filière or',
        label: 'Frais de garde (cron 0 6 * * *)',
        state: holders === 0 ? 'not_probed' : fees > 0 ? 'ok' : 'missing',
        detail:
          holders === 0
            ? 'Aucun or gardé — rien à facturer'
            : fees > 0
              ? `${fees} frais calculé(s) pour le ${yesterday}`
              : `Or gardé mais aucun frais pour le ${yesterday}`,
        impact: "La garde n'est pas facturée",
        source: 'wrangler',
        probeable: false,
      },
    ];
  }

/**
   * Age de la derniere sauvegarde VERIFIEE.
   *
   * C'est le vrai correctif de l'ecart D. Ajouter un cron ne suffit pas : un cron
   * qui echoue en silence ramene a la situation d'avant en donnant en plus
   * l'illusion contraire. Ici, l'absence de sauvegarde recente est une mesure,
   * pas une case a cocher.
   */
  private async backupCheck(): Promise<Check> {
    const commun = {
      key: 'database_backup',
      group: 'Exploitation',
      label: 'Sauvegarde de la base (cron 0 7 * * *)',
      impact: "Aucune copie exportable du registre au-dela des 30 jours de Time Travel",
      source: 'wrangler' as const,
      probeable: false,
    };

    let etat: {
      finishedAt?: string;
      ok?: boolean;
      totalRows?: number;
      tables?: number;
      tronquees?: string[];
      erreur?: string;
    } | null = null;

    try {
      etat = await this.env.CACHE.get('backup:last', 'json');
    } catch {
      return { ...commun, state: 'probe_failed', detail: "L'etat de sauvegarde n'a pas pu etre lu" };
    }

    if (!etat?.finishedAt) {
      return {
        ...commun,
        state: 'missing',
        detail: "Aucune sauvegarde n'a jamais abouti",
      };
    }

    const ageHeures = (Date.now() - new Date(etat.finishedAt).getTime()) / 3_600_000;
    const quand = etat.finishedAt.slice(0, 16).replace('T', ' ');

    if (!etat.ok) {
      return {
        ...commun,
        state: 'missing',
        detail: `Derniere tentative en echec le ${quand} — ${etat.erreur || 'raison inconnue'}`,
      };
    }

    // 48 h : deux executions quotidiennes manquees d'affilee. Une seule peut
    // tenir a un incident passager ; deux, c'est une panne.
    if (ageHeures > 48) {
      return {
        ...commun,
        state: 'missing',
        detail: `Derniere sauvegarde verifiee le ${quand}, soit il y a ${Math.floor(ageHeures / 24)} jour(s)`,
      };
    }

    return {
      ...commun,
      state: 'ok',
      detail: `${etat.tables ?? 0} table(s), ${etat.totalRows ?? 0} ligne(s), verifiee le ${quand}`,
    };
  }

  /** Au moins un pays réellement ouvrable. */
  private async countryCheck(): Promise<Check> {
    let enabled: Array<{ code: string; payment_methods: string }> = [];
    try {
      const rows = await this.env.DB
        .prepare('SELECT code, payment_methods FROM country_config WHERE enabled = 1')
        .all<{ code: string; payment_methods: string }>();
      enabled = rows.results || [];
    } catch {
      // Table absente : aucun pays ouvrable, ce que le check dira.
    }
    // Le drapeau `enabled` ne suffit pas : sans moyen de paiement branché, un
    // détenteur pourrait s'inscrire puis ne pas pouvoir déposer.
    const serviceable = enabled.filter((c) => {
      try {
        const methods = JSON.parse(c.payment_methods) as Array<{ implemented?: boolean }>;
        return Array.isArray(methods) && methods.some((m) => m.implemented);
      } catch {
        return false;
      }
    });

    return {
      key: 'country_config',
      group: 'Multi-pays',
      label: 'Pays réellement ouvrables',
      state: serviceable.length > 0 ? 'ok' : 'missing',
      detail:
        serviceable.length > 0
          ? `${serviceable.map((c) => c.code).join(', ')} (${enabled.length} activé(s))`
          : enabled.length > 0
            ? `${enabled.length} pays activé(s), aucun avec un moyen de paiement branché`
            : 'Aucun pays activé',
      impact: 'Aucune inscription possible',
      source: 'config',
      probeable: false,
    };
  }

  /**
   * Fraîcheur du prix — le blocage numéro un d'une démonstration.
   *
   * Distinct de la clé GoldAPI : la clé peut être présente et le rafraîchisseur
   * à l'arrêt, auquel cas achat et vente échouent avec une clé pourtant valide.
   */
  private async priceFreshnessCheck(): Promise<Check> {
    let latest: { timestamp: string } | null = null;
    try {
      latest = await this.env.DB
        .prepare('SELECT timestamp FROM gold_prices ORDER BY timestamp DESC LIMIT 1')
        .first<{ timestamp: string }>();
    } catch {
      // Table absente : aucun prix, ce que le check dira.
    }

    // SQLite ecrit `datetime('now')` en UTC mais sans indicateur de fuseau.
    // `new Date(...)` lit alors la valeur en heure LOCALE : l'age serait decale
    // du fuseau du serveur, et un prix frais paraitrait perime — ou l'inverse.
    const utc = /(Z|[+-]\d{2}:?\d{2})$/.test(latest?.timestamp ?? '')
      ? latest?.timestamp
      : `${(latest?.timestamp ?? '').replace(' ', 'T')}Z`;
    const parsed = latest ? new Date(utc as string).getTime() : Number.NaN;
    const ageMinutes = Number.isNaN(parsed) ? null : Math.round((Date.now() - parsed) / 60000);
    // Le cron tourne toutes les 5 à 15 minutes ; une heure signale un arrêt,
    // pas un simple retard.
    const fresh = ageMinutes !== null && ageMinutes <= 60;

    return {
      key: 'price_freshness',
      group: 'Marché',
      label: "Prix de l'or récent en base",
      state: fresh ? 'ok' : 'missing',
      detail: latest
        ? `Dernier prix il y a ${ageMinutes} minute(s)`
        : "Aucun prix en base — le rafraîchisseur n'a jamais tourné",
      impact: 'Achat, vente et valorisation indisponibles',
      source: 'wrangler',
      probeable: false,
    };
  }

  /** Read-only price fetch. Never mutates anything. */
  private async probeGoldApi(): Promise<CheckState> {
    try {
      const key = (await this.config.get('gold_api_key', this.env.GOLD_API_KEY as string)) || '';
      const baseUrl = await this.config.get('gold_api_base_url', 'https://www.goldapi.io/api/XAU/USD');
      const response = await fetch(baseUrl!, { headers: { 'x-access-token': key } });
      return response.ok ? 'ok' : 'probe_failed';
    } catch {
      return 'probe_failed';
    }
  }

  /** Token exchange only — no message is ever sent. */
  private async probeFcm(): Promise<CheckState> {
    try {
      const raw = (await this.config.get('fcm_service_account', this.env.FCM_SERVICE_ACCOUNT as string)) || '';
      const account = parseServiceAccount(raw);
      if (!account) return 'probe_failed';
      const token = await getAccessToken(account, null);
      return token ? 'ok' : 'probe_failed';
    } catch {
      return 'probe_failed';
    }
  }
}

const PAYMENT_PROVIDERS: Array<{ key: string; label: string; keys: Array<[string, string]> }> = [
  {
    key: 'orange_money',
    label: 'Orange Money',
    keys: [
      ['orange_money_api_key', 'ORANGE_MONEY_API_KEY'],
      ['orange_money_merchant_id', 'ORANGE_MONEY_MERCHANT_ID'],
    ],
  },
  {
    key: 'moov_money',
    label: 'Moov Money',
    keys: [
      ['moov_money_api_key', 'MOOV_MONEY_API_KEY'],
      ['moov_merchant_id', 'MOOV_MERCHANT_ID'],
    ],
  },
  {
    key: 'cinetpay',
    label: 'CinetPay',
    keys: [
      ['cinetpay_api_key', 'CINETPAY_API_KEY'],
      ['cinetpay_site_id', 'CINETPAY_SITE_ID'],
    ],
  },
  {
    key: 'stripe',
    label: 'Stripe',
    keys: [
      ['stripe_secret_key', 'STRIPE_SECRET_KEY'],
      ['stripe_webhook_secret', 'STRIPE_WEBHOOK_SECRET'],
    ],
  },
];
