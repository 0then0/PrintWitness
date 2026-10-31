import { mkdir, writeFile } from 'node:fs/promises';

// Original synthetic documents, Apache-2.0. No external files, fonts or tools.
const output = new URL('../fixtures/pdf/', import.meta.url);
await mkdir(output, { recursive: true });
function pdf(objects: string[]) {
  let body = '%PDF-1.7\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('');
  return `${body}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
const stream = (text: string) =>
  `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
for (const name of ['predefined-cmap', 'plain', 'textless']) {
  const content =
    name === 'textless'
      ? '0.5 g 30 30 100 100 re f'
      : name === 'predefined-cmap'
        ? 'BT /F2 16 Tf 30 250 Td <65E5672C8A9E> Tj ET'
        : `BT /F1 16 Tf 30 250 Td (Required) Tj 0 -40 Td (Plain control) Tj /F1 16 Tf 0 -40 Td (End) Tj ET`;
  await writeFile(
    new URL(`${name}.pdf`, output),
    pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
      stream(content),
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Font /Subtype /Type0 /BaseFont /PWFixture /Encoding /UniJIS-UCS2-H /DescendantFonts [7 0 R] >>',
      '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /PWFixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor 8 0 R /DW 1000 >>',
      '<< /Type /FontDescriptor /FontName /PWFixture /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>',
    ]),
  );
}
await writeFile(
  new URL('corrupt.pdf', output),
  '%PDF-1.7\nDeliberately truncated synthetic PDF.\n',
);
