/**
 * Ownership certificate as a PDF.
 *
 * The HTML certificate stays — it is what the app displays. This is the file a
 * holder downloads, sends to a bank, or keeps: a PDF opens the same way on
 * every machine in ten years, which an HTML page with an external QR image does
 * not.
 *
 * Two rules the document must not break:
 *
 *  1. NO PRICE. Gold moves; a value printed today is wrong tomorrow and a
 *     certificate carrying a stale valuation is worse than one carrying none.
 *
 *  2. Leased grams are stated separately. Since the lease exists, the wallet
 *     balance is not the whole holding — and lent gold is a claim on a
 *     counterparty, not metal in the vault. Folding the two into one number
 *     would be the same overstatement the reserve page refuses to make.
 */

import type { PdfDoc, PdfBlock } from './pdf';

export interface CertificateDocumentInput {
  certificateId: string;
  verificationCode: string;
  holderName: string;
  holderEmail: string;
  kycLevel: string;
  /** Grams held in the wallet — spendable today. */
  walletGrams: number;
  /** Grams currently in a lease: owned, lent out, not spendable. */
  leasedGrams: number;
  issuedAt: string;
  verifyUrl: string;
  platformName: string;
}

const g = (n: number) => `${(Math.round(n * 1000) / 1000).toFixed(3)} g`;

const KYC_LABELS: Record<string, string> = {
  BASIC: 'Niveau 1 — identité déclarée',
  STANDARD: 'Niveau 2 — identité vérifiée',
  VERIFIED: 'Niveau 3 — identité et justificatifs vérifiés',
};

function frenchDate(iso: string): string {
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  // Built by hand rather than with toLocaleString: the ICU data available to a
  // Worker is not guaranteed, and a certificate must read the same wherever it
  // is generated.
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function totalOwnedGrams(input: {
  walletGrams: number;
  leasedGrams: number;
}): number {
  return Math.round((input.walletGrams + input.leasedGrams) * 1000) / 1000;
}

export function buildCertificateDocument(input: CertificateDocumentInput): PdfDoc {
  const total = totalOwnedGrams(input);
  const hasLease = input.leasedGrams > 0;

  const blocks: PdfBlock[] = [
    {
      type: 'paragraph',
      text:
        `${input.platformName} atteste que le titulaire désigné ci-dessous détient, ` +
        `à la date d'émission du présent certificat, la quantité d'or affiné indiquée. ` +
        `Chaque token représente 1 gramme d'or physique conservé par l'État partenaire.`,
    },
    { type: 'heading', text: 'Titulaire' },
    {
      type: 'keyValue',
      rows: [
        ['Nom', input.holderName],
        ['Courriel', input.holderEmail],
        ['Vérification d\'identité', KYC_LABELS[input.kycLevel] || input.kycLevel],
      ],
    },
    { type: 'heading', text: 'Quantité détenue' },
  ];

  if (hasLease) {
    // Two lines, never one: lent gold is owed to the holder, not held for them.
    blocks.push({
      type: 'table',
      columns: ['Détention', 'Poids'],
      rows: [
        ['Disponible en portefeuille', g(input.walletGrams)],
        ['Placé en location (prêté)', g(input.leasedGrams)],
        ['Total détenu', g(total)],
      ],
    });
    blocks.push({
      type: 'note',
      text:
        "La part placée en location est prêtée à une contrepartie : elle appartient au " +
        "titulaire et lui sera restituée au terme du délai de rappel, mais elle n'est pas " +
        'physiquement en coffre à la date du présent certificat et ne peut être vendue tant ' +
        'que la position reste ouverte.',
    });
  } else {
    blocks.push({
      type: 'keyValue',
      rows: [
        ['Or détenu', g(total)],
        ['Équivalent', `${(Math.round(total * 1000) / 1000).toFixed(3)} token(s)`],
        ['Titre', "1 token = 1 gramme d'or affiné"],
      ],
    });
  }

  blocks.push({ type: 'heading', text: 'Authenticité' });
  blocks.push({
    type: 'keyValue',
    rows: [
      ['Numéro de certificat', input.certificateId],
      ['Code de vérification', input.verificationCode],
      ['Émis le', frenchDate(input.issuedAt)],
    ],
  });
  blocks.push({
    type: 'paragraph',
    text: `Vérifiez ce certificat sur ${input.verifyUrl} en saisissant le code ci-dessus.`,
  });

  blocks.push({
    type: 'note',
    // Deliberate: no valuation anywhere on the document.
    text:
      "Ce certificat atteste d'une quantité d'or, jamais d'une valeur : le cours de l'or " +
      "varie et toute somme imprimée ici serait fausse dès le lendemain. Il constate la " +
      "situation à la date d'émission et ne vaut pas pour une date ultérieure ; le solde " +
      'fait foi dans le registre de la plateforme.',
  });

  return {
    title: 'Certificat de propriété',
    subtitle: `${input.platformName} — ${input.certificateId}`,
    footer: `${input.certificateId} · code ${input.verificationCode} · ${input.verifyUrl}`,
    blocks,
  };
}
