import { describe, it, expect } from 'vitest';
import { renderPdf, type PdfDoc } from './pdf';

const decode = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

function doc(overrides: Partial<PdfDoc> = {}): PdfDoc {
  return {
    title: 'Preuve de réserve',
    subtitle: 'TNC Trading',
    blocks: [{ type: 'paragraph', text: 'Contenu' }],
    ...overrides,
  };
}

describe('renderPdf', () => {
  it('produces a file a reader will accept', () => {
    const pdf = decode(renderPdf(doc()));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('/Type /Pages');
    expect(pdf).toContain('xref');
    expect(pdf).toContain('trailer');
  });

  it('writes byte offsets that actually point at their objects', () => {
    // A wrong xref is the classic way to produce a file that looks fine and
    // that no reader will open, so this is checked rather than assumed.
    const pdf = decode(renderPdf(doc()));

    const startxref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

    const entries = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThan(3);
    entries.forEach((offset, i) => {
      expect(pdf.slice(offset)).toMatch(new RegExp(`^${i + 1} 0 obj`));
    });
  });

  it('keeps French accents intact rather than mangling them', () => {
    // "PropriÃ©tÃ©" on a certificate would not be acceptable.
    const pdf = decode(renderPdf(doc({ title: 'Certificat de propriété' })));
    expect(pdf).toContain('Certificat de propriété');
  });

  it('escapes characters that would otherwise break the file', () => {
    const pdf = decode(renderPdf(doc({ blocks: [{ type: 'paragraph', text: 'Lot (A) 50% \\ fin' }] })));
    expect(pdf).toContain('Lot \\(A\\) 50% \\\\ fin');
  });

  it('degrades a character it cannot encode instead of emitting a broken glyph', () => {
    const pdf = decode(renderPdf(doc({ blocks: [{ type: 'paragraph', text: 'tokens ≤ or' }] })));
    expect(pdf).toContain('tokens <= or');
  });

  it('renders every block type', () => {
    const pdf = decode(
      renderPdf(
        doc({
          blocks: [
            { type: 'heading', text: 'Réserve' },
            { type: 'keyValue', rows: [['Or alloué', '10000.000 g']] },
            { type: 'table', columns: ['Lot', 'Poids'], rows: [['CONS-AB12', '900.000 g']] },
            { type: 'spacer' },
            { type: 'note', text: 'Document généré automatiquement' },
          ],
        })
      )
    );
    expect(pdf).toContain('Réserve');
    expect(pdf).toContain('Or alloué');
    expect(pdf).toContain('CONS-AB12');
    expect(pdf).toContain('Document généré');
  });

  it('paginates instead of writing past the bottom of the page', () => {
    const many: PdfDoc['blocks'] = Array.from({ length: 200 }, (_, i) => ({
      type: 'paragraph' as const,
      text: `Ligne ${i}`,
    }));
    const pdf = decode(renderPdf(doc({ blocks: many })));

    const count = Number(pdf.match(/\/Count (\d+)/)![1]);
    expect(count).toBeGreaterThan(1);
    expect((pdf.match(/\/Type \/Page[^s]/g) || []).length).toBe(count);
  });

  it('repeats the footer on each page', () => {
    const many: PdfDoc['blocks'] = Array.from({ length: 200 }, () => ({
      type: 'paragraph' as const,
      text: 'x',
    }));
    const pdf = decode(renderPdf(doc({ blocks: many, footer: 'tnc.trading' })));
    expect((pdf.match(/tnc\.trading/g) || []).length).toBeGreaterThan(1);
  });

  it('handles an empty document without producing a corrupt file', () => {
    const pdf = decode(renderPdf({ title: 'Vide', blocks: [] }));
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pdf).toContain('/Count 1');
  });
});
