import { fileURLToPath } from 'node:url';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Box, PdfIndex } from '../core/types.ts';

const assets = fileURLToPath(new URL('../../../node_modules/pdfjs-dist/', import.meta.url));
export interface PdfAnalysis {
  index: PdfIndex;
  images: string[];
}
export async function analyzePdf(bytes: Uint8Array): Promise<PdfAnalysis> {
  const index: PdfIndex = { pages: [], tokens: [], links: [], warnings: [] };
  const images: string[] = [];
  let doc: PDFDocumentProxy | undefined;
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    wasmUrl: `${assets}wasm/`,
    stopAtErrors: true,
  });
  task.onPassword = () => task.destroy();
  try {
    doc = await task.promise;
    if (doc.numPages > 100) throw new Error('v0.1 supports up to 100 PDF pages.');
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const rect = (r: number[]): Box => {
        const [a, b, c, d, e, f] = viewport.transform;
        const [x1, y1, x2, y2] = [
          a * r[0] + c * r[1] + e,
          b * r[0] + d * r[1] + f,
          a * r[2] + c * r[3] + e,
          b * r[2] + d * r[3] + f,
        ];
        return {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        };
      };
      const content = await page.getTextContent();
      const pageText: string[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [a, b, , , x, y] = item.transform;
        if (Math.abs(b) > 0.1 || a < 0 || item.dir === 'ttb')
          index.warnings.push(`Page ${n}: rotated/vertical text needs manual inspection.`);
        index.tokens.push({
          page: n,
          text: item.str,
          lineEnd: item.hasEOL,
          box: rect([x, y, x + item.width, y + Math.max(item.height, 1)]),
        });
        pageText.push(item.str);
      }
      index.pages.push({
        number: n,
        width: viewport.width,
        height: viewport.height,
        text: pageText.join(' '),
      });
      for (const annotation of await page.getAnnotations({ intent: 'display' })) {
        if (
          annotation.subtype === 'Link' &&
          typeof annotation.url === 'string' &&
          Array.isArray(annotation.rect)
        )
          index.links.push({ page: n, box: rect(annotation.rect), href: annotation.url });
      }
      try {
        const scale = Math.min(1.25, Math.sqrt(2_000_000 / (viewport.width * viewport.height)));
        const renderViewport = page.getViewport({ scale });
        // PDF.js uses its own bundled Node canvas factory; no additional canvas dependency.
        const factory = doc.canvasFactory as {
          create(
            w: number,
            h: number,
          ): {
            canvas: HTMLCanvasElement & { toBuffer(type: string): Buffer };
            context: CanvasRenderingContext2D;
          };
          destroy(c: unknown): void;
        };
        const canvas = factory.create(
          Math.ceil(renderViewport.width),
          Math.ceil(renderViewport.height),
        );
        try {
          await page.render({
            canvas: canvas.canvas,
            canvasContext: canvas.context,
            viewport: renderViewport,
          }).promise;
          images.push(
            `data:image/png;base64,${canvas.canvas.toBuffer('image/png').toString('base64')}`,
          );
        } finally {
          factory.destroy(canvas);
        }
      } catch {
        images.push('');
        index.warnings.push(`Page ${n}: preview could not be rendered.`);
      }
      page.cleanup();
    }
    if (index.warnings.some((w) => w.includes('rotated/vertical')))
      index.error =
        'Rotated or vertical text is not reliably mapped by v0.1. Inspect this PDF manually.';
  } catch (error) {
    index.error = `Cannot read PDF: ${error instanceof Error ? error.message : 'unknown PDF error'}`;
  } finally {
    await task.destroy();
  }
  return { index, images };
}
