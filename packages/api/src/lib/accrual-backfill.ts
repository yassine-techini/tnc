/**
 * Rattrapage des jours manques — ADR 011.
 *
 * Les travaux de nuit valorisent un jour ecoule. Quand l'un d'eux echoue en cours
 * de route, les beneficiaires suivants restent en retard : leur `last_accrued_on`
 * est anterieur au jour a traiter. Le code annoncait que « le job reprend le jour
 * au passage suivant » — mais il creditait la date COURANTE, si bien que la
 * position etait reprise et le jour perdu jamais.
 *
 * Ce module fournit les deux briques qui manquaient : la liste des jours dus, et
 * le prix DE CE JOUR-LA.
 */

import type { D1Database } from '@cloudflare/workers-types';

/** Un jour dû, avec la valorisation qui lui correspond. */
export interface JourARattraper {
  date: string;
  pricePerGram: number;
}

export interface PlanRattrapage {
  /** Jours valorisables, du plus ancien au plus recent. */
  jours: JourARattraper[];
  /** Jours dus mais sans prix releve : non rattrapables, signales. */
  sansPrix: string[];
  /** Vrai quand le plafond a ete atteint : il reste des jours en arriere. */
  tronque: boolean;
}

const UN_JOUR = 24 * 60 * 60 * 1000;

/** `2026-08-18` — le format utilise partout pour une date de valorisation. */
export function jourIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * La veille d'une date — `2026-08-18` rend `2026-08-17`.
 *
 * Sert a exprimer « du a partir de CE jour inclus » dans un calcul qui compte a
 * partir du dernier jour DEJA traite. Une position jamais creditee doit son
 * premier jour a sa date d'ouverture : la reference a passer est donc la veille
 * de cette ouverture.
 */
export function veille(date: string): string {
  return jourIso(new Date(new Date(`${date}T00:00:00Z`).getTime() - UN_JOUR));
}

/**
 * Les jours dus, de `dernierTraite + 1` jusqu'a `jusquA` inclus.
 *
 * `dernierTraite` a `null` signifie « aucune reference » : on ne remonte alors
 * pas plus loin que le jour courant, faute de savoir depuis quand. Les appelants
 * qui disposent d'une date d'origine passent `veille(origine)` plutot que `null`.
 */
export function joursDus(
  dernierTraite: string | null | undefined,
  jusquA: string,
  plafond: number
): { jours: string[]; tronque: boolean } {
  const fin = new Date(`${jusquA}T00:00:00Z`).getTime();
  if (!Number.isFinite(fin)) return { jours: [], tronque: false };

  let debut: number;
  if (dernierTraite) {
    const dernier = new Date(`${dernierTraite}T00:00:00Z`).getTime();
    if (!Number.isFinite(dernier)) return { jours: [], tronque: false };
    // Deja a jour, ou en avance (horloge decalee) : rien a faire.
    if (dernier >= fin) return { jours: [], tronque: false };
    debut = dernier + UN_JOUR;
  } else {
    debut = fin;
  }

  const jours: string[] = [];
  for (let t = debut; t <= fin; t += UN_JOUR) {
    jours.push(jourIso(new Date(t)));
  }

  // On garde les jours les PLUS RECENTS : si l'arriere est trop long, mieux vaut
  // rattraper ce qui est proche et signaler le reste que de s'arreter au plus
  // ancien et laisser le present en souffrance.
  if (jours.length > plafond) {
    return { jours: jours.slice(-plafond), tronque: true };
  }
  return { jours, tronque: false };
}

/**
 * Le prix retenu pour une journee : le DERNIER releve de cette journee-la.
 *
 * C'est la cloture de fait, coherente avec « un jour n'est revolu qu'une fois
 * termine ». Prendre le dernier prix connu tous jours confondus reviendrait a
 * valoriser un jour passe au cours d'aujourd'hui.
 */
export async function prixDuJour(db: D1Database, date: string): Promise<number | null> {
  const ligne = await db
    .prepare(
      `SELECT price_xof FROM gold_prices
       WHERE timestamp >= ? AND timestamp < ?
       ORDER BY timestamp DESC LIMIT 1`
    )
    .bind(`${date} 00:00:00`, `${date} 23:59:59`)
    .first<{ price_xof: number }>();

  return ligne && ligne.price_xof > 0 ? ligne.price_xof : null;
}

/**
 * Construit le plan de rattrapage d'un beneficiaire.
 *
 * Un jour sans prix releve n'est PAS valorise : le relevé a echoue ce jour-la, il
 * n'existe aucune valeur defendable, et en inventer une produirait un chiffre
 * qu'aucun audit ne pourrait justifier (ADR 011).
 */
export async function planifierRattrapage(
  db: D1Database,
  dernierTraite: string | null | undefined,
  jusquA: string,
  plafond: number
): Promise<PlanRattrapage> {
  const { jours: dus, tronque } = joursDus(dernierTraite, jusquA, plafond);
  const jours: JourARattraper[] = [];
  const sansPrix: string[] = [];

  for (const date of dus) {
    const prix = await prixDuJour(db, date);
    if (prix === null) {
      sansPrix.push(date);
      continue;
    }
    jours.push({ date, pricePerGram: prix });
  }

  return { jours, sansPrix, tronque };
}
