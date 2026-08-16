/**
 * Minimal PDF writer — no dependency, no headless browser.
 *
 * The documents this platform produces (Proof of Reserve report, settlement
 * statement, ownership certificate) are structured text: headings, key/value
 * rows, small tables. That needs a fraction of a PDF library, and a Worker has
 * neither a browser to print from nor room for a heavy dependency.
 *
 * Produces PDF 1.4 with the base-14 fonts, which every reader supports without
 * embedding. Text is WinAnsi-encoded, so accented French characters render
 * correctly rather than turning into mojibake on a legal document.
 */

export interface PdfDoc {
  title: string;
  subtitle?: string;
  /** Small print at the bottom of every page. */
  footer?: string;
  blocks: PdfBlock[];
}

export type PdfBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'keyValue'; rows: Array<[string, string]> }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'spacer'; height?: number }
  | { type: 'note'; text: string };

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const LINE = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/**
 * WinAnsi (CP1252) encoding for the characters a French document actually uses.
 * Anything outside it degrades to its unaccented form rather than to a broken
 * glyph — a certificate with "PropriÃ©tÃ©" on it is not acceptable.
 */
const WIN_ANSI: Record<string, number> = {
  '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135,
  'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, '‘': 145, '’': 146,
  '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '™': 153, 'š': 154,
  '›': 155, 'œ': 156, 'Ÿ': 159,
};

const FALLBACK: Record<string, string> = {
  '≤': '<=', '≥': '>=', '·': '-', '—': '-', '–': '-', '’': "'", '“': '"', '”': '"',
};

/**
 * Group digits with a plain space.
 *
 * Deliberately not `toLocaleString`: its separator depends on the ICU build and
 * is a narrow no-break space that base-14 PDF fonts cannot encode. A document
 * that states an amount must state the same amount everywhere it is generated.
 */
export function groupDigits(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function encodeText(input: string): string {
  // The exotic spaces locale formatting emits: U+202F (the narrow no-break
  // space French thousands separators use), U+00A0, U+2009. None is encodable
  // in a base-14 font, so an amount would print as "33?000?000 XOF" on a legal
  // document. Normalised before encoding rather than left to the fallback.
  const normalized = input.replace(/[   ]/g, ' ');

  let out = '';
  for (const char of normalized) {
    const code = char.codePointAt(0)!;
    if (code < 128) {
      out += char;
    } else if (WIN_ANSI[char] !== undefined) {
      out += String.fromCharCode(WIN_ANSI[char]);
    } else if (code <= 255) {
      // Latin-1 range maps straight through in WinAnsi (é, à, ç, ...).
      out += char;
    } else if (FALLBACK[char]) {
      out += FALLBACK[char];
    } else {
      out += '?';
    }
  }
  // Escape the three characters that would otherwise break a PDF string.
  return out.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Rough width in points, enough to wrap and to right-align numbers. */
function textWidth(text: string, size: number): number {
  return text.length * size * 0.5;
}

function wrap(text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

interface Op {
  font: 'F1' | 'F2';
  size: number;
  x: number;
  y: number;
  text: string;
}

/** Lay blocks out into pages, so a long report paginates instead of overflowing. */
function layout(doc: PdfDoc): Op[][] {
  const pages: Op[][] = [];
  let ops: Op[] = [];
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    if (ops.length) pages.push(ops);
    ops = [];
    y = PAGE_HEIGHT - MARGIN;
  };

  const need = (height: number) => {
    if (y - height < MARGIN + 40) newPage();
  };

  const write = (text: string, size: number, font: 'F1' | 'F2', x = MARGIN) => {
    ops.push({ font, size, x, y, text });
    y -= LINE;
  };

  // Title block
  write(doc.title, 18, 'F2');
  if (doc.subtitle) {
    y -= 2;
    write(doc.subtitle, 10, 'F1');
  }
  y -= 10;

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading':
        need(LINE * 2);
        y -= 6;
        write(block.text, 12, 'F2');
        y -= 2;
        break;

      case 'paragraph':
        for (const line of wrap(block.text, 10, CONTENT_WIDTH)) {
          need(LINE);
          write(line, 10, 'F1');
        }
        break;

      case 'note':
        for (const line of wrap(block.text, 8, CONTENT_WIDTH)) {
          need(LINE);
          write(line, 8, 'F1');
        }
        break;

      case 'keyValue':
        for (const [key, value] of block.rows) {
          need(LINE);
          ops.push({ font: 'F1', size: 10, x: MARGIN, y, text: key });
          ops.push({ font: 'F2', size: 10, x: MARGIN + 200, y, text: value });
          y -= LINE;
        }
        break;

      case 'table': {
        const colWidth = CONTENT_WIDTH / block.columns.length;
        need(LINE * 2);
        block.columns.forEach((col, i) => {
          ops.push({ font: 'F2', size: 9, x: MARGIN + i * colWidth, y, text: col });
        });
        y -= LINE;
        for (const row of block.rows) {
          need(LINE);
          row.forEach((cell, i) => {
            ops.push({ font: 'F1', size: 9, x: MARGIN + i * colWidth, y, text: cell });
          });
          y -= LINE;
        }
        break;
      }

      case 'spacer':
        y -= block.height ?? LINE;
        break;
    }
  }

  if (ops.length) pages.push(ops);
  return pages.length ? pages : [[]];
}

function contentStream(ops: Op[], footer?: string): string {
  let s = 'BT\n';
  for (const op of ops) {
    s += `/${op.font} ${op.size} Tf\n1 0 0 1 ${op.x.toFixed(2)} ${op.y.toFixed(2)} Tm\n(${encodeText(op.text)}) Tj\n`;
  }
  if (footer) {
    s += `/F1 7 Tf\n1 0 0 1 ${MARGIN} ${MARGIN - 20} Tm\n(${encodeText(footer)}) Tj\n`;
  }
  s += 'ET';
  return s;
}

/**
 * Render a document to PDF bytes.
 *
 * Builds the xref table by hand: byte offsets must be exact or readers reject
 * the file, which is why the objects are assembled into a single buffer and
 * measured as they go.
 */
export function renderPdf(doc: PdfDoc): Uint8Array {
  const pages = layout(doc);
  const objects: string[] = [];

  // 1 catalog, 2 page tree, 3-4 fonts, then per page: page object + content.
  const pageObjectIds = pages.map((_, i) => 5 + i * 2);
  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(' ');

  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

  pages.forEach((ops, i) => {
    const contentId = pageObjectIds[i] + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    const stream = contentStream(ops, doc.footer);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  // Latin-1: every byte written above is already in the 0-255 range, and a
  // UTF-8 encode would corrupt both the accents and the xref offsets.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
