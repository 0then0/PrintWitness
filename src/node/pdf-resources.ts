import { readFile } from 'node:fs/promises';

// Resolve the very entry point imported by pdf.ts, respecting package exports.
// In pdfjs-dist 6.4.299 it lives at legacy/build/pdf.mjs; package.json has no exports.
export const pdfResourceRoot = new URL(
  '../../',
  import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'),
);

const directories = {
  cMapUrl: 'cmaps',
  standardFontDataUrl: 'standard_fonts',
  wasmUrl: 'wasm',
} as const;

// PDF.js can catch a failed fetch and continue with empty text or a fallback.
// Keep a per-document record independently of its warnings and recovery policy.
export function pdfResources(root: URL = pdfResourceRoot) {
  if (root.protocol !== 'file:' || !root.pathname.endsWith('/'))
    throw new Error('PDF resources require a local directory URL.');
  const failures = new Set<string>();
  class BinaryDataFactory {
    async fetch({ kind, filename }: { kind: string; filename: string }) {
      try {
        if (!Object.hasOwn(directories, kind) || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(filename))
          throw new Error('Unsupported PDF resource request.');
        const directory = directories[kind as keyof typeof directories];
        const bytes = await readFile(new URL(`${directory}/${filename}`, root));
        if (!bytes.length) throw new Error('Empty PDF resource.');
        return new Uint8Array(bytes);
      } catch (error) {
        failures.add(`${kind}/${filename}`);
        throw error;
      }
    }
  }
  return {
    failures,
    options: {
      BinaryDataFactory,
      useWorkerFetch: false,
      useSystemFonts: false,
      cMapUrl: new URL('cmaps/', root).href,
      standardFontDataUrl: new URL('standard_fonts/', root).href,
      // PDF.js dynamically imports decoder JS fallbacks from here as well.
      wasmUrl: new URL('wasm/', root).href,
      cMapPacked: true,
    },
  };
}
